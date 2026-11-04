import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { OrdersService } from '../src/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';

/** Same hand-checked scenario as checkout.e2e-spec: 2×A(¥100,500g) + 1×B-L(¥60,300g) → 78,352 RWF. */
describe('Orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let orders: OrdersService;
  type Acct = Awaited<ReturnType<typeof loginAs>>;
  let admin: Acct;
  let cust: Acct;
  let other: Acct;
  let addressId: string;
  let otherAddressId: string;
  let A: any;
  let B: any;
  let BL: any;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const adminPost = (path: string, body: object) => http().post(`/api/v1/admin/${path}`).set(auth(admin.token)).send(body);
  const place = (token = cust.token, over: Record<string, unknown> = {}, addr = addressId) =>
    http().post('/api/v1/orders').set(auth(token)).send({ addressId: addr, deliveryMethod: 'STANDARD', currency: 'RWF', ...over });
  const addToCart = (token: string, productId: string, quantity: number, variantId?: string) =>
    http().post('/api/v1/cart/items').set(auth(token)).send({ productId, quantity, variantId }).expect(201);
  const fillCart = async () => {
    await addToCart(cust.token, A.id, 2);
    await addToCart(cust.token, B.id, 1, BL.id);
  };
  const stock = async () => ({
    a: (await prisma.product.findUniqueOrThrow({ where: { id: A.id } })).stock,
    bl: (await prisma.productVariant.findUniqueOrThrow({ where: { id: BL.id } })).stock,
  });
  const markPaid = (orderId: string) => orders.changeStatus(orderId, 'PAID', { system: true, description: 'test payment' });

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
    orders = app.get(OrdersService);
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    await prisma.currency.createMany({ data: [{ code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 }] });
    admin = await loginAs(app, prisma, mail, Role.ADMIN);
    cust = await loginAs(app, prisma, mail);
    other = await loginAs(app, prisma, mail);

    const cat = (await adminPost('categories', { name: 'Fashion' }).expect(201)).body.id;
    const mk = async (body: object) =>
      (await adminPost('products', { description: 'Generic test description.', categoryId: cat, status: 'ACTIVE', ...body }).expect(201)).body;
    A = await mk({ sku: 'PROD-A', name: 'Product A', priceCny: '100', stock: 10, weightGrams: 500 });
    B = await mk({
      sku: 'PROD-B', name: 'Product B', priceCny: '50', weightGrams: 300,
      variants: [{ sku: 'B-M', size: 'M', color: 'Blue', stock: 5 }, { sku: 'B-L', size: 'L', color: 'Blue', priceDeltaCny: '10', stock: 2 }],
    });
    BL = B.variants.find((v: any) => v.sku === 'B-L');

    await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '200' }).expect(201);
    await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin.token)).send({ value: '5' }).expect(200);
    await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '20', perKgFee: '30' }).expect(201);
    await adminPost('tax-rules', { country: 'RW', name: 'VAT', ratePct: '18' }).expect(201);

    const mkAddr = async (token: string) =>
      (await http().post('/api/v1/users/me/addresses').set(auth(token)).send({ recipientName: 'Aline Uwase', phone: '+250788123456', country: 'RW', city: 'Kigali', street: 'KG 7 Ave 12' }).expect(201)).body.id;
    addressId = await mkAddr(cust.token);
    otherAddressId = await mkAddr(other.token);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('placing an order', () => {
    it('creates an order that matches the quote, snapshots data, reserves stock and clears the cart', async () => {
      await fillCart();
      const quote = (await http().post('/api/v1/checkout/quote').set(auth(cust.token)).send({ addressId, deliveryMethod: 'STANDARD', currency: 'RWF' })).body;

      const res = await place(cust.token, { customerNote: 'Please call on arrival' }).expect(201);
      const o = res.body;
      expect(o.orderNumber).toMatch(/^VM-\d{8}-[A-Z2-9]{6}$/);
      expect(o.status).toBe('AWAITING_PAYMENT');
      expect(o.currency).toBe('RWF');
      expect(o.subtotal).toBe('52000');
      expect(o.shippingFee).toBe('11800');
      expect(o.serviceFee).toBe('2600');
      expect(o.taxAmount).toBe('11952');
      expect(o.discountAmount).toBe('0');
      expect(o.total).toBe('78352');
      expect(o.total).toBe(quote.breakdown.total.amount); // charged price == quoted price
      expect(o.exchangeRate).toBe('200');
      expect(o.customerNote).toBe('Please call on arrival');
      expect(o.shippingAddress).toMatchObject({ recipientName: 'Aline Uwase', country: 'RW', city: 'Kigali' });
      expect(o.items.map((i: any) => [i.sku, i.quantity, i.unitPrice, i.lineTotal, i.unitPriceCny])).toEqual([
        ['PROD-A', 2, '20000', '40000', '100'],
        ['B-L', 1, '12000', '12000', '60'],
      ]);
      expect(o.history).toHaveLength(1);
      expect(o.history[0]).toMatchObject({ status: 'AWAITING_PAYMENT' });

      expect(await stock()).toEqual({ a: 8, bl: 1 });
      expect((await http().get('/api/v1/cart').set(auth(cust.token))).body.items).toHaveLength(0);
      const notes = (await http().get('/api/v1/notifications').set(auth(cust.token))).body;
      expect(notes.unread).toBe(1);
      expect(notes.items[0].title).toBe('Order placed');
    });

    it('keeps historical prices and address when the catalogue or address changes later', async () => {
      await fillCart();
      const { id } = (await place().expect(201)).body;
      await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '999' }).expect(201);
      await http().patch(`/api/v1/admin/products/${A.id}`).set(auth(admin.token)).send({ priceCny: '1', name: 'Renamed' }).expect(200);
      await http().patch(`/api/v1/users/me/addresses/${addressId}`).set(auth(cust.token)).send({ city: 'Huye' }).expect(200);
      const o = (await http().get(`/api/v1/orders/${id}`).set(auth(cust.token)).expect(200)).body;
      expect(o.total).toBe('78352');
      expect(o.items[0].name).toBe('Product A');
      expect(o.items[0].unitPrice).toBe('20000');
      expect(o.shippingAddress.city).toBe('Kigali');
    });

    it('refuses empty carts, bad input, foreign addresses and unauthenticated requests', async () => {
      await place().expect(400);
      await fillCart();
      await place(cust.token, { deliveryMethod: 'TELEPORT' }).expect(400);
      await place(cust.token, {}, otherAddressId).expect(404);
      await http().post('/api/v1/orders').send({}).expect(401);
      await place(cust.token, { customerNote: 'x'.repeat(501) }).expect(400);
    });

    it('blocks checkout while the cart has stock problems and reports the issues', async () => {
      await fillCart();
      await prisma.product.update({ where: { id: A.id }, data: { stock: 1 } });
      const res = await place().expect(409);
      expect(res.body.code).toBe('CHECKOUT_ISSUES');
      expect(res.body.issues[0].code).toBe('INSUFFICIENT_STOCK');
      expect(await prisma.order.count()).toBe(0);
    });

    it('a double-submit creates exactly one order and takes stock once', async () => {
      await fillCart();
      const results = await Promise.all([place(), place()]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(201);
      expect(statuses[1]).toBeGreaterThanOrEqual(400);
      expect(await prisma.order.count()).toBe(1);
      expect(await stock()).toEqual({ a: 8, bl: 1 });
    });

    it('never oversells: two buyers racing for the last unit → one order, stock never negative', async () => {
      await prisma.product.update({ where: { id: A.id }, data: { stock: 1 } });
      await addToCart(cust.token, A.id, 1);
      await addToCart(other.token, A.id, 1);
      const results = await Promise.all([place(cust.token), place(other.token, {}, otherAddressId)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: A.id } })).stock).toBe(0);
      expect(await prisma.order.count()).toBe(1);
    });

    it('redeems a coupon exactly once even when two buyers race for its last use', async () => {
      await adminPost('coupons', { code: 'ONCE', type: 'PERCENTAGE', value: '10', maxUses: 1 }).expect(201);
      await addToCart(cust.token, A.id, 1);
      await addToCart(other.token, A.id, 1);
      const results = await Promise.all([place(cust.token, { couponCode: 'ONCE' }), place(other.token, { couponCode: 'ONCE' }, otherAddressId)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'ONCE' } })).usedCount).toBe(1);
      // the loser's transaction rolled back completely: only one unit of stock was taken
      expect((await prisma.product.findUniqueOrThrow({ where: { id: A.id } })).stock).toBe(9);
      const winner = results.find((r) => r.status === 201)!.body;
      expect(winner.discountAmount).toBe('2000'); // 10% of 20,000
    });
  });

  describe('customer views', () => {
    it('lists only my orders, filters by status, paginates, and hides others\' orders', async () => {
      await addToCart(cust.token, A.id, 1);
      const o1 = (await place().expect(201)).body;
      await addToCart(cust.token, A.id, 1);
      const o2 = (await place().expect(201)).body;
      await addToCart(other.token, A.id, 1);
      const o3 = (await place(other.token, {}, otherAddressId).expect(201)).body;

      const mine = (await http().get('/api/v1/orders').set(auth(cust.token)).expect(200)).body;
      expect(mine.total).toBe(2);
      expect(mine.items.map((i: any) => i.id)).toEqual([o2.id, o1.id]); // newest first
      expect(mine.items[0].itemCount).toBe(1);
      expect(mine.items[0]).not.toHaveProperty('shippingAddress');

      await http().post(`/api/v1/orders/${o1.id}/cancel`).set(auth(cust.token)).expect(200);
      expect((await http().get('/api/v1/orders?status=CANCELLED').set(auth(cust.token))).body.total).toBe(1);
      expect((await http().get('/api/v1/orders?pageSize=1&page=2').set(auth(cust.token))).body.items).toHaveLength(1);
      await http().get('/api/v1/orders?status=BOGUS').set(auth(cust.token)).expect(400);

      await http().get(`/api/v1/orders/${o3.id}`).set(auth(cust.token)).expect(404);
      await http().post(`/api/v1/orders/${o3.id}/cancel`).set(auth(cust.token)).expect(404);
      await http().get('/api/v1/orders').expect(401);
    });

    it('finds an order by its reference, case-insensitively, for the owner only', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      const res = await http().get(`/api/v1/orders/by-number/${o.orderNumber.toLowerCase()}`).set(auth(cust.token)).expect(200);
      expect(res.body.id).toBe(o.id);
      await http().get(`/api/v1/orders/by-number/${o.orderNumber}`).set(auth(other.token)).expect(404);
      await http().get('/api/v1/orders/by-number/VM-00000000-AAAAAA').set(auth(cust.token)).expect(404);
    });
  });

  describe('cancellation', () => {
    it('releases stock and the coupon, records the timeline, and cannot be repeated', async () => {
      await adminPost('coupons', { code: 'SAVE', type: 'PERCENTAGE', value: '10', maxUses: 5 }).expect(201);
      await fillCart();
      const o = (await place(cust.token, { couponCode: 'SAVE' }).expect(201)).body;
      expect(await stock()).toEqual({ a: 8, bl: 1 });
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAVE' } })).usedCount).toBe(1);

      const res = (await http().post(`/api/v1/orders/${o.id}/cancel`).set(auth(cust.token)).send({ reason: 'Changed my mind' }).expect(200)).body;
      expect(res.status).toBe('CANCELLED');
      expect(res.history.map((h: any) => h.status)).toEqual(['AWAITING_PAYMENT', 'CANCELLED']);
      expect(res.history[1].description).toBe('Changed my mind');
      expect(await stock()).toEqual({ a: 10, bl: 2 });
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'SAVE' } })).usedCount).toBe(0);

      const again = await http().post(`/api/v1/orders/${o.id}/cancel`).set(auth(cust.token)).expect(409);
      expect(again.body.code).toBe('NOT_CANCELLABLE');
      expect(await stock()).toEqual({ a: 10, bl: 2 }); // not restocked twice
    });

    it('cannot be cancelled online once paid', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      await markPaid(o.id);
      expect((await http().post(`/api/v1/orders/${o.id}/cancel`).set(auth(cust.token)).expect(409)).body.code).toBe('NOT_CANCELLABLE');
    });
  });

  describe('admin order management', () => {
    it('is restricted to ADMIN/STAFF', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      await http().get('/api/v1/admin/orders').set(auth(cust.token)).expect(403);
      await http().get(`/api/v1/admin/orders/${o.id}`).set(auth(cust.token)).expect(403);
      await http().patch(`/api/v1/admin/orders/${o.id}/status`).set(auth(cust.token)).send({ status: 'PROCESSING' }).expect(403);
      await http().get('/api/v1/admin/orders').expect(401);
      const staff = await loginAs(app, prisma, mail, Role.STAFF);
      await http().get('/api/v1/admin/orders').set(auth(staff.token)).expect(200);
    });

    it('lists, searches and filters orders', async () => {
      await addToCart(cust.token, A.id, 1);
      const o1 = (await place().expect(201)).body;
      await addToCart(other.token, A.id, 1);
      await place(other.token, {}, otherAddressId).expect(201);
      await http().post(`/api/v1/orders/${o1.id}/cancel`).set(auth(cust.token)).expect(200);

      const all = (await http().get('/api/v1/admin/orders').set(auth(admin.token)).expect(200)).body;
      expect(all.total).toBe(2);
      expect(all.items[0].user.email).toBeDefined();
      expect((await http().get('/api/v1/admin/orders?status=CANCELLED').set(auth(admin.token))).body.total).toBe(1);
      expect((await http().get(`/api/v1/admin/orders?search=${o1.orderNumber.slice(-6)}`).set(auth(admin.token))).body.total).toBe(1);
      expect((await http().get(`/api/v1/admin/orders?search=${other.user.email}`).set(auth(admin.token))).body.total).toBe(1);
      expect((await http().get('/api/v1/admin/orders?from=2999-01-01T00:00:00Z').set(auth(admin.token))).body.total).toBe(0);
      expect((await http().get(`/api/v1/admin/orders/${o1.id}`).set(auth(admin.token)).expect(200)).body.user.email).toBe(cust.user.email);
    });

    it('walks an order through the full lifecycle, building the customer timeline and notifications', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      const patch = (status: string, extra: object = {}) => http().patch(`/api/v1/admin/orders/${o.id}/status`).set(auth(admin.token)).send({ status, ...extra });

      await markPaid(o.id); // done by the payments module in production
      await patch('PROCESSING', { description: 'Preparing your purchase' }).expect(200);
      await patch('PURCHASED_FROM_SUPPLIER').expect(200);
      const shipped = (await patch('SHIPPED_FROM_CHINA', { trackingRef: 'YT1234567890CN', description: 'Left Guangzhou' }).expect(200)).body;
      expect(shipped.status).toBe('SHIPPED_FROM_CHINA');
      await patch('ARRIVED_AT_DESTINATION_COUNTRY').expect(200);
      await patch('OUT_FOR_DELIVERY').expect(200);
      await patch('DELIVERED').expect(200);

      const mine = (await http().get(`/api/v1/orders/${o.id}`).set(auth(cust.token)).expect(200)).body;
      expect(mine.status).toBe('DELIVERED');
      expect(mine.history.map((h: any) => h.status)).toEqual([
        'AWAITING_PAYMENT', 'PAID', 'PROCESSING', 'PURCHASED_FROM_SUPPLIER', 'SHIPPED_FROM_CHINA', 'ARRIVED_AT_DESTINATION_COUNTRY', 'OUT_FOR_DELIVERY', 'DELIVERED',
      ]);
      const ship = mine.history.find((h: any) => h.status === 'SHIPPED_FROM_CHINA');
      expect(ship).toMatchObject({ trackingRef: 'YT1234567890CN', description: 'Left Guangzhou' });
      expect(mine.history[0]).not.toHaveProperty('createdBy'); // staff identities are not exposed to customers

      const adminView = (await http().get(`/api/v1/admin/orders/${o.id}`).set(auth(admin.token))).body;
      expect(adminView.history[2].createdBy.id).toBe(admin.id);

      const notes = (await http().get('/api/v1/notifications').set(auth(cust.token))).body;
      expect(notes.total).toBe(8); // placed + 7 status changes
      const audit = await prisma.auditLog.findMany({ where: { action: 'order.status.update' } });
      expect(audit).toHaveLength(6);

      await patch('PROCESSING').expect(400); // nothing moves after DELIVERED
    });

    it('rejects invalid transitions and never lets admins set PAID or REFUNDED', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      const patch = (status: string) => http().patch(`/api/v1/admin/orders/${o.id}/status`).set(auth(admin.token)).send({ status });

      expect((await patch('PROCESSING').expect(400)).body.code).toBe('INVALID_TRANSITION'); // unpaid
      await patch('PAID').expect(400);
      await patch('REFUNDED').expect(400);
      await patch('DELIVERED').expect(400);
      await patch('NOT_A_STATUS').expect(400);
      await http().patch('/api/v1/admin/orders/nope/status').set(auth(admin.token)).send({ status: 'CANCELLED' }).expect(404);

      await markPaid(o.id);
      await patch('SHIPPED_FROM_CHINA').expect(400); // cannot skip steps
      await patch('CANCELLED').expect(400); // paid orders go through the refund flow instead
      await patch('PROCESSING').expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PROCESSING');
    });

    it('admin cancellation of an unpaid order restocks', async () => {
      await fillCart();
      const o = (await place().expect(201)).body;
      expect(await stock()).toEqual({ a: 8, bl: 1 });
      const res = await http().patch(`/api/v1/admin/orders/${o.id}/status`).set(auth(admin.token)).send({ status: 'CANCELLED', description: 'Customer asked by phone' }).expect(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(await stock()).toEqual({ a: 10, bl: 2 });
    });

    it('the system (payments) path can refund a paid order but only along allowed transitions', async () => {
      await addToCart(cust.token, A.id, 1);
      const o = (await place().expect(201)).body;
      await expect(orders.changeStatus(o.id, 'REFUNDED', { system: true })).rejects.toMatchObject({ status: 400 }); // not paid yet
      await markPaid(o.id);
      await orders.changeStatus(o.id, 'REFUNDED', { system: true, description: 'Refund issued' });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('REFUNDED');
    });
  });

  describe('notifications', () => {
    it('lists, marks as read, and is private per user', async () => {
      await addToCart(cust.token, A.id, 1);
      await place().expect(201);
      const list = (await http().get('/api/v1/notifications').set(auth(cust.token)).expect(200)).body;
      expect(list.unread).toBe(1);
      const id = list.items[0].id;

      await http().post(`/api/v1/notifications/${id}/read`).set(auth(other.token)).expect(404);
      await http().post(`/api/v1/notifications/${id}/read`).set(auth(cust.token)).expect(200);
      expect((await http().get('/api/v1/notifications?unreadOnly=true').set(auth(cust.token))).body.total).toBe(0);
      expect((await http().get('/api/v1/notifications').set(auth(other.token))).body.total).toBe(0);
      expect((await http().post('/api/v1/notifications/read-all').set(auth(cust.token)).expect(200)).body.updated).toBe(0);
      await http().get('/api/v1/notifications').expect(401);
    });
  });
});
