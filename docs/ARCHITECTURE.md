# Vella Market — Architecture & Roadmap

## System overview

```
Browser (React + TS + Tailwind, TanStack Query)
        │  HTTPS, JSON, httpOnly refresh cookie + Bearer access token
        ▼
NestJS REST API  (/api/v1, Swagger at /api/docs in non-production)
  helmet · CORS allow-list · throttler · ValidationPipe (whitelist) · global exception filter
        │ Prisma
        ▼
PostgreSQL 16            External providers (all behind interfaces, configured via env):
                         Email: SMTP/Mailpit (dev) · Resend (prod)
                         SMS:   Twilio
                         Payments: Flutterwave (MTN MoMo, Airtel Money, cards)
```

## Repository layout

```
backend/
  prisma/            schema.prisma, migrations/, seed.ts (DEV data only)
  src/
    config/          zod-validated environment
    prisma/          global PrismaService
    common/          filters, guards, decorators, interceptors
    health/          liveness + DB check
    <module>/        one folder per domain module (controller, service, dto, spec)
  test/              e2e tests
frontend/
  src/
    components/ui, components/layout
    features/<domain>/   api hooks, forms, components per domain
    pages/  routes/  lib/  hooks/  types/
docs/
docker-compose.yml   PostgreSQL (host port 5433) + Mailpit (SMTP 1025, UI 8025)
```

Planned backend modules: `auth`, `users`, `catalog` (products, categories, suppliers), `cart`, `wishlist`,
`pricing` (currency, exchange rates, shipping rates, taxes), `checkout`, `orders`, `payments`, `shipments`,
`sourcing` (requests + quotations), `reviews`, `notifications`, `support`, `content`, `admin`, `audit`.

## Key design decisions

| Concern | Decision |
|---|---|
| Money | `Decimal(14,2)` everywhere; computed with decimal arithmetic, never floats. Base price in CNY; orders snapshot currency + exchange rate. |
| Shipping/FX | No hard-coded values. `ShippingRate`, `ExchangeRate`, `TaxRule`, and the service-fee setting are admin-managed. Checkout refuses to price an order when no rate is configured. |
| RBAC | `Role` enum (CUSTOMER / ADMIN / STAFF) on `User`; enforced by JWT guard + roles guard on every admin route. |
| Passwords | Argon2id. |
| OTP | 6 digits from CSPRNG, stored as HMAC-SHA256 (server secret); 5 min TTL, max attempts, resend cooldown + cap, one active OTP per target/purpose (DB partial unique index), never logged or returned. |
| Sessions | Short-lived JWT access token + rotating refresh token (hashed in DB, grouped by `familyId`; reuse of a rotated token revokes the family). |
| Payments | Provider-agnostic interface; Flutterwave first. Payment rows are created before redirect; webhook signature verified, events stored in `WebhookEvent` for idempotency; server-side verification with provider before marking paid; DB partial unique index permits only one SUCCESSFUL payment per order. No card data stored. |
| Orders | `OrderStatusHistory` is the customer-visible timeline; address and prices are snapshotted on the order. |
| Auditing | `AuditLog` for admin/staff mutations and security events. |

## Database

See `backend/prisma/schema.prisma` (36 models). Migrations:
1. `init` – full schema.
2. `integrity_constraints` – CHECK constraints (rating 1–5, positive quantities, non-negative money/stock) and partial unique indexes (cart items without variant, one default address, one active OTP, one successful payment per order).

## Roadmap

| # | Module | Status |
|---|---|---|
| 1 | Environment, DB schema, migrations, app shell | **done** |
| 2 | Auth + OTP (register, verify, login, refresh rotation, reset, RBAC) | next |
| 3 | Catalogue (products, categories, variants, search/filter/sort/paginate, reviews, wishlist) | |
| 4 | Pricing config + cart + checkout | |
| 5 | Orders + timeline | |
| 6 | Payments (Flutterwave sandbox, webhook, refunds) | |
| 7 | Shipping + tracking | |
| 8 | Sourcing requests + quotations | |
| 9 | Admin dashboard (API + UI) | |
| 10 | Customer UI pages for every module | |
| 11 | Tests, Swagger completeness, Dockerfiles, deployment guide | |

## Local development

```
docker compose up -d                 # PostgreSQL :5433, Mailpit UI :8025
cd backend && cp .env.example .env   # then set secrets
npm install && npx prisma migrate dev && npx prisma db seed
npm run start:dev                    # http://localhost:4000/api/v1/health, /api/docs
cd ../frontend && npm install && npm run dev   # http://localhost:5173
```

Note: host port 5433 is used because a native PostgreSQL service already occupied 5432 on the development machine.
