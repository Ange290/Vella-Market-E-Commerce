import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { CheckoutService, QuoteInput } from '../checkout/checkout.service';
import { PrismaService } from '../prisma/prisma.service';

const S = OrderStatus;

/** Transitions an admin/staff member may perform. PAID and REFUNDED are deliberately absent:
 *  they can only be set by the payments module after a verified provider event. */
export const ADMIN_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [S.PENDING]: [S.AWAITING_PAYMENT, S.CANCELLED],
  [S.AWAITING_PAYMENT]: [S.CANCELLED],
  [S.PAID]: [S.PROCESSING],
  [S.PROCESSING]: [S.PURCHASED_FROM_SUPPLIER],
  [S.PURCHASED_FROM_SUPPLIER]: [S.SHIPPED_FROM_CHINA],
  [S.SHIPPED_FROM_CHINA]: [S.ARRIVED_AT_DESTINATION_COUNTRY],
  [S.ARRIVED_AT_DESTINATION_COUNTRY]: [S.OUT_FOR_DELIVERY],
  [S.OUT_FOR_DELIVERY]: [S.DELIVERED],
};

/** Transitions only trusted server-side code (payments/refunds) may perform. */
export const SYSTEM_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [S.PENDING]: [S.PAID],
  [S.AWAITING_PAYMENT]: [S.PAID, S.CANCELLED],
  [S.PAID]: [S.REFUNDED, S.CANCELLED],
  [S.PROCESSING]: [S.REFUNDED],
  [S.PURCHASED_FROM_SUPPLIER]: [S.REFUNDED],
  [S.SHIPPED_FROM_CHINA]: [S.REFUNDED],
  [S.ARRIVED_AT_DESTINATION_COUNTRY]: [S.REFUNDED],
  [S.OUT_FOR_DELIVERY]: [S.REFUNDED],
  [S.DELIVERED]: [S.REFUNDED],
};

/** Statuses from which the customer may cancel on their own (nothing has been paid or bought yet). */
const CUSTOMER_CANCELLABLE: OrderStatus[] = [S.PENDING, S.AWAITING_PAYMENT];

const CUSTOMER_MESSAGES: Record<OrderStatus, { title: string; body: string }> = {
  PENDING: { title: 'Order received', body: 'We have received your order.' },
  AWAITING_PAYMENT: { title: 'Awaiting payment', body: 'Your order is waiting for payment.' },
  PAID: { title: 'Payment received', body: 'We received your payment. Thank you!' },
  PROCESSING: { title: 'Order is being processed', body: 'We are preparing to purchase your items.' },
  PURCHASED_FROM_SUPPLIER: { title: 'Purchased from supplier', body: 'Your items have been purchased from the supplier.' },
  SHIPPED_FROM_CHINA: { title: 'Shipped from China', body: 'Your order has left China and is on its way.' },
  ARRIVED_AT_DESTINATION_COUNTRY: { title: 'Arrived in your country', body: 'Your order arrived in the destination country.' },
  OUT_FOR_DELIVERY: { title: 'Out for delivery', body: 'Your order is out for delivery.' },
  DELIVERED: { title: 'Delivered', body: 'Your order has been delivered. Enjoy!' },
  CANCELLED: { title: 'Order cancelled', body: 'Your order has been cancelled.' },
  REFUNDED: { title: 'Order refunded', body: 'Your order has been refunded.' },
};

export interface ChangeStatusOptions {
  description?: string;
  trackingRef?: string;
  actorId?: string | null;
  /** Use the system transition table (payments module). Admin endpoints must leave this false. */
  system?: boolean;
}

const orderDetailInclude = {
  items: { orderBy: { createdAt: 'asc' as const } },
  history: { orderBy: { createdAt: 'asc' as const }, select: { id: true, status: true, description: true, trackingRef: true, createdAt: true } },
  payments: { orderBy: { createdAt: 'desc' as const }, select: { id: true, method: true, status: true, amount: true, currency: true, reference: true, paidAt: true, createdAt: true } },
  shipments: { include: { events: { orderBy: { occurredAt: 'desc' as const } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
  ) {}

  // ───────────── Create ─────────────

  /**
   * Turns the user's cart into an order. Prices come from the same engine as the quote.
   * Inside one transaction we lock the cart, verify it still matches what was priced,
   * atomically decrement stock (never below zero), redeem the coupon, and clear the cart.
   */
  async create(userId: string, input: QuoteInput & { customerNote?: string }) {
    const priced = await this.checkout.price(userId, input);
    if (priced.issues.length > 0) {
      throw new ConflictException({ message: 'Some items in your cart need attention before you can order', code: 'CHECKOUT_ISSUES', issues: priced.issues });
    }
    const orderNumber = await this.newOrderNumber();

    const order = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE`;
        const current = await tx.cartItem.findMany({ where: { cart: { userId } }, select: { id: true, quantity: true } });
        const sig = (rows: { id: string; quantity: number }[]) => rows.map((r) => `${r.id}:${r.quantity}`).sort().join('|');
        if (sig(current) !== sig(priced.lines.map((l) => ({ id: l.line.id, quantity: l.line.quantity })))) {
          throw new ConflictException({ message: 'Your cart changed while you were checking out. Please review it and try again.', code: 'CART_CHANGED' });
        }

        // Fixed lock order (by id) so concurrent orders cannot deadlock.
        const byId = [...priced.lines].sort((a, b) => (a.line.variantId ?? a.line.productId).localeCompare(b.line.variantId ?? b.line.productId));
        for (const { line } of byId) {
          const result = line.variantId
            ? await tx.productVariant.updateMany({ where: { id: line.variantId, isActive: true, stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } })
            : await tx.product.updateMany({ where: { id: line.productId, status: 'ACTIVE', stock: { gte: line.quantity } }, data: { stock: { decrement: line.quantity } } });
          if (result.count === 0) {
            throw new ConflictException({ message: `"${line.product.name}" no longer has enough stock`, code: 'OUT_OF_STOCK' });
          }
        }

        if (priced.coupon) {
          const redeemed = await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE id = ${priced.coupon.id} AND "isActive" = true AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
          if (redeemed === 0) throw new ConflictException({ message: 'This coupon is no longer available', code: 'COUPON_INVALID' });
        }

        const a = priced.address;
        const created = await tx.order.create({
          data: {
            orderNumber,
            userId,
            status: OrderStatus.AWAITING_PAYMENT,
            deliveryMethod: priced.deliveryMethod,
            currency: priced.currency,
            exchangeRate: priced.exchangeRate,
            subtotal: priced.subtotal,
            shippingFee: priced.shipping.fee,
            serviceFee: priced.serviceFee,
            taxAmount: priced.taxTotal,
            discountAmount: priced.discount,
            total: priced.total,
            couponId: priced.coupon?.id,
            customerNote: input.customerNote,
            shippingAddress: {
              recipientName: a.recipientName, phone: a.phone, country: a.country, region: a.region, city: a.city, street: a.street, postalCode: a.postalCode,
            },
            items: {
              create: priced.lines.map(({ line, unitPriceCny, unitPrice, lineTotal }) => ({
                productId: line.productId,
                variantId: line.variantId,
                name: line.product.name,
                sku: line.variant?.sku ?? line.product.sku,
                imageUrl: line.product.images[0]?.url ?? null,
                size: line.variant?.size,
                color: line.variant?.color,
                quantity: line.quantity,
                unitPriceCny,
                unitPrice,
                lineTotal,
                weightGrams: line.product.weightGrams,
              })),
            },
            history: { create: { status: OrderStatus.AWAITING_PAYMENT, description: 'Order placed. Waiting for payment.' } },
          },
          include: orderDetailInclude,
        });
        await tx.cartItem.deleteMany({ where: { cart: { userId } } });
        await tx.notification.create({
          data: { userId, type: NotificationType.ORDER, title: 'Order placed', body: `Order ${orderNumber} was placed. Complete payment to start processing.`, data: { orderId: created.id, orderNumber } },
        });
        return created;
      },
      { timeout: 20_000 },
    );
    return this.present(order);
  }

  // ───────────── Customer reads ─────────────

  async listMine(userId: string, q: { page: number; pageSize: number; status?: OrderStatus }) {
    const where: Prisma.OrderWhereInput = { userId, ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, orderNumber: true, status: true, currency: true, total: true, createdAt: true,
          items: { select: { name: true, imageUrl: true, quantity: true }, take: 3, orderBy: { createdAt: 'asc' } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, ...o }) => ({ ...o, itemCount: _count.items })),
      total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  async getMine(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, userId }, include: orderDetailInclude });
    if (!order) throw new NotFoundException('Order not found');
    return this.present(order);
  }

  async getMineByNumber(userId: string, orderNumber: string) {
    const order = await this.prisma.order.findFirst({ where: { orderNumber: orderNumber.toUpperCase(), userId }, include: orderDetailInclude });
    if (!order) throw new NotFoundException('Order not found');
    return this.present(order);
  }

  // ───────────── Cancel ─────────────

  async cancelMine(userId: string, id: string, reason?: string) {
    const order = await this.prisma.order.findFirst({ where: { id, userId }, select: { id: true, status: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
      throw new ConflictException({ message: 'This order can no longer be cancelled online. Please contact support.', code: 'NOT_CANCELLABLE' });
    }
    await this.prisma.$transaction((tx) => this.cancelInTx(tx, order.id, CUSTOMER_CANCELLABLE, reason ?? 'Cancelled by customer', null));
    return this.getMine(userId, id);
  }

  // ───────────── Status changes ─────────────

  /** Admin/staff status change, validated against ADMIN_TRANSITIONS. */
  async changeStatus(orderId: string, to: OrderStatus, opts: ChangeStatusOptions = {}) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, userId: true, orderNumber: true } });
    if (!order) throw new NotFoundException('Order not found');
    const table = opts.system ? SYSTEM_TRANSITIONS : ADMIN_TRANSITIONS;
    if (!table[order.status]?.includes(to)) {
      throw new BadRequestException({
        message: `Cannot change an order from ${order.status} to ${to}`,
        code: 'INVALID_TRANSITION',
        allowed: table[order.status] ?? [],
      });
    }

    await this.prisma.$transaction(async (tx) => {
      if (to === OrderStatus.CANCELLED) {
        await this.cancelInTx(tx, order.id, [order.status], opts.description ?? 'Order cancelled', opts.actorId ?? null, opts.trackingRef);
        return;
      }
      const moved = await tx.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: to } });
      if (moved.count === 0) throw new ConflictException({ message: 'The order was updated by someone else. Reload and try again.', code: 'CONCURRENT_UPDATE' });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, status: to, description: opts.description ?? CUSTOMER_MESSAGES[to].body, trackingRef: opts.trackingRef, createdById: opts.actorId ?? null },
      });
      await this.notify(tx, order.userId, order.id, order.orderNumber, to);
    });
    return this.adminGet(orderId);
  }

  // ───────────── Admin reads ─────────────

  async adminList(q: { page: number; pageSize: number; status?: OrderStatus; search?: string; from?: string; to?: string }) {
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ orderNumber: { contains: q.search, mode: 'insensitive' } }, { user: { email: { contains: q.search, mode: 'insensitive' } } }, { user: { profile: { fullName: { contains: q.search, mode: 'insensitive' } } } }] }
        : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, orderNumber: true, status: true, currency: true, total: true, createdAt: true, deliveryMethod: true,
          user: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async adminGet(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        ...orderDetailInclude,
        history: { orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { id: true, profile: { select: { fullName: true } } } } } },
        user: { select: { id: true, email: true, phone: true, profile: { select: { fullName: true, country: true } } } },
        coupon: { select: { code: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ───────────── internals ─────────────

  /** Cancels inside a transaction: guards on the expected current status, restocks, releases the coupon. */
  private async cancelInTx(tx: Prisma.TransactionClient, orderId: string, allowedFrom: OrderStatus[], description: string, actorId: string | null, trackingRef?: string) {
    const moved = await tx.order.updateMany({ where: { id: orderId, status: { in: allowedFrom } }, data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() } });
    if (moved.count === 0) throw new ConflictException({ message: 'This order can no longer be cancelled', code: 'NOT_CANCELLABLE' });

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    for (const item of order.items) {
      if (item.variantId) await tx.productVariant.updateMany({ where: { id: item.variantId }, data: { stock: { increment: item.quantity } } });
      else if (item.productId) await tx.product.updateMany({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
    }
    if (order.couponId) {
      await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0) WHERE id = ${order.couponId}`;
    }
    await tx.orderStatusHistory.create({ data: { orderId, status: OrderStatus.CANCELLED, description, trackingRef, createdById: actorId } });
    await this.notify(tx, order.userId, orderId, order.orderNumber, OrderStatus.CANCELLED);
  }

  private notify(tx: Prisma.TransactionClient, userId: string, orderId: string, orderNumber: string, status: OrderStatus) {
    const m = CUSTOMER_MESSAGES[status];
    return tx.notification.create({
      data: { userId, type: NotificationType.ORDER, title: m.title, body: `Order ${orderNumber}: ${m.body}`, data: { orderId, orderNumber, status } },
    });
  }

  /** Random, non-sequential, human-friendly reference such as VM-20261104-7K3QHD. */
  private async newOrderNumber(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt++) {
      const bytes = randomBytes(6);
      const suffix = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
      const candidate = `VM-${date}-${suffix}`;
      if (!(await this.prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } }))) return candidate;
    }
    this.logger.error('Could not generate a unique order number');
    throw new ConflictException('Please try again');
  }

  private present<T extends { history: unknown[] }>(order: T) {
    return order;
  }
}
