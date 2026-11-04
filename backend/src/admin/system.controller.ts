import { Body, ConflictException, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, ReviewStatus, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery, pageResult, paginate } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

class CreateCurrencyDto {
  @Transform(upper) @Matches(/^[A-Z]{3}$/, { message: 'code must be a 3-letter ISO 4217 code' }) code!: string;
  @Transform(trim) @IsString() @MaxLength(60) name!: string;
  @Transform(trim) @IsString() @MaxLength(8) symbol!: string;
  /** Decimal places used when rounding amounts. Fixed at creation so historical rounding stays consistent. */
  @Type(() => Number) @IsInt() @Min(0) @Max(4) decimals!: number;
}
class UpdateCurrencyDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(8) symbol?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class RatesQuery extends PaginationQuery {
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) quote?: string;
}
class AuditQuery extends PaginationQuery {
  @IsOptional() @IsString() actorId?: string;
  @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
class ReviewsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(ReviewStatus) status?: ReviewStatus;
  @IsOptional() @IsString() productId?: string;
}
class ModerateDto {
  @IsEnum(ReviewStatus) status!: ReviewStatus;
}

@ApiTags('Admin · System')
@ApiBearerAuth()
@Controller('admin')
export class SystemAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───── Currencies & exchange-rate history ─────
  @Roles(Role.ADMIN, Role.STAFF)
  @Get('currencies')
  currencies() {
    return this.prisma.currency.findMany({ orderBy: { code: 'asc' } });
  }

  @Roles(Role.ADMIN)
  @Post('currencies')
  async createCurrency(@Body() dto: CreateCurrencyDto, @CurrentUser() actor: AuthUser) {
    if (await this.prisma.currency.findUnique({ where: { code: dto.code } })) throw new ConflictException('This currency already exists');
    const row = await this.prisma.currency.create({ data: dto });
    await this.audit.log({ actorId: actor.id, action: 'currency.create', entity: 'Currency', entityId: row.code });
    return row;
  }

  @Roles(Role.ADMIN)
  @Patch('currencies/:code')
  async updateCurrency(@Param('code') code: string, @Body() dto: UpdateCurrencyDto, @CurrentUser() actor: AuthUser) {
    const row = await this.prisma.currency.update({ where: { code: code.toUpperCase() }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'currency.update', entity: 'Currency', entityId: row.code, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @Get('exchange-rates')
  async rates(@Query() q: RatesQuery) {
    const where: Prisma.ExchangeRateWhereInput = q.quote ? { quoteCurrency: q.quote } : {};
    const [items, total] = await Promise.all([
      this.prisma.exchangeRate.findMany({ where, orderBy: { effectiveAt: 'desc' }, ...paginate(q) }),
      this.prisma.exchangeRate.count({ where }),
    ]);
    return pageResult(items, total, q);
  }

  // ───── Audit log ─────
  @Roles(Role.ADMIN)
  @Get('audit-logs')
  async auditLogs(@Query() q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { contains: q.action, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q), include: { actor: { select: { id: true, email: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return pageResult(items, total, q);
  }

  // ───── Review moderation ─────
  @Roles(Role.ADMIN, Role.STAFF)
  @Get('reviews')
  async reviews(@Query() q: ReviewsQuery) {
    const where: Prisma.ReviewWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.productId ? { productId: q.productId } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q), include: { product: { select: { name: true, slug: true } }, user: { select: { email: true } } } }),
      this.prisma.review.count({ where }),
    ]);
    return pageResult(items, total, q);
  }

  @Roles(Role.ADMIN, Role.STAFF)
  @Patch('reviews/:id')
  async moderate(@Param('id') id: string, @Body() dto: ModerateDto, @CurrentUser() actor: AuthUser) {
    const review = await this.prisma.$transaction(async (tx) => {
      const r = await tx.review.update({ where: { id }, data: { status: dto.status } });
      const agg = await tx.review.aggregate({ where: { productId: r.productId, status: ReviewStatus.APPROVED }, _avg: { rating: true }, _count: { _all: true } });
      await tx.product.update({ where: { id: r.productId }, data: { ratingAverage: new Prisma.Decimal(agg._avg.rating ?? 0).toDecimalPlaces(2), ratingCount: agg._count._all } });
      return r;
    });
    await this.audit.log({ actorId: actor.id, action: 'review.moderate', entity: 'Review', entityId: id, metadata: { status: dto.status } });
    return review;
  }
}
