import { BadGatewayException, BadRequestException, Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return this.config.get('SMS_PROVIDER', { infer: true }) === 'twilio';
  }

  /** Sends an OTP by SMS via Twilio. The code is never logged. */
  async sendOtp(toE164: string, code: string): Promise<void> {
    if (!this.enabled) throw new BadRequestException('SMS verification is not available');
    const sid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const token = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const ttl = this.config.get('OTP_TTL_MINUTES', { infer: true });
    const body = new URLSearchParams({
      To: toE164,
      From: this.config.get('TWILIO_FROM_NUMBER', { infer: true }),
      Body: `Vella Market: your code is ${code}. It expires in ${ttl} minutes. Do not share it.`,
    });
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
    } catch (err) {
      this.logger.error(`SMS delivery failed: ${(err as Error).message}`);
      throw new BadGatewayException('We could not send the SMS right now. Please try again shortly.');
    }
  }
}

@Global()
@Module({ providers: [SmsService], exports: [SmsService] })
export class SmsModule {}
