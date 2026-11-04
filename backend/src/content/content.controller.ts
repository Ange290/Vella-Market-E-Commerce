import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, Role, SupportStatus } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUrl, Length, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery, pageResult, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true };
/** Internal paths ("/shop") or absolute http(s) URLs only: never javascript: or data: links. */
const LINK = /^(\/[^\s]*|https?:\/\/[^\s]+)$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

class UpsertContentDto {
  @Transform(trim) @IsString() @Length(2, 150) title!: string;
  /** Plain text / Markdown. It is never treated as HTML: clients must render it with a safe Markdown renderer. */
  @IsString() @Length(1, 100_000) body!: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}
class PromotionDto {
  @Transform(trim) @IsString() @Length(2, 120) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsUrl(HTTP_URL) bannerUrl?: string;
  @IsOptional() @Matches(LINK, { message: 'linkUrl must be an internal path or an http(s) URL' }) linkUrl?: string;
  @IsOptional() @IsString() couponId?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdatePromotionDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsUrl(HTTP_URL) bannerUrl?: string;
  @IsOptional() @Matches(LINK) linkUrl?: string;
  @IsOptional() @IsString() couponId?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ContactDto {
  @Transform(trim) @IsString() @Length(2, 100) name!: string;
  @Transform(normEmail) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @Length(3, 150) subject!: string;
  @Transform(trim) @IsString() @Length(10, 5000) message!: string;
}
class SupportQuery extends PaginationQuery {
  @IsOptional() @IsEnum(SupportStatus) status?: SupportStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
}
class SupportStatusDto {
  @IsIn([SupportStatus.IN_PROGRESS, SupportStatus.RESOLVED, SupportStatus.CLOSED]) status!: 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
}

// ───────────── Public ─────────────

@ApiTags('Content')
@Public()
@Controller()
export class PublicContentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('content')
  @ApiOperation({ summary: 'Titles of published pages (for footers and menus)' })
  list() {
    return this.prisma.contentPage.findMany({ where: { isPublished: true }, select: { slug: true, title: true }, orderBy: { slug: 'asc' } });
  }

  @Get('content/:slug')
  @ApiOperation({ summary: 'A published page: about, faq, terms, privacy, …' })
  async page(@Param('slug') slug: string) {
    const page = await this.prisma.contentPage.findFirst({ where: { slug, isPublished: true }, select: { slug: true, title: true, body: true, updatedAt: true } });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  @Get('promotions')
  @ApiOperation({ summary: 'Currently running promotions (banners), with the linked coupon code when it is still valid' })
  async promotions() {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, subtitle: true, bannerUrl: true, linkUrl: true, endsAt: true, coupon: { select: { code: true, isActive: true, expiresAt: true, maxUses: true, usedCount: true } } },
    });
    return rows.map(({ coupon, ...p }) => {
      const live = coupon && coupon.isActive && (!coupon.expiresAt || coupon.expiresAt > now) && (coupon.maxUses === null || coupon.usedCount < coupon.maxUses);
      return { ...p, couponCode: live ? coupon!.code : null };
    });
  }

  @Post('support')
  @HttpCode(201)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Contact form: creates a support request for the team' })
  async contact(@Body() dto: ContactDto) {
    const row = await this.prisma.supportRequest.create({ data: dto, select: { id: true, createdAt: true } });
    return { id: row.id, message: 'Thanks for contacting us. Our team will reply by email.' };
  }
}

// ───────────── Admin ─────────────

@ApiTags('Admin · Content')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class AdminContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───── Pages ─────
  @Get('content')
  pages() {
    return this.prisma.contentPage.findMany({ orderBy: { slug: 'asc' } });
  }

  @Get('content/:slug')
  async page(@Param('slug') slug: string) {
    const p = await this.prisma.contentPage.findUnique({ where: { slug } });
    if (!p) throw new NotFoundException('Page not found');
    return p;
  }

  @Put('content/:slug')
  @ApiOperation({ summary: 'Create or replace a page' })
  async upsert(@Param('slug') slug: string, @Body() dto: UpsertContentDto, @CurrentUser() actor: AuthUser) {
    if (!SLUG.test(slug) || slug.length > 60) throw new BadRequestException('Page slugs may contain lowercase letters, digits and hyphens only');
    const data = { title: dto.title, body: dto.body, isPublished: dto.isPublished ?? true, updatedById: actor.id };
    const page = await this.prisma.contentPage.upsert({ where: { slug }, update: data, create: { slug, ...data } });
    await this.audit.log({ actorId: actor.id, action: 'content.upsert', entity: 'ContentPage', entityId: slug });
    return page;
  }

  @Roles(Role.ADMIN)
  @Delete('content/:slug')
  @HttpCode(204)
  async removePage(@Param('slug') slug: string, @CurrentUser() actor: AuthUser) {
    await this.prisma.contentPage.delete({ where: { slug } });
    await this.audit.log({ actorId: actor.id, action: 'content.delete', entity: 'ContentPage', entityId: slug });
  }

  // ───── Promotions ─────
  @Get('promotions')
  promotions() {
    return this.prisma.promotion.findMany({ orderBy: { createdAt: 'desc' }, include: { coupon: { select: { code: true } } } });
  }

  @Post('promotions')
  async createPromotion(@Body() dto: PromotionDto, @CurrentUser() actor: AuthUser) {
    await this.validatePromotion(dto);
    const row = await this.prisma.promotion.create({ data: dto });
    await this.audit.log({ actorId: actor.id, action: 'promotion.create', entity: 'Promotion', entityId: row.id });
    return row;
  }

  @Patch('promotions/:id')
  async updatePromotion(@Param('id') id: string, @Body() dto: UpdatePromotionDto, @CurrentUser() actor: AuthUser) {
    const cur = await this.prisma.promotion.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Promotion not found');
    await this.validatePromotion({ ...dto, startsAt: dto.startsAt ?? cur.startsAt?.toISOString(), endsAt: dto.endsAt ?? cur.endsAt?.toISOString() });
    const row = await this.prisma.promotion.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'promotion.update', entity: 'Promotion', entityId: id, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  @Roles(Role.ADMIN)
  @Delete('promotions/:id')
  @HttpCode(204)
  async removePromotion(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.prisma.promotion.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'promotion.delete', entity: 'Promotion', entityId: id });
  }

  // ───── Support requests ─────
  @Get('support')
  async support(@Query() q: SupportQuery) {
    const where: Prisma.SupportRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ subject: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.supportRequest.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
      this.prisma.supportRequest.count({ where }),
    ]);
    return pageResult(items, total, q);
  }

  @Get('support/:id')
  async supportOne(@Param('id') id: string) {
    const r = await this.prisma.supportRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Support request not found');
    return r;
  }

  @Patch('support/:id')
  async setSupportStatus(@Param('id') id: string, @Body() dto: SupportStatusDto, @CurrentUser() actor: AuthUser) {
    const r = await this.prisma.supportRequest.update({ where: { id }, data: { status: dto.status } });
    await this.audit.log({ actorId: actor.id, action: 'support.status', entity: 'SupportRequest', entityId: id, metadata: { status: dto.status } });
    return r;
  }

  private async validatePromotion(dto: { couponId?: string; startsAt?: string; endsAt?: string }) {
    if (dto.startsAt && dto.endsAt && new Date(dto.startsAt) >= new Date(dto.endsAt)) throw new BadRequestException('endsAt must be after startsAt');
    if (dto.couponId && !(await this.prisma.coupon.findUnique({ where: { id: dto.couponId } }))) throw new BadRequestException('Coupon not found');
  }
}
