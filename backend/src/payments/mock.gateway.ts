import { PaymentProvider, Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import {
  GatewayStatus, InitiateInput, InitiateResult, PaymentGateway, RefundResult, VerifyResult, WebhookEventInfo,
} from './gateway';

/**
 * DEVELOPMENT-ONLY simulated payment provider (PAYMENT_PROVIDER=mock). The app refuses to boot
 * with it in production. It never reports success by itself: a payment stays "pending" until a
 * developer explicitly simulates an outcome via POST /dev/payments/:reference/simulate, which
 * then flows through the same webhook → server-side verification → order-update code as a real provider.
 */
export class MockGateway implements PaymentGateway {
  readonly provider = PaymentProvider.MOCK;
  readonly enabled = true;

  private readonly records = new Map<string, { amount: Prisma.Decimal; currency: string; status: GatewayStatus; id: string; reason?: string }>();
  private nextRefund: 'completed' | 'processing' | 'failed' = 'completed';
  private counter = 0;

  constructor(
    private readonly webhookSecret: string,
    private readonly appUrl: string,
  ) {}

  async initiate(i: InitiateInput): Promise<InitiateResult> {
    this.records.set(i.reference, { amount: i.amount, currency: i.currency, status: 'pending', id: `MOCK-${++this.counter}-${Date.now()}` });
    return { checkoutUrl: `${this.appUrl}/dev/mock-pay?reference=${encodeURIComponent(i.reference)}`, raw: { mock: true } };
  }

  async verifyByReference(reference: string): Promise<VerifyResult> {
    const r = this.records.get(reference);
    if (!r) return { status: 'pending' };
    return { status: r.status, amount: r.amount, currency: r.currency, providerReference: r.id, failureReason: r.reason, raw: { mock: true } };
  }

  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>): boolean {
    const given = headers['verif-hash'];
    const value = Array.isArray(given) ? given[0] : given;
    if (!value) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(this.webhookSecret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: any): WebhookEventInfo | null {
    const data = body?.data;
    if (!data?.tx_ref || data.id === undefined) return null;
    return { eventId: String(data.id), eventType: String(body.event ?? 'charge.completed'), reference: String(data.tx_ref) };
  }

  async refund(providerReference: string): Promise<RefundResult> {
    const status = this.nextRefund;
    this.nextRefund = 'completed';
    return { providerReference: `MOCK-RF-${providerReference}`, status, failureReason: status === 'failed' ? 'Simulated refund failure' : undefined };
  }

  // ───── simulation controls (dev endpoints and tests) ─────

  /** Sets what the "provider" will report for a reference; optionally overrides amount/currency to test mismatches. */
  simulate(reference: string, outcome: { status: GatewayStatus; amount?: Prisma.Decimal; currency?: string; reason?: string }) {
    const r = this.records.get(reference);
    if (!r) throw new Error(`Unknown reference ${reference}`);
    this.records.set(reference, { ...r, status: outcome.status, amount: outcome.amount ?? r.amount, currency: outcome.currency ?? r.currency, reason: outcome.reason });
    return { id: r.id };
  }

  has(reference: string) {
    return this.records.has(reference);
  }

  failNextRefundWith(status: 'processing' | 'failed') {
    this.nextRefund = status;
  }

  get secret() {
    return this.webhookSecret;
  }
}
