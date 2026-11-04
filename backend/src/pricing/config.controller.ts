import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CouponType, DeliveryMethod, Prisma, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { Allow, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const toStr = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PCT = /^(100(\.0{1,3})?|\d{1,2}(\.\d{1,3})?)$/;
const ISO2 = /^[A-Z]{2}$/;
const ISO3 = /^[A-Z]{3}$/;

// ───────── DTOs ─────────
class CreateShippingRateDto {
  @Transform(upper) @Matches(ISO2) destinationCountry!: string;
  @IsEnum(DeliveryMethod) method!: DeliveryMethod;
  @Transform(upper) @Matches(ISO3) currency!: string;
  @Transform(toStr) @Matches(MONEY, { message: 'baseFee must be a non-negative amount' }) baseFee!: string;
  @Transform(toStr) @Matches(MONEY, { message: 'perKgFee must be a non-negative amount' }) perKgFee!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minWeightGrams?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxWeightGrams?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) estimatedDaysMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) estimatedDaysMax?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateShippingRateDto {
  @IsOptional() @Transform(upper) @Matches(ISO3) currency?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) baseFee?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) perKgFee?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minWeightGrams?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxWeightGrams?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) estimatedDaysMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) estimatedDaysMax?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class TaxRuleDto {
  @Transform(upper) @Matches(ISO2) country!: string;
  @IsString() @MaxLength(60) name!: string;
  @Transform(toStr) @Matches(PCT, { message: 'ratePct must be between 0 and 100 (max 3 decimals)' }) ratePct!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateTaxRuleDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @Transform(toStr) @Matches(PCT) ratePct?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class SettingDto {
  @Allow()
  value!: unknown;
}
class CreateCouponDto {
  @Transform(upper) @Matches(/^[A-Z0-9_-]{3,30}$/, { message: 'code must be 3-30 letters, digits, - or _' }) code!: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsEnum(CouponType) type!: CouponType;
  @Transform(toStr) @Matches(MONEY) value!: string;
  @IsOptional() @Transform(upper) @Matches(ISO3) currency?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) minOrderAmount?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class UpdateCouponDto {
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @Transform(toStr) @Matches(MONEY) minOrderAmount?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class CountryQuery {
  @IsOptional() @Transform(upper) @Matches(ISO2) country?: string;
}

const isPositive = (s: string) => /[1-9]/.test(s);

/** Admin-managed pricing configuration. Nothing here has a built-in default value. */
@ApiTags('Admin · Pricing config')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin')
export class PricingConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───── Shipping rates ─────
  @Get('shipping-rates')
  listRates(@Query() q: CountryQuery) {
    return this.prisma.shippingRate.findMany({
      where: q.country ? { destinationCountry: q.country } : {},
      orderBy: [{ destinationCountry: 'asc' }, { method: 'asc' }, { minWeightGrams: 'asc' }],
    });
  }

  @Post('shipping-rates')
  @ApiOperation({ summary: 'fee = baseFee + perKgFee × cart weight (kg), for the matching weight band' })
  async createRate(@Body() dto: CreateShippingRateDto, @CurrentUser() actor: AuthUser) {
    await this.assertCurrency(dto.currency);
    const min = dto.minWeightGrams ?? 0;
    this.assertBands(min, dto.maxWeightGrams, dto.estimatedDaysMin, dto.estimatedDaysMax);
    const row = await this.prisma.shippingRate.create({ data: { ...dto, minWeightGrams: min } });
    await this.audit.log({ actorId: actor.id, action: 'shipping_rate.create', entity: 'ShippingRate', entityId: row.id });
    return row;
  }

  @Patch('shipping-rates/:id')
  async updateRate(@Param('id') id: string, @Body() dto: UpdateShippingRateDto, @CurrentUser() actor: AuthUser) {
    const cur = await this.prisma.shippingRate.findUniqueOrThrow({ where: { id } });
    if (dto.currency) await this.assertCurrency(dto.currency);
    this.assertBands(dto.minWeightGrams ?? cur.minWeightGrams, dto.maxWeightGrams ?? cur.maxWeightGrams ?? undefined, dto.estimatedDaysMin ?? cur.estimatedDaysMin ?? undefined, dto.estimatedDaysMax ?? cur.estimatedDaysMax ?? undefined);
    const row = await this.prisma.shippingRate.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'shipping_rate.update', entity: 'ShippingRate', entityId: id, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  @Roles(Role.ADMIN)
  @Delete('shipping-rates/:id')
  @HttpCode(204)
  async deleteRate(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.prisma.shippingRate.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'shipping_rate.delete', entity: 'ShippingRate', entityId: id });
  }

  // ───── Tax rules ─────
  @Get('tax-rules')
  listTax(@Query() q: CountryQuery) {
    return this.prisma.taxRule.findMany({ where: q.country ? { country: q.country } : {}, orderBy: [{ country: 'asc' }, { name: 'asc' }] });
  }

  @Roles(Role.ADMIN)
  @Post('tax-rules')
  async createTax(@Body() dto: TaxRuleDto, @CurrentUser() actor: AuthUser) {
    const row = await this.prisma.taxRule.create({ data: dto });
    await this.audit.log({ actorId: actor.id, action: 'tax_rule.create', entity: 'TaxRule', entityId: row.id, metadata: { country: dto.country, ratePct: dto.ratePct } });
    return row;
  }

  @Roles(Role.ADMIN)
  @Patch('tax-rules/:id')
  async updateTax(@Param('id') id: string, @Body() dto: UpdateTaxRuleDto, @CurrentUser() actor: AuthUser) {
    const row = await this.prisma.taxRule.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'tax_rule.update', entity: 'TaxRule', entityId: id, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  @Roles(Role.ADMIN)
  @Delete('tax-rules/:id')
  @HttpCode(204)
  async deleteTax(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    await this.prisma.taxRule.delete({ where: { id } });
    await this.audit.log({ actorId: actor.id, action: 'tax_rule.delete', entity: 'TaxRule', entityId: id });
  }

  // ───── System settings ─────
  @Get('settings')
  async settings() {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Roles(Role.ADMIN)
  @Put('settings/:key')
  @ApiOperation({ summary: 'Set service_fee_pct (0-100), default_currency, or supported_destinations (ISO country codes)' })
  async setSetting(@Param('key') key: string, @Body() body: SettingDto, @CurrentUser() actor: AuthUser) {
    const value = await this.validateSetting(key, body?.value);
    const row = await this.prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await this.audit.log({ actorId: actor.id, action: 'setting.update', entity: 'SystemSetting', entityId: key, metadata: { value } });
    return { key: row.key, value: row.value };
  }

  // ───── Coupons ─────
  @Get('coupons')
  listCoupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post('coupons')
  async createCoupon(@Body() dto: CreateCouponDto, @CurrentUser() actor: AuthUser) {
    if (!isPositive(dto.value)) throw new BadRequestException('value must be greater than zero');
    if (dto.type === CouponType.PERCENTAGE && !PCT.test(dto.value)) throw new BadRequestException('Percentage value must be between 0 and 100');
    if (dto.type === CouponType.FIXED_AMOUNT) {
      if (!dto.currency) throw new BadRequestException('currency is required for fixed-amount coupons');
      await this.assertCurrency(dto.currency);
    }
    if (dto.startsAt && dto.expiresAt && new Date(dto.startsAt) >= new Date(dto.expiresAt)) throw new BadRequestException('expiresAt must be after startsAt');
    const row = await this.prisma.coupon.create({ data: dto });
    await this.audit.log({ actorId: actor.id, action: 'coupon.create', entity: 'Coupon', entityId: row.id });
    return row;
  }

  @Patch('coupons/:id')
  async updateCoupon(@Param('id') id: string, @Body() dto: UpdateCouponDto, @CurrentUser() actor: AuthUser) {
    const row = await this.prisma.coupon.update({ where: { id }, data: dto });
    await this.audit.log({ actorId: actor.id, action: 'coupon.update', entity: 'Coupon', entityId: id, metadata: { fields: Object.keys(dto) } });
    return row;
  }

  // ───── helpers ─────
  private async assertCurrency(code: string) {
    if (code === 'CNY') return; // base currency is always valid
    if (!(await this.prisma.currency.findFirst({ where: { code, isActive: true } }))) throw new BadRequestException(`Unknown or inactive currency ${code}`);
  }

  private assertBands(min: number, max?: number, dMin?: number, dMax?: number) {
    if (max !== undefined && max <= min) throw new BadRequestException('maxWeightGrams must be greater than minWeightGrams');
    if (dMin !== undefined && dMax !== undefined && dMin > dMax) throw new BadRequestException('estimatedDaysMin cannot exceed estimatedDaysMax');
  }

  private async validateSetting(key: string, raw: unknown): Promise<Prisma.InputJsonValue> {
    switch (key) {
      case 'service_fee_pct': {
        const s = typeof raw === 'number' ? String(raw) : raw;
        if (typeof s !== 'string' || !PCT.test(s)) throw new BadRequestException('service_fee_pct must be a number between 0 and 100');
        return s;
      }
      case 'default_currency': {
        if (typeof raw !== 'string' || !ISO3.test(raw)) throw new BadRequestException('default_currency must be a 3-letter currency code');
        await this.assertCurrency(raw);
        return raw;
      }
      case 'supported_destinations': {
        if (!Array.isArray(raw) || raw.length === 0 || !raw.every((c) => typeof c === 'string' && ISO2.test(c))) {
          throw new BadRequestException('supported_destinations must be a non-empty array of ISO country codes');
        }
        return [...new Set(raw as string[])];
      }
      default:
        throw new BadRequestException(`Unknown setting "${key}"`);
    }
  }
}
