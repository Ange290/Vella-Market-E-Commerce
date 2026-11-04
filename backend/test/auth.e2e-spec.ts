import { INestApplication } from '@nestjs/common';
import { OtpChannel, OtpPurpose, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FakeMailService, newUser, resetDb } from './helpers';

describe('Auth, OTP & RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: FakeMailService;
  const http = () => request(app.getHttpServer());

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

  /** Registers + verifies a user, returning credentials and tokens. */
  async function activeUser(over: Record<string, unknown> = {}) {
    const u = newUser(over);
    await http().post('/api/v1/auth/register').send(u).expect(201);
    const res = await http()
      .post('/api/v1/auth/verify-otp')
      .send({ email: u.email, code: mail.lastCode(u.email, OtpPurpose.REGISTRATION) })
      .expect(200);
    return { u, accessToken: res.body.accessToken as string, cookie: res.headers['set-cookie'] as unknown as string[] };
  }

  describe('registration', () => {
    it('creates a pending account, stores only a hash of the OTP, and never returns the code', async () => {
      const u = newUser();
      const res = await http().post('/api/v1/auth/register').send(u).expect(201);
      expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email }, include: { addresses: true, profile: true } });
      expect(user.status).toBe(UserStatus.PENDING_VERIFICATION);
      expect(user.role).toBe(Role.CUSTOMER);
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.addresses).toHaveLength(1);

      const code = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      const otp = await prisma.oTPVerification.findFirstOrThrow({ where: { target: u.email } });
      expect(otp.codeHash).not.toContain(code);
      expect(otp.codeHash).toHaveLength(64);
      expect(otp.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    });

    it('rejects mismatched passwords, weak passwords and bad phone numbers', async () => {
      await http().post('/api/v1/auth/register').send(newUser({ confirmPassword: 'different1234' })).expect(400);
      await http().post('/api/v1/auth/register').send(newUser({ password: 'short1', confirmPassword: 'short1' })).expect(400);
      await http().post('/api/v1/auth/register').send(newUser({ password: 'onlyletterspassword', confirmPassword: 'onlyletterspassword' })).expect(400);
      await http().post('/api/v1/auth/register').send(newUser({ phone: '0788123456' })).expect(400);
    });

    it('rejects duplicate emails and phones for active accounts', async () => {
      const { u } = await activeUser();
      await http().post('/api/v1/auth/register').send(newUser({ email: u.email })).expect(409);
      await http().post('/api/v1/auth/register').send(newUser({ phone: u.phone })).expect(409);
    });

    it('cannot log in before verifying the email', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      const res = await http().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(403);
      expect(res.body.message).toMatch(/verify/i);
    });
  });

  describe('OTP verification', () => {
    it('activates the account with the right code and signs the user in (httpOnly refresh cookie)', async () => {
      const { u, accessToken, cookie } = await activeUser();
      expect(accessToken).toBeTruthy();
      expect(cookie.join(';')).toMatch(/vella_rt=.+HttpOnly/i);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
      expect(user.status).toBe(UserStatus.ACTIVE);
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('rejects a wrong code and locks out after the maximum attempts, even for the right code', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      const real = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      const wrong = real === '000000' ? '111111' : '000000';
      for (let i = 0; i < 3; i++) {
        await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code: wrong }).expect(400);
      }
      await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code: real }).expect(429);
    });

    it('rejects an expired code', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      const code = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      await prisma.oTPVerification.updateMany({ where: { target: u.email }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code }).expect(400);
    });

    it('a code can only be used once', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      const code = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code }).expect(200);
      await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code }).expect(400);
    });

    it('resend invalidates the previous code and issues a fresh one', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      const first = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      let second = first;
      for (let i = 0; i < 5 && second === first; i++) {
        await http().post('/api/v1/auth/resend-otp').send({ email: u.email }).expect(200);
        second = mail.lastCode(u.email, OtpPurpose.REGISTRATION);
      }
      expect(await prisma.oTPVerification.count({ where: { target: u.email, consumedAt: null } })).toBe(1);
      if (second !== first) {
        await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code: first }).expect(400);
      }
      await http().post('/api/v1/auth/verify-otp').send({ email: u.email, code: second }).expect(200);
    });

    it('enforces the resend cooldown and the resend cap', async () => {
      const u = newUser();
      await http().post('/api/v1/auth/register').send(u).expect(201);
      // cap: OTP_MAX_RESENDS defaults to 5
      for (let i = 0; i < 5; i++) await http().post('/api/v1/auth/resend-otp').send({ email: u.email }).expect(200);
      await http().post('/api/v1/auth/resend-otp').send({ email: u.email }).expect(429);

    });

    it('enforces the 60s resend cooldown (OtpService with production-like config)', async () => {
      const cfg = { OTP_RESEND_COOLDOWN_SECONDS: 60, OTP_MAX_RESENDS: 5, OTP_TTL_MINUTES: 5, OTP_MAX_ATTEMPTS: 5, OTP_HMAC_SECRET: 'x'.repeat(40) };
      const svc = new OtpService(prisma, { get: (k: keyof typeof cfg) => cfg[k] } as any);
      const input = { target: 'cooldown@example.com', channel: OtpChannel.EMAIL, purpose: OtpPurpose.PASSWORD_RESET };
      await svc.issue(input);
      await expect(svc.issue(input)).rejects.toMatchObject({ status: 429 });
      // after the cooldown elapses a new code is allowed
      await prisma.oTPVerification.updateMany({ where: { target: input.target }, data: { lastSentAt: new Date(Date.now() - 61_000) } });
      await expect(svc.issue(input)).resolves.toMatchObject({ cooldownSeconds: 60 });
    });
  });

  describe('login', () => {
    it('logs in with email or phone and password', async () => {
      const { u } = await activeUser();
      const byEmail = await http().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200);
      expect(byEmail.body.user.role).toBe('CUSTOMER');
      await http().post('/api/v1/auth/login').send({ identifier: u.phone, password: u.password }).expect(200);
    });

    it('returns the same 401 for a wrong password and an unknown user', async () => {
      const { u } = await activeUser();
      const a = await http().post('/api/v1/auth/login').send({ identifier: u.email, password: 'WrongPass123' }).expect(401);
      const b = await http().post('/api/v1/auth/login').send({ identifier: 'nobody@example.com', password: 'WrongPass123' }).expect(401);
      expect(a.body.message).toBe(b.body.message);
    });

    it('blocks suspended accounts', async () => {
      const { u } = await activeUser();
      await prisma.user.update({ where: { email: u.email }, data: { status: UserStatus.SUSPENDED } });
      await http().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(403);
    });

    it('supports passwordless login with an emailed OTP', async () => {
      const { u } = await activeUser();
      await http().post('/api/v1/auth/login/otp/request').send({ identifier: u.email }).expect(200);
      const code = mail.lastCode(u.email, OtpPurpose.LOGIN);
      await http().post('/api/v1/auth/login/otp/verify').send({ identifier: u.email, code }).expect(200);
    });

    it('does not reveal whether an account exists when requesting a login OTP', async () => {
      const res = await http().post('/api/v1/auth/login/otp/request').send({ identifier: 'ghost@example.com' }).expect(200);
      expect(mail.sent).toHaveLength(0);
      expect(res.body.message).toMatch(/if the account exists/i);
    });

    it('rejects SMS login when no SMS provider is configured', async () => {
      await http().post('/api/v1/auth/login/otp/request').send({ identifier: '+250788000001' }).expect(400);
    });
  });

  describe('refresh-token rotation', () => {
    it('rotates the refresh token and rejects reuse of the old one, revoking the whole family', async () => {
      const { cookie } = await activeUser();
      const first = cookie[0].split(';')[0]; // vella_rt=...

      const r1 = await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(200);
      expect(r1.body.accessToken).toBeTruthy();
      const second = (r1.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      expect(second).not.toBe(first);

      // Re-presenting the rotated token = theft signal
      await http().post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
      // …which revokes the newer token too
      await http().post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
    });

    it('stores refresh tokens hashed only', async () => {
      const { cookie } = await activeUser();
      const raw = cookie[0].split(';')[0].split('=')[1];
      const rows = await prisma.refreshToken.findMany();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.tokenHash === raw)).toBe(false);
    });

    it('rejects refresh without a cookie', async () => {
      await http().post('/api/v1/auth/refresh').expect(401);
    });

    it('logout revokes the session', async () => {
      const { cookie } = await activeUser();
      const c = cookie[0].split(';')[0];
      await http().post('/api/v1/auth/logout').set('Cookie', c).expect(200);
      await http().post('/api/v1/auth/refresh').set('Cookie', c).expect(401);
    });
  });

  describe('password reset', () => {
    it('resets the password with an OTP, revokes all sessions and invalidates the old password', async () => {
      const { u, cookie } = await activeUser();
      await http().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(200);
      const code = mail.lastCode(u.email, OtpPurpose.PASSWORD_RESET);

      await http().post('/api/v1/auth/reset-password').send({ email: u.email, code, newPassword: 'BrandNewPass99' }).expect(200);

      await http().post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(401);
      await http().post('/api/v1/auth/login').send({ identifier: u.email, password: 'BrandNewPass99' }).expect(200);
      await http().post('/api/v1/auth/refresh').set('Cookie', cookie[0].split(';')[0]).expect(401);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
      expect(await argon2.verify(user.passwordHash, 'BrandNewPass99')).toBe(true);
    });

    it('gives an identical response for unknown emails and sends nothing', async () => {
      const res = await http().post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' }).expect(200);
      expect(res.body.message).toMatch(/if the account exists/i);
      expect(mail.sent).toHaveLength(0);
    });

    it('rejects a wrong reset code and a weak new password', async () => {
      const { u } = await activeUser();
      await http().post('/api/v1/auth/forgot-password').send({ email: u.email }).expect(200);
      const code = mail.lastCode(u.email, OtpPurpose.PASSWORD_RESET);
      const wrong = code === '000000' ? '111111' : '000000';
      await http().post('/api/v1/auth/reset-password').send({ email: u.email, code: wrong, newPassword: 'BrandNewPass99' }).expect(400);
      await http().post('/api/v1/auth/reset-password').send({ email: u.email, code, newPassword: 'weak' }).expect(400);
    });
  });

  describe('authorisation (RBAC)', () => {
    it('requires authentication for protected routes', async () => {
      await http().get('/api/v1/users/me').expect(401);
      await http().get('/api/v1/users').expect(401);
      await http().get('/api/v1/users/me').set('Authorization', 'Bearer not.a.token').expect(401);
    });

    it('lets a customer read their own profile but forbids admin routes', async () => {
      const { u, accessToken } = await activeUser();
      const me = await http().get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(me.body.email).toBe(u.email);
      expect(me.body).not.toHaveProperty('passwordHash');
      await http().get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(403);
    });

    it('allows ADMIN and STAFF to list users and reflects role changes immediately', async () => {
      const { u, accessToken } = await activeUser();
      await prisma.user.update({ where: { email: u.email }, data: { role: Role.STAFF } });
      const res = await http().get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).not.toHaveProperty('passwordHash');
      await prisma.user.update({ where: { email: u.email }, data: { role: Role.CUSTOMER } });
      await http().get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`).expect(403);
    });

    it('rejects an access token once the user is suspended', async () => {
      const { u, accessToken } = await activeUser();
      await prisma.user.update({ where: { email: u.email }, data: { status: UserStatus.SUSPENDED } });
      await http().get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`).expect(401);
    });
  });
});
