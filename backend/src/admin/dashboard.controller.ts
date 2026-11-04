import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrderStatus, PaymentStatus, Prisma, ProductStatus, RefundStatus, Role, ShipmentStatus, SupportStatus, ProductRequestStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const PENDING_ORDERS: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT];
const PAID_ORDERS: OrderStatus[] = [
  OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.PURCHASED_FROM_SUPPLIER, OrderStatus.SHIPPED_FROM_CHINA,
  OrderStatus.ARRIVED_AT_DESTINATION_COUNTRY, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED,
];
/** Payment statuses where money was actually received at some point. */
const RECEIVED: PaymentStatus[] = [PaymentStatus.SUCCESSFUL, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];

class ChartQuery {
  @Type(() => Number) @IsOptional() @IsInt() @Min(7) @Max(365) days: number = 30;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

@ApiTags('Admin · Dashboard')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.STAFF)
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline numbers. Monetary totals are ADMIN-only and are reported per currency, never mixed.' })
  async summary(@CurrentUser() user: AuthUser) {
    const p = this.prisma;
    const [customers, orders, pendingOrders, paidOrders, products, suppliers, shipments, shipmentsInTransit, payments, requestsOpen, supportOpen] = await Promise.all([
      p.user.count({ where: { role: Role.CUSTOMER } }),
      p.order.count(),
      p.order.count({ where: { status: { in: PENDING_ORDERS } } }),
      p.order.count({ where: { status: { in: PAID_ORDERS } } }),
      p.product.count({ where: { status: ProductStatus.ACTIVE } }),
      p.supplier.count({ where: { isActive: true } }),
      p.shipment.count(),
      p.shipment.count({ where: { status: { in: [ShipmentStatus.IN_TRANSIT, ShipmentStatus.CUSTOMS, ShipmentStatus.OUT_FOR_DELIVERY] } } }),
      p.payment.count(),
      p.productRequest.count({ where: { status: { in: [ProductRequestStatus.SUBMITTED, ProductRequestStatus.UNDER_REVIEW] } } }),
      p.supportRequest.count({ where: { status: { in: [SupportStatus.OPEN, SupportStatus.IN_PROGRESS] } } }),
    ]);

    const result: Record<string, unknown> = {
      customers, orders, pendingOrders, paidOrders, products, suppliers,
      shipments: { total: shipments, active: shipmentsInTransit },
      payments: { total: payments },
      productRequests: { open: requestsOpen },
      supportRequests: { open: supportOpen },
      revenue: null,
    };

    if (user.role === Role.ADMIN) {
      const [gross, refunded] = await Promise.all([
        p.payment.groupBy({ by: ['currency'], where: { status: { in: RECEIVED } }, _sum: { amount: true } }),
        p.$queryRaw<{ currency: string; amount: Prisma.Decimal }[]>`
          SELECT pay."currency" AS currency, SUM(r."amount") AS amount
          FROM "Refund" r JOIN "Payment" pay ON pay.id = r."paymentId"
          WHERE r.status IN (${RefundStatus.COMPLETED}::"RefundStatus", ${RefundStatus.PROCESSING}::"RefundStatus")
            AND pay.status IN ('SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED')
          GROUP BY pay."currency"`,
      ]);
      const refundMap = new Map(refunded.map((r) => [r.currency, new Prisma.Decimal(r.amount)]));
      result.revenue = gross.map((g) => {
        const grossAmt = g._sum.amount ?? new Prisma.Decimal(0);
        const refundedAmt = refundMap.get(g.currency) ?? new Prisma.Decimal(0);
        return { currency: g.currency, gross: grossAmt.toString(), refunded: refundedAmt.toString(), net: grossAmt.sub(refundedAmt).toString() };
      });
    }
    return result;
  }

  @Get('charts')
  @ApiOperation({ summary: 'Time-series and breakdowns for the dashboard charts' })
  async charts(@Query() q: ChartQuery, @CurrentUser() user: AuthUser) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (q.days - 1));

    const [ordersPerDay, byStatus, topProducts, signups] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; orders: number }[]>`
        SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS orders
        FROM "Order" WHERE "createdAt" >= ${since} AND status <> 'CANCELLED' GROUP BY 1 ORDER BY 1`,
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRaw<{ name: string; sku: string; units: number }[]>`
        SELECT oi."name" AS name, oi."sku" AS sku, SUM(oi."quantity")::int AS units
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= ${since} AND o.status NOT IN ('CANCELLED', 'REFUNDED', 'AWAITING_PAYMENT', 'PENDING')
        GROUP BY oi."name", oi."sku" ORDER BY units DESC, name ASC LIMIT 5`,
      this.prisma.$queryRaw<{ day: Date; customers: number }[]>`
        SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, COUNT(*)::int AS customers
        FROM "User" WHERE role = 'CUSTOMER' AND "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    ]);

    // Days with no activity are included as zeros so charts have a continuous axis.
    const days: string[] = [];
    for (let i = 0; i < q.days; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push(dayKey(d));
    }
    const orderMap = new Map(ordersPerDay.map((r) => [dayKey(r.day), r.orders]));
    const signupMap = new Map(signups.map((r) => [dayKey(r.day), r.customers]));

    let revenue: unknown = null;
    if (user.role === Role.ADMIN) {
      const rows = await this.prisma.$queryRaw<{ day: Date; currency: string; amount: Prisma.Decimal }[]>`
        SELECT date_trunc('day', "paidAt" AT TIME ZONE 'UTC') AS day, "currency" AS currency, SUM("amount") AS amount
        FROM "Payment" WHERE status IN ('SUCCESSFUL', 'PARTIALLY_REFUNDED', 'REFUNDED') AND "paidAt" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`;
      const currencies = [...new Set(rows.map((r) => r.currency))];
      revenue = currencies.map((currency) => {
        const m = new Map(rows.filter((r) => r.currency === currency).map((r) => [dayKey(r.day), new Prisma.Decimal(r.amount).toString()]));
        return { currency, series: days.map((d) => ({ date: d, amount: m.get(d) ?? '0' })) };
      });
    }

    return {
      days: q.days,
      ordersPerDay: days.map((d) => ({ date: d, orders: orderMap.get(d) ?? 0 })),
      signupsPerDay: days.map((d) => ({ date: d, customers: signupMap.get(d) ?? 0 })),
      ordersByStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      topProducts,
      revenue,
    };
  }
}
