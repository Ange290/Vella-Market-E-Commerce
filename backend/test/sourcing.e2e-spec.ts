import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';
import { setupShop } from './shop';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('Sourcing requests & quotations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let shop: Awaited<ReturnType<typeof setupShop>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const adminReq = (method: 'post' | 'patch' | 'get', path: string, body?: object) => http()[method](`/api/v1/admin/${path}`).set(auth(shop.admin.token)).send(body);

  const link = 'https://detail.1688.com/offer/123456.html';
  const submit = (body: object = {}, token = shop.cust.token) =>
    http().post('/api/v1/product-requests').set(auth(token)).send({ productUrl: link, title: 'Wireless earbuds', quantity: 20, preferredColor: 'Black', preferredSize: 'M', instructions: 'Please check battery life', ...body });
  const quote = (over: object = {}) => ({ productCost: '50000', shippingCost: '12000', serviceFee: '2500', currency: 'RWF', validUntil: days(7), notes: 'Includes inspection', ...over });
  const quotation = async (requestId: string, over: object = {}, send = true) =>
    (await adminReq('post', `product-requests/${requestId}/quotations`, { ...quote(over), send }).expect(201)).body;

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    shop = await setupShop(app, prisma, mail);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('submitting requests', () => {
    it('accepts a product link, a photo, or both, and stores the request for the customer', async () => {
      const a = (await submit().expect(201)).body;
      expect(a).toMatchObject({ productUrl: link, quantity: 20, preferredColor: 'Black', preferredSize: 'M', status: 'SUBMITTED', userId: shop.cust.id });

      const b = (await http().post('/api/v1/product-requests').set(auth(shop.cust.token))
        .field('quantity', '3').field('title', 'Red handbag').field('instructions', 'Like the photo')
        .attach('image', PNG, { filename: 'bag.png', contentType: 'image/png' }).expect(201)).body;
      expect(b.imageUrl).toMatch(/^\/uploads\/[a-f0-9]{32}\.png$/);
      expect(b.quantity).toBe(3);

      await submit({ productUrl: undefined }).expect(400); // neither link nor image
      await http().post('/api/v1/product-requests').set(auth(shop.cust.token)).send({ quantity: 1 }).expect(400);
    });

    it('validates input: URL scheme, quantity, image bytes, unknown fields, login', async () => {
      await submit({ productUrl: 'javascript:alert(1)' }).expect(400);
      await submit({ productUrl: 'ftp://x.com/a' }).expect(400);
      await submit({ quantity: 0 }).expect(400);
      await submit({ quantity: 1000 }).expect(400);
      await submit({ destinationCountry: 'Rwanda' }).expect(400);
      await submit({ status: 'CONVERTED' }).expect(400); // cannot set server-owned fields
      await http().post('/api/v1/product-requests').set(auth(shop.cust.token)).field('quantity', '1')
        .attach('image', Buffer.from('<?php evil(); ?>'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
      await http().post('/api/v1/product-requests').send({}).expect(401);
    });

    it('limits how many requests can be open at once', async () => {
      for (let i = 0; i < 10; i++) await submit().expect(201);
      expect((await submit().expect(409)).body.code).toBe('TOO_MANY_OPEN_REQUESTS');
      const first = (await http().get('/api/v1/product-requests').set(auth(shop.cust.token))).body.items[0];
      await http().post(`/api/v1/product-requests/${first.id}/cancel`).set(auth(shop.cust.token)).expect(200);
      await submit().expect(201); // capacity freed
    });

    it('keeps requests private to their owner', async () => {
      const r = (await submit().expect(201)).body;
      const mine = (await http().get('/api/v1/product-requests').set(auth(shop.cust.token))).body;
      expect(mine.total).toBe(1);
      expect((await http().get('/api/v1/product-requests').set(auth(shop.other.token))).body.total).toBe(0);
      await http().get(`/api/v1/product-requests/${r.id}`).set(auth(shop.other.token)).expect(404);
      await http().post(`/api/v1/product-requests/${r.id}/cancel`).set(auth(shop.other.token)).expect(404);
      await http().get('/api/v1/product-requests?status=BOGUS').set(auth(shop.cust.token)).expect(400);
    });
  });

  describe('admin review', () => {
    it('is restricted to ADMIN/STAFF', async () => {
      const r = (await submit().expect(201)).body;
      await http().get('/api/v1/admin/product-requests').set(auth(shop.cust.token)).expect(403);
      await http().post(`/api/v1/admin/product-requests/${r.id}/quotations`).set(auth(shop.cust.token)).send(quote()).expect(403);
      await http().get('/api/v1/admin/product-requests').expect(401);
      const staff = await loginAs(app, prisma, mail, Role.STAFF);
      await http().get('/api/v1/admin/product-requests').set(auth(staff.token)).expect(200);
    });

    it('lists, filters and searches requests with customer details', async () => {
      await submit({ title: 'Wireless earbuds' }).expect(201);
      await submit({ title: 'Garden chairs', productUrl: 'https://item.taobao.com/item.htm?id=9' }, shop.other.token).expect(201);
      const all = (await adminReq('get', 'product-requests').expect(200)).body;
      expect(all.total).toBe(2);
      expect(all.items[0].user.email).toBeDefined();
      expect((await adminReq('get', 'product-requests?search=chairs').expect(200)).body.total).toBe(1);
      expect((await adminReq('get', 'product-requests?search=taobao').expect(200)).body.total).toBe(1);
      expect((await adminReq('get', `product-requests?search=${shop.cust.user.email}`).expect(200)).body.total).toBe(1);
      expect((await adminReq('get', 'product-requests?status=QUOTED').expect(200)).body.total).toBe(0);
    });

    it('moves requests through review, assignment and decline with proper rules', async () => {
      const r = (await submit().expect(201)).body;
      const patch = (body: object) => adminReq('patch', `product-requests/${r.id}`, body);

      await patch({ assignedToId: shop.cust.id }).expect(400); // customers cannot be assignees
      const done = (await patch({ status: 'UNDER_REVIEW', assignedToId: shop.admin.id }).expect(200)).body;
      expect(done).toMatchObject({ status: 'UNDER_REVIEW', assignedToId: shop.admin.id });
      await patch({ status: 'UNDER_REVIEW' }).expect(400); // already under review
      await patch({ status: 'QUOTED' }).expect(400); // only via quotations
      await patch({ status: 'REJECTED' }).expect(400); // a reason is required
      await patch({ status: 'REJECTED', reason: 'This item cannot be exported' }).expect(200);

      const notes = (await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body.items;
      expect(notes.find((n: any) => n.title === 'We could not source this product').body).toBe('This item cannot be exported');
      await adminReq('post', `product-requests/${r.id}/quotations`, quote()).expect(409); // closed requests cannot be quoted
      expect((await adminReq('get', `product-requests?assignedToId=${shop.admin.id}`).expect(200)).body.total).toBe(1);
    });
  });

  describe('quotations', () => {
    it('computes the total on the server, hides drafts from customers, and notifies on send', async () => {
      const r = (await submit().expect(201)).body;
      await adminReq('post', `product-requests/${r.id}/quotations`, { ...quote(), total: '1' }).expect(400); // total is not client-controlled

      const draft = await quotation(r.id, { taxAmount: '500' }, false);
      expect(draft).toMatchObject({ status: 'DRAFT', productCost: '50000', total: '65000', currency: 'RWF' }); // 50000+12000+2500+500
      expect((await adminReq('get', `product-requests/${r.id}`).expect(200)).body.status).toBe('UNDER_REVIEW');
      expect((await http().get(`/api/v1/product-requests/${r.id}`).set(auth(shop.cust.token))).body.quotations).toHaveLength(0);
      expect((await http().get('/api/v1/quotations').set(auth(shop.cust.token))).body).toHaveLength(0);

      const edited = (await adminReq('patch', `quotations/${draft.id}`, { shippingCost: '10000' }).expect(200)).body;
      expect(edited.total).toBe('63000'); // recomputed

      const sent = (await adminReq('post', `quotations/${draft.id}/send`).expect(200)).body;
      expect(sent.status).toBe('SENT');
      expect((await adminReq('get', `product-requests/${r.id}`).expect(200)).body.status).toBe('QUOTED');
      const view = (await http().get(`/api/v1/product-requests/${r.id}`).set(auth(shop.cust.token)).expect(200)).body;
      expect(view.quotations).toHaveLength(1);
      expect(view.quotations[0]).toMatchObject({ total: '63000', status: 'SENT' });
      expect(view.quotations[0]).not.toHaveProperty('createdById');
      expect((await http().get('/api/v1/notifications').set(auth(shop.cust.token))).body.items.some((n: any) => n.title === 'Your quotation is ready')).toBe(true);

      await adminReq('patch', `quotations/${draft.id}`, { shippingCost: '1' }).expect(409); // sent quotes are immutable
      await adminReq('post', `quotations/${draft.id}/send`).expect(409);
    });

    it('validates amounts, currency and validity window', async () => {
      const r = (await submit().expect(201)).body;
      const bad = (over: object) => adminReq('post', `product-requests/${r.id}/quotations`, quote(over));
      await bad({ productCost: '0' }).expect(400);
      await bad({ productCost: '-5' }).expect(400);
      await bad({ shippingCost: '1.999' }).expect(400);
      await bad({ currency: 'XXX' }).expect(400);
      await bad({ currency: 'rwf1' }).expect(400);
      await bad({ validUntil: days(-1) }).expect(400);
      await bad({ validUntil: days(90) }).expect(400);
      await bad({ validUntil: 'next week' }).expect(400);
      await adminReq('post', 'product-requests/missing/quotations', quote()).expect(404);
    });

    it('withdraws the earlier live offer when a new one is sent', async () => {
      const r = (await submit().expect(201)).body;
      const first = await quotation(r.id);
      const second = await quotation(r.id, { productCost: '45000' });
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('EXPIRED');
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('SENT');
      await http().post(`/api/v1/quotations/${first.id}/accept`).set(auth(shop.cust.token)).send({ addressId: shop.addressId }).expect(409);
    });
  });

  describe('accepting and rejecting quotations', () => {
    it('turns an accepted quotation into an order that can be paid like any other', async () => {
      const r = (await submit().expect(201)).body;
      const q = await quotation(r.id);
      const accepted = await http().post(`/api/v1/quotations/${q.id}/accept`).set(auth(shop.cust.token)).send({ addressId: shop.addressId, customerNote: 'Call me' }).expect(201);
      const order = accepted.body;

      expect(order).toMatchObject({ status: 'AWAITING_PAYMENT', currency: 'RWF', subtotal: '50000', shippingFee: '12000', serviceFee: '2500', taxAmount: '0', discountAmount: '0', total: '64500', quotationId: q.id, customerNote: 'Call me' });
      expect(order.orderNumber).toMatch(/^VM-\d{8}-[A-Z2-9]{6}$/);
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({ name: 'Wireless earbuds', quantity: 20, color: 'Black', size: 'M', unitPrice: '2500', lineTotal: '50000', productId: null });
      expect(order.shippingAddress).toMatchObject({ country: 'RW', city: 'Kigali' });

      expect((await prisma.productRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CONVERTED');
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('ACCEPTED');
      const view = (await http().get(`/api/v1/product-requests/${r.id}`).set(auth(shop.cust.token))).body;
      expect(view.quotations[0].order.orderNumber).toBe(order.orderNumber);

      // The sourced order flows through the normal payment pipeline.
      const pay = (await http().post(`/api/v1/orders/${order.id}/payments`).set(auth(shop.cust.token)).send({ method: 'CARD' }).expect(201)).body;
      expect(pay.amount).toBe('64500');
      await http().post(`/api/v1/dev/payments/${pay.reference}/simulate`).send({ outcome: 'successful' }).expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    });

    it('can only be accepted once, even when two accept calls race', async () => {
      const r = (await submit().expect(201)).body;
      const q = await quotation(r.id);
      const accept = () => http().post(`/api/v1/quotations/${q.id}/accept`).set(auth(shop.cust.token)).send({ addressId: shop.addressId });
      const results = await Promise.all([accept(), accept()]);
      expect(results.map((x) => x.status).sort()).toEqual([201, 409]);
      expect(await prisma.order.count({ where: { quotationId: q.id } })).toBe(1);
      await accept().expect(409);
    });

    it('refuses expired quotations, foreign quotations/addresses, and missing exchange rates', async () => {
      const r = (await submit().expect(201)).body;
      const q = await quotation(r.id);
      const accept = (id: string, body: object, token = shop.cust.token) => http().post(`/api/v1/quotations/${id}/accept`).set(auth(token)).send(body);

      await accept(q.id, { addressId: shop.addressId }, shop.other.token).expect(404);
      await accept(q.id, { addressId: shop.otherAddressId }).expect(404); // someone else's address
      await accept(q.id, {}).expect(400);
      await accept('missing', { addressId: shop.addressId }).expect(404);

      await prisma.quotation.update({ where: { id: q.id }, data: { validUntil: new Date(Date.now() - 1000) } });
      expect((await accept(q.id, { addressId: shop.addressId }).expect(409)).body.code).toBe('QUOTATION_EXPIRED');
      expect(await prisma.order.count()).toBe(0);

      await prisma.currency.create({ data: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 } });
      const usd = await quotation(r.id, { currency: 'USD', productCost: '400', shippingCost: '50', serviceFee: '20' });
      expect((await accept(usd.id, { addressId: shop.addressId }).expect(422)).body.code).toBe('CURRENCY_UNAVAILABLE'); // no CNY→USD rate yet
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: usd.id } })).status).toBe('SENT'); // not consumed by the failure
    });

    it('lets the customer reject an offer so the team can send a new one', async () => {
      const r = (await submit().expect(201)).body;
      const q = await quotation(r.id);
      await http().post(`/api/v1/quotations/${q.id}/reject`).set(auth(shop.other.token)).expect(404);
      const res = (await http().post(`/api/v1/quotations/${q.id}/reject`).set(auth(shop.cust.token)).expect(200)).body;
      expect(res.status).toBe('UNDER_REVIEW');
      expect(res.quotations[0].status).toBe('REJECTED');
      await http().post(`/api/v1/quotations/${q.id}/reject`).set(auth(shop.cust.token)).expect(409);

      const better = await quotation(r.id, { productCost: '40000' });
      const order = (await http().post(`/api/v1/quotations/${better.id}/accept`).set(auth(shop.cust.token)).send({ addressId: shop.addressId }).expect(201)).body;
      expect(order.total).toBe('54500');
    });

    it('expires live offers when the customer cancels the request', async () => {
      const r = (await submit().expect(201)).body;
      const q = await quotation(r.id);
      const res = (await http().post(`/api/v1/product-requests/${r.id}/cancel`).set(auth(shop.cust.token)).expect(200)).body;
      expect(res.status).toBe('CANCELLED');
      expect((await prisma.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe('EXPIRED');
      await http().post(`/api/v1/quotations/${q.id}/accept`).set(auth(shop.cust.token)).send({ addressId: shop.addressId }).expect(409);
      await http().post(`/api/v1/product-requests/${r.id}/cancel`).set(auth(shop.cust.token)).expect(409);
    });
  });
});
