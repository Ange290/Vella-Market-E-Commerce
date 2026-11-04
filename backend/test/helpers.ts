import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OtpPurpose } from '@prisma/client';
import cookieParser from 'cookie-parser';
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

export async function createTestApp() {
  const mail = new FakeMailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
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
    'TRUNCATE TABLE "RefreshToken","OTPVerification","AuditLog","Address","UserProfile","User" RESTART IDENTITY CASCADE',
  );
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
