import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryMethod, ProductRequestStatus, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { memoryStorage } from 'multer';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationQuery } from '../common/pagination';
import { SourcingService } from './sourcing.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value);
const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const HTTP_URL = { protocols: ['http', 'https'], require_protocol: true };

class CreateRequestDto {
  @IsOptional() @Transform(trim) @IsUrl(HTTP_URL) @MaxLength(2000) productUrl?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) title?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(999) quantity!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) preferredSize?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) preferredColor?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1500) instructions?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{2}$/) destinationCountry?: string;
}
class ListRequestsQuery extends PaginationQuery {
  @IsOptional() @IsEnum(ProductRequestStatus) status?: ProductRequestStatus;
}
class AcceptDto {
  @IsString() addressId!: string;
  @IsOptional() @IsEnum(DeliveryMethod) deliveryMethod?: DeliveryMethod;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) customerNote?: string;
}
class AdminListRequestsQuery extends ListRequestsQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() assignedToId?: string;
}
class ReviewDto {
  @IsOptional() @IsIn(['UNDER_REVIEW', 'REJECTED']) status?: 'UNDER_REVIEW' | 'REJECTED';
  @IsOptional() @IsString() assignedToId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) reason?: string;
}
class QuotationDto {
  @Transform(toStr) @Matches(MONEY, { message: 'productCost must be a positive amount' }) productCost!: string;
  @Transform(toStr) @Matches(MONEY, { message: 'shippingCost must be a non-negative amount' }) shippingCost!: string;
  @Transform(toStr) @Matches(MONEY, { message: 'serviceFee must be a non-negative amount' }) serviceFee!: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY, { message: 'taxAmount must be a non-negative amount' }) taxAmount?: string;
  @Transform(upper) @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsDateString() validUntil!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}
class CreateQuotationDto extends QuotationDto {
  /** Publish immediately instead of saving a draft. */
  @IsOptional() @IsBoolean() send?: boolean;
}
class UpdateQuotationDto {
  @IsOptional() @Transform(toStr) @Matches(MONEY) productCost?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) shippingCost?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) serviceFee?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) taxAmount?: string;
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsDateString() validUntil?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}

@ApiTags('Sourcing')
@ApiBearerAuth()
@Controller()
export class SourcingController {
  constructor(private readonly sourcing: SourcingService) {}

  @Post('product-requests')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Ask us to source a product: a supplier link and/or a photo (JPEG/PNG/WebP, 5 MB)' })
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: AuthUser, @UploadedFile() image?: Express.Multer.File) {
    return this.sourcing.create(user.id, dto, image);
  }

  @Get('product-requests')
  list(@Query() q: ListRequestsQuery, @CurrentUser() user: AuthUser) {
    return this.sourcing.listMine(user.id, q);
  }

  @Get('product-requests/:id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sourcing.getMine(user.id, id);
  }

  @Post('product-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sourcing.cancelMine(user.id, id);
  }

  @Get('quotations')
  quotations(@CurrentUser() user: AuthUser) {
    return this.sourcing.listQuotationsMine(user.id);
  }

  @Post('quotations/:id/accept')
  @ApiOperation({ summary: 'Accept a quotation: creates an order awaiting payment' })
  accept(@Param('id') id: string, @Body() dto: AcceptDto, @CurrentUser() user: AuthUser) {
    return this.sourcing.accept(user.id, id, dto);
  }

  @Post('quotations/:id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sourcing.reject(user.id, id);
  }
}

@ApiTags('Admin · Sourcing')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class AdminSourcingController {
  constructor(
    private readonly sourcing: SourcingService,
    private readonly audit: AuditService,
  ) {}

  @Get('product-requests')
  list(@Query() q: AdminListRequestsQuery) {
    return this.sourcing.adminList(q);
  }

  @Get('product-requests/:id')
  get(@Param('id') id: string) {
    return this.sourcing.adminGet(id);
  }

  @Patch('product-requests/:id')
  @ApiOperation({ summary: 'Start review, decline (reason required, customer is notified) and/or assign to a team member' })
  async review(@Param('id') id: string, @Body() dto: ReviewDto, @CurrentUser() actor: AuthUser) {
    const r = await this.sourcing.review(id, dto);
    await this.audit.log({ actorId: actor.id, action: 'product_request.review', entity: 'ProductRequest', entityId: id, metadata: { status: dto.status ?? null, assignedToId: dto.assignedToId ?? null } });
    return r;
  }

  @Post('product-requests/:id/quotations')
  @ApiOperation({ summary: 'Create a quotation (total is computed server-side). Set send=true to publish immediately.' })
  async createQuotation(@Param('id') id: string, @Body() dto: CreateQuotationDto, @CurrentUser() actor: AuthUser) {
    const q = await this.sourcing.createQuotation(id, dto, actor.id);
    await this.audit.log({ actorId: actor.id, action: 'quotation.create', entity: 'Quotation', entityId: q.id, metadata: { requestId: id, sent: !!dto.send } });
    return q;
  }

  @Patch('quotations/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @CurrentUser() actor: AuthUser) {
    const q = await this.sourcing.updateQuotation(id, dto);
    await this.audit.log({ actorId: actor.id, action: 'quotation.update', entity: 'Quotation', entityId: id });
    return q;
  }

  @Post('quotations/:id/send')
  @HttpCode(200)
  async send(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const q = await this.sourcing.send(id);
    await this.audit.log({ actorId: actor.id, action: 'quotation.send', entity: 'Quotation', entityId: id });
    return q;
  }
}
