/**
 * DEVELOPMENT SEED DATA — not for production use.
 *
 * Creates reference data the app needs to boot (currencies, categories, content pages,
 * settings) and one admin account taken from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 *
 * Deliberately NOT seeded: exchange rates and shipping rates. Those must be entered by an
 * administrator (or fetched from a real provider) — no invented fixed values.
 */
import 'dotenv/config';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { CONTENT_DEFAULTS, PLACEHOLDER_MARKER } from './content-defaults';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run development seed in production');
  }

  const currencies = [
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
    { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', decimals: 0 },
    { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
    { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 },
    { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimals: 0 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c, create: c });
  }

  const categories = [
    ['Electronics', 'electronics'],
    ['Fashion', 'fashion'],
    ['Home & Living', 'home-living'],
    ['Beauty & Health', 'beauty-health'],
    ['Sports & Outdoors', 'sports-outdoors'],
    ['Baby & Kids', 'baby-kids'],
  ];
  for (const [i, [name, slug]] of categories.entries()) {
    await prisma.category.upsert({
      where: { slug },
      update: { name, sortOrder: i },
      create: { name, slug, sortOrder: i },
    });
  }

  // Default page text. Existing pages are only replaced while they still contain the old placeholder,
  // so edits made by admins are never overwritten.
  for (const [slug, page] of Object.entries(CONTENT_DEFAULTS)) {
    const existing = await prisma.contentPage.findUnique({ where: { slug } });
    if (!existing) await prisma.contentPage.create({ data: { slug, ...page } });
    else if (existing.body.includes(PLACEHOLDER_MARKER)) await prisma.contentPage.update({ where: { slug }, data: page });
  }

  const settings: Record<string, unknown> = {
    default_currency: 'RWF',
    base_currency: 'CNY',
    service_fee_pct: null, // set by admin; checkout refuses to price orders until configured
    supported_destinations: ['RW'],
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as any },
    });
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        profile: { create: { fullName: 'Vella Admin (dev seed)', country: 'RW' } },
      },
    });
    console.log(`Seeded admin: ${email}`);
  }

  console.log('Seed complete (development data only).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
