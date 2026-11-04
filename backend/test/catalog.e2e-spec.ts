import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';

// Smallest valid PNG / JPEG / WebP headers for upload tests
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const NOT_AN_IMAGE = Buffer.from('<?php echo "pwn"; ?>');

describe('Catalogue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let admin: string;
  let customer: string;
  let customer2: string;
  let categoryId: string;
  let supplierId: string;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createProduct(over: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/admin/products')
      .set(auth(admin))
      .send({
        sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
        name: 'Test Sneaker',
        description: 'Generic test description text.',
        categoryId,
        supplierId,
        priceCny: '100.00',
        stock: 10,
        status: 'ACTIVE',
        ...over,
      })
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    admin = (await loginAs(app, prisma, mail, Role.ADMIN)).token;
    customer = (await loginAs(app, prisma, mail)).token;
    customer2 = (await loginAs(app, prisma, mail)).token;
    categoryId = (await http().post('/api/v1/admin/categories').set(auth(admin)).send({ name: 'Fashion' }).expect(201)).body.id;
    supplierId = (await http().post('/api/v1/admin/suppliers').set(auth(admin)).send({ name: 'Guangzhou Shoes Co', email: 'sales@gz.example', country: 'CN' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('authorisation', () => {
    it('lets anyone browse but only ADMIN/STAFF manage', async () => {
      await http().get('/api/v1/products').expect(200);
      await http().get('/api/v1/categories').expect(200);
      await http().post('/api/v1/admin/products').send({}).expect(401);
      await http().post('/api/v1/admin/products').set(auth(customer)).send({}).expect(403);
      await http().post('/api/v1/admin/categories').set(auth(customer)).send({ name: 'x' }).expect(403);
      await http().get('/api/v1/admin/suppliers').set(auth(customer)).expect(403);
      await http().post('/api/v1/admin/exchange-rates').set(auth(customer)).send({ quoteCurrency: 'RWF', rate: '200' }).expect(403);
    });

    it('STAFF can manage products but not delete categories or set exchange rates', async () => {
      const staff = (await loginAs(app, prisma, mail, Role.STAFF)).token;
      await http().post('/api/v1/admin/products').set(auth(staff)).send({
        sku: 'STAFF-1', name: 'Staff Product', description: 'Created by staff member.', categoryId, priceCny: '10',
      }).expect(201);
      await http().delete(`/api/v1/admin/categories/${categoryId}`).set(auth(staff)).expect(403);
      await http().post('/api/v1/admin/exchange-rates').set(auth(staff)).send({ quoteCurrency: 'RWF', rate: '200' }).expect(403);
    });
  });

  describe('product management', () => {
    it('creates a product with images and variants, and hides private supplier data publicly', async () => {
      const p = await createProduct({
        specifications: { material: 'Mesh', weight: '300g' },
        sourceUrl: 'https://item.taobao.com/item.htm?id=1',
        images: [{ url: 'https://cdn.example.com/a.jpg' }, { url: 'https://cdn.example.com/b.jpg' }],
        variants: [
          { sku: 'SN-42-BLK', size: '42', color: 'Black', stock: 5 },
          { sku: 'SN-43-WHT', size: '43', color: 'White', priceDeltaCny: '5.50', stock: 3 },
        ],
      });
      expect(p.slug).toBe('test-sneaker');
      expect(p.images.map((i: any) => i.isPrimary)).toEqual([true, false]);

      const detail = (await http().get(`/api/v1/products/${p.slug}`).expect(200)).body;
      expect(detail.sizes.sort()).toEqual(['42', '43']);
      expect(detail.colors.sort()).toEqual(['Black', 'White']);
      expect(detail.variants.find((v: any) => v.sku === 'SN-43-WHT').finalPriceCny).toBe('105.50');
      expect(detail.supplier).toEqual(expect.objectContaining({ name: 'Guangzhou Shoes Co', country: 'CN' }));
      expect(detail.supplier).not.toHaveProperty('email');
      expect(detail).not.toHaveProperty('sourceUrl');
      expect(detail.priceCny).toBe('100');
    });

    it('validates input: money format, ranges, unknown category, duplicate SKU/variants', async () => {
      const base = { sku: 'V-1', name: 'Valid Name', description: 'A valid description here.', categoryId, priceCny: '10' };
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, priceCny: '-5' }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, priceCny: '10.999' }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, categoryId: 'nope' }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, shippingDaysMin: 30, shippingDaysMax: 10 }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, unexpected: 1 }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({
        ...base, variants: [{ sku: 'A', size: 'M' }, { sku: 'B', size: 'M' }],
      }).expect(400);
      await http().post('/api/v1/admin/products').set(auth(admin)).send(base).expect(201);
      await http().post('/api/v1/admin/products').set(auth(admin)).send({ ...base, name: 'Other Name' }).expect(409);
    });

    it('generates unique slugs for identical names', async () => {
      const a = await createProduct();
      const b = await createProduct();
      expect(a.slug).not.toBe(b.slug);
    });

    it('updates and archives; drafts and archived products are not public', async () => {
      const p = await createProduct();
      await http().patch(`/api/v1/admin/products/${p.id}`).set(auth(admin)).send({ priceCny: '120.50', stock: 4 }).expect(200);
      expect((await http().get(`/api/v1/products/${p.slug}`).expect(200)).body.priceCny).toBe('120.5');

      const draft = await createProduct({ status: 'DRAFT', name: 'Hidden Draft' });
      await http().get(`/api/v1/products/${draft.slug}`).expect(404);

      await http().delete(`/api/v1/admin/products/${p.id}`).set(auth(admin)).expect(204);
      await http().get(`/api/v1/products/${p.slug}`).expect(404);
      const adminView = await http().get('/api/v1/admin/products').set(auth(admin)).expect(200);
      expect(adminView.body.total).toBe(2); // admin still sees draft + archived
      expect(await prisma.product.count()).toBe(2); // soft delete — row still exists

      const writes = await prisma.auditLog.findMany({ where: { entity: 'Product' } });
      expect(writes.map((w) => w.action)).toEqual(expect.arrayContaining(['product.create', 'product.update', 'product.archive']));
    });

    it('manages variants (deactivate instead of delete)', async () => {
      const p = await createProduct();
      const v = (await http().post(`/api/v1/admin/products/${p.id}/variants`).set(auth(admin)).send({ sku: 'NEW-1', size: 'L', color: 'Red', stock: 2 }).expect(201)).body;
      await http().post(`/api/v1/admin/products/${p.id}/variants`).set(auth(admin)).send({ sku: 'NEW-2', size: 'L', color: 'Red' }).expect(409);
      await http().patch(`/api/v1/admin/variants/${v.id}`).set(auth(admin)).send({ stock: 9 }).expect(200);
      await http().delete(`/api/v1/admin/variants/${v.id}`).set(auth(admin)).expect(204);
      expect((await http().get(`/api/v1/products/${p.slug}`)).body.variants).toHaveLength(0);
    });

    it('stores uploaded images only when the bytes are really an image', async () => {
      const p = await createProduct();
      const ok = await http().post(`/api/v1/admin/products/${p.id}/images`).set(auth(admin)).attach('file', PNG, { filename: 'x.png', contentType: 'image/png' }).expect(201);
      expect(ok.body.url).toMatch(/^\/uploads\/[a-f0-9]{32}\.png$/);
      expect(ok.body.isPrimary).toBe(true);
      // renamed script posing as an image
      await http().post(`/api/v1/admin/products/${p.id}/images`).set(auth(admin)).attach('file', NOT_AN_IMAGE, { filename: 'shell.png', contentType: 'image/png' }).expect(400);
      await http().post(`/api/v1/admin/products/${p.id}/images`).set(auth(admin)).expect(400);
      await http().post(`/api/v1/admin/products/${p.id}/images`).set(auth(customer)).attach('file', PNG, 'x.png').expect(403);
    });
  });

  describe('search, filter, sort, pagination', () => {
    beforeEach(async () => {
      const kids = (await http().post('/api/v1/admin/categories').set(auth(admin)).send({ name: 'Kids Shoes', parentId: categoryId }).expect(201)).body.id;
      await createProduct({ name: 'Red Sneaker', sku: 'P1', priceCny: '50' });
      await createProduct({ name: 'Blue Jacket', sku: 'P2', priceCny: '200', description: 'Warm winter jacket in blue.' });
      await createProduct({ name: 'Green Sandal', sku: 'P3', priceCny: '20', categoryId: kids });
      await createProduct({ name: 'Out Of Stock Hat', sku: 'P4', priceCny: '10', status: 'OUT_OF_STOCK', stock: 0 });
      await createProduct({ name: 'Unlisted Item', sku: 'P5', priceCny: '10', status: 'DRAFT' });
    });

    const names = (res: request.Response) => res.body.items.map((i: any) => i.name);

    it('only lists public products and searches name/description/sku case-insensitively', async () => {
      expect((await http().get('/api/v1/products')).body.total).toBe(4);
      expect(names(await http().get('/api/v1/products?q=SNEAKER'))).toEqual(['Red Sneaker']);
      expect(names(await http().get('/api/v1/products?q=winter'))).toEqual(['Blue Jacket']);
      expect(names(await http().get('/api/v1/products?q=p3'))).toEqual(['Green Sandal']);
      expect((await http().get('/api/v1/products?q=nothing-matches')).body.total).toBe(0);
    });

    it('filters by category (including sub-categories) and by price range', async () => {
      expect((await http().get('/api/v1/products?category=fashion')).body.total).toBe(4);
      expect(names(await http().get('/api/v1/products?category=kids-shoes'))).toEqual(['Green Sandal']);
      expect((await http().get('/api/v1/products?category=unknown')).body.total).toBe(0);
      expect(names(await http().get('/api/v1/products?minPrice=30&maxPrice=100'))).toEqual(['Red Sneaker']);
      await http().get('/api/v1/products?minPrice=100&maxPrice=10').expect(400);
      await http().get('/api/v1/products?minPrice=abc').expect(400);
    });

    it('sorts by price and name', async () => {
      expect(names(await http().get('/api/v1/products?sort=price_asc'))).toEqual(['Out Of Stock Hat', 'Green Sandal', 'Red Sneaker', 'Blue Jacket']);
      expect(names(await http().get('/api/v1/products?sort=price_desc'))[0]).toBe('Blue Jacket');
      expect(names(await http().get('/api/v1/products?sort=name'))[0]).toBe('Blue Jacket');
      await http().get('/api/v1/products?sort=hacker').expect(400);
    });

    it('paginates with stable ordering and caps page size', async () => {
      const p1 = await http().get('/api/v1/products?sort=name&pageSize=3&page=1').expect(200);
      const p2 = await http().get('/api/v1/products?sort=name&pageSize=3&page=2').expect(200);
      expect(p1.body.items).toHaveLength(3);
      expect(p2.body.items).toHaveLength(1);
      expect(p1.body.totalPages).toBe(2);
      const all = [...names(p1), ...names(p2)];
      expect(new Set(all).size).toBe(4);
      await http().get('/api/v1/products?pageSize=1000').expect(400);
      await http().get('/api/v1/products?page=0').expect(400);
    });

    it('returns related products from the same category, excluding itself', async () => {
      const rel = (await http().get('/api/v1/products/red-sneaker/related').expect(200)).body;
      const relNames = rel.map((r: any) => r.name);
      expect(relNames).not.toContain('Red Sneaker');
      expect(relNames).toEqual(expect.arrayContaining(['Blue Jacket', 'Out Of Stock Hat']));
      expect(relNames).not.toContain('Green Sandal'); // different (child) category
      await http().get('/api/v1/products/nope/related').expect(404);
    });

    it('marks stock availability', async () => {
      const hat = (await http().get('/api/v1/products?q=hat')).body.items[0];
      expect(hat.inStock).toBe(false);
    });
  });

  describe('currency conversion', () => {
    it('shows converted prices only when an admin has configured a rate (no invented rates)', async () => {
      await prisma.currency.createMany({ data: [{ code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 }, { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 }] });
      const p = await createProduct({ priceCny: '99.99' });

      const before = (await http().get(`/api/v1/products/${p.slug}?currency=RWF`).expect(200)).body;
      expect(before.displayPrice).toBeNull();

      await http().post('/api/v1/admin/exchange-rates').set(auth(admin)).send({ quoteCurrency: 'RWF', rate: '200.5' }).expect(201);
      await http().post('/api/v1/admin/exchange-rates').set(auth(admin)).send({ quoteCurrency: 'XXX', rate: '1' }).expect(400);
      await http().post('/api/v1/admin/exchange-rates').set(auth(admin)).send({ quoteCurrency: 'CNY', rate: '1' }).expect(400);
      await http().post('/api/v1/admin/exchange-rates').set(auth(admin)).send({ quoteCurrency: 'RWF', rate: '0' }).expect(400);

      const after = (await http().get(`/api/v1/products/${p.slug}?currency=RWF`).expect(200)).body;
      expect(after.displayPrice).toEqual({ amount: '20048', currency: 'RWF' }); // 99.99 * 200.5 = 20047.995 → 0 dp, half-up

      // a newer rate supersedes the old one; the older row is kept for history
      await http().post('/api/v1/admin/exchange-rates').set(auth(admin)).send({ quoteCurrency: 'RWF', rate: '210' }).expect(201);
      const list = (await http().get('/api/v1/products?currency=RWF')).body;
      expect(list.items[0].displayPrice).toEqual({ amount: '20998', currency: 'RWF' });
      expect(await prisma.exchangeRate.count()).toBe(2);

      const currencies = (await http().get('/api/v1/currencies').expect(200)).body;
      expect(currencies.find((c: any) => c.code === 'RWF').rateFromCny).toBe('210');
      expect(currencies.find((c: any) => c.code === 'USD').rateFromCny).toBeNull();
    });
  });

  describe('wishlist', () => {
    it('adds, lists and removes items idempotently, per user', async () => {
      const p = await createProduct();
      await http().get('/api/v1/wishlist').expect(401);
      await http().post(`/api/v1/wishlist/${p.id}`).set(auth(customer)).expect(200);
      await http().post(`/api/v1/wishlist/${p.id}`).set(auth(customer)).expect(200); // idempotent
      const mine = (await http().get('/api/v1/wishlist').set(auth(customer)).expect(200)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0].slug).toBe(p.slug);
      expect((await http().get('/api/v1/wishlist').set(auth(customer2))).body).toHaveLength(0);

      await http().post('/api/v1/wishlist/does-not-exist').set(auth(customer)).expect(404);
      await http().delete(`/api/v1/wishlist/${p.id}`).set(auth(customer2)).expect(200); // cannot touch others' items
      expect((await http().get('/api/v1/wishlist').set(auth(customer))).body).toHaveLength(1);
      await http().delete(`/api/v1/wishlist/${p.id}`).set(auth(customer)).expect(200);
      expect((await http().get('/api/v1/wishlist').set(auth(customer))).body).toHaveLength(0);
    });
  });

  describe('reviews and ratings', () => {
    it('requires login, allows one review per user, and keeps the rating average correct', async () => {
      const p = await createProduct();
      await http().post(`/api/v1/products/${p.slug}/reviews`).send({ rating: 5 }).expect(401);
      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(customer)).send({ rating: 6 }).expect(400);
      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(customer)).send({ rating: 0 }).expect(400);

      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(customer)).send({ rating: 5, title: 'Great', comment: 'Loved it' }).expect(201);
      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(customer)).send({ rating: 1 }).expect(409);
      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(customer2)).send({ rating: 2 }).expect(201);

      const list = (await http().get(`/api/v1/products/${p.slug}/reviews`).expect(200)).body;
      expect(list.total).toBe(2);
      expect(list.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 0, 5: 1 });
      expect(list.items[0]).not.toHaveProperty('userId');
      expect(list.items.every((r: any) => r.isVerifiedPurchase === false)).toBe(true);

      const detail = (await http().get(`/api/v1/products/${p.slug}`)).body;
      expect(detail.ratingAverage).toBe('3.5');
      expect(detail.ratingCount).toBe(2);

      await http().delete(`/api/v1/products/${p.slug}/reviews`).set(auth(customer2)).expect(204);
      await http().delete(`/api/v1/products/${p.slug}/reviews`).set(auth(customer2)).expect(404);
      const after = (await http().get(`/api/v1/products/${p.slug}`)).body;
      expect(after.ratingAverage).toBe('5');
      expect(after.ratingCount).toBe(1);
    });

    it('flags verified purchases only for customers with a paid order containing the product', async () => {
      const p = await createProduct();
      const buyer = await loginAs(app, prisma, mail);
      const order = await prisma.order.create({
        data: {
          orderNumber: 'VM-TEST-1', userId: buyer.id, status: 'DELIVERED', currency: 'CNY', exchangeRate: '1',
          subtotal: '100', shippingFee: '0', serviceFee: '0', taxAmount: '0', total: '100', shippingAddress: {},
          items: { create: { productId: p.id, name: p.name, sku: p.sku, quantity: 1, unitPriceCny: '100', unitPrice: '100', lineTotal: '100' } },
        },
      });
      expect(order.id).toBeTruthy();
      await http().post(`/api/v1/products/${p.slug}/reviews`).set(auth(buyer.token)).send({ rating: 4 }).expect(201);
      const list = (await http().get(`/api/v1/products/${p.slug}/reviews`)).body;
      expect(list.items[0].isVerifiedPurchase).toBe(true);
    });
  });

  describe('categories', () => {
    it('returns a tree with product counts and protects non-empty categories from deletion', async () => {
      await http().post('/api/v1/admin/categories').set(auth(admin)).send({ name: 'Boots', parentId: categoryId }).expect(201);
      await createProduct();
      const tree = (await http().get('/api/v1/categories').expect(200)).body;
      expect(tree).toHaveLength(1);
      expect(tree[0].productCount).toBe(1);
      expect(tree[0].children[0].name).toBe('Boots');
      await http().delete(`/api/v1/admin/categories/${categoryId}`).set(auth(admin)).expect(409);
    });

    it('rejects self-parenting and cycles', async () => {
      const child = (await http().post('/api/v1/admin/categories').set(auth(admin)).send({ name: 'Child', parentId: categoryId }).expect(201)).body.id;
      await http().patch(`/api/v1/admin/categories/${categoryId}`).set(auth(admin)).send({ parentId: categoryId }).expect(400);
      await http().patch(`/api/v1/admin/categories/${categoryId}`).set(auth(admin)).send({ parentId: child }).expect(400);
    });
  });
});
