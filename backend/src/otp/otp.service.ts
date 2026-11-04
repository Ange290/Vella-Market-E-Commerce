import { BadRequestException, HttpException, HttpStatus, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

const STALE_AFTER_MS = 60 * 60 * 1000; // after 1h an unconsumed OTP chain is retired and the resend budget resets

export interface IssueOtpInput {
  target: string; // normalised email or E.164 phone
  channel: OtpChannel;
  purpose: OtpPurpose;
  userId?: string | null;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** 6-digit code from a CSPRNG. */
  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Keyed hash (HMAC-SHA256). The raw code is never persisted. */
  hash(target: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.config.get('OTP_HMAC_SECRET', { infer: true }))
      .update(`${target}|${purpose}|${code}`)
      .digest('hex');
  }

  /**
   * Creates (or re-issues) the single active OTP for target+purpose and returns the plaintext
   * code so the caller can deliver it. Enforces the resend cooldown and resend cap.
   */
  async issue(input: IssueOtpInput): Promise<{ code: string; cooldownSeconds: number }> {
    const { target, channel, purpose, userId } = input;
    const cooldown = this.config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
    const maxResends = this.config.get('OTP_MAX_RESENDS', { infer: true });
    const ttlMin = this.config.get('OTP_TTL_MINUTES', { infer: true });
    const maxAttempts = this.config.get('OTP_MAX_ATTEMPTS', { infer: true });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMin * 60_000);
    const code = this.generateCode();
    const codeHash = this.hash(target, purpose, code);

    const existing = await this.prisma.oTPVerification.findFirst({ where: { target, purpose, consumedAt: null } });

    if (existing) {
      const sinceSend = (now.getTime() - existing.lastSentAt.getTime()) / 1000;
      if (sinceSend < cooldown) {
        const wait = Math.ceil(cooldown - sinceSend);
        throw new HttpException(
          { message: `Please wait ${wait}s before requesting another code`, retryAfterSeconds: wait },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const stale = now.getTime() - existing.createdAt.getTime() > STALE_AFTER_MS;
      if (stale) {
        await this.prisma.oTPVerification.update({ where: { id: existing.id }, data: { consumedAt: now } });
      } else {
        if (existing.resendCount >= maxResends) {
          throw new HttpException('Too many codes requested. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }
        await this.prisma.oTPVerification.update({
          where: { id: existing.id },
          data: {
            codeHash,
            expiresAt,
            attempts: 0,
            maxAttempts,
            lastSentAt: now,
            resendCount: { increment: 1 },
          },
        });
        return { code, cooldownSeconds: cooldown };
      }
    }

    await this.prisma.oTPVerification.create({
      data: { target, channel, purpose, userId: userId ?? null, codeHash, expiresAt, maxAttempts, lastSentAt: now },
    });
    return { code, cooldownSeconds: cooldown };
  }

  /**
   * Verifies and consumes a code. Every guess increments the attempt counter atomically
   * BEFORE comparison, so concurrent guessing cannot exceed the limit.
   */
  async verify(target: string, purpose: OtpPurpose, code: string): Promise<{ userId: string | null }> {
    const now = new Date();
    const record = await this.prisma.oTPVerification.findFirst({
      where: { target, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt <= now) throw new BadRequestException('Invalid or expired code');

    const bumped = await this.prisma.oTPVerification.updateMany({
      where: { id: record.id, consumedAt: null, attempts: { lt: record.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count === 0) {
      throw new HttpException('Too many incorrect attempts. Please request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = Buffer.from(this.hash(target, purpose, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new BadRequestException('Invalid or expired code');
    }

    const consumed = await this.prisma.oTPVerification.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) throw new BadRequestException('Invalid or expired code');
    return { userId: record.userId };
  }
}

@Module({ providers: [OtpService], exports: [OtpService] })
export class OtpModule {}
