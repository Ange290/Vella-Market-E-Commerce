import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';

const SS = ShipmentStatus;
const OS = OrderStatus;

/** Progress of a shipment. EXCEPTION is outside the scale and blocks the order from advancing. */
const RANK: Record<ShipmentStatus, number> = {
  [SS.PENDING]: 0, [SS.IN_TRANSIT]: 1, [SS.CUSTOMS]: 1, [SS.ARRIVED]: 2, [SS.OUT_FOR_DELIVERY]: 3, [SS.DELIVERED]: 4, [SS.EXCEPTION]: -1,
};

/** Order statuses a shipment drives, in order. An order must already be in this chain to be shipped. */
const CHAIN: OrderStatus[] = [OS.PROCESSING, OS.PURCHASED_FROM_SUPPLIER, OS.SHIPPED_FROM_CHINA, OS.ARRIVED_AT_DESTINATION_COUNTRY, OS.OUT_FOR_DELIVERY, OS.DELIVERED];
const ORDER_FOR_RANK: Record<number, OrderStatus> = {
  1: OS.SHIPPED_FROM_CHINA, 2: OS.ARRIVED_AT_DESTINATION_COUNTRY, 3: OS.OUT_FOR_DELIVERY, 4: OS.DELIVERED,
};

export interface CreateShipmentInput {
  carrier?: string;
  trackingNumber?: string;
  weightGrams?: number;
  cost?: string;
  costCurrency?: string;
  estimatedDelivery?: string;
}
export interface EventInput {
  status: ShipmentStatus;
  location?: string;
  description?: string;
  occurredAt?: string;
}

const shipmentInclude = { events: { orderBy: [{ occurredAt: 'desc' as const }, { createdAt: 'desc' as const }] } } satisfies Prisma.ShipmentInclude;

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  // ───────────── Admin ─────────────

  async create(orderId: string, input: CreateShipmentInput) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, shippingAddress: true } });
    if (!order) throw new NotFoundException('Order not found');
    if (!CHAIN.includes(order.status) || order.status === OS.DELIVERED) {
      throw new ConflictException({ message: 'Shipments can only be created for paid orders that are being processed', code: 'ORDER_NOT_SHIPPABLE' });
    }
    const destination = (order.shippingAddress as { country?: string }).country ?? 'RW';
    if (input.cost && !input.costCurrency) throw new BadRequestException('costCurrency is required when cost is given');
    return this.prisma.shipment.create({
      data: {
        orderId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        destinationCountry: destination,
        weightGrams: input.weightGrams,
        cost: input.cost,
        costCurrency: input.costCurrency,
        estimatedDelivery: input.estimatedDelivery ? new Date(input.estimatedDelivery) : undefined,
        events: { create: { status: SS.PENDING, description: 'Shipment created' } },
      },
      include: shipmentInclude,
    });
  }

  async update(id: string, input: Omit<CreateShipmentInput, 'cost' | 'costCurrency'> & { cost?: string; costCurrency?: string }) {
    await this.get(id);
    return this.prisma.shipment.update({
      where: { id },
      data: { ...input, estimatedDelivery: input.estimatedDelivery ? new Date(input.estimatedDelivery) : undefined },
      include: shipmentInclude,
    });
  }

  async remove(id: string) {
    const s = await this.get(id);
    if (s.status !== SS.PENDING || s.events.length > 1) throw new ConflictException('Only shipments that have not started moving can be deleted');
    await this.prisma.shipment.delete({ where: { id } });
  }

  /** Appends a tracking event, updates the shipment, and moves the order forward when appropriate. */
  async addEvent(id: string, input: EventInput, actorId: string) {
    const shipment = await this.get(id);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('occurredAt cannot be in the future');

    const floor = shipment.events.reduce((m, e) => Math.max(m, RANK[e.status]), 0);
    if (input.status !== SS.EXCEPTION && RANK[input.status] < floor) {
      throw new BadRequestException({ message: `A shipment cannot go back from stage ${floor} to ${input.status}`, code: 'INVALID_SHIPMENT_TRANSITION' });
    }
    if (shipment.status === SS.DELIVERED && input.status !== SS.DELIVERED) {
      throw new BadRequestException({ message: 'This shipment was already delivered', code: 'INVALID_SHIPMENT_TRANSITION' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.shipmentTracking.create({ data: { shipmentId: id, status: input.status, location: input.location, description: input.description, occurredAt } });
      await tx.shipment.update({
        where: { id },
        data: {
          status: input.status,
          shippedAt: shipment.shippedAt ?? (RANK[input.status] >= 1 ? occurredAt : undefined),
          deliveredAt: input.status === SS.DELIVERED ? occurredAt : undefined,
        },
      });
      if (input.status === SS.CUSTOMS || input.status === SS.EXCEPTION) {
        await tx.notification.create({
          data: {
            userId: shipment.order.userId,
            type: NotificationType.SHIPMENT,
            title: input.status === SS.CUSTOMS ? 'Your package is in customs' : 'There is an issue with your shipment',
            body: `Order ${shipment.order.orderNumber}: ${input.description ?? (input.status === SS.CUSTOMS ? 'Customs clearance in progress.' : 'We are looking into it and will update you soon.')}`,
            data: { orderId: shipment.orderId, shipmentId: id, status: input.status },
          },
        });
      }
    });

    await this.syncOrder(shipment.orderId, actorId, shipment.trackingNumber ?? undefined, input.description);
    return this.get(id);
  }

  async adminList(q: { page: number; pageSize: number; status?: ShipmentStatus; search?: string }) {
    const where: Prisma.ShipmentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ trackingNumber: { contains: q.search, mode: 'insensitive' } }, { carrier: { contains: q.search, mode: 'insensitive' } }, { order: { orderNumber: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.shipment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { order: { select: { orderNumber: true, status: true } } } }),
      this.prisma.shipment.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async get(id: string) {
    const s = await this.prisma.shipment.findUnique({ where: { id }, include: { ...shipmentInclude, order: { select: { id: true, userId: true, orderNumber: true, status: true } } } });
    if (!s) throw new NotFoundException('Shipment not found');
    return s;
  }

  // ───────────── Customer ─────────────

  async listForCustomer(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
    if (!order) throw new NotFoundException('Order not found');
    return this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, carrier: true, trackingNumber: true, status: true, originCountry: true, destinationCountry: true,
        estimatedDelivery: true, shippedAt: true, deliveredAt: true,
        events: { orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], select: { id: true, status: true, location: true, description: true, occurredAt: true } },
      },
    });
  }

  // ───────────── Order synchronisation ─────────────

  /**
   * Moves the order forward to match its shipments: it reaches a stage only when *every* shipment
   * has, and it steps through each intermediate status so the customer timeline has no gaps.
   * It never moves an order backwards and does nothing if a shipment has an open exception.
   */
  private async syncOrder(orderId: string, actorId: string, trackingRef: string | undefined, description: string | undefined) {
    const [order, shipments] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } }),
      this.prisma.shipment.findMany({ where: { orderId }, select: { status: true } }),
    ]);
    if (shipments.length === 0 || shipments.some((s) => s.status === SS.EXCEPTION)) return;
    const minRank = Math.min(...shipments.map((s) => RANK[s.status]));
    const target = ORDER_FOR_RANK[minRank];
    if (!target) return;

    const from = CHAIN.indexOf(order.status);
    const to = CHAIN.indexOf(target);
    if (from === -1 || to <= from) return;
    for (let i = from + 1; i <= to; i++) {
      const last = i === to;
      await this.orders.changeStatus(orderId, CHAIN[i], { actorId, trackingRef, description: last ? description : undefined });
    }
    this.logger.log(`Order ${orderId} advanced ${order.status} → ${target} from shipment progress`);
  }
}
