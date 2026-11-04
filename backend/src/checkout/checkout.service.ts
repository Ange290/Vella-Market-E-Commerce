import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Address, Coupon, CouponType, DeliveryMethod, Prisma, ShippingRate, TaxRule } from '@prisma/client';
import { CartService, CartLineRecord, lineIssue, unitPriceCny } from '../cart/cart.service';
import { BASE_CURRENCY, Converter, PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export interface QuoteInput {
  addressId: string;
  deliveryMethod: DeliveryMethod;
  currency?: string;
  couponCode?: string;
}

export interface Issue {
  code: string;
  message: string;
  itemId?: string;
}

/** Unformatted result of a pricing run. Order creation persists exactly these values. */
export interface PricedCheckout {
  currency: string;
  exchangeRate: Prisma.Decimal; // 1 CNY = rate currency
  address: Address;
  deliveryMethod: DeliveryMethod;
  lines: { line: CartLineRecord; unitPriceCny: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal; weightGrams: number }[];
  weightGrams: number;
  subtotal: Prisma.Decimal;
  shipping: { fee: Prisma.Decimal; rate: ShippingRate };
  serviceFeePct: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  taxes: { rule: TaxRule; amount: Prisma.Decimal }[];
  taxTotal: Prisma.Decimal;
  coupon: Coupon | null;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  issues: Issue[];
  conv: Converter;
}

const unprocessable = (code: string, message: string) => new UnprocessableEntityException({ message, code });

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly cart: CartService,
  ) {}

  /**
   * Prices the user's cart. Throws 422 when required admin configuration (exchange rate,
   * service fee, shipping rate, product weight) is missing — values are never guessed.
   * Soft problems (stock, bad coupon) are returned in `issues` so the UI can show them.
   *
   * Formula (all amounts in the charge currency, rounded half-up to the currency's decimals):
   *   subtotal   = Σ round(unitPriceCny × rate) × qty
   *   shipping   = round((baseFee + perKgFee × weightKg) converted to charge currency)
   *   serviceFee = round(subtotal × service_fee_pct / 100)
   *   discount   = coupon applied to subtotal (never more than the subtotal)
   *   tax(rule)  = round((subtotal + shipping + serviceFee − discount) × ratePct / 100)
   *   total      = subtotal + shipping + serviceFee + Σ tax − discount
   */
  async price(userId: string, input: QuoteInput): Promise<PricedCheckout> {
    const { cart, address, conv, weightGrams, lines } = await this.context(userId, input.addressId, input.currency);

    const feePct = await this.setting<string | null>('service_fee_pct');
    if (feePct === null || feePct === undefined) throw unprocessable('SERVICE_FEE_NOT_CONFIGURED', 'The service fee has not been configured yet. Please try again later.');
    const serviceFeePct = D(feePct);

    const shipping = await this.shippingFee(address.country, input.deliveryMethod, weightGrams, conv);

    const subtotal = lines.reduce((s, l) => s.add(l.lineTotal), D(0));
    const serviceFee = conv.round(subtotal.mul(serviceFeePct).div(100));

    const issues: Issue[] = [];
    for (const l of cart.items) {
      const i = lineIssue(l);
      if (i) issues.push({ ...i, itemId: l.id });
    }

    let coupon: Coupon | null = null;
    let discount = D(0);
    if (input.couponCode) {
      const res = await this.applyCoupon(input.couponCode, subtotal, conv);
      if ('error' in res) issues.push({ code: 'COUPON_INVALID', message: res.error });
      else ({ coupon, discount } = res);
    }

    const taxBase = Prisma.Decimal.max(subtotal.add(shipping.fee).add(serviceFee).sub(discount), 0);
    const rules = await this.prisma.taxRule.findMany({ where: { country: address.country, isActive: true }, orderBy: { name: 'asc' } });
    const taxes = rules.map((rule) => ({ rule, amount: conv.round(taxBase.mul(rule.ratePct).div(100)) }));
    const taxTotal = taxes.reduce((s, t) => s.add(t.amount), D(0));

    const total = subtotal.add(shipping.fee).add(serviceFee).add(taxTotal).sub(discount);

    return {
      currency: conv.currency, exchangeRate: conv.rate, address, deliveryMethod: input.deliveryMethod, lines, weightGrams,
      subtotal, shipping, serviceFeePct, serviceFee, taxes, taxTotal, coupon, discount, total, issues, conv,
    };
  }

  /** Customer-facing quote: a transparent breakdown with every charge listed. */
  async quote(userId: string, input: QuoteInput) {
    const p = await this.price(userId, input);
    const m = (v: Prisma.Decimal) => p.conv.format(v);
    return {
      currency: p.currency,
      exchangeRate: { from: BASE_CURRENCY, to: p.currency, rate: p.exchangeRate.toString() },
      lines: p.lines.map((l) => ({
        itemId: l.line.id,
        productId: l.line.productId,
        variantId: l.line.variantId,
        name: l.line.product.name,
        sku: l.line.variant?.sku ?? l.line.product.sku,
        size: l.line.variant?.size ?? null,
        color: l.line.variant?.color ?? null,
        quantity: l.line.quantity,
        unitPrice: m(l.unitPrice),
        lineTotal: m(l.lineTotal),
      })),
      breakdown: {
        subtotal: m(p.subtotal),
        shipping: {
          label: `Shipping (${p.deliveryMethod}) to ${p.address.country}`,
          amount: m(p.shipping.fee),
          weightGrams: p.weightGrams,
          estimatedDays: { min: p.shipping.rate.estimatedDaysMin, max: p.shipping.rate.estimatedDaysMax },
        },
        serviceFee: { label: `Service fee (${p.serviceFeePct.toString()}% of subtotal)`, pct: p.serviceFeePct.toString(), amount: m(p.serviceFee) },
        taxes: p.taxes.map((t) => ({ label: `${t.rule.name} (${t.rule.ratePct.toString()}%)`, ratePct: t.rule.ratePct.toString(), amount: m(t.amount) })),
        discount: p.coupon ? { code: p.coupon.code, amount: m(p.discount) } : null,
        total: m(p.total),
      },
      issues: p.issues,
      canCheckout: p.issues.length === 0,
    };
  }

  /** Every delivery method with its price for this cart and destination (or why it is unavailable). */
  async shippingOptions(userId: string, addressId: string, currency?: string) {
    const { address, conv, weightGrams } = await this.context(userId, addressId, currency);
    const options = [];
    for (const method of Object.values(DeliveryMethod)) {
      try {
        const { fee, rate } = await this.shippingFee(address.country, method, weightGrams, conv);
        options.push({ method, available: true, fee: conv.format(fee), estimatedDays: { min: rate.estimatedDaysMin, max: rate.estimatedDaysMax } });
      } catch (e) {
        if (!(e instanceof UnprocessableEntityException)) throw e;
        options.push({ method, available: false, fee: null, reason: (e.getResponse() as { message: string }).message });
      }
    }
    return { country: address.country, weightGrams, currency: conv.currency, options };
  }

  // ───────────── internals ─────────────

  private async context(userId: string, addressId: string, currencyInput?: string) {
    const cart = await this.cart.getCartRecord(userId);
    if (cart.items.length === 0) throw new BadRequestException('Your cart is empty');

    const address = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) throw new NotFoundException('Delivery address not found');

    const supported = await this.setting<string[] | null>('supported_destinations');
    if (Array.isArray(supported) && supported.length > 0 && !supported.includes(address.country)) {
      throw unprocessable('DESTINATION_NOT_SUPPORTED', `We do not deliver to ${address.country} yet.`);
    }

    const currency = currencyInput?.toUpperCase() ?? (await this.setting<string | null>('default_currency')) ?? undefined;
    const conv = await this.pricing.converter(currency);
    if (!conv) throw unprocessable('CURRENCY_UNAVAILABLE', `Prices in ${currency ?? 'the requested currency'} are not available yet (no exchange rate configured).`);

    let weightGrams = 0;
    const lines = cart.items.map((line) => {
      if (!line.product.weightGrams) throw unprocessable('PRODUCT_WEIGHT_MISSING', `"${line.product.name}" has no weight recorded, so shipping cannot be calculated.`);
      const unitCny = unitPriceCny(line);
      const unitPrice = conv.convertDecimal(unitCny);
      weightGrams += line.product.weightGrams * line.quantity;
      return { line, unitPriceCny: unitCny, unitPrice, lineTotal: unitPrice.mul(line.quantity), weightGrams: line.product.weightGrams * line.quantity };
    });
    return { cart, address, conv, weightGrams, lines };
  }

  private async shippingFee(country: string, method: DeliveryMethod, weightGrams: number, conv: Converter) {
    const candidates = await this.prisma.shippingRate.findMany({
      where: { destinationCountry: country, method, isActive: true, minWeightGrams: { lte: weightGrams } },
      orderBy: { minWeightGrams: 'desc' },
    });
    const rate = candidates.find((r) => r.maxWeightGrams === null || weightGrams <= r.maxWeightGrams);
    if (!rate) throw unprocessable('NO_SHIPPING_RATE', `${method} delivery to ${country} is not available for this order weight.`);

    const inRateCurrency = rate.baseFee.add(rate.perKgFee.mul(D(weightGrams).div(1000)));
    let feeCny = inRateCurrency;
    if (rate.currency !== BASE_CURRENCY) {
      const rc = await this.pricing.converter(rate.currency);
      if (!rc) throw unprocessable('SHIPPING_RATE_CURRENCY_UNAVAILABLE', `No exchange rate configured for shipping currency ${rate.currency}.`);
      feeCny = inRateCurrency.div(rc.rate);
    }
    return { fee: conv.convertDecimal(feeCny), rate };
  }

  private async applyCoupon(code: string, subtotal: Prisma.Decimal, conv: Converter): Promise<{ coupon: Coupon; discount: Prisma.Decimal } | { error: string }> {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    const now = new Date();
    if (!coupon || !coupon.isActive) return { error: 'This coupon code is not valid' };
    if (coupon.startsAt && coupon.startsAt > now) return { error: 'This coupon is not active yet' };
    if (coupon.expiresAt && coupon.expiresAt < now) return { error: 'This coupon has expired' };
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) return { error: 'This coupon has been fully redeemed' };
    if (coupon.currency && coupon.currency !== conv.currency) return { error: `This coupon is only valid for orders in ${coupon.currency}` };
    if (coupon.minOrderAmount && subtotal.lt(coupon.minOrderAmount)) {
      return { error: `Minimum order of ${conv.format(coupon.minOrderAmount).amount} ${conv.currency} required for this coupon` };
    }
    const raw = coupon.type === CouponType.PERCENTAGE ? subtotal.mul(coupon.value).div(100) : coupon.value;
    return { coupon, discount: Prisma.Decimal.min(conv.round(raw), subtotal) };
  }

  private async setting<T>(key: string): Promise<T | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return (row?.value as T) ?? null;
  }
}
