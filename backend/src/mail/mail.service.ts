import { BadGatewayException, Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Env } from '../config/env.validation';

const SUBJECTS: Record<OtpPurpose, string> = {
  REGISTRATION: 'Verify your Vella Market account',
  LOGIN: 'Your Vella Market login code',
  PASSWORD_RESET: 'Reset your Vella Market password',
  PHONE_VERIFICATION: 'Verify your phone number',
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Sends an OTP email. The code is only ever placed in the message body — never logged. */
  async sendOtp(to: string, code: string, purpose: OtpPurpose): Promise<void> {
    const ttl = this.config.get('OTP_TTL_MINUTES', { infer: true });
    const subject = SUBJECTS[purpose];
    const text = `Your Vella Market verification code is ${code}. It expires in ${ttl} minutes. If you did not request it, ignore this email and never share this code.`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#0f2557">Vella Market</h2>
      <p>${escapeHtml(subject)}</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0f2557">${escapeHtml(code)}</p>
      <p>This code expires in ${ttl} minutes. If you did not request it, you can ignore this email. Never share this code with anyone.</p></div>`;
    await this.send(to, subject, text, html);
  }

  private async send(to: string, subject: string, text: string, html: string): Promise<void> {
    const from = this.config.get('EMAIL_FROM', { infer: true });
    try {
      if (this.config.get('EMAIL_PROVIDER', { infer: true }) === 'resend') {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.get('RESEND_API_KEY', { infer: true })}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
        });
        if (!res.ok) throw new Error(`Resend responded ${res.status}`);
        return;
      }
      this.transporter ??= nodemailer.createTransport({
        host: this.config.get('SMTP_HOST', { infer: true }),
        port: this.config.get('SMTP_PORT', { infer: true }),
        secure: false,
      });
      await this.transporter.sendMail({ from, to, subject, text, html });
    } catch (err) {
      this.logger.error(`Email delivery failed: ${(err as Error).message}`);
      throw new BadGatewayException('We could not send the email right now. Please try again shortly.');
    }
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
