import { PaymentMethod, PaymentProvider, Prisma } from '@prisma/client';

/** DI token for the active payment gateway (chosen by PAYMENT_PROVIDER). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type GatewayStatus = 'successful' | 'failed' | 'pending';

export interface InitiateInput {
  reference: string; // our tx_ref
  amount: Prisma.Decimal;
  currency: string;
  method: PaymentMethod;
  country: string; // destination country (ISO alpha-2), used to pick the right mobile-money rail
  customer: { email: string; name: string; phone?: string };
  redirectUrl: string;
  description: string;
}

export interface InitiateResult {
  checkoutUrl: string;
  providerReference?: string;
  /** Non-sensitive response data kept for support/debugging. */
  raw?: Prisma.InputJsonValue;
}

export interface VerifyResult {
  status: GatewayStatus;
  amount?: Prisma.Decimal;
  currency?: string;
  providerReference?: string;
  failureReason?: string;
  raw?: Prisma.InputJsonValue;
}

export interface WebhookEventInfo {
  eventId: string;
  eventType: string;
  reference?: string;
}

export interface RefundResult {
  providerReference?: string;
  status: 'completed' | 'processing' | 'failed';
  failureReason?: string;
}

/**
 * Everything the platform needs from a payment provider. The rest of the codebase never
 * talks to Flutterwave (or any provider) directly, so providers can be added or swapped.
 */
export interface PaymentGateway {
  readonly provider: PaymentProvider;
  /** False when no provider is configured: initiation then fails with 503 instead of faking a result. */
  readonly enabled: boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  /** Server-to-server lookup — the only source of truth for whether money was received. */
  verifyByReference(reference: string): Promise<VerifyResult>;
  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown): WebhookEventInfo | null;
  refund(providerReference: string, amount: Prisma.Decimal, currency: string, reason: string): Promise<RefundResult>;
}

/** Placeholder used when PAYMENT_PROVIDER=disabled. */
export class DisabledGateway implements PaymentGateway {
  readonly provider = PaymentProvider.MANUAL;
  readonly enabled = false;
  private fail(): never {
    throw new Error('Payments are not configured');
  }
  initiate(): Promise<InitiateResult> { return this.fail(); }
  verifyByReference(): Promise<VerifyResult> { return this.fail(); }
  verifyWebhookSignature(): boolean { return false; }
  parseWebhook(): WebhookEventInfo | null { return null; }
  refund(): Promise<RefundResult> { return this.fail(); }
}
