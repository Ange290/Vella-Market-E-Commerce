import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeMailService, loginAs } from './helpers';

/**
 * Seeds a fully configured shop (currency, exchange rate, fees, shipping, tax, two products) plus an
 * admin and two customers with delivery addresses. Used by suites that need a priced order.
 * Scenario figures: 1 CNY = 200 RWF; order of 2×A + 1×B-L totals 78,352 RWF.
 */
export async function setupShop(app: INestApplication, prisma: PrismaService, mail: FakeMailService) {
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  await prisma.currency.createMany({ data: [{ code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 }] });
  const admin = await loginAs(app, prisma, mail, Role.ADMIN);
  const cust = await loginAs(app, prisma, mail);
  const other = await loginAs(app, prisma, mail);
  const adminPost = (path: string, body: object) => http().post(`/api/v1/admin/${path}`).set(auth(admin.token)).send(body);

  const cat = (await adminPost('categories', { name: 'Fashion' }).expect(201)).body.id;
  const mk = async (body: object) => (await adminPost('products', { description: 'Generic test description.', categoryId: cat, status: 'ACTIVE', ...body }).expect(201)).body;
  const A = await mk({ sku: 'PROD-A', name: 'Product A', priceCny: '100', stock: 100, weightGrams: 500 });
  const B = await mk({
    sku: 'PROD-B', name: 'Product B', priceCny: '50', weightGrams: 300,
    variants: [{ sku: 'B-M', size: 'M', color: 'Blue', stock: 5 }, { sku: 'B-L', size: 'L', color: 'Blue', priceDeltaCny: '10', stock: 50 }],
  });
  const BL = B.variants.find((v: any) => v.sku === 'B-L');

  await adminPost('exchange-rates', { quoteCurrency: 'RWF', rate: '200' }).expect(201);
  await http().put('/api/v1/admin/settings/service_fee_pct').set(auth(admin.token)).send({ value: '5' }).expect(200);
  await adminPost('shipping-rates', { destinationCountry: 'RW', method: 'STANDARD', currency: 'CNY', baseFee: '20', perKgFee: '30' }).expect(201);
  await adminPost('tax-rules', { country: 'RW', name: 'VAT', ratePct: '18' }).expect(201);

  const mkAddr = async (token: string) =>
    (await http().post('/api/v1/users/me/addresses').set(auth(token)).send({ recipientName: 'Aline Uwase', phone: '+250788123456', country: 'RW', city: 'Kigali', street: 'KG 7 Ave 12' }).expect(201)).body.id as string;
  const addressId = await mkAddr(cust.token);
  const otherAddressId = await mkAddr(other.token);

  /** Places a 78,352 RWF order for the given customer and returns it. */
  async function placeOrder(account = cust, addr = addressId) {
    await http().post('/api/v1/cart/items').set(auth(account.token)).send({ productId: A.id, quantity: 2 }).expect(201);
    await http().post('/api/v1/cart/items').set(auth(account.token)).send({ productId: B.id, variantId: BL.id, quantity: 1 }).expect(201);
    return (await http().post('/api/v1/orders').set(auth(account.token)).send({ addressId: addr, deliveryMethod: 'STANDARD', currency: 'RWF' }).expect(201)).body;
  }

  return { admin, cust, other, A, B, BL, addressId, otherAddressId, placeOrder, auth, http };
}
