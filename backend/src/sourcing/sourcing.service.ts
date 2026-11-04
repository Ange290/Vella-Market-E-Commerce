import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DeliveryMethod, NotificationType, OrderStatus, Prisma, ProductRequestStatus as RS, QuotationStatus as QS, Role } from '@prisma/client';
import { UploadsService } from '../catalog/uploads.service';
import { OrdersService } from '../orders/orders.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const MAX_OPEN_REQUESTS = 10;
const OPEN: RS[] = [RS.SUBMITTED, RS.UNDER_REVIEW, RS.QUOTED];
const MAX_VALIDITY_DAYS = 60;

export interface CreateRequestInput {
  productUrl?: string;
  title?: string;
  quantity: number;
  preferredSize?: string;
  preferredColor?: string;
  instructions?: string;
  destinationCountry?: string;
}
export interface QuotationInput {
  productCost: string;
  shippingCost: string;
  serviceFee: string;
  taxAmount?: string;
  currency: string;
  validUntil: string;
  notes?: string;
}

/** What customers may see of a quotation (drafts never leave the back office). */
const customerQuotationSelect = {
  id: true, requestId: true, productCost: true, shippingCost: true, serviceFee: true, taxAmount: true, total: true,
  currency: true, validUntil: true, notes: true, status: true, createdAt: true,
} satisfies Prisma.QuotationSelect;

@Injectable()
export class SourcingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
  ) {}

  // ───────────── Customer: requests ─────────────

  async create(userId: string, input: CreateRequestInput, file?: Express.Multer.File) {
    if (!input.productUrl && !file) throw new BadRequestException('Provide a product link, a product image, or both');
    const open = await this.prisma.productRequest.count({ where: { userId, status: { in: OPEN } } });
    if (open >= MAX_OPEN_REQUESTS) {
      throw new ConflictException({ message: `You already have ${MAX_OPEN_REQUESTS} open requests. Please wait for quotations or cancel some.`, code: 'TOO_MANY_OPEN_REQUESTS' });
    }
    const imageUrl = file ? await this.uploads.saveImage(file) : undefined;
    return this.prisma.productRequest.create({ data: { userId, ...input, imageUrl } });
  }

  async listMine(userId: string, q: { page: number; pageSize: number; status?: RS }) {
    const where: Prisma.ProductRequestWhereInput = { userId, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.productRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.productRequest.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async getMine(userId: string, id: string) {
    const r = await this.prisma.productRequest.findFirst({
      where: { id, userId },
      include: { quotations: { where: { status: { not: QS.DRAFT } }, orderBy: { createdAt: 'desc' }, select: { ...customerQuotationSelect, order: { select: { id: true, orderNumber: true } } } } },
    });
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  async cancelMine(userId: string, id: string) {
    const r = await this.prisma.productRequest.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Request not found');
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.productRequest.updateMany({ where: { id, status: { in: OPEN } }, data: { status: RS.CANCELLED } });
      if (moved.count === 0) throw new ConflictException({ message: 'This request can no longer be cancelled', code: 'NOT_CANCELLABLE' });
      await tx.quotation.updateMany({ where: { requestId: id, status: { in: [QS.SENT, QS.DRAFT] } }, data: { status: QS.EXPIRED } });
    });
    return this.getMine(userId, id);
  }

  // ───────────── Customer: quotations ─────────────

  async listQuotationsMine(userId: string) {
    return this.prisma.quotation.findMany({
      where: { request: { userId }, status: { not: QS.DRAFT } },
      orderBy: { createdAt: 'desc' },
      select: { ...customerQuotationSelect, request: { select: { id: true, title: true, productUrl: true, imageUrl: true, quantity: true } } },
    });
  }

  /** Accepting converts the quotation into a normal order that is paid through the standard payment flow. */
  async accept(userId: string, quotationId: string, input: { addressId: string; deliveryMethod?: DeliveryMethod; customerNote?: string }) {
    const q = await this.owned(userId, quotationId);
    const address = await this.prisma.address.findFirst({ where: { id: input.addressId, userId } });
    if (!address) throw new NotFoundException('Delivery address not found');

    const conv = await this.pricing.converter(q.currency);
    if (!conv) throw new UnprocessableEntityException({ message: `No exchange rate is configured for ${q.currency}, so this quotation cannot be converted to an order yet.`, code: 'CURRENCY_UNAVAILABLE' });
    const orderNumber = await this.orders.newOrderNumber();
    const qty = q.request.quantity;

    return this.prisma.$transaction(async (tx) => {
      // Atomic claim: exactly one acceptance can win, and only while the quotation is live.
      const claimed = await tx.quotation.updateMany({ where: { id: q.id, status: QS.SENT, validUntil: { gt: new Date() } }, data: { status: QS.ACCEPTED } });
      if (claimed.count === 0) {
        const fresh = await tx.quotation.findUniqueOrThrow({ where: { id: q.id } });
        const expired = fresh.status === QS.SENT && fresh.validUntil <= new Date();
        throw new ConflictException({ message: expired ? 'This quotation has expired. Please ask for a new one.' : 'This quotation is no longer available', code: expired ? 'QUOTATION_EXPIRED' : 'QUOTATION_UNAVAILABLE' });
      }
      const unitPrice = conv.round(q.productCost.div(qty));
      const order = await tx.order.create({
        data: {
          orderNumber, userId, status: OrderStatus.AWAITING_PAYMENT, deliveryMethod: input.deliveryMethod ?? DeliveryMethod.STANDARD,
          currency: q.currency, exchangeRate: conv.rate,
          subtotal: q.productCost, shippingFee: q.shippingCost, serviceFee: q.serviceFee, taxAmount: q.taxAmount, discountAmount: 0, total: q.total,
          quotationId: q.id, customerNote: input.customerNote,
          shippingAddress: { recipientName: address.recipientName, phone: address.phone, country: address.country, region: address.region, city: address.city, street: address.street, postalCode: address.postalCode },
          items: {
            create: {
              name: q.request.title ?? 'Sourced product', sku: `SRC-${q.requestId.slice(-8).toUpperCase()}`, imageUrl: q.request.imageUrl,
              size: q.request.preferredSize, color: q.request.preferredColor, quantity: qty,
              unitPriceCny: conv.rate.isZero() ? 0 : D(unitPrice).div(conv.rate).toDecimalPlaces(2), unitPrice, lineTotal: q.productCost,
            },
          },
          history: { create: { status: OrderStatus.AWAITING_PAYMENT, description: 'Order created from your accepted quotation. Waiting for payment.' } },
        },
        include: { items: true, history: true },
      });
      await tx.productRequest.update({ where: { id: q.requestId }, data: { status: RS.CONVERTED } });
      await tx.quotation.updateMany({ where: { requestId: q.requestId, id: { not: q.id }, status: { in: [QS.SENT, QS.DRAFT] } }, data: { status: QS.EXPIRED } });
      await tx.notification.create({
        data: { userId, type: NotificationType.ORDER, title: 'Order placed', body: `Order ${orderNumber} was created from your quotation. Complete payment to start sourcing.`, data: { orderId: order.id, orderNumber } },
      });
      return order;
    });
  }

  async reject(userId: string, quotationId: string) {
    const q = await this.owned(userId, quotationId);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.quotation.updateMany({ where: { id: q.id, status: QS.SENT }, data: { status: QS.REJECTED } });
      if (moved.count === 0) throw new ConflictException({ message: 'This quotation is no longer available', code: 'QUOTATION_UNAVAILABLE' });
      await tx.productRequest.updateMany({ where: { id: q.requestId, status: RS.QUOTED }, data: { status: RS.UNDER_REVIEW } }); // back to the team for a new offer
    });
    return this.getMine(userId, q.requestId);
  }

  // ───────────── Admin ─────────────

  async adminList(q: { page: number; pageSize: number; status?: RS; search?: string; assignedToId?: string }) {
    const where: Prisma.ProductRequestWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { productUrl: { contains: q.search, mode: 'insensitive' } }, { user: { email: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.productRequest.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { user: { select: { id: true, email: true, profile: { select: { fullName: true } } } }, assignedTo: { select: { id: true, email: true } }, _count: { select: { quotations: true } } },
      }),
      this.prisma.productRequest.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async adminGet(id: string) {
    const r = await this.prisma.productRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, phone: true, profile: { select: { fullName: true, country: true } } } },
        assignedTo: { select: { id: true, email: true } },
        quotations: { orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { id: true, email: true } }, order: { select: { id: true, orderNumber: true, status: true } } } },
      },
    });
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  async review(id: string, input: { status?: 'UNDER_REVIEW' | 'REJECTED'; assignedToId?: string | null; reason?: string }) {
    const r = await this.prisma.productRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    if (input.assignedToId) {
      const a = await this.prisma.user.findFirst({ where: { id: input.assignedToId, role: { in: [Role.ADMIN, Role.STAFF] }, status: 'ACTIVE' } });
      if (!a) throw new BadRequestException('assignedToId must be an active admin or staff member');
    }
    if (input.status) {
      const allowed: Record<string, RS[]> = { UNDER_REVIEW: [RS.SUBMITTED], REJECTED: [RS.SUBMITTED, RS.UNDER_REVIEW, RS.QUOTED] };
      if (!allowed[input.status].includes(r.status)) {
        throw new BadRequestException({ message: `Cannot change a request from ${r.status} to ${input.status}`, code: 'INVALID_TRANSITION' });
      }
      if (input.status === 'REJECTED' && !input.reason) throw new BadRequestException('A reason is required when declining a request');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productRequest.update({
        where: { id },
        data: { ...(input.status ? { status: input.status } : {}), ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}) },
      });
      if (input.status === 'REJECTED') {
        await tx.quotation.updateMany({ where: { requestId: id, status: { in: [QS.SENT, QS.DRAFT] } }, data: { status: QS.EXPIRED } });
        await tx.notification.create({
          data: { userId: r.userId, type: NotificationType.QUOTATION, title: 'We could not source this product', body: input.reason!, data: { requestId: id } },
        });
      }
    });
    return this.adminGet(id);
  }

  async createQuotation(requestId: string, input: QuotationInput & { send?: boolean }, actorId: string) {
    const request = await this.prisma.productRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    if (![RS.SUBMITTED, RS.UNDER_REVIEW, RS.QUOTED].includes(request.status as any)) {
      throw new ConflictException({ message: `Cannot quote a request that is ${request.status}`, code: 'REQUEST_CLOSED' });
    }
    const data = await this.validated(input);
    const q = await this.prisma.quotation.create({ data: { requestId, createdById: actorId, status: QS.DRAFT, ...data } });
    if (request.status === RS.SUBMITTED) await this.prisma.productRequest.update({ where: { id: requestId }, data: { status: RS.UNDER_REVIEW } });
    return input.send ? this.send(q.id) : q;
  }

  async updateQuotation(id: string, input: Partial<QuotationInput>) {
    const q = await this.prisma.quotation.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status !== QS.DRAFT) throw new ConflictException({ message: 'Only draft quotations can be edited. Create a new quotation instead.', code: 'NOT_EDITABLE' });
    const merged: QuotationInput = {
      productCost: input.productCost ?? q.productCost.toString(), shippingCost: input.shippingCost ?? q.shippingCost.toString(),
      serviceFee: input.serviceFee ?? q.serviceFee.toString(), taxAmount: input.taxAmount ?? q.taxAmount.toString(),
      currency: input.currency ?? q.currency, validUntil: input.validUntil ?? q.validUntil.toISOString(), notes: input.notes ?? q.notes ?? undefined,
    };
    return this.prisma.quotation.update({ where: { id }, data: await this.validated(merged) });
  }

  /** Publishes a draft to the customer. Any earlier live offer for the same request is withdrawn. */
  async send(id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include: { request: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status !== QS.DRAFT) throw new ConflictException({ message: 'Only draft quotations can be sent', code: 'NOT_SENDABLE' });
    if (q.validUntil <= new Date()) throw new BadRequestException('validUntil has already passed');
    if (![RS.SUBMITTED, RS.UNDER_REVIEW, RS.QUOTED].includes(q.request.status as any)) throw new ConflictException({ message: 'The request is closed', code: 'REQUEST_CLOSED' });

    return this.prisma.$transaction(async (tx) => {
      await tx.quotation.updateMany({ where: { requestId: q.requestId, status: QS.SENT }, data: { status: QS.EXPIRED } });
      const sent = await tx.quotation.update({ where: { id }, data: { status: QS.SENT } });
      await tx.productRequest.update({ where: { id: q.requestId }, data: { status: RS.QUOTED } });
      await tx.notification.create({
        data: {
          userId: q.request.userId, type: NotificationType.QUOTATION, title: 'Your quotation is ready',
          body: `We priced your request: ${q.total.toString()} ${q.currency}, valid until ${q.validUntil.toISOString().slice(0, 10)}.`,
          data: { requestId: q.requestId, quotationId: q.id },
        },
      });
      return sent;
    });
  }

  // ───────────── internals ─────────────

  private async owned(userId: string, quotationId: string) {
    const q = await this.prisma.quotation.findFirst({ where: { id: quotationId, request: { userId }, status: { not: QS.DRAFT } }, include: { request: true } });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  /** Computes the total server-side and validates currency and dates. The client never supplies a total. */
  private async validated(i: QuotationInput) {
    if (i.currency !== 'CNY' && !(await this.prisma.currency.findFirst({ where: { code: i.currency, isActive: true } }))) throw new BadRequestException(`Unknown or inactive currency ${i.currency}`);
    const validUntil = new Date(i.validUntil);
    const now = Date.now();
    if (validUntil.getTime() <= now) throw new BadRequestException('validUntil must be in the future');
    if (validUntil.getTime() > now + MAX_VALIDITY_DAYS * 86_400_000) throw new BadRequestException(`A quotation can be valid for at most ${MAX_VALIDITY_DAYS} days`);
    const productCost = D(i.productCost);
    if (productCost.lte(0)) throw new BadRequestException('productCost must be greater than zero');
    const shippingCost = D(i.shippingCost);
    const serviceFee = D(i.serviceFee);
    const taxAmount = D(i.taxAmount ?? 0);
    return {
      productCost, shippingCost, serviceFee, taxAmount, total: productCost.add(shippingCost).add(serviceFee).add(taxAmount),
      currency: i.currency, validUntil, notes: i.notes,
    };
  }
}
