import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, loginAs, resetDb } from './helpers';

describe('Profile & password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma, mail } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDb(prisma);
    mail.sent = [];
  });
  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /users/me', () => {
    it('updates name, country, language and display currency, and nothing else', async () => {
      await prisma.currency.create({ data: { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 } });
      const me = await loginAs(app, prisma, mail);
      const res = await http().patch('/api/v1/users/me').set(auth(me.token)).send({ fullName: '  Aline Uwase  ', country: 'ug', preferredCurrency: 'rwf', preferredLanguage: 'fr' }).expect(200);
      expect(res.body.profile).toMatchObject({ fullName: 'Aline Uwase', country: 'UG', preferredCurrency: 'RWF', preferredLanguage: 'fr' });

      // identity and privilege fields cannot be set through this endpoint
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ role: 'ADMIN' }).expect(400);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ email: 'evil@example.com' }).expect(400);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ phone: '+250788000000' }).expect(400);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).role).toBe('CUSTOMER');
    });

    it('validates input and requires login', async () => {
      const me = await loginAs(app, prisma, mail);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ fullName: 'A' }).expect(400);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ country: 'Rwanda' }).expect(400);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ preferredLanguage: 'xx' }).expect(400);
      await http().patch('/api/v1/users/me').set(auth(me.token)).send({ preferredCurrency: 'ZZZ' }).expect(400); // not a configured currency
      await http().patch('/api/v1/users/me').send({ fullName: 'Hacker' }).expect(401);
      expect((await prisma.auditLog.count({ where: { action: 'user.profile_update' } }))).toBe(0);
    });
  });

  describe('POST /users/me/password', () => {
    const login = (email: string, password: string) => http().post('/api/v1/auth/login').send({ identifier: email, password });

    it('changes the password, signs out other devices and keeps the current one signed in', async () => {
      const me = await loginAs(app, prisma, mail);
      const other = await login(me.user.email, me.user.password).expect(200); // a second device
      const otherCookie = (other.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

      const res = await http().post('/api/v1/users/me/password').set(auth(me.token)).send({ currentPassword: me.user.password, newPassword: 'BrandNewPass99' }).expect(200);
      expect(res.body.accessToken).toBeTruthy();
      const newCookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

      await http().post('/api/v1/auth/refresh').set('Cookie', otherCookie).expect(401); // other device is signed out
      await http().post('/api/v1/auth/refresh').set('Cookie', newCookie).expect(200); // this device stays signed in
      await login(me.user.email, me.user.password).expect(401);
      await login(me.user.email, 'BrandNewPass99').expect(200);
      expect(await prisma.auditLog.count({ where: { action: 'user.password_change' } })).toBe(1);
    });

    it('rejects a wrong current password, weak or unchanged passwords, and anonymous callers', async () => {
      const me = await loginAs(app, prisma, mail);
      const change = (body: object) => http().post('/api/v1/users/me/password').set(auth(me.token)).send(body);
      await change({ currentPassword: 'WrongPass12345', newPassword: 'BrandNewPass99' }).expect(401);
      await change({ currentPassword: me.user.password, newPassword: 'short1' }).expect(400);
      await change({ currentPassword: me.user.password, newPassword: 'onlylettersnonumbers' }).expect(400);
      await change({ currentPassword: me.user.password, newPassword: me.user.password }).expect(400);
      await change({ newPassword: 'BrandNewPass99' }).expect(400);
      await http().post('/api/v1/users/me/password').send({ currentPassword: 'x', newPassword: 'BrandNewPass99' }).expect(401);
      await login(me.user.email, me.user.password).expect(200); // nothing changed
      expect(await prisma.auditLog.count({ where: { action: 'user.password_change_failed' } })).toBe(1);
    });
  });
});
