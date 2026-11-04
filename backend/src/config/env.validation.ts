import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be at least 32 characters'),

  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_MAX_RESENDS: z.coerce.number().int().positive().default(5),

  EMAIL_PROVIDER: z.enum(['smtp', 'resend']).default('smtp'),
  EMAIL_FROM: z.string().min(1),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  RESEND_API_KEY: z.string().optional().default(''),

  SMS_PROVIDER: z.enum(['twilio', 'disabled']).default('disabled'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM_NUMBER: z.string().optional().default(''),

  PAYMENT_PROVIDER: z.enum(['disabled', 'flutterwave', 'mock']).default('disabled'),
  FLUTTERWAVE_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLUTTERWAVE_SECRET_KEY: z.string().optional().default(''),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional().default(''),
  FLUTTERWAVE_WEBHOOK_SECRET_HASH: z.string().optional().default(''),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock') {
    throw new Error('PAYMENT_PROVIDER=mock is a development-only simulator and is not allowed in production');
  }
  if (env.PAYMENT_PROVIDER === 'flutterwave' && !(env.FLUTTERWAVE_SECRET_KEY && env.FLUTTERWAVE_WEBHOOK_SECRET_HASH)) {
    throw new Error('FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_SECRET_HASH are required when PAYMENT_PROVIDER=flutterwave');
  }
  if (env.PAYMENT_PROVIDER === 'mock' && !env.FLUTTERWAVE_WEBHOOK_SECRET_HASH) {
    throw new Error('FLUTTERWAVE_WEBHOOK_SECRET_HASH is required (it also signs mock webhooks)');
  }
  if (env.NODE_ENV === 'production') {
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    }
    if (env.SMS_PROVIDER === 'twilio' && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER)) {
      throw new Error('Twilio credentials are required when SMS_PROVIDER=twilio');
    }
  }
  return env;
}
