// Runs before every test file. Uses an isolated database; never touches development data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://vella:vella_dev_password@localhost:5433/vella_market_test?schema=public';
process.env.APP_URL = 'http://localhost:5173';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-0123456789-abcdef';
process.env.OTP_HMAC_SECRET = 'test-otp-secret-0123456789-0123456789-abcdefgh';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
process.env.OTP_MAX_ATTEMPTS = '3';
process.env.EMAIL_FROM = 'Vella Market <test@vellamarket.local>';
process.env.SMS_PROVIDER = 'disabled';
