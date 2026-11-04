import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, OrderStatus, PaymentMethod, PaymentStatus, Prisma, RefundStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Env } from '../config/env.validation';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_GATEWAY, PaymentGateway, VerifyResult } from './gateway';

/** A pending payment younger than this is reused instead of creating a second one for the same order. */
const REUSE_WINDOW_MS = 30 * 60 * 1000;
const PAYABLE_ORDER_STATUSES: OrderStatus[] = [OrderStatus.AWAITING_PAYMENT, OrderStatus.PENDING];
const ACTIVE_PAYMENT_STATUSES: PaymentStatus[] = [PaymentStatus.INITIATED, PaymentStatus.PENDING];

/** What a customer may see of a payment (never the raw provider response). */
const customerSelect = {
  id: true, orderId: true, method: true, status: true, amount: true, currency: true, reference: true,
  checkoutUrl: true, failureReason: true, paidAt: true, createdAt: true,
} satisfies Prisma.PaymentSelect;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ───────────── Initiate ─────────────

  /**
   * Starts a payment for an order. The amount and currency always come from the stored order —
   * never from the client. Safe to call repeatedly: an existing live payment is returned instead
   * of creating a duplicate, and an `Idempotency-Key` makes retries return the original result.
   */
  async initiate(userId: string, orderId: string, method: PaymentMethod, idempotencyKey?: string) {
    if (!this.gateway.enabled) throw new ServiceUnavailableException({ message: 'Online payments are not available right now. Please try again later.', code: 'PAYMENTS_DISABLED' });

    if (idempotencyKey) {
      const prior = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
      if (prior) {
        if (prior.userId !== userId || prior.orderId !== orderId) throw new ConflictException({ message: 'Idempotency-Key was already used for a different request', code: 'IDEMPOTENCY_KEY_REUSED' });
        return this.forCustomer(prior.id);
      }
    }

    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId }, include: { user: { include: { profile: true } } } });
    if (!order) throw new NotFoundException('Order not found');

    const country = (order.shippingAddress as { country?: string } | null)?.country ?? order.user.profile?.country ?? 'RW';
    const reference = `VMP-${order.orderNumber.replace(/^VM-/, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    // Phase 1 (DB lock): decide whether a new payment row is allowed, and create it.
    const decision = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
      if (!PAYABLE_ORDER_STATUSES.includes(fresh.status)) {
        throw new ConflictException({ message: fresh.status === OrderStatus.CANCELLED ? 'This order was cancelled' : 'This order is not awaiting payment', code: 'ORDER_NOT_PAYABLE' });
      }
      if (await tx.payment.findFirst({ where: { orderId, status: PaymentStatus.SUCCESSFUL } })) {
        throw new ConflictException({ message: 'This order has already been paid', code: 'ALREADY_PAID' });
      }
      const live = await tx.payment.findFirst({
        where: { orderId, status: { in: ACTIVE_PAYMENT_STATUSES }, method, createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) }, checkoutUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (live) return { id: live.id, reuse: true };
      // Older unfinished attempts are closed locally; if one is paid late, settlement handles it (see settle()).
      await tx.payment.updateMany({ where: { orderId, status: { in: ACTIVE_PAYMENT_STATUSES } }, data: { status: PaymentStatus.CANCELLED, failureReason: 'Superseded by a newer payment attempt' } });
      const created = await tx.payment.create({
        data: {
          orderId, userId, provider: this.gateway.provider, method, status: PaymentStatus.INITIATED,
          amount: order.total, currency: order.currency, reference, idempotencyKey: idempotencyKey ?? null,
        },
      });
      return { id: created.id, reuse: false };
    });
    if (decision.reuse) return this.forCustomer(decision.id);

    // Phase 2 (no lock): call the provider.
    try {
      const result = await this.gateway.initiate({
        reference, amount: order.total, currency: order.currency, method, country,
        customer: { email: order.user.email, name: order.user.profile?.fullName ?? order.user.email, phone: order.user.phone ?? undefined },
        redirectUrl: `${this.config.get('APP_URL', { infer: true })}/payment/return`,
        description: `Order ${order.orderNumber}`,
      });
      await this.prisma.payment.update({
        where: { id: decision.id },
        data: { status: PaymentStatus.PENDING, checkoutUrl: result.checkoutUrl, providerReference: result.providerReference, providerResponse: result.raw },
      });
    } catch (err) {
      await this.prisma.payment.update({ where: { id: decision.id }, data: { status: PaymentStatus.FAILED, failureReason: 'Could not start payment with the provider' } });
      throw err; // HttpExceptions (422 for unavailable method, 502 for provider problems) pass through unchanged
    }
    await this.audit.log({ actorId: userId, action: 'payment.initiate', entity: 'Payment', entityId: decision.id, metadata: { orderId, method } });
    return this.forCustomer(decision.id);
  }

  // ───────────── Status (customer) ─────────────

  /** Used by the post-checkout page: re-verifies with the provider while the payment is still open. */
  async statusForCustomer(userId: string, reference: string) {
    const payment = await this.prisma.payment.findFirst({ where: { reference, userId }, select: { id: true, status: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (ACTIVE_PAYMENT_STATUSES.includes(payment.status) && this.gateway.enabled) {
      try {
        await this.settle(reference);
      } catch (err) {
        this.logger.warn(`Status check for ${reference} could not verify: ${(err as Error).message}`);
      }
    }
    return this.forCustomer(payment.id);
  }

  // ───────────── Webhook ─────────────

  async handleWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<{ received: true; duplicate?: boolean }> {
    if (!this.gateway.enabled || !this.gateway.verifyWebhookSignature(headers)) {
      await this.audit.log({ action: 'payment.webhook.rejected', entity: 'Webhook', metadata: { reason: 'invalid_signature' } });
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const info = this.gateway.parseWebhook(body);
    if (!info?.reference) return { received: true }; // not a payment event we act on

    let eventId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: { provider: this.gateway.provider, eventId: info.eventId, eventType: info.eventType, payload: this.redact(body) },
      });
      eventId = row.id;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      const existing = await this.prisma.webhookEvent.findFirstOrThrow({ where: { provider: this.gateway.provider, eventId: info.eventId, eventType: info.eventType } });
      if (existing.processedAt) return { received: true, duplicate: true }; // replay of a handled event
      eventId = existing.id; // earlier attempt failed midway: process again
    }

    try {
      // The webhook body is only a hint to look the payment up. What it *claims* is never trusted:
      // settle() asks the provider's API directly.
      await this.settle(info.reference);
      await this.prisma.webhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), error: null } });
    } catch (err) {
      await this.prisma.webhookEvent.update({ where: { id: eventId }, data: { error: (err as Error).message.slice(0, 500) } });
      throw err; // non-2xx makes the provider retry
    }
    return { received: true };
  }

  // ───────────── Settlement ─────────────

  /**
   * Brings our records in line with what the provider says. Idempotent and safe to run
   * concurrently (webhook + customer polling + admin re-check).
   */
  async settle(reference: string) {
    let payment = await this.prisma.payment.findUnique({ where: { reference } });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === PaymentStatus.SUCCESSFUL) {
      await this.ensureOrderPaid(payment.id); // repairs a crash between "payment saved" and "order marked paid"
      return payment;
    }
    if (!ACTIVE_PAYMENT_STATUSES.includes(payment.status) && payment.status !== PaymentStatus.CANCELLED) return payment; // FAILED/REFUNDED are final

    const result = await this.gateway.verifyByReference(reference);

    if (result.status === 'pending') return payment;
    if (result.status === 'failed') {
      const failed = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: [...ACTIVE_PAYMENT_STATUSES, PaymentStatus.CANCELLED] } },
        data: { status: PaymentStatus.FAILED, failureReason: (result.failureReason ?? 'Payment failed').slice(0, 300), providerReference: result.providerReference ?? payment.providerReference, providerResponse: result.raw },
      });
      if (failed.count > 0) {
        await this.prisma.notification.create({
          data: { userId: payment.userId, type: NotificationType.PAYMENT, title: 'Payment failed', body: 'Your payment did not go through. You can try again from your order page.', data: { orderId: payment.orderId, reference } },
        });
        await this.audit.log({ actorId: payment.userId, action: 'payment.failed', entity: 'Payment', entityId: payment.id, metadata: { reason: result.failureReason ?? null } });
      }
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    // result.status === 'successful' → validate before trusting it
    if (!this.matches(payment, result)) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: [...ACTIVE_PAYMENT_STATUSES, PaymentStatus.CANCELLED] } },
        data: { status: PaymentStatus.FAILED, failureReason: 'AMOUNT_OR_CURRENCY_MISMATCH', providerReference: result.providerReference ?? payment.providerReference, providerResponse: result.raw },
      });
      await this.audit.log({ action: 'payment.mismatch', entity: 'Payment', entityId: payment.id, metadata: { expected: `${payment.amount} ${payment.currency}`, received: `${result.amount ?? '?'} ${result.currency ?? '?'}`, providerReference: result.providerReference ?? null } });
      this.logger.error(`Payment ${reference}: provider reported success with a different amount/currency. Manual review required.`);
      return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    try {
      const won = await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: [...ACTIVE_PAYMENT_STATUSES, PaymentStatus.CANCELLED] } },
        data: { status: PaymentStatus.SUCCESSFUL, paidAt: new Date(), failureReason: null, providerReference: result.providerReference ?? payment.providerReference, providerResponse: result.raw },
      });
      if (won.count === 0) return this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }); // another worker settled it
    } catch (e) {
      // The DB allows exactly one SUCCESSFUL payment per order. A second one means the customer paid twice.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.recordDuplicatePayment(payment.id, result);
      }
      throw e;
    }
    payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    await this.audit.log({ actorId: payment.userId, action: 'payment.success', entity: 'Payment', entityId: payment.id, metadata: { orderId: payment.orderId, reference } });
    await this.ensureOrderPaid(payment.id);
    return payment;
  }

  // ───────────── Admin ─────────────

  async adminList(q: { page: number; pageSize: number; status?: PaymentStatus; search?: string }) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ reference: { contains: q.search, mode: 'insensitive' } }, { providerReference: { contains: q.search } }, { order: { orderNumber: { contains: q.search, mode: 'insensitive' } } }, { user: { email: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        select: { ...customerSelect, provider: true, providerReference: true, order: { select: { orderNumber: true } }, user: { select: { email: true } }, _count: { select: { refunds: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  adminGet(id: string) {
    return this.prisma.payment.findUniqueOrThrow({ where: { id }, include: { refunds: { orderBy: { createdAt: 'desc' } }, order: { select: { orderNumber: true, status: true, total: true, currency: true } }, user: { select: { id: true, email: true } } } });
  }

  async adminVerify(id: string, actorId: string) {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    if (!this.gateway.enabled) throw new ServiceUnavailableException({ message: 'Payments are not configured', code: 'PAYMENTS_DISABLED' });
    await this.settle(p.reference);
    await this.audit.log({ actorId, action: 'payment.verify', entity: 'Payment', entityId: id });
    return this.adminGet(id);
  }

  // ───────────── Refunds ─────────────

  async createRefund(paymentId: string, input: { amount?: string; reason: string }, actorId: string) {
    if (!this.gateway.enabled) throw new ServiceUnavailableException({ message: 'Payments are not configured', code: 'PAYMENTS_DISABLED' });
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { refunds: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!payment.providerReference) throw new ConflictException({ message: 'This payment has no provider transaction to refund', code: 'NOT_REFUNDABLE' });

    // A refund is allowed for money we actually hold: a SUCCESSFUL payment, or a duplicate/late payment flagged for refund.
    const hasPendingRequest = payment.refunds.some((r) => r.status === RefundStatus.REQUESTED);
    const refundable = [PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status as any) || hasPendingRequest;
    if (!refundable) throw new ConflictException({ message: 'Only paid payments can be refunded', code: 'NOT_REFUNDABLE' });

    const committed = payment.refunds.filter((r) => r.status !== RefundStatus.FAILED && r.status !== RefundStatus.REJECTED && r.status !== RefundStatus.REQUESTED)
      .reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0));
    const remaining = payment.amount.sub(committed);
    const amount = input.amount ? new Prisma.Decimal(input.amount) : remaining;
    if (amount.lte(0) || amount.gt(remaining)) throw new BadRequestException(`Refund amount must be between 0 and ${remaining.toString()} ${payment.currency}`);

    // Reuse the open REQUESTED row (created by duplicate/late-payment detection) if there is one; otherwise create.
    const open = payment.refunds.find((r) => r.status === RefundStatus.REQUESTED);
    const refund = open
      ? await this.prisma.refund.update({ where: { id: open.id }, data: { amount, reason: input.reason, status: RefundStatus.PROCESSING, processedById: actorId } })
      : await this.prisma.refund.create({ data: { paymentId, amount, reason: input.reason, status: RefundStatus.PROCESSING, processedById: actorId } });

    let outcome: Awaited<ReturnType<PaymentGateway['refund']>>;
    try {
      outcome = await this.gateway.refund(payment.providerReference, amount, payment.currency, input.reason);
    } catch (err) {
      await this.prisma.refund.update({ where: { id: refund.id }, data: { status: RefundStatus.FAILED } });
      throw err;
    }
    const status = outcome.status === 'completed' ? RefundStatus.COMPLETED : outcome.status === 'failed' ? RefundStatus.FAILED : RefundStatus.PROCESSING;
    const updated = await this.prisma.refund.update({ where: { id: refund.id }, data: { status, providerReference: outcome.providerReference } });
    await this.audit.log({ actorId, action: 'refund.create', entity: 'Refund', entityId: refund.id, metadata: { paymentId, amount: amount.toString(), status } });
    if (status !== RefundStatus.FAILED) await this.applyRefundToPayment(paymentId);
    return updated;
  }

  /** Admin correction for a refund the provider is still processing (no provider status API is assumed). */
  async resolveRefund(refundId: string, status: 'COMPLETED' | 'FAILED', actorId: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status !== RefundStatus.PROCESSING) throw new ConflictException('Only refunds that are processing can be resolved');
    const updated = await this.prisma.refund.update({ where: { id: refundId }, data: { status } });
    await this.audit.log({ actorId, action: 'refund.resolve', entity: 'Refund', entityId: refundId, metadata: { status } });
    await this.applyRefundToPayment(refund.paymentId);
    return updated;
  }

  async listRefunds(q: { page: number; pageSize: number; status?: RefundStatus }) {
    const where: Prisma.RefundWhereInput = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { payment: { select: { reference: true, amount: true, currency: true, order: { select: { orderNumber: true } } } } } }),
      this.prisma.refund.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  // ───────────── internals ─────────────

  private matches(p: { amount: Prisma.Decimal; currency: string }, r: VerifyResult): boolean {
    return !!r.amount && r.amount.equals(p.amount) && r.currency === p.currency;
  }

  /** Marks the order PAID after its payment is SUCCESSFUL. Orders that can no longer be paid get a refund request. */
  private async ensureOrderPaid(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { select: { id: true, status: true, orderNumber: true } } } });
    if (!PAYABLE_ORDER_STATUSES.includes(payment.order.status)) {
      // Already advanced past payment (idempotent re-run) — nothing to do. A cancelled/refunded order needs money returned.
      if (payment.order.status === OrderStatus.CANCELLED) await this.requestRefund(payment.id, 'Order was cancelled before the payment completed');
      return;
    }
    try {
      await this.orders.changeStatus(payment.order.id, OrderStatus.PAID, { system: true, description: `Payment received (${payment.method.replace(/_/g, ' ').toLowerCase()}, ref ${payment.reference})` });
    } catch (err) {
      this.logger.error(`Payment ${payment.reference} succeeded but order ${payment.order.orderNumber} could not be marked paid: ${(err as Error).message}`);
      throw err; // webhook will be retried; settle() repairs on the next run
    }
  }

  private async recordDuplicatePayment(paymentId: string, result: VerifyResult) {
    const p = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.CANCELLED, failureReason: 'DUPLICATE_PAYMENT_REFUND_REQUIRED', providerReference: result.providerReference, providerResponse: result.raw },
    });
    await this.requestRefund(paymentId, 'Duplicate payment: the order was already paid');
    await this.audit.log({ action: 'payment.duplicate', entity: 'Payment', entityId: paymentId, metadata: { orderId: p.orderId } });
    this.logger.warn(`Duplicate payment detected for order ${p.orderId}; refund requested for ${p.reference}`);
    return p;
  }

  private async requestRefund(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true } });
    if (payment.refunds.length > 0) return; // already requested / handled
    await this.prisma.refund.create({ data: { paymentId, amount: payment.amount, reason, status: RefundStatus.REQUESTED } });
  }

  /** Recomputes the payment's refunded state; flips the order to REFUNDED once fully refunded. */
  private async applyRefundToPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true } });
    const refunded = payment.refunds.filter((r) => r.status === RefundStatus.COMPLETED || r.status === RefundStatus.PROCESSING).reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0));
    if (refunded.lte(0) || payment.status === PaymentStatus.CANCELLED) return; // duplicate/late payments keep their CANCELLED status
    const full = refunded.gte(payment.amount);
    await this.prisma.payment.update({ where: { id: paymentId }, data: { status: full ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED } });
    if (full) {
      const order = await this.prisma.order.findUniqueOrThrow({ where: { id: payment.orderId }, select: { id: true, status: true } });
      if (order.status !== OrderStatus.REFUNDED && order.status !== OrderStatus.CANCELLED) {
        await this.orders.changeStatus(order.id, OrderStatus.REFUNDED, { system: true, description: 'Your payment has been refunded.' });
      }
    }
  }

  private async forCustomer(id: string) {
    return this.prisma.payment.findUniqueOrThrow({ where: { id }, select: customerSelect });
  }

  /** Webhook payloads are stored for audit but card/customer details are never kept. */
  private redact(body: unknown): Prisma.InputJsonValue {
    const b = (body ?? {}) as any;
    const d = b.data ?? b;
    return { event: b.event ?? null, data: { id: d.id ?? null, tx_ref: d.tx_ref ?? null, flw_ref: d.flw_ref ?? null, status: d.status ?? null, amount: d.amount ?? null, currency: d.currency ?? null } };
  }
}
