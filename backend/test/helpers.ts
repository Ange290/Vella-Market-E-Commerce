import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { OtpPurpose, Role } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Captures OTP emails in memory so tests can read the code without a real mailbox. */
export class FakeMailService {
  sent: { to: string; code: string; purpose: OtpPurpose }[] = [];
  async sendOtp(to: string, code: string, purpose: OtpPurpose) {
    this.sent.push({ to, code, purpose });
  }
  lastCode(to: string, purpose: OtpPurpose): string {
    const hit = [...this.sent].reverse().find((m) => m.to === to && m.purpose === purpose);
    if (!hit) throw new Error(`No ${purpose} email sent to ${to}`);
    return hit.code;
  }
}

export async function createTestApp(configure?: (b: TestingModuleBuilder) => TestingModuleBuilder) {
  const mail = new FakeMailService();
  let builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailService).useValue(mail);
  if (configure) builder = configure(builder);
  const moduleRef = await builder.compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, mail };
}

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "User","Product","Category","Supplier","Currency","ExchangeRate","ShippingRate","TaxRule","SystemSetting","Coupon","WebhookEvent","ContentPage","Promotion","SupportRequest","AuditLog" RESTART IDENTITY CASCADE',
  );
}

/** Registers + verifies a customer, optionally promotes the role, and returns a bearer token. */
export async function loginAs(
  app: INestApplication,
  prisma: PrismaService,
  mail: FakeMailService,
  role: Role = Role.CUSTOMER,
  over: Record<string, unknown> = {},
) {
  const u = newUser(over);
  await request(app.getHttpServer()).post('/api/v1/auth/register').send(u).expect(201);
  await request(app.getHttpServer())
    .post('/api/v1/auth/verify-otp')
    .send({ email: u.email, code: mail.lastCode(u.email, OtpPurpose.REGISTRATION) })
    .expect(200);
  if (role !== Role.CUSTOMER) await prisma.user.update({ where: { email: u.email }, data: { role } });
  const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ identifier: u.email, password: u.password }).expect(200);
  return { user: u, id: res.body.user.id as string, token: res.body.accessToken as string };
}

let n = 0;
export const newUser = (over: Record<string, unknown> = {}) => {
  n += 1;
  return {
    fullName: 'Test Customer',
    email: `customer${n}@example.com`,
    phone: `+25078800${String(n).padStart(4, '0')}`,
    password: 'Str0ngPassw0rd',
    confirmPassword: 'Str0ngPassw0rd',
    country: 'RW',
    addressLine: 'KN 4 Ave 12',
    city: 'Kigali',
    ...over,
  };
};
