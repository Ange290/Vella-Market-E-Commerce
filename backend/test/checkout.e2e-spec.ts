import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';

/**
 * Hand-checked scenario (1 CNY = 200 RWF, 1 CNY = 0.14 USD):
 *   A: ¥100, 500 g          B-L: ¥50 + ¥10 delta = ¥60, 300 g
 *   cart: 2×A + 1×B-L  → ¥260, 1300 g
 *   RWF: unit A 20,000 · B-L 12,000 → subtotal 52,000
 *   STANDARD shipping RW (CNY): 20 + 30×1.3kg = ¥59 → 11,800
 *   service fee 5% of subtotal → 2,600
 *   VAT 18% of (52,000 + 11,800 + 2,600 = 66,400) → 11,952
 *   total = 52,000 + 11,800 + 2,600 + 11,952 = 78,352
 */
describe('Cart, pricing config & checkout quote (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  let admin: string;
  let cust: { token: string; id: string };
  let other: { token: string; id: string };
  let addressId: string;
  let A: any;
  let B: any;
  let BL: any; // variant L of product B
  let BM: any;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const adminPost = (path: string, body: object) => http().post(`/api/v1/admin/${path}`).set(auth(admin)).send(body);
  const quote = (over: Record<string, unknown> = {}, token = cust.token) =>
    http().post('/api/v1/checkout/quote').set(auth(token)).send({ addressId, deliveryMethod: 'STANDARD', currency: 'RWF', ...over });

  async function configureAll() {
    await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '200' }).expect(201);
    await adminPost('exchange-rates', { quoteCurrency: 'USD', rate: '0.14' }).expect(201);
    await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin)).send({ value: '5' }).expect(200);
    await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '20', perKgFee: '30', estimatedDaysMin: 15, estimatedDaysMax: 30 }).expect(201);
    await adminPost('tax-rules', { country: 'RW', name: 'VAT', ratePct: '18' }).expect(201);
  }
  const fillCart = async () => {
    await http().post('/api/v1/cart/items').set(auth(cust.token)).send({ productId: A.id, quantity: 2 }).expect(201);
    await http().post('/api/v1/cart/items').set(auth(cust.token)).send({ productId: B.id, variantId: BL.id, quantity: 1 }).expect(201);
  };

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
    await prisma.currency.createMany({
      data: [
        { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 },
        { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
      ],
    });
    admin = (await loginAs(app, prisma, mail, Role.ADMIN)).token;
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
    BM = B.variants.find((v: any) => v.sku === 'B-M');
    BL = B.variants.find((v: any) => v.sku === 'B-L');
    addressId = (await http().post('/api/v1/users/me/addresses').set(auth(cust.token)).send({
      recipientName: 'Aline Uwase', phone: '+250788123456', country: 'RW', city: 'Kigali', street: 'KG 7 Ave 12',
    }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  describe('addresses', () => {
    it('keeps exactly one default and isolates users', async () => {
      const second = (await http().post('/api/v1/users/me/addresses').set(auth(cust.token)).send({
        recipientName: 'Work', phone: '+250788000111', country: 'rw', city: 'Kigali', street: 'KN 3 Rd', isDefault: true,
      }).expect(201)).body;
      expect(second.country).toBe('RW');
      let list = (await http().get('/api/v1/users/me/addresses').set(auth(cust.token))).body;
      expect(list.filter((a: any) => a.isDefault)).toHaveLength(1);
      expect(list[0].id).toBe(second.id);

      await http().delete(`/api/v1/users/me/addresses/${second.id}`).set(auth(cust.token)).expect(204);
      list = (await http().get('/api/v1/users/me/addresses').set(auth(cust.token))).body;
      expect(list).toHaveLength(2); // registration address + the one created in setup
      expect(list.filter((a: any) => a.isDefault)).toHaveLength(1); // a new default is promoted after deleting the default

      await http().patch(`/api/v1/users/me/addresses/${addressId}`).set(auth(other.token)).send({ city: 'Hacked' }).expect(404);
      await http().delete(`/api/v1/users/me/addresses/${addressId}`).set(auth(other.token)).expect(404);
      await http().post('/api/v1/users/me/addresses').set(auth(cust.token)).send({ recipientName: 'X', phone: '0788', country: 'RW', city: 'K', street: 'abc' }).expect(400);
    });
  });

  describe('cart', () => {
    it('requires login', async () => {
      await http().get('/api/v1/cart').expect(401);
    });

    it('enforces variant selection, stock and per-line limits', async () => {
      const add = (body: object) => http().post('/api/v1/cart/items').set(auth(cust.token)).send(body);
      await add({ productId: B.id, quantity: 1 }).expect(400); // needs a variant
      await add({ productId: A.id, variantId: BL.id, quantity: 1 }).expect(400); // variant of another product / product has none
      await add({ productId: B.id, variantId: 'nope', quantity: 1 }).expect(400);
      await add({ productId: A.id, quantity: 11 }).expect(409); // stock 10
      await add({ productId: A.id, quantity: 100 }).expect(400); // max 99
      await add({ productId: A.id, quantity: 0 }).expect(400);
      await add({ productId: 'missing', quantity: 1 }).expect(404);
      const draft = (await adminPost('products', { sku: 'DRAFT-1', name: 'Draft', description: 'Generic test description.', categoryId: A.categoryId, priceCny: '5' }).expect(201)).body;
      await add({ productId: draft.id, quantity: 1 }).expect(404); // not purchasable
      await add({ productId: B.id, variantId: BL.id, quantity: 3 }).expect(409); // variant L stock is 2
    });

    it('merges repeat adds, updates, removes, and never shares carts between users', async () => {
      const add = (body: object) => http().post('/api/v1/cart/items').set(auth(cust.token)).send(body);
      await add({ productId: A.id, quantity: 2 }).expect(201);
      const merged = (await add({ productId: A.id, quantity: 3 }).expect(201)).body;
      expect(merged.items).toHaveLength(1);
      expect(merged.items[0].quantity).toBe(5);
      await add({ productId: A.id, quantity: 6 }).expect(409); // 5 + 6 > stock 10

      await add({ productId: B.id, variantId: BM.id, quantity: 1 }).expect(201);
      const two = (await add({ productId: B.id, variantId: BL.id, quantity: 1 }).expect(201)).body;
      expect(two.items).toHaveLength(3); // A, B-M, B-L are separate lines

      const itemId = two.items[0].id;
      const upd = (await http().patch(`/api/v1/cart/items/${itemId}`).set(auth(cust.token)).send({ quantity: 1 }).expect(200)).body;
      expect(upd.items[0].quantity).toBe(1);
      await http().patch(`/api/v1/cart/items/${itemId}`).set(auth(cust.token)).send({ quantity: 11 }).expect(409);

      await http().patch(`/api/v1/cart/items/${itemId}`).set(auth(other.token)).send({ quantity: 1 }).expect(404);
      await http().delete(`/api/v1/cart/items/${itemId}`).set(auth(other.token)).expect(404);
      expect((await http().get('/api/v1/cart').set(auth(other.token))).body.items).toHaveLength(0);

      const after = (await http().delete(`/api/v1/cart/items/${itemId}`).set(auth(cust.token)).expect(200)).body;
      expect(after.items).toHaveLength(2);
      await http().delete('/api/v1/cart').set(auth(cust.token)).expect(204);
      expect((await http().get('/api/v1/cart').set(auth(cust.token))).body.items).toHaveLength(0);
    });

    it('prices lines with variant deltas and converts only when a rate exists', async () => {
      await fillCart();
      const noRate = (await http().get('/api/v1/cart?currency=RWF').set(auth(cust.token))).body;
      expect(noRate.subtotalCny).toBe('260.00');
      expect(noRate.subtotal).toBeNull();
      expect(noRate.items.find((i: any) => i.sku === 'B-L').unitPriceCny).toBe('60.00');

      await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '200' }).expect(201);
      const withRate = (await http().get('/api/v1/cart?currency=RWF').set(auth(cust.token))).body;
      expect(withRate.subtotal).toEqual({ amount: '52000', currency: 'RWF' });
      expect(withRate.itemCount).toBe(3);
    });
  });

  describe('pricing configuration (admin)', () => {
    it('is restricted to admins and validates input', async () => {
      await http().post('/api/v1/admin/shipping-rates').set(auth(cust.token)).send({}).expect(403);
      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(cust.token)).send({ value: '5' }).expect(403);
      const staff = (await loginAs(app, prisma, mail, Role.STAFF)).token;
      await http().get('/api/v1/admin/shipping-rates').set(auth(staff)).expect(200);
      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(staff)).send({ value: '5' }).expect(403);
      await http().post('/api/v1/admin/tax-rules').set(auth(staff)).send({ country: 'RW', name: 'VAT', ratePct: '18' }).expect(403);

      const base = { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '20', perKgFee: '30' };
      await adminPost('shipping-rates', { ...base, baseFee: '-1' }).expect(400);
      await adminPost('shipping-rates', { ...base, currency: 'XXX' }).expect(400);
      await adminPost('shipping-rates', { ...base, method: 'TELEPORT' }).expect(400);
      await adminPost('shipping-rates', { ...base, minWeightGrams: 500, maxWeightGrams: 400 }).expect(400);
      await adminPost('shipping-rates', base).expect(201);
      await adminPost('shipping-rates', base).expect(409); // same country+method+band

      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin)).send({ value: '150' }).expect(400);
      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin)).send({ value: 'abc' }).expect(400);
      await http().put('/api/v1/admin/settings/default_currency').set(auth(admin)).send({ value: 'ZZZ' }).expect(400);
      await http().put('/api/v1/admin/settings/anything_else').set(auth(admin)).send({ value: 1 }).expect(400);
      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin)).send({ value: 7.5 }).expect(200);
      await adminPost('tax-rules', { country: 'RW', name: 'VAT', ratePct: '101' }).expect(400);
      await adminPost('coupons', { code: 'X', type: 'PERCENTAGE', value: '10' }).expect(400); // code too short
      await adminPost('coupons', { code: 'BIG', type: 'PERCENTAGE', value: '150' }).expect(400);
      await adminPost('coupons', { code: 'FIXED', type: 'FIXED_AMOUNT', value: '10' }).expect(400); // needs currency
    });
  });

  describe('checkout quote', () => {
    it('refuses to price an order until each required setting exists — nothing is invented', async () => {
      await fillCart();
      expect((await quote().expect(422)).body.code).toBe('CURRENCY_UNAVAILABLE');

      await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '200' }).expect(201);
      expect((await quote().expect(422)).body.code).toBe('SERVICE_FEE_NOT_CONFIGURED');

      await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin)).send({ value: '5' }).expect(200);
      expect((await quote().expect(422)).body.code).toBe('NO_SHIPPING_RATE');

      await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '20', perKgFee: '30' }).expect(201);
      const res = await quote().expect(200);
      expect(res.body.breakdown.taxes).toEqual([]); // no tax rule configured → no tax line (not an invented rate)
    });

    it('returns a transparent, correct breakdown in RWF', async () => {
      await configureAll();
      await fillCart();
      const q = (await quote().expect(200)).body;

      expect(q.currency).toBe('RWF');
      expect(q.exchangeRate).toEqual({ from: 'CNY', to: 'RWF', rate: '200' });
      expect(q.lines.map((l: any) => [l.sku, l.quantity, l.unitPrice.amount, l.lineTotal.amount])).toEqual([
        ['PROD-A', 2, '20000', '40000'],
        ['B-L', 1, '12000', '12000'],
      ]);
      const b = q.breakdown;
      expect(b.subtotal.amount).toBe('52000');
      expect(b.shipping.amount.amount).toBe('11800');
      expect(b.shipping.weightGrams).toBe(1300);
      expect(b.shipping.estimatedDays).toEqual({ min: 15, max: 30 });
      expect(b.serviceFee.amount.amount).toBe('2600');
      expect(b.taxes).toHaveLength(1);
      expect(b.taxes[0].amount.amount).toBe('11952');
      expect(b.discount).toBeNull();
      expect(b.total.amount).toBe('78352');
      expect(q.canCheckout).toBe(true);
    });

    it('quotes in another currency with correct decimals and rounding', async () => {
      await configureAll();
      await fillCart();
      const q = (await quote({ currency: 'usd' }).expect(200)).body;
      // A 14.00 ×2 = 28.00 · B-L 8.40 → 36.40; shipping ¥59×0.14 = 8.26; fee 1.82; tax 18% of 46.48 = 8.3664 → 8.37
      expect(q.breakdown.subtotal.amount).toBe('36.40');
      expect(q.breakdown.shipping.amount.amount).toBe('8.26');
      expect(q.breakdown.serviceFee.amount.amount).toBe('1.82');
      expect(q.breakdown.taxes[0].amount.amount).toBe('8.37');
      expect(q.breakdown.total.amount).toBe('54.85');
    });

    it('converts a shipping tariff defined in a different currency', async () => {
      await configureAll();
      await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'AIR_FREIGHT', currency: 'USD', baseFee: '10', perKgFee: '5' }).expect(201);
      await fillCart();
      // (10 + 5×1.3) = 16.50 USD ÷ 0.14 = ¥117.857… × 200 = 23,571.43 → 23,571 RWF
      const q = (await quote({ deliveryMethod: 'AIR_FREIGHT' }).expect(200)).body;
      expect(q.breakdown.shipping.amount.amount).toBe('23571');
    });

    it('uses the correct weight band', async () => {
      await configureAll();
      const base = (await http().get('/api/v1/admin/shipping-rates?country=RW').set(auth(admin))).body.find((r: any) => r.minWeightGrams === 0);
      await http().patch(`/api/v1/admin/shipping-rates/${base.id}`).set(auth(admin)).send({ maxWeightGrams: 999 }).expect(200);
      await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '5', perKgFee: '10', minWeightGrams: 1000, maxWeightGrams: 5000 }).expect(201);
      await fillCart(); // 1300 g → falls in the 1000-5000 band: 5 + 10×1.3 = ¥18 → 3,600
      expect((await quote().expect(200)).body.breakdown.shipping.amount.amount).toBe('3600');
      await http().delete('/api/v1/cart').set(auth(cust.token)).expect(204);
      await http().post('/api/v1/cart/items').set(auth(cust.token)).send({ productId: A.id, quantity: 1 }).expect(201); // 500 g → base band: 20+15 = ¥35 → 7,000
      expect((await quote().expect(200)).body.breakdown.shipping.amount.amount).toBe('7000');
      await http().post('/api/v1/cart/items').set(auth(cust.token)).send({ productId: A.id, quantity: 9 }).expect(201); // 5000 g → still in band (<= max)
      await http().post('/api/v1/cart/items').set(auth(cust.token)).send({ productId: B.id, variantId: BM.id, quantity: 1 }).expect(201); // 5300 g → no band covers it
      expect((await quote().expect(422)).body.code).toBe('NO_SHIPPING_RATE');
    });

    it('lists delivery options with prices and marks unconfigured methods unavailable', async () => {
      await configureAll();
      await fillCart();
      const res = (await http().get(`/api/v1/checkout/shipping-options?addressId=${addressId}&currency=RWF`).set(auth(cust.token)).expect(200)).body;
      const std = res.options.find((o: any) => o.method === 'STANDARD');
      expect(std).toMatchObject({ available: true, fee: { amount: '11800', currency: 'RWF' } });
      const express = res.options.find((o: any) => o.method === 'EXPRESS');
      expect(express.available).toBe(false);
      expect(express.reason).toMatch(/not available/i);
    });

    it('applies percentage and fixed coupons, and reports invalid ones', async () => {
      await configureAll();
      await fillCart();
      await adminPost('coupons', { code: 'save10', type: 'PERCENTAGE', value: '10' }).expect(201);
      // discount 5,200; tax base 66,400 − 5,200 = 61,200 → VAT 11,016; total 72,216
      const q = (await quote({ couponCode: 'SAVE10' }).expect(200)).body;
      expect(q.breakdown.discount).toEqual({ code: 'SAVE10', amount: { amount: '5200', currency: 'RWF' } });
      expect(q.breakdown.taxes[0].amount.amount).toBe('11016');
      expect(q.breakdown.total.amount).toBe('72216');

      await adminPost('coupons', { code: 'FIX3000', type: 'FIXED_AMOUNT', value: '3000', currency: 'RWF', minOrderAmount: '100000' }).expect(201);
      const low = (await quote({ couponCode: 'FIX3000' }).expect(200)).body;
      expect(low.canCheckout).toBe(false);
      expect(low.issues[0].code).toBe('COUPON_INVALID');
      expect(low.breakdown.discount).toBeNull();

      const wrongCur = (await quote({ couponCode: 'FIX3000', currency: 'USD' }).expect(200)).body;
      expect(wrongCur.issues[0].message).toMatch(/only valid for orders in RWF/);

      expect((await quote({ couponCode: 'NOPE' }).expect(200)).body.issues[0].code).toBe('COUPON_INVALID');
      await adminPost('coupons', { code: 'OLDONE', type: 'PERCENTAGE', value: '10', startsAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z' }).expect(201);
      expect((await quote({ couponCode: 'OLDONE' }).expect(200)).body.issues[0].message).toMatch(/expired/);
      await adminPost('coupons', { code: 'USEDUP', type: 'PERCENTAGE', value: '10', maxUses: 1 }).expect(201);
      await prisma.coupon.update({ where: { code: 'USEDUP' }, data: { usedCount: 1 } });
      expect((await quote({ couponCode: 'USEDUP' }).expect(200)).body.issues[0].message).toMatch(/redeemed/);
    });

    it('flags stock problems without failing the quote', async () => {
      await configureAll();
      await fillCart();
      await prisma.product.update({ where: { id: A.id }, data: { stock: 1 } });
      const q = (await quote().expect(200)).body;
      expect(q.canCheckout).toBe(false);
      expect(q.issues).toEqual([expect.objectContaining({ code: 'INSUFFICIENT_STOCK' })]);
      await prisma.product.update({ where: { id: A.id }, data: { status: 'ARCHIVED' } });
      expect((await quote().expect(200)).body.issues[0].code).toBe('UNAVAILABLE');
    });

    it('rejects bad requests: empty cart, foreign address, unsupported destination, missing weight', async () => {
      await configureAll();
      expect((await quote().expect(400)).body.message).toMatch(/empty/i);
      await fillCart();
      await quote({ addressId }, other.token).expect(400); // other's cart is empty
      await http().post('/api/v1/cart/items').set(auth(other.token)).send({ productId: A.id, quantity: 1 }).expect(201);
      await quote({ addressId }, other.token).expect(404); // address belongs to cust

      await http().put('/api/v1/admin/settings/supported_destinations').set(auth(admin)).send({ value: ['KE'] }).expect(200);
      expect((await quote().expect(422)).body.code).toBe('DESTINATION_NOT_SUPPORTED');
      await http().put('/api/v1/admin/settings/supported_destinations').set(auth(admin)).send({ value: ['RW'] }).expect(200);

      await prisma.product.update({ where: { id: A.id }, data: { weightGrams: null } });
      expect((await quote().expect(422)).body.code).toBe('PRODUCT_WEIGHT_MISSING');

      await http().post('/api/v1/checkout/quote').set(auth(cust.token)).send({ addressId, deliveryMethod: 'TELEPORT' }).expect(400);
      await http().post('/api/v1/checkout/quote').send({}).expect(401);
    });

    it('uses the default currency setting when none is requested', async () => {
      await configureAll();
      await fillCart();
      await http().put('/api/v1/admin/settings/default_currency').set(auth(admin)).send({ value: 'RWF' }).expect(200);
      const q = (await http().post('/api/v1/checkout/quote').set(auth(cust.token)).send({ addressId, deliveryMethod: 'STANDARD' }).expect(200)).body;
      expect(q.currency).toBe('RWF');
    });
  });
});
