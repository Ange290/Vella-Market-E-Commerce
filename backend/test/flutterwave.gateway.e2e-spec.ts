import { BadGatewayException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { FlutterwaveGateway, paymentOptionsFor } from '../src/payments/flutterwave.gateway';

/** Unit tests of the real Flutterwave adapter with HTTP mocked — no network, no keys. */
describe('FlutterwaveGateway (mocked HTTP)', () => {
  const gw = new FlutterwaveGateway({ baseUrl: 'https://flw.test/v3', secretKey: 'FLWSECK_TEST-fake', webhookSecretHash: 'hash-123' });
  let fetchMock: jest.SpyInstance;
  const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const input = {
    reference: 'VMP-1', amount: new Prisma.Decimal('78352'), currency: 'RWF', method: PaymentMethod.MTN_MOBILE_MONEY, country: 'RW',
    customer: { email: 'a@b.rw', name: 'Aline', phone: '+250788123456' }, redirectUrl: 'https://app.test/payment/return', description: 'Order VM-1',
  };

  it('initiates a hosted payment with the right request and returns the checkout link', async () => {
    reply(200, { status: 'success', data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' } });
    const r = await gw.initiate(input);
    expect(r.checkoutUrl).toBe('https://checkout.flutterwave.com/v3/hosted/pay/abc');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://flw.test/v3/payments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer FLWSECK_TEST-fake');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      tx_ref: 'VMP-1', amount: '78352', currency: 'RWF', redirect_url: 'https://app.test/payment/return',
      payment_options: 'mobilemoneyrwanda', customer: { email: 'a@b.rw', name: 'Aline', phonenumber: '+250788123456' },
    });
  });

  it('maps payment methods to Flutterwave options and rejects impossible combinations', () => {
    expect(paymentOptionsFor(PaymentMethod.CARD, 'RW', 'RWF')).toBe('card');
    expect(paymentOptionsFor(PaymentMethod.AIRTEL_MONEY, 'RW', 'RWF')).toBe('mobilemoneyrwanda');
    expect(paymentOptionsFor(PaymentMethod.OTHER, 'RW', 'RWF')).toBeUndefined();
    expect(() => paymentOptionsFor(PaymentMethod.MTN_MOBILE_MONEY, 'RW', 'USD')).toThrow(UnprocessableEntityException);
    expect(() => paymentOptionsFor(PaymentMethod.MTN_MOBILE_MONEY, 'FR', 'EUR')).toThrow(UnprocessableEntityException);
  });

  it('fails cleanly when the provider errors or is unreachable', async () => {
    reply(401, { status: 'error', message: 'Invalid authorization key' });
    await expect(gw.initiate(input)).rejects.toBeInstanceOf(BadGatewayException);
    reply(200, { status: 'success', data: {} });
    await expect(gw.initiate(input)).rejects.toBeInstanceOf(BadGatewayException); // no link returned
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(gw.initiate(input)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('verifies by reference and maps statuses, amounts and ids', async () => {
    reply(200, { status: 'success', data: { id: 4321, tx_ref: 'VMP-1', status: 'successful', amount: 78352, currency: 'RWF', flw_ref: 'FLW-1', payment_type: 'mobilemoneyrwanda' } });
    const ok = await gw.verifyByReference('VMP-1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://flw.test/v3/transactions/verify_by_reference?tx_ref=VMP-1');
    expect(ok.status).toBe('successful');
    expect(ok.amount!.equals(78352)).toBe(true);
    expect(ok.currency).toBe('RWF');
    expect(ok.providerReference).toBe('4321');

    reply(200, { status: 'success', data: { id: 1, status: 'failed', amount: 10, currency: 'RWF', processor_response: 'Insufficient funds' } });
    expect(await gw.verifyByReference('x')).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' });
    reply(200, { status: 'success', data: { id: 1, status: 'pending', amount: 10, currency: 'RWF' } });
    expect((await gw.verifyByReference('x')).status).toBe('pending');
  });

  it('treats "no transaction yet" as pending, but real errors as failures', async () => {
    reply(404, { status: 'error', message: 'No transaction was found for this id' });
    expect((await gw.verifyByReference('VMP-9')).status).toBe('pending');
    reply(500, { status: 'error', message: 'boom' });
    await expect(gw.verifyByReference('VMP-9')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('checks the webhook signature in constant time and rejects anything else', () => {
    expect(gw.verifyWebhookSignature({ 'verif-hash': 'hash-123' })).toBe(true);
    expect(gw.verifyWebhookSignature({ 'verif-hash': 'hash-124' })).toBe(false);
    expect(gw.verifyWebhookSignature({ 'verif-hash': 'short' })).toBe(false);
    expect(gw.verifyWebhookSignature({})).toBe(false);
    const noSecret = new FlutterwaveGateway({ baseUrl: 'x', secretKey: 'k', webhookSecretHash: '' });
    expect(noSecret.verifyWebhookSignature({ 'verif-hash': '' })).toBe(false);
  });

  it('parses webhook payloads and ignores unrelated ones', () => {
    expect(gw.parseWebhook({ event: 'charge.completed', data: { id: 99, tx_ref: 'VMP-1', status: 'successful' } })).toEqual({ eventId: '99', eventType: 'charge.completed', reference: 'VMP-1' });
    expect(gw.parseWebhook({ event: 'transfer.completed', data: { id: 1 } })).toBeNull();
    expect(gw.parseWebhook(null)).toBeNull();
  });

  it('requests refunds and maps their outcome', async () => {
    reply(200, { status: 'success', data: { id: 55, status: 'completed' } });
    expect(await gw.refund('4321', new Prisma.Decimal('1000'), 'RWF', 'why')).toEqual({ providerReference: '55', status: 'completed' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://flw.test/v3/transactions/4321/refund');
    expect(JSON.parse(init.body)).toEqual({ amount: '1000' });

    reply(200, { status: 'success', data: { id: 56, status: 'pending' } });
    expect((await gw.refund('4321', new Prisma.Decimal('1'), 'RWF', 'why')).status).toBe('processing');
    reply(200, { status: 'error', message: 'Insufficient balance' });
    expect(await gw.refund('4321', new Prisma.Decimal('1'), 'RWF', 'why')).toMatchObject({ status: 'failed', failureReason: 'Insufficient balance' });
  });
});
