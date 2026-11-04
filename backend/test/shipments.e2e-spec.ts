import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';
import { setupShop } from './shop';

describe('Shipments & tracking (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let orders: OrdersService;
  let shop: Awaited<ReturnType<typeof setupShop>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const adminReq = (method: 'post' | 'patch' | 'get' | 'delete', path: string, body?: object) =>
    http()[method](`/api/v1/admin/${path}`).set(auth(shop.admin.token)).send(body);

  /** An order that is paid and in PROCESSING — the earliest state a shipment may be created. */
  async function processingOrder(account = shop.cust, addr = shop.addressId) {
    const order = await shop.placeOrder(account, addr);
    await orders.changeStatus(order.id, 'PAID', { system: true });
    await adminReq('patch', `orders/${order.id}/status`, { status: 'PROCESSING' }).expect(200);
    return order;
  }
  const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const timeline = async (id: string) => (await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })).map((h) => h.status);
  const event = (shipmentId: string, status: string, extra: object = {}) => adminReq('post', `shipments/${shipmentId}/events`, { status, ...extra });

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
    orders = app.get(OrdersService);
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    shop = await setupShop(app, prisma, mail);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('creating shipments', () => {
    it('only allows shipments for paid orders that are being processed', async () => {
      const unpaid = await shop.placeOrder();
      expect((await adminReq('post', `orders/${unpaid.id}/shipments`, {}).expect(409)).body.code).toBe('ORDER_NOT_SHIPPABLE');
      await orders.changeStatus(unpaid.id, 'PAID', { system: true });
      await adminReq('post', `orders/${unpaid.id}/shipments`, {}).expect(409); // paid but not yet processing
      await adminReq('post', 'orders/nope/shipments', {}).expect(404);

      await adminReq('patch', `orders/${unpaid.id}/status`, { status: 'PROCESSING' }).expect(200);
      const s = (await adminReq('post', `orders/${unpaid.id}/shipments`, { carrier: 'YunExpress', trackingNumber: 'YT123', weightGrams: 1300, cost: '59', costCurrency: 'CNY', estimatedDelivery: '2026-12-01T00:00:00Z' }).expect(201)).body;
      expect(s).toMatchObject({ carrier: 'YunExpress', trackingNumber: 'YT123', status: 'PENDING', originCountry: 'CN', destinationCountry: 'RW', weightGrams: 1300, cost: '59', costCurrency: 'CNY' });
      expect(s.events).toHaveLength(1);
    });

    it('validates input and restricts access to ADMIN/STAFF', async () => {
      const order = await processingOrder();
      await adminReq('post', `orders/${order.id}/shipments`, { cost: '10' }).expect(400); // currency required with cost
      await adminReq('post', `orders/${order.id}/shipments`, { cost: '-1', costCurrency: 'CNY' }).expect(400);
      await adminReq('post', `orders/${order.id}/shipments`, { weightGrams: 0 }).expect(400);
      await adminReq('post', `orders/${order.id}/shipments`, { unknownField: 1 }).expect(400);
      await http().post(`/api/v1/admin/orders/${order.id}/shipments`).set(auth(shop.cust.token)).send({}).expect(403);
      await http().get('/api/v1/admin/shipments').set(auth(shop.cust.token)).expect(403);
      await http().get('/api/v1/admin/shipments').expect(401);
      const staff = await loginAs(app, prisma, mail, Role.STAFF);
      await http().post(`/api/v1/admin/orders/${order.id}/shipments`).set(auth(staff.token)).send({ carrier: 'DHL' }).expect(201);
    });

    it('updates details and deletes only shipments that have not started moving', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, { carrier: 'DHL' }).expect(201)).body;
      const upd = (await adminReq('patch', `shipments/${s.id}`, { trackingNumber: 'DHL999', carrier: 'DHL Express' }).expect(200)).body;
      expect(upd).toMatchObject({ trackingNumber: 'DHL999', carrier: 'DHL Express' });

      const moving = (await adminReq('post', `orders/${order.id}/shipments`, {}).expect(201)).body;
      await event(moving.id, 'IN_TRANSIT').expect(201);
      await adminReq('delete', `shipments/${moving.id}`).expect(409);
      await adminReq('delete', `shipments/${s.id}`).expect(204);
      await adminReq('get', `shipments/${s.id}`).expect(404);
    });
  });

  describe('tracking events and order synchronisation', () => {
    it('follows a shipment from China to delivery and moves the order through every stage', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, { carrier: 'YunExpress', trackingNumber: 'YT123' }).expect(201)).body;

      let res = (await event(s.id, 'IN_TRANSIT', { location: 'Guangzhou, CN', description: 'Departed origin facility' }).expect(201)).body;
      expect(res.status).toBe('IN_TRANSIT');
      expect(res.shippedAt).not.toBeNull();
      // order skipped PROCESSING → PURCHASED_FROM_SUPPLIER → SHIPPED_FROM_CHINA, each recorded on the timeline
      expect(await orderStatus(order.id)).toBe('SHIPPED_FROM_CHINA');
      expect(await timeline(order.id)).toEqual(['AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA']);
      const shippedEntry = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id, status: 'SHIPPED_FROM_CHINA' } });
      expect(shippedEntry.trackingRef).toBe('YT123');
      expect(shippedEntry.description).toBe('Departed origin facility');

      await event(s.id, 'CUSTOMS', { location: 'Kigali, RW', description: 'Customs clearance' }).expect(201);
      expect(await orderStatus(order.id)).toBe('SHIPPED_FROM_CHINA'); // customs is informational
      await event(s.id, 'ARRIVED', { location: 'Kigali Hub' }).expect(201);
      expect(await orderStatus(order.id)).toBe('ARRIVED_AT_DESTINATION_COUNTRY');
      await event(s.id, 'OUT_FOR_DELIVERY').expect(201);
      expect(await orderStatus(order.id)).toBe('OUT_FOR_DELIVERY');
      res = (await event(s.id, 'DELIVERED', { description: 'Signed by A. Uwase' }).expect(201)).body;
      expect(res.deliveredAt).not.toBeNull();
      expect(await orderStatus(order.id)).toBe('DELIVERED');
      expect(await timeline(order.id)).toEqual([
        'AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA', 'ARRIVED_AT_DESTINATION_COUNTRY', 'OUT_FOR_DELIVERY', 'DELIVERED',
      ]);
      expect(res.events.map((e: any) => e.status)).toEqual(['DELIVERED', 'OUT_FOR_DELIVERY', 'ARRIVED', 'CUSTOMS', 'IN_TRANSIT', 'PENDING']); // newest first
    });

    it('shows customers their own tracking, newest event first, and nobody else\'s', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, { trackingNumber: 'YT123', cost: '59', costCurrency: 'CNY' }).expect(201)).body;
      await event(s.id, 'IN_TRANSIT', { location: 'Guangzhou' }).expect(201);
      await event(s.id, 'CUSTOMS', { description: 'In customs' }).expect(201);

      const mine = (await http().get(`/api/v1/orders/${order.id}/shipments`).set(auth(shop.cust.token)).expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0].trackingNumber).toBe('YT123');
      expect(mine[0].events[0].status).toBe('CUSTOMS');
      expect(mine[0]).not.toHaveProperty('cost'); // internal logistics cost is not exposed
      const viaOrder = (await http().get(`/api/v1/orders/${order.id}`).set(auth(shop.cust.token))).body;
      expect(viaOrder.shipments[0].events.length).toBe(3);

      await http().get(`/api/v1/orders/${order.id}/shipments`).set(auth(shop.other.token)).expect(404);
      await http().get(`/api/v1/orders/${order.id}/shipments`).expect(401);
      const notes = (await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body.items;
      expect(notes.some((n: any) => n.title === 'Your package is in customs')).toBe(true);
    });

    it('can jump ahead, but never backwards', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, { trackingNumber: 'YT9' }).expect(201)).body;
      await event(s.id, 'ARRIVED').expect(201); // straight from PENDING
      expect(await timeline(order.id)).toEqual(['AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA', 'ARRIVED_AT_DESTINATION_COUNTRY']);

      expect((await event(s.id, 'IN_TRANSIT').expect(400)).body.code).toBe('INVALID_SHIPMENT_TRANSITION');
      await event(s.id, 'PENDING').expect(400);
      await event(s.id, 'ARRIVED', { description: 'Second scan at hub' }).expect(201); // same stage is fine
      await event(s.id, 'DELIVERED').expect(201);
      await event(s.id, 'OUT_FOR_DELIVERY').expect(400);
    });

    it('validates events', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, {}).expect(201)).body;
      await event(s.id, 'TELEPORTED').expect(400);
      await event(s.id, 'IN_TRANSIT', { occurredAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(400);
      await event(s.id, 'IN_TRANSIT', { occurredAt: 'yesterday' }).expect(400);
      await event('missing', 'IN_TRANSIT').expect(404);
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const ok = (await event(s.id, 'IN_TRANSIT', { occurredAt: past }).expect(201)).body;
      expect(new Date(ok.shippedAt).toISOString()).toBe(past);
    });

    it('holds the order back while a shipment has an exception, then resumes', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, {}).expect(201)).body;
      await event(s.id, 'EXCEPTION', { description: 'Address could not be verified' }).expect(201);
      expect(await orderStatus(order.id)).toBe('PROCESSING');
      const notes = (await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body.items;
      expect(notes.some((n: any) => n.title === 'There is an issue with your shipment')).toBe(true);

      await event(s.id, 'IN_TRANSIT', { description: 'Resolved, back on its way' }).expect(201); // recovery is allowed
      expect(await orderStatus(order.id)).toBe('SHIPPED_FROM_CHINA');
    });

    it('with several shipments, advances the order only when every shipment has reached the stage', async () => {
      const order = await processingOrder();
      const s1 = (await adminReq('post', `orders/${order.id}/shipments`, { trackingNumber: 'P1' }).expect(201)).body;
      const s2 = (await adminReq('post', `orders/${order.id}/shipments`, { trackingNumber: 'P2' }).expect(201)).body;

      await event(s1.id, 'IN_TRANSIT').expect(201);
      expect(await orderStatus(order.id)).toBe('PROCESSING'); // s2 has not left yet
      await event(s2.id, 'IN_TRANSIT').expect(201);
      expect(await orderStatus(order.id)).toBe('SHIPPED_FROM_CHINA');

      await event(s1.id, 'DELIVERED').expect(201);
      expect(await orderStatus(order.id)).toBe('SHIPPED_FROM_CHINA'); // partial delivery does not complete the order
      await event(s2.id, 'DELIVERED').expect(201);
      expect(await orderStatus(order.id)).toBe('DELIVERED');
    });

    it('does not fight manual order updates: an order already further along is left alone', async () => {
      const order = await processingOrder();
      const s = (await adminReq('post', `orders/${order.id}/shipments`, {}).expect(201)).body;
      for (const status of ['PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA', 'ARRIVED_AT_DESTINATION_COUNTRY']) {
        await adminReq('patch', `orders/${order.id}/status`, { status }).expect(200);
      }
      await event(s.id, 'IN_TRANSIT').expect(201); // stale scan arrives late
      expect(await orderStatus(order.id)).toBe('ARRIVED_AT_DESTINATION_COUNTRY');
      expect(await timeline(order.id).then((t) => t.filter((x) => x === 'SHIPPED_FROM_CHINA').length)).toBe(1);
    });
  });

  describe('admin listing', () => {
    it('filters by status and searches by tracking number, carrier or order reference', async () => {
      const o1 = await processingOrder();
      const o2 = await processingOrder(shop.other, shop.otherAddressId);
      const s1 = (await adminReq('post', `orders/${o1.id}/shipments`, { carrier: 'YunExpress', trackingNumber: 'YT-ALPHA' }).expect(201)).body;
      await adminReq('post', `orders/${o2.id}/shipments`, { carrier: 'DHL', trackingNumber: 'DHL-BETA' }).expect(201);
      await event(s1.id, 'IN_TRANSIT').expect(201);

      const all = (await adminReq('get', 'shipments').expect(200)).body;
      expect(all.total).toBe(2);
      expect(all.items[0].order.orderNumber).toBeDefined();
      expect((await adminReq('get', 'shipments?status=IN_TRANSIT').expect(200)).body.total).toBe(1);
      expect((await adminReq('get', 'shipments?search=beta').expect(200)).body.items[0].carrier).toBe('DHL');
      expect((await adminReq('get', `shipments?search=${o1.orderNumber}`).expect(200)).body.total).toBe(1);
      await adminReq('get', 'shipments?status=BOGUS').expect(400);
      expect(await prisma.auditLog.count({ where: { entity: 'Shipment' } })).toBeGreaterThanOrEqual(3);
    });
  });
});
