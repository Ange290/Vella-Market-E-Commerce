import { INestApplication } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import request from 'supertest';
import { DisabledGateway, PAYMENT_GATEWAY } from '../src/payments/gateway';
import { MockGateway } from '../src/payments/mock.gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';
import { setupShop } from './shop';

const SECRET = 'test-webhook-secret-hash-1234567890';
const TOTAL = '78352'; // see test/shop.ts

describe('Payments (e2e, mock gateway)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let gw: MockGateway;
  let shop: Awaited<ReturnType<typeof setupShop>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const pay = (orderId: string, method = 'MTN_MOBILE_MONEY', token = shop.cust.token, headers: Record<string, string> = {}) =>
    http().post(`/api/v1/orders/${orderId}/payments`).set(auth(token)).set(headers).send({ method });
  const simulate = (reference: string, outcome: string, amount?: string) => http().post(`/api/v1/dev/payments/${reference}/simulate`).send({ outcome, amount });
  const webhook = (body: object, secret: string | null = SECRET) => {
    const r = http().post('/api/v1/payments/webhooks/flutterwave');
    if (secret !== null) r.set('verif-hash', secret);
    return r.send(body);
  };
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
  const paymentBy = (reference: string) => prisma.payment.findUniqueOrThrow({ where: { reference } });
  /** Order → initiate → simulated successful payment. Returns ids. */
  async function paidOrder() {
    const order = await shop.placeOrder();
    const p = (await pay(order.id).expect(201)).body;
    await simulate(p.reference, 'successful').expect(200);
    return { order, payment: await paymentBy(p.reference) };
  }

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
    gw = app.get(PAYMENT_GATEWAY);
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    shop = await setupShop(app, prisma, mail);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('initiation', () => {
    it('charges the stored order total, ignores client-supplied amounts, and hides provider internals', async () => {
      const order = await shop.placeOrder();
      await http().post(`/api/v1/orders/${order.id}/payments`).set(auth(shop.cust.token)).send({ method: 'MTN_MOBILE_MONEY', amount: '1' }).expect(400);
      const res = (await pay(order.id).expect(201)).body;
      expect(res).toMatchObject({ status: 'PENDING', method: 'MTN_MOBILE_MONEY', amount: TOTAL, currency: 'RWF' });
      expect(res.reference).toMatch(/^VMP-\d{8}-[A-Z2-9]{6}-[0-9A-F]{6}$/);
      expect(res.checkoutUrl).toContain(res.reference);
      expect(res).not.toHaveProperty('providerResponse');
      expect((await orderOf(order.id)).status).toBe('AWAITING_PAYMENT'); // not paid until the provider confirms
    });

    it('reuses a live payment, supersedes it on a method change, and honours Idempotency-Key', async () => {
      const order = await shop.placeOrder();
      const first = (await pay(order.id).expect(201)).body;
      const again = (await pay(order.id).expect(201)).body;
      expect(again.id).toBe(first.id); // no duplicate row for the same method

      const card = (await pay(order.id, 'CARD').expect(201)).body;
      expect(card.id).not.toBe(first.id);
      expect((await paymentBy(first.reference)).status).toBe('CANCELLED');

      const k1 = (await pay(order.id, 'AIRTEL_MONEY', shop.cust.token, { 'Idempotency-Key': 'key-1' }).expect(201)).body;
      const k2 = (await pay(order.id, 'AIRTEL_MONEY', shop.cust.token, { 'Idempotency-Key': 'key-1' }).expect(201)).body;
      expect(k2.id).toBe(k1.id);
      const other = await shop.placeOrder(shop.other, shop.otherAddressId);
      await pay(other.id, 'CARD', shop.other.token, { 'Idempotency-Key': 'key-1' }).expect(409); // key belongs to another request
    });

    it('creates only one payment when initiated concurrently', async () => {
      const order = await shop.placeOrder();
      const results = await Promise.all([pay(order.id), pay(order.id), pay(order.id)]);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('rejects other users, unknown orders, bad methods, and orders that are cancelled or already paid', async () => {
      const order = await shop.placeOrder();
      await pay(order.id, 'CARD', shop.other.token).expect(404);
      await pay('missing').expect(404);
      await http().post(`/api/v1/orders/${order.id}/payments`).set(auth(shop.cust.token)).send({ method: 'BITCOIN' }).expect(400);
      await http().post(`/api/v1/orders/${order.id}/payments`).send({ method: 'CARD' }).expect(401);

      const { order: paid } = await paidOrder();
      await pay(paid.id).expect(409); // already paid

      const o2 = await shop.placeOrder();
      await http().post(`/api/v1/orders/${o2.id}/cancel`).set(auth(shop.cust.token)).expect(200);
      expect((await pay(o2.id).expect(409)).body.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('answers 503 and fakes nothing when no payment provider is configured', async () => {
      const { app: bare } = await createTestApp((b) => b.overrideProvider(PAYMENT_GATEWAY).useValue(new DisabledGateway()));
      try {
        const order = await shop.placeOrder();
        const r = await request(bare.getHttpServer()).post(`/api/v1/orders/${order.id}/payments`).set(auth(shop.cust.token)).send({ method: 'CARD' }).expect(503);
        expect(r.body.code).toBe('PAYMENTS_DISABLED');
        await request(bare.getHttpServer()).post('/api/v1/payments/webhooks/flutterwave').set('verif-hash', SECRET).send({ data: { id: 1, tx_ref: 'x' } }).expect(401);
        expect(await prisma.payment.count()).toBe(0);
      } finally {
        await bare.close();
      }
    });
  });

  describe('confirmation via verified webhooks', () => {
    it('marks the payment and order paid only after the provider confirms, and records the timeline', async () => {
      const { order, payment } = await paidOrder();
      expect(payment.status).toBe('SUCCESSFUL');
      expect(payment.paidAt).not.toBeNull();
      expect(payment.providerReference).toMatch(/^MOCK-/);
      const o = await orderOf(order.id);
      expect(o.status).toBe('PAID');
      expect(o.history.map((h) => h.status)).toEqual(['AWAITING_PAYMENT', 'PAID']);
      expect(o.history[1].description).toContain(payment.reference);
      const notes = (await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body;
      expect(notes.items.some((n: any) => n.title === 'Payment received')).toBe(true);
      const ev = await prisma.webhookEvent.findFirstOrThrow({});
      expect(ev.processedAt).not.toBeNull();
      expect(JSON.stringify(ev.payload)).not.toMatch(/email|phone/i); // payload is stored redacted
    });

    it('ignores replayed webhooks (idempotent)', async () => {
      const { order, payment } = await paidOrder();
      const ev = await prisma.webhookEvent.findFirstOrThrow({});
      const body = { event: 'charge.completed', data: { id: ev.eventId, tx_ref: payment.reference, status: 'successful' } };
      const replay = (await webhook(body).expect(200)).body;
      expect(replay.duplicate).toBe(true);
      expect((await orderOf(order.id)).history.filter((h) => h.status === 'PAID')).toHaveLength(1);
      expect(await prisma.webhookEvent.count()).toBe(1);
    });

    it('rejects webhooks with a missing or wrong signature and changes nothing', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      gw.simulate(p.reference, { status: 'successful' });
      const body = { event: 'charge.completed', data: { id: 777, tx_ref: p.reference, status: 'successful' } };
      await webhook(body, null).expect(401);
      await webhook(body, 'wrong-secret').expect(401);
      await webhook(body, SECRET + 'x').expect(401);
      expect((await paymentBy(p.reference)).status).toBe('PENDING');
      expect((await orderOf(order.id)).status).toBe('AWAITING_PAYMENT');
      expect(await prisma.webhookEvent.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'payment.webhook.rejected' } })).toBe(3);
    });

    it('never trusts the webhook body: a validly signed "successful" claim is ignored if the provider says pending', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      await webhook({ event: 'charge.completed', data: { id: 5, tx_ref: p.reference, status: 'successful', amount: TOTAL, currency: 'RWF' } }).expect(200);
      expect((await paymentBy(p.reference)).status).toBe('PENDING');
      expect((await orderOf(order.id)).status).toBe('AWAITING_PAYMENT');
    });

    it('returns 200 for unrelated events and 404-safe handling for unknown references', async () => {
      await webhook({ event: 'transfer.completed', data: { something: 'else' } }).expect(200);
      const r = await webhook({ event: 'charge.completed', data: { id: 9, tx_ref: 'VMP-DOES-NOT-EXIST', status: 'successful' } });
      expect(r.status).toBe(404); // provider will retry; nothing is marked paid
      expect(await prisma.payment.count({ where: { status: 'SUCCESSFUL' } })).toBe(0);
    });

    it('refuses a successful payment whose amount or currency differs from the order', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      await simulate(p.reference, 'successful', '100').expect(200);
      const stored = await paymentBy(p.reference);
      expect(stored.status).toBe('FAILED');
      expect(stored.failureReason).toBe('AMOUNT_OR_CURRENCY_MISMATCH');
      expect((await orderOf(order.id)).status).toBe('AWAITING_PAYMENT');
      expect(await prisma.auditLog.count({ where: { action: 'payment.mismatch' } })).toBe(1);
    });

    it('handles a failed payment, notifies the customer, and lets them retry successfully', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      await simulate(p.reference, 'failed').expect(200);
      expect((await paymentBy(p.reference)).status).toBe('FAILED');
      expect((await orderOf(order.id)).status).toBe('AWAITING_PAYMENT');
      expect((await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body.items.some((n: any) => n.title === 'Payment failed')).toBe(true);

      const retry = (await pay(order.id).expect(201)).body;
      expect(retry.reference).not.toBe(p.reference);
      await simulate(retry.reference, 'successful').expect(200);
      expect((await orderOf(order.id)).status).toBe('PAID');
    });
  });

  describe('customer status polling', () => {
    it('re-verifies with the provider so the customer sees success even without a webhook', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      const status = (path: string) => http().get(`/api/v1/payments/${path}/status`).set(auth(shop.cust.token));
      expect((await status(p.reference).expect(200)).body.status).toBe('PENDING');

      gw.simulate(p.reference, { status: 'successful' }); // provider-side success, no webhook delivered
      const results = await Promise.all([status(p.reference), status(p.reference), status(p.reference)]);
      expect(results.every((r) => r.body.status === 'SUCCESSFUL')).toBe(true);
      const o = await orderOf(order.id);
      expect(o.status).toBe('PAID');
      expect(o.history.filter((h) => h.status === 'PAID')).toHaveLength(1); // concurrent settles paid it once

      await http().get(`/api/v1/payments/${p.reference}/status`).set(auth(shop.other.token)).expect(404);
      await http().get(`/api/v1/payments/${p.reference}/status`).expect(401);
    });
  });

  describe('duplicate and late payments', () => {
    it('flags a second successful payment for the same order and requests a refund instead of double-crediting', async () => {
      const order = await shop.placeOrder();
      const first = (await pay(order.id, 'CARD').expect(201)).body;
      const second = (await pay(order.id, 'MTN_MOBILE_MONEY').expect(201)).body; // supersedes the first attempt
      await simulate(second.reference, 'successful').expect(200);
      expect((await orderOf(order.id)).status).toBe('PAID');

      // the customer also completed the older link
      await simulate(first.reference, 'successful').expect(200);
      const dup = await paymentBy(first.reference);
      expect(dup.status).toBe('CANCELLED');
      expect(dup.failureReason).toBe('DUPLICATE_PAYMENT_REFUND_REQUIRED');
      expect(await prisma.payment.count({ where: { orderId: order.id, status: 'SUCCESSFUL' } })).toBe(1);
      const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: dup.id } });
      expect(refund.status).toBe('REQUESTED');
      expect(refund.amount.toString()).toBe(TOTAL);
      expect((await orderOf(order.id)).history.filter((h) => h.status === 'PAID')).toHaveLength(1);

      // the admin returns the duplicate money
      const done = (await http().post(`/api/v1/admin/payments/${dup.id}/refunds`).set(auth(shop.admin.token)).send({ reason: 'Duplicate payment' }).expect(201)).body;
      expect(done.status).toBe('COMPLETED');
      expect((await orderOf(order.id)).status).toBe('PAID'); // the genuine payment is untouched
    });

    it('requests a refund when money arrives for an order that was cancelled meanwhile', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      await http().post(`/api/v1/orders/${order.id}/cancel`).set(auth(shop.cust.token)).expect(200);
      await simulate(p.reference, 'successful').expect(200);
      expect((await orderOf(order.id)).status).toBe('CANCELLED');
      const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { reference: p.reference } } });
      expect(refund).toMatchObject({ status: 'REQUESTED' });
      expect(refund.reason).toMatch(/cancelled/i);
    });
  });

  describe('refunds', () => {
    it('refunds in parts, then fully; the order becomes REFUNDED only when fully refunded', async () => {
      const { order, payment } = await paidOrder();
      const refund = (body: object, token = shop.admin.token) => http().post(`/api/v1/admin/payments/${payment.id}/refunds`).set(auth(token)).send(body);

      await refund({ amount: '10000', reason: 'Goodwill refund' }).expect(201);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PARTIALLY_REFUNDED');
      expect((await orderOf(order.id)).status).toBe('PAID');

      await refund({ amount: '70000', reason: 'Too much' }).expect(400); // only 68,352 remain
      await refund({ amount: '0', reason: 'Zero is invalid' }).expect(400);
      await refund({ amount: '10.555', reason: 'Bad precision' }).expect(400);
      await refund({ amount: '5' }).expect(400); // reason required

      const rest = (await refund({ reason: 'Return the remainder' }).expect(201)).body;
      expect(rest.amount).toBe('68352');
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
      const o = await orderOf(order.id);
      expect(o.status).toBe('REFUNDED');
      expect(o.history.at(-1)!.status).toBe('REFUNDED');
      await refund({ reason: 'Nothing left to refund' }).expect(409);
      expect(await prisma.auditLog.count({ where: { action: 'refund.create' } })).toBe(2);
    });

    it('is ADMIN-only and only possible for paid payments', async () => {
      const { payment } = await paidOrder();
      const staff = await loginAs(app, prisma, mail, Role.STAFF);
      await http().post(`/api/v1/admin/payments/${payment.id}/refunds`).set(auth(staff.token)).send({ reason: 'staff attempt' }).expect(403);
      await http().post(`/api/v1/admin/payments/${payment.id}/refunds`).set(auth(shop.cust.token)).send({ reason: 'customer attempt' }).expect(403);

      const order = await shop.placeOrder(shop.other, shop.otherAddressId);
      const unpaid = (await pay(order.id, 'CARD', shop.other.token).expect(201)).body;
      const unpaidRow = await paymentBy(unpaid.reference);
      await http().post(`/api/v1/admin/payments/${unpaidRow.id}/refunds`).set(auth(shop.admin.token)).send({ reason: 'not paid yet' }).expect(409);
    });

    it('tracks refunds the provider is still processing and failed ones', async () => {
      const { payment } = await paidOrder();
      const refund = () => http().post(`/api/v1/admin/payments/${payment.id}/refunds`).set(auth(shop.admin.token)).send({ amount: '1000', reason: 'Testing provider states' });

      gw.failNextRefundWith('failed');
      const failed = (await refund().expect(201)).body;
      expect(failed.status).toBe('FAILED');
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('SUCCESSFUL'); // failed refunds change nothing

      gw.failNextRefundWith('processing');
      const processing = (await refund().expect(201)).body;
      expect(processing.status).toBe('PROCESSING');
      await http().patch(`/api/v1/admin/refunds/${processing.id}`).set(auth(shop.admin.token)).send({ status: 'COMPLETED' }).expect(200);
      await http().patch(`/api/v1/admin/refunds/${processing.id}`).set(auth(shop.admin.token)).send({ status: 'FAILED' }).expect(409); // already resolved
      const list = (await http().get('/api/v1/admin/refunds?status=COMPLETED').set(auth(shop.admin.token)).expect(200)).body;
      expect(list.total).toBe(1);
    });
  });

  describe('admin payment management', () => {
    it('lists, searches and inspects payments; customers are locked out', async () => {
      const { order, payment } = await paidOrder();
      await http().get('/api/v1/admin/payments').set(auth(shop.cust.token)).expect(403);
      await http().get('/api/v1/admin/payments').expect(401);

      const all = (await http().get('/api/v1/admin/payments').set(auth(shop.admin.token)).expect(200)).body;
      expect(all.total).toBe(1);
      expect(all.items[0]).toMatchObject({ reference: payment.reference, status: 'SUCCESSFUL', amount: TOTAL });
      expect(all.items[0].order.orderNumber).toBe(order.orderNumber);
      expect((await http().get(`/api/v1/admin/payments?search=${order.orderNumber}`).set(auth(shop.admin.token))).body.total).toBe(1);
      expect((await http().get('/api/v1/admin/payments?status=FAILED').set(auth(shop.admin.token))).body.total).toBe(0);

      const detail = (await http().get(`/api/v1/admin/payments/${payment.id}`).set(auth(shop.admin.token)).expect(200)).body;
      expect(detail.providerResponse).toBeDefined(); // admins can see provider data
      expect(detail.refunds).toEqual([]);
    });

    it('lets staff re-verify a stuck payment with the provider', async () => {
      const order = await shop.placeOrder();
      const p = (await pay(order.id).expect(201)).body;
      const row = await paymentBy(p.reference);
      gw.simulate(p.reference, { status: 'successful' }); // webhook never arrived
      const staff = await loginAs(app, prisma, mail, Role.STAFF);
      const res = (await http().post(`/api/v1/admin/payments/${row.id}/verify`).set(auth(staff.token)).expect(200)).body;
      expect(res.status).toBe('SUCCESSFUL');
      expect((await orderOf(order.id)).status).toBe('PAID');
    });
  });

  it('keeps the monetary values exact (no floating point drift)', async () => {
    const { payment } = await paidOrder();
    expect(new Prisma.Decimal(payment.amount).equals(new Prisma.Decimal('78352'))).toBe(true);
  });
});
