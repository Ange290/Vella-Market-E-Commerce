import { BadRequestException, Body, Controller, Get, Global, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

export const BASE_CURRENCY = 'CNY';

export interface Money {
  amount: string;
  currency: string;
}

/** A resolved conversion from CNY to a target currency. Reusable across many products per request. */
export interface Converter {
  currency: string;
  rate: Prisma.Decimal;
  decimals: number;
  convert(amountCny: Prisma.Decimal.Value): Money;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds a CNY → `currency` converter from the latest admin-entered exchange rate.
   * Returns null when the currency is CNY-less/unknown or no rate has been configured —
   * callers then simply omit the converted price (we never guess a rate).
   */
  async converter(currency?: string): Promise<Converter | null> {
    if (!currency) return null;
    const code = currency.toUpperCase();
    if (code === BASE_CURRENCY) return this.build(code, new Prisma.Decimal(1), 2);

    const [cur, rate] = await Promise.all([
      this.prisma.currency.findUnique({ where: { code } }),
      this.prisma.exchangeRate.findFirst({
        where: { baseCurrency: BASE_CURRENCY, quoteCurrency: code, effectiveAt: { lte: new Date() } },
        orderBy: { effectiveAt: 'desc' },
      }),
    ]);
    if (!cur || !cur.isActive || !rate) return null;
    return this.build(code, rate.rate, cur.decimals);
  }

  private build(currency: string, rate: Prisma.Decimal, decimals: number): Converter {
    return {
      currency,
      rate,
      decimals,
      convert: (amountCny) => ({
        amount: new Prisma.Decimal(amountCny).mul(rate).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP).toFixed(decimals),
        currency,
      }),
    };
  }
}

class CreateExchangeRateDto {
  @IsString() @Matches(/^[A-Z]{3}$/) quoteCurrency!: string;
  /** 1 CNY = `rate` quoteCurrency */
  @Type(() => String) @Matches(/^\d{1,10}(\.\d{1,8})?$/, { message: 'rate must be a positive decimal' }) rate!: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
}

@ApiTags('Currencies')
@Controller()
export class PricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('currencies')
  @ApiOperation({ summary: 'Active currencies with their latest CNY exchange rate (null when not configured)' })
  async currencies() {
    const [currencies, rates] = await Promise.all([
      this.prisma.currency.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.exchangeRate.findMany({
        where: { baseCurrency: BASE_CURRENCY, effectiveAt: { lte: new Date() } },
        orderBy: { effectiveAt: 'desc' },
      }),
    ]);
    const latest = new Map<string, string>();
    for (const r of rates) if (!latest.has(r.quoteCurrency)) latest.set(r.quoteCurrency, r.rate.toString());
    return currencies.map((c) => ({ ...c, rateFromCny: c.code === BASE_CURRENCY ? '1' : (latest.get(c.code) ?? null) }));
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Post('admin/exchange-rates')
  @ApiOperation({ summary: 'Record a new CNY exchange rate (append-only, ADMIN)' })
  async createRate(@Body() dto: CreateExchangeRateDto, @CurrentUser() actor: AuthUser) {
    if (dto.quoteCurrency === BASE_CURRENCY) throw new BadRequestException('Cannot set a rate for the base currency');
    if (!/[1-9]/.test(dto.rate)) throw new BadRequestException('rate must be greater than zero');
    const cur = await this.prisma.currency.findUnique({ where: { code: dto.quoteCurrency } });
    if (!cur) throw new BadRequestException(`Unknown currency ${dto.quoteCurrency}`);
    const row = await this.prisma.exchangeRate.create({
      data: { baseCurrency: BASE_CURRENCY, quoteCurrency: dto.quoteCurrency, rate: dto.rate, source: dto.source ?? 'manual', createdById: actor.id },
    });
    await this.audit.log({ actorId: actor.id, action: 'exchange_rate.create', entity: 'ExchangeRate', entityId: row.id, metadata: { quote: dto.quoteCurrency, rate: dto.rate } });
    return row;
  }
}

@Global()
@Module({ controllers: [PricingController], providers: [PricingService], exports: [PricingService] })
export class PricingModule {}
