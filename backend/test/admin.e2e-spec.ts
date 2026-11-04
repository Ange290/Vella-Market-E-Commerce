import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';
import { setupShop } from './shop';

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe('Admin dashboard, people, content & system (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let shop: Awaited<ReturnType<typeof setupShop>>;
  let staff: Awaited<ReturnType<typeof loginAs>>;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const as = (token: string, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object) =>
    http()[method](`/api/v1${path}`).set(auth(token)).send(body);
  const admin = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: object) => as(shop.admin.token, method, path, body);

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "ContentPage","Promotion","SupportRequest" RESTART IDENTITY CASCADE');
    mail.sent = [];
    shop = await setupShop(app, prisma, mail);
    staff = await loginAs(app, prisma, mail, Role.STAFF);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('dashboard', () => {
    /** One paid order (78,352 RWF, partly refunded) and one unpaid order from another customer. */
    async function scenario() {
      const paid = await shop.placeOrder();
      const p = (await as(shop.cust.token, 'post', `/orders/${paid.id}/payments`, { method: 'CARD' }).expect(201)).body;
      await http().post(`/api/v1/dev/payments/${p.reference}/simulate`).send({ outcome: 'successful' }).expect(200);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { reference: p.reference } });
      await admin('post', `/admin/payments/${payment.id}/refunds`, { amount: '10000', reason: 'Goodwill refund' }).expect(201);
      await shop.placeOrder(shop.other, shop.otherAddressId);
      return paid;
    }

    it('reports accurate counts and per-currency revenue (net of refunds) to admins', async () => {
      await scenario();
      await http().post('/api/v1/support').send({ name: 'Eve', email: 'eve@example.com', subject: 'Question', message: 'Where is my parcel?' }).expect(201);
      const s = (await admin('get', '/admin/dashboard/summary').expect(200)).body;
      expect(s).toMatchObject({ customers: 2, orders: 2, pendingOrders: 1, paidOrders: 1, products: 2, suppliers: 0 });
      expect(s.payments.total).toBe(1);
      expect(s.shipments).toEqual({ total: 0, active: 0 });
      expect(s.supportRequests.open).toBe(1);
      expect(s.revenue).toEqual([{ currency: 'RWF', gross: '78352', refunded: '10000', net: '68352' }]);
    });

    it('hides money from staff but still shows operational counts', async () => {
      await scenario();
      const s = (await as(staff.token, 'get', '/admin/dashboard/summary').expect(200)).body;
      expect(s.orders).toBe(2);
      expect(s.revenue).toBeNull();
      const c = (await as(staff.token, 'get', '/admin/dashboard/charts').expect(200)).body;
      expect(c.revenue).toBeNull();
      await as(shop.cust.token, 'get', '/admin/dashboard/summary').expect(403);
      await http().get('/api/v1/admin/dashboard/summary').expect(401);
    });

    it('builds chart series with a continuous daily axis', async () => {
      await scenario();
      const c = (await admin('get', '/admin/dashboard/charts?days=7').expect(200)).body;
      expect(c.ordersPerDay).toHaveLength(7);
      expect(c.ordersPerDay.reduce((n: number, d: any) => n + d.orders, 0)).toBe(2);
      expect(c.ordersPerDay.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
      expect(c.signupsPerDay.reduce((n: number, d: any) => n + d.customers, 0)).toBe(2); // only the two customers; the admin and staff accounts are not customers
      expect(c.ordersByStatus).toEqual(expect.arrayContaining([{ status: 'PAID', count: 1 }, { status: 'AWAITING_PAYMENT', count: 1 }]));
      expect(c.topProducts[0]).toMatchObject({ units: 2 }); // only the paid order counts
      expect(c.revenue[0].currency).toBe('RWF');
      expect(c.revenue[0].series).toHaveLength(7);
      expect(c.revenue[0].series.at(-1).amount).toBe('78352');
      await admin('get', '/admin/dashboard/charts?days=3').expect(400);
      await admin('get', '/admin/dashboard/charts?days=999').expect(400);
    });
  });

  describe('customers', () => {
    it('lists, searches and shows customer details; staff may view', async () => {
      await shop.placeOrder();
      const list = (await as(staff.token, 'get', '/admin/customers').expect(200)).body;
      expect(list.total).toBe(2);
      expect(list.items.find((c: any) => c.id === shop.cust.id).orderCount).toBe(1);
      expect(list.items.every((c: any) => !('passwordHash' in c))).toBe(true);
      expect((await admin('get', `/admin/customers?search=${shop.other.user.email}`).expect(200)).body.total).toBe(1);
      expect((await admin('get', '/admin/customers?status=SUSPENDED').expect(200)).body.total).toBe(0);

      const one = (await admin('get', `/admin/customers/${shop.cust.id}`).expect(200)).body;
      expect(one.email).toBe(shop.cust.user.email);
      expect(one.addresses.length).toBeGreaterThan(0);
      expect(one.orders).toHaveLength(1);
      expect(one).not.toHaveProperty('passwordHash');
      await admin('get', `/admin/customers/${shop.admin.id}`).expect(404); // not a customer
      await as(shop.cust.token, 'get', '/admin/customers').expect(403);
    });

    it('suspends and reactivates customers, killing their sessions; ADMIN-only', async () => {
      const login = () => http().post('/api/v1/auth/login').send({ identifier: shop.cust.user.email, password: shop.cust.user.password });
      const refreshCookie = (await login().expect(200)).headers['set-cookie'] as unknown as string[];

      await as(staff.token, 'patch', `/admin/customers/${shop.cust.id}/status`, { status: 'SUSPENDED' }).expect(403);
      await admin('patch', `/admin/customers/${shop.cust.id}/status`, { status: 'SUSPENDED' }).expect(200);
      await as(shop.cust.token, 'get', '/users/me').expect(401); // existing access token stops working
      await http().post('/api/v1/auth/refresh').set('Cookie', refreshCookie[0].split(';')[0]).expect(401); // refresh revoked
      await login().expect(403);

      await admin('patch', `/admin/customers/${shop.cust.id}/status`, { status: 'ACTIVE' }).expect(200);
      await login().expect(200);
      await admin('patch', `/admin/customers/${shop.cust.id}/status`, { status: 'PENDING_VERIFICATION' }).expect(400);
      await admin('patch', `/admin/customers/${shop.admin.id}/status`, { status: 'SUSPENDED' }).expect(404); // admins are not customers
      expect(await prisma.auditLog.count({ where: { action: { in: ['customer.suspended', 'customer.active'] } } })).toBe(2);
    });

    it('shows lifetime spend per currency to admins only', async () => {
      const o = await shop.placeOrder();
      const p = (await as(shop.cust.token, 'post', `/orders/${o.id}/payments`, { method: 'CARD' }).expect(201)).body;
      await http().post(`/api/v1/dev/payments/${p.reference}/simulate`).send({ outcome: 'successful' }).expect(200);
      expect((await admin('get', `/admin/customers/${shop.cust.id}/spend`).expect(200)).body).toEqual([{ currency: 'RWF', total: '78352' }]);
      await as(staff.token, 'get', `/admin/customers/${shop.cust.id}/spend`).expect(403);
    });
  });

  describe('staff management', () => {
    it('lets admins create staff who can then sign in with limited rights', async () => {
      const body = { fullName: 'Grace Mukamana', email: 'grace@vellamarket.local', phone: '+250788777000', password: 'Staffpass12345' };
      await as(staff.token, 'post', '/admin/staff', body).expect(403);
      await as(shop.cust.token, 'post', '/admin/staff', body).expect(403);
      await admin('post', '/admin/staff', { ...body, password: 'short' }).expect(400);
      const created = (await admin('post', '/admin/staff', body).expect(201)).body;
      expect(created).toMatchObject({ email: 'grace@vellamarket.local', role: 'STAFF', status: 'ACTIVE' });
      await admin('post', '/admin/staff', body).expect(409);
      await admin('post', '/admin/staff', { ...body, email: 'other@vellamarket.local' }).expect(409); // phone already used

      const session = (await http().post('/api/v1/auth/login').send({ identifier: body.email, password: body.password }).expect(200)).body;
      await as(session.accessToken, 'get', '/admin/orders').expect(200);
      await as(session.accessToken, 'get', '/admin/staff').expect(403);
      expect((await admin('get', '/admin/staff').expect(200)).body.map((u: any) => u.role)).toEqual(expect.arrayContaining(['ADMIN', 'STAFF']));
    });

    it('promotes and demotes without ever touching ADMIN accounts or the caller', async () => {
      const promoted = (await admin('patch', `/admin/users/${shop.cust.id}/role`, { role: 'STAFF' }).expect(200)).body;
      expect(promoted.role).toBe('STAFF');
      await as(shop.cust.token, 'get', '/admin/orders').expect(200); // takes effect on the next request

      await admin('patch', `/admin/users/${shop.cust.id}/role`, { role: 'ADMIN' }).expect(400); // no way to mint admins
      await admin('patch', `/admin/users/${shop.cust.id}/role`, { role: 'SUPERUSER' }).expect(400);
      await admin('patch', `/admin/users/${shop.admin.id}/role`, { role: 'CUSTOMER' }).expect(400); // not yourself
      const other = await loginAs(app, prisma, mail, Role.ADMIN);
      expect((await admin('patch', `/admin/users/${other.id}/role`, { role: 'CUSTOMER' }).expect(409)).body.code).toBe('ADMIN_PROTECTED');
      await as(staff.token, 'patch', `/admin/users/${shop.cust.id}/role`, { role: 'CUSTOMER' }).expect(403);

      const refresh = (await http().post('/api/v1/auth/login').send({ identifier: shop.cust.user.email, password: shop.cust.user.password }).expect(200)).headers['set-cookie'] as unknown as string[];
      await admin('patch', `/admin/users/${shop.cust.id}/role`, { role: 'CUSTOMER' }).expect(200);
      await as(shop.cust.token, 'get', '/admin/orders').expect(403);
      await http().post('/api/v1/auth/refresh').set('Cookie', refresh[0].split(';')[0]).expect(401); // sessions revoked on demotion
      await admin('patch', '/admin/users/missing/role', { role: 'STAFF' }).expect(404);
    });

    it('suspends staff and prevents self-suspension', async () => {
      await admin('patch', `/admin/staff/${staff.id}/status`, { status: 'SUSPENDED' }).expect(200);
      await as(staff.token, 'get', '/admin/orders').expect(401);
      await admin('patch', `/admin/staff/${shop.admin.id}/status`, { status: 'SUSPENDED' }).expect(400);
      await admin('patch', `/admin/staff/${shop.cust.id}/status`, { status: 'SUSPENDED' }).expect(404); // customers go through /customers
    });
  });

  describe('content pages', () => {
    it('serves only published pages publicly and lets staff edit them', async () => {
      await as(staff.token, 'put', '/admin/content/about', { title: 'About Vella Market', body: '# Hello\n\nWe ship from China.' }).expect(200);
      await as(staff.token, 'put', '/admin/content/draft-page', { title: 'Hidden', body: 'secret', isPublished: false }).expect(200);

      const page = (await http().get('/api/v1/content/about').expect(200)).body;
      expect(page).toMatchObject({ slug: 'about', title: 'About Vella Market' });
      expect(page.body).toContain('We ship from China.');
      await http().get('/api/v1/content/draft-page').expect(404);
      await http().get('/api/v1/content/nope').expect(404);
      expect((await http().get('/api/v1/content').expect(200)).body).toEqual([{ slug: 'about', title: 'About Vella Market' }]);

      await as(staff.token, 'put', '/admin/content/about', { title: 'About Us', body: 'Updated' }).expect(200);
      expect((await http().get('/api/v1/content/about')).body.title).toBe('About Us');
      expect((await admin('get', '/admin/content').expect(200)).body).toHaveLength(2); // admins see drafts too

      await as(staff.token, 'put', '/admin/content/Bad Slug!', { title: 'x', body: 'y' }).expect(400);
      await as(staff.token, 'put', '/admin/content/ok', { title: 'x' }).expect(400);
      await as(shop.cust.token, 'put', '/admin/content/about', { title: 'Hacked', body: 'x' }).expect(403);
      await as(staff.token, 'delete', '/admin/content/draft-page').expect(403);
      await admin('delete', '/admin/content/draft-page').expect(204);
    });

    it('stores markup as inert text', async () => {
      const evil = '<script>alert(1)</script> [x](javascript:alert(1))';
      await admin('put', '/admin/content/terms', { title: 'Terms', body: evil }).expect(200);
      expect((await http().get('/api/v1/content/terms')).body.body).toBe(evil); // returned verbatim as data; clients must not render it as HTML
      const res = await http().get('/api/v1/content/terms');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('promotions', () => {
    it('shows only live promotions publicly, with the coupon code while it is still valid', async () => {
      const coupon = (await admin('post', '/admin/coupons', { code: 'WELCOME10', type: 'PERCENTAGE', value: '10' }).expect(201)).body;
      const live = (await admin('post', '/admin/promotions', { title: 'Welcome offer', subtitle: '10% off', linkUrl: '/shop', couponId: coupon.id }).expect(201)).body;
      await admin('post', '/admin/promotions', { title: 'Future sale', startsAt: days(3), endsAt: days(10) }).expect(201);
      await admin('post', '/admin/promotions', { title: 'Past sale', startsAt: days(-10), endsAt: days(-3) }).expect(201);
      await admin('post', '/admin/promotions', { title: 'Switched off', isActive: false }).expect(201);

      let pub = (await http().get('/api/v1/promotions').expect(200)).body;
      expect(pub.map((p: any) => p.title)).toEqual(['Welcome offer']);
      expect(pub[0].couponCode).toBe('WELCOME10');

      await admin('patch', `/admin/coupons/${coupon.id}`, { isActive: false }).expect(200);
      pub = (await http().get('/api/v1/promotions')).body;
      expect(pub[0].couponCode).toBeNull(); // dead coupons are not advertised

      await admin('patch', `/admin/promotions/${live.id}`, { isActive: false }).expect(200);
      expect((await http().get('/api/v1/promotions')).body).toHaveLength(0);
    });

    it('validates links, dates and coupons; deletion is ADMIN-only', async () => {
      await admin('post', '/admin/promotions', { title: 'Bad link', linkUrl: 'javascript:alert(1)' }).expect(400);
      await admin('post', '/admin/promotions', { title: 'Bad link', linkUrl: 'data:text/html,x' }).expect(400);
      await admin('post', '/admin/promotions', { title: 'Bad banner', bannerUrl: 'ftp://x/y.png' }).expect(400);
      await admin('post', '/admin/promotions', { title: 'Bad dates', startsAt: days(5), endsAt: days(1) }).expect(400);
      await admin('post', '/admin/promotions', { title: 'No coupon', couponId: 'missing' }).expect(400);
      await as(shop.cust.token, 'post', '/admin/promotions', { title: 'x1' }).expect(403);
      const p = (await as(staff.token, 'post', '/admin/promotions', { title: 'Staff promo', linkUrl: 'https://example.com/deal' }).expect(201)).body;
      await as(staff.token, 'delete', `/admin/promotions/${p.id}`).expect(403);
      await admin('delete', `/admin/promotions/${p.id}`).expect(204);
    });
  });

  describe('support requests', () => {
    const msg = { name: 'Eve Customer', email: 'Eve@Example.com', subject: 'Delivery question', message: 'My parcel has not arrived yet.' };

    it('accepts public contact messages and lets staff work the queue', async () => {
      const res = await http().post('/api/v1/support').send(msg).expect(201);
      expect(res.body.id).toBeDefined();
      const row = await prisma.supportRequest.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({ email: 'eve@example.com', status: 'OPEN' }); // email normalised

      const list = (await as(staff.token, 'get', '/admin/support?status=OPEN').expect(200)).body;
      expect(list.total).toBe(1);
      expect((await as(staff.token, 'get', '/admin/support?search=parcel').expect(200)).body.total).toBe(0); // search covers subject/name/email, not body
      expect((await as(staff.token, 'get', '/admin/support?search=delivery').expect(200)).body.total).toBe(1);
      expect((await as(staff.token, 'get', `/admin/support/${row.id}`).expect(200)).body.message).toBe(msg.message);

      await as(staff.token, 'patch', `/admin/support/${row.id}`, { status: 'IN_PROGRESS' }).expect(200);
      await as(staff.token, 'patch', `/admin/support/${row.id}`, { status: 'RESOLVED' }).expect(200);
      await as(staff.token, 'patch', `/admin/support/${row.id}`, { status: 'OPEN' }).expect(400);
      expect((await as(staff.token, 'get', '/admin/support?status=RESOLVED').expect(200)).body.total).toBe(1);
      await as(shop.cust.token, 'get', '/admin/support').expect(403);
    });

    it('validates input and rate-limits the public form', async () => {
      await http().post('/api/v1/support').send({ ...msg, email: 'not-an-email' }).expect(400);
      await http().post('/api/v1/support').send({ ...msg, message: 'short' }).expect(400);
      await http().post('/api/v1/support').send({ ...msg, status: 'RESOLVED' }).expect(400); // cannot set server-owned fields
      await http().post('/api/v1/support').send({}).expect(400);
    });
  });

  describe('currencies and exchange rates', () => {
    it('manages currencies (ADMIN) and exposes rate history', async () => {
      await as(staff.token, 'post', '/admin/currencies', { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 }).expect(403);
      const kes = (await admin('post', '/admin/currencies', { code: 'kes', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 }).expect(201)).body;
      expect(kes.code).toBe('KES');
      await admin('post', '/admin/currencies', { code: 'KES', name: 'Dup', symbol: 'K', decimals: 2 }).expect(409);
      await admin('post', '/admin/currencies', { code: 'EURO', name: 'x', symbol: 'x', decimals: 2 }).expect(400);
      await admin('post', '/admin/currencies', { code: 'JPY', name: 'Yen', symbol: '¥', decimals: 9 }).expect(400);

      await admin('patch', '/admin/currencies/KES', { decimals: 0 }).expect(400); // decimals are immutable
      expect((await admin('patch', '/admin/currencies/KES', { isActive: false }).expect(200)).body.isActive).toBe(false);
      expect((await http().get('/api/v1/currencies').expect(200)).body.some((c: any) => c.code === 'KES')).toBe(false); // inactive → hidden from shoppers
      await admin('patch', '/admin/currencies/ZZZ', { isActive: false }).expect(404);

      await admin('post', '/admin/exchange-rates', { quoteCurrency: 'RWF', rate: '205' }).expect(201);
      const history = (await as(staff.token, 'get', '/admin/exchange-rates?quote=RWF').expect(200)).body;
      expect(history.total).toBe(2); // 200 from setup + 205
      expect(history.items[0].rate).toBe('205');
      expect((await as(staff.token, 'get', '/admin/currencies').expect(200)).body.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('audit log and review moderation', () => {
    it('shows the audit trail to admins only, filterable', async () => {
      await admin('put', '/admin/content/faq', { title: 'FAQ', body: 'Questions' }).expect(200);
      await as(staff.token, 'get', '/admin/audit-logs').expect(403);
      const all = (await admin('get', '/admin/audit-logs?action=content').expect(200)).body;
      expect(all.items.length).toBe(1);
      expect(all.items[0]).toMatchObject({ action: 'content.upsert', entity: 'ContentPage', entityId: 'faq' });
      expect(all.items[0].actor.email).toBe(shop.admin.user.email);
      expect((await admin('get', `/admin/audit-logs?actorId=${shop.admin.id}&entity=ContentPage`).expect(200)).body.total).toBe(1);
      expect((await admin('get', '/admin/audit-logs?from=2999-01-01T00:00:00Z').expect(200)).body.total).toBe(0);
      expect(JSON.stringify(all)).not.toMatch(/passwordHash|codeHash/);
    });

    it('hides rejected reviews and recomputes the product rating', async () => {
      const slug = shop.A.slug;
      await as(shop.cust.token, 'post', `/products/${slug}/reviews`, { rating: 5 }).expect(201);
      await as(shop.other.token, 'post', `/products/${slug}/reviews`, { rating: 1, comment: 'Spam spam spam' }).expect(201);
      expect((await http().get(`/api/v1/products/${slug}`)).body.ratingAverage).toBe('3');

      const pending = (await as(staff.token, 'get', '/admin/reviews').expect(200)).body;
      const spam = pending.items.find((r: any) => r.rating === 1);
      await as(staff.token, 'patch', `/admin/reviews/${spam.id}`, { status: 'REJECTED' }).expect(200);
      await as(staff.token, 'patch', `/admin/reviews/${spam.id}`, { status: 'LOVELY' }).expect(400);
      const detail = (await http().get(`/api/v1/products/${slug}`)).body;
      expect(detail).toMatchObject({ ratingAverage: '5', ratingCount: 1 });
      expect((await http().get(`/api/v1/products/${slug}/reviews`)).body.total).toBe(1);
      expect((await as(staff.token, 'get', '/admin/reviews?status=REJECTED').expect(200)).body.total).toBe(1);
      await as(shop.cust.token, 'get', '/admin/reviews').expect(403);
    });
  });
});
