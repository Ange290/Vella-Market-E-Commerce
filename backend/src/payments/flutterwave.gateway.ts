import { BadGatewayException, Logger, UnprocessableEntityException } from '@nestjs/common';
import { PaymentMethod, PaymentProvider, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import {
  GatewayStatus, InitiateInput, InitiateResult, PaymentGateway, RefundResult, VerifyResult, WebhookEventInfo,
} from './gateway';

/**
 * Flutterwave v3 integration (https://developer.flutterwave.com/v3.0).
 *
 *   initiate  → POST /payments                       (hosted checkout link)
 *   verify    → GET  /transactions/verify_by_reference?tx_ref=…
 *   refund    → POST /transactions/:id/refund
 *   webhook   → header `verif-hash` must equal the secret hash configured in the dashboard
 *
 * NOTE: written against the documented v3 contract; it has not yet been exercised against the
 * live sandbox (no keys available at build time). Validate with sandbox keys before go-live.
 */

/** Flutterwave hosted-checkout `payment_options` for mobile money, per destination country. */
const MOBILE_MONEY_OPTION: Record<string, { option: string; currency: string }> = {
  RW: { option: 'mobilemoneyrwanda', currency: 'RWF' },
  UG: { option: 'mobilemoneyuganda', currency: 'UGX' },
  GH: { option: 'mobilemoneyghana', currency: 'GHS' },
  ZM: { option: 'mobilemoneyzambia', currency: 'ZMW' },
  KE: { option: 'mpesa', currency: 'KES' },
};

export function paymentOptionsFor(method: PaymentMethod, country: string, currency: string): string | undefined {
  switch (method) {
    case PaymentMethod.CARD:
      return 'card';
    case PaymentMethod.BANK_TRANSFER:
      return 'banktransfer';
    case PaymentMethod.MTN_MOBILE_MONEY:
    case PaymentMethod.AIRTEL_MONEY: {
      const rail = MOBILE_MONEY_OPTION[country];
      if (!rail) throw new UnprocessableEntityException({ message: `Mobile money is not available for ${country} yet.`, code: 'PAYMENT_METHOD_UNAVAILABLE' });
      if (rail.currency !== currency) {
        throw new UnprocessableEntityException({
          message: `Mobile money in ${country} is paid in ${rail.currency}. This order is in ${currency}; please create the order in ${rail.currency} or pay by card.`,
          code: 'PAYMENT_CURRENCY_MISMATCH',
        });
      }
      return rail.option;
    }
    default:
      return undefined; // let the hosted page offer every method enabled on the account
  }
}

export interface FlutterwaveConfig {
  baseUrl: string;
  secretKey: string;
  webhookSecretHash: string;
}

export class FlutterwaveGateway implements PaymentGateway {
  readonly provider = PaymentProvider.FLUTTERWAVE;
  readonly enabled = true;
  private readonly logger = new Logger(FlutterwaveGateway.name);

  constructor(private readonly cfg: FlutterwaveConfig) {}

  async initiate(i: InitiateInput): Promise<InitiateResult> {
    const options = paymentOptionsFor(i.method, i.country, i.currency);
    const body = {
      tx_ref: i.reference,
      amount: i.amount.toString(),
      currency: i.currency,
      redirect_url: i.redirectUrl,
      ...(options ? { payment_options: options } : {}),
      customer: { email: i.customer.email, name: i.customer.name, ...(i.customer.phone ? { phonenumber: i.customer.phone } : {}) },
      customizations: { title: 'Vella Market', description: i.description },
    };
    const res = await this.call('POST', '/payments', body);
    const link = res?.data?.link;
    if (res?.status !== 'success' || typeof link !== 'string') {
      throw new BadGatewayException('The payment provider did not return a checkout link');
    }
    return { checkoutUrl: link };
  }

  async verifyByReference(reference: string): Promise<VerifyResult> {
    const res = await this.call('GET', `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, undefined, true);
    // Before the customer pays there is no transaction yet: that is "pending", not an error.
    if (res === null || res?.status !== 'success' || !res.data) return { status: 'pending' };
    const d = res.data;
    return {
      status: this.mapStatus(d.status),
      amount: d.amount !== undefined ? new Prisma.Decimal(String(d.amount)) : undefined,
      currency: typeof d.currency === 'string' ? d.currency : undefined,
      providerReference: d.id !== undefined ? String(d.id) : undefined,
      failureReason: typeof d.processor_response === 'string' ? d.processor_response : undefined,
      raw: { id: d.id ?? null, status: d.status ?? null, flw_ref: d.flw_ref ?? null, payment_type: d.payment_type ?? null, processor_response: d.processor_response ?? null },
    };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>): boolean {
    const given = headers['verif-hash'];
    const value = Array.isArray(given) ? given[0] : given;
    if (!value || !this.cfg.webhookSecretHash) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(this.cfg.webhookSecretHash);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: any): WebhookEventInfo | null {
    const data = body?.data ?? body;
    const reference = data?.tx_ref ?? data?.txRef;
    const id = data?.id ?? data?.flw_ref;
    if (!reference || id === undefined) return null;
    return { eventId: String(id), eventType: String(body?.event ?? body?.['event.type'] ?? 'charge.completed'), reference: String(reference) };
  }

  async refund(providerReference: string, amount: Prisma.Decimal, _currency: string, _reason: string): Promise<RefundResult> {
    const res = await this.call('POST', `/transactions/${encodeURIComponent(providerReference)}/refund`, { amount: amount.toString() });
    if (res?.status !== 'success') return { status: 'failed', failureReason: String(res?.message ?? 'Refund rejected by provider') };
    const s = String(res?.data?.status ?? '').toLowerCase();
    return {
      providerReference: res?.data?.id !== undefined ? String(res.data.id) : undefined,
      status: s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'processing',
    };
  }

  // ───────────── internals ─────────────

  private mapStatus(s: unknown): GatewayStatus {
    const v = String(s ?? '').toLowerCase();
    if (v === 'successful' || v === 'success') return 'successful';
    if (v === 'failed' || v === 'cancelled') return 'failed';
    return 'pending';
  }

  /** Returns parsed JSON, or null for a 404 / "no transaction" answer when `nullOnMissing` is set. */
  private async call(method: 'GET' | 'POST', path: string, body?: unknown, nullOnMissing = false): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.cfg.secretKey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.error(`Flutterwave ${method} ${path.split('?')[0]} failed: ${(err as Error).message}`);
      throw new BadGatewayException('Could not reach the payment provider');
    }
    const json: any = await res.json().catch(() => null);
    if (!res.ok) {
      if (nullOnMissing && (res.status === 404 || /no transaction/i.test(String(json?.message ?? '')))) return null;
      this.logger.error(`Flutterwave ${method} ${path.split('?')[0]} → ${res.status} ${String(json?.message ?? '')}`);
      throw new BadGatewayException('The payment provider rejected the request');
    }
    return json;
  }
}
