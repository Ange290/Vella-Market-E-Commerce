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
| 2 | Auth + OTP (register, verify, login, refresh rotation, reset, RBAC) | **done** (28 e2e tests) |
| 3 | Catalogue (products, categories, variants, search/filter/sort/paginate, reviews, wishlist) | **done** (backend API, 48 e2e tests total) |
| 4 | Pricing config + cart + checkout | **done** (64 e2e tests total) |
| 5 | Orders + timeline | **done** (82 e2e tests total) |
| 6 | Payments (Flutterwave sandbox, webhook, refunds) | **done** (111 e2e tests total) |
| 7 | Shipping + tracking | **done** |
| 8 | Sourcing requests + quotations | **done** |
| 9 | Admin dashboard (API + UI) | **done** (backend API) |
| 10 | Customer UI pages for every module | in progress. Done: foundation, auth, storefront, cart, checkout, payment return, orders, tracking. Next: account pages, sourcing, static pages, admin UI |
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

## Pricing formula (checkout quote and, in module 5, order creation)

All amounts are in the charge currency, rounded half-up to that currency's decimals. Prices are held in CNY and converted once.

```
unit        = round(unitPriceCny × rate)            (variant price = base + priceDeltaCny)
subtotal    = Σ unit × quantity
shipping    = round( (baseFee + perKgFee × weightKg) → charge currency )   (rate band chosen by cart weight)
serviceFee  = round(subtotal × service_fee_pct / 100)
discount    = coupon on subtotal (never more than subtotal)
tax(rule)   = round((subtotal + shipping + serviceFee − discount) × ratePct / 100)   per active TaxRule of the destination country
total       = subtotal + shipping + serviceFee + Σ tax − discount
```

Quotes return HTTP 422 with a stable `code` when configuration is missing:
`CURRENCY_UNAVAILABLE`, `SERVICE_FEE_NOT_CONFIGURED`, `NO_SHIPPING_RATE`, `SHIPPING_RATE_CURRENCY_UNAVAILABLE`,
`PRODUCT_WEIGHT_MISSING`, `DESTINATION_NOT_SUPPORTED`. Stock/coupon problems are returned as `issues` (`canCheckout:false`).

Admin setup order before the first order can be priced: currencies → exchange rates → `service_fee_pct` → shipping rates → tax rules.

## Order lifecycle

```
AWAITING_PAYMENT ──(payment verified, system)──▶ PAID ─▶ PROCESSING ─▶ PURCHASED_FROM_SUPPLIER ─▶ SHIPPED_FROM_CHINA
      │                                                                        ─▶ ARRIVED_AT_DESTINATION_COUNTRY ─▶ OUT_FOR_DELIVERY ─▶ DELIVERED
      └─▶ CANCELLED (customer or admin; restocks stock + releases coupon)           any paid state ─(refund, system)─▶ REFUNDED
```
- Admin/staff transitions: `ADMIN_TRANSITIONS` in `orders.service.ts`. PAID/REFUNDED are system-only (`system: true`), reserved for the payments module.
- Customers can cancel only before payment. Paid orders are cancelled via the refund flow.
- Order creation locks the cart row, re-validates it against the priced snapshot, decrements stock with an atomic `stock >= qty` update, and redeems the coupon with a guarded `UPDATE`, all in one transaction.
- Order numbers (`VM-YYYYMMDD-XXXXXX`) are random, not sequential.

## Payments

`PaymentsService` talks only to the `PaymentGateway` interface (`src/payments/gateway.ts`). `PAYMENT_PROVIDER` selects the implementation:

| Value | Behaviour |
|---|---|
| `disabled` (default) | Payment endpoints answer 503 `PAYMENTS_DISABLED`; nothing is faked. |
| `flutterwave` | Real Flutterwave v3 (`flutterwave.gateway.ts`). Needs `FLUTTERWAVE_SECRET_KEY` + `FLUTTERWAVE_WEBHOOK_SECRET_HASH`. Unit-tested with mocked HTTP; **not yet run against the live sandbox** — do that first when keys are available. |
| `mock` | Development simulator. Refused when `NODE_ENV=production`. Stays "pending" until you call `POST /api/v1/dev/payments/:reference/simulate {outcome}`, which then delivers a signed webhook through the real handler. |

Flow: `POST /orders/:id/payments {method}` → provider checkout link → customer pays → webhook **and/or** `GET /payments/:reference/status` → `settle()`:
1. the webhook signature (`verif-hash`) is checked in constant time; the event is stored once in `WebhookEvent` (replays are acknowledged and ignored);
2. the body is only a hint — `settle()` asks the provider's API for the truth;
3. amount and currency must exactly equal the order's; otherwise the payment is FAILED `AMOUNT_OR_CURRENCY_MISMATCH` and the order stays unpaid;
4. only then is the payment marked SUCCESSFUL (guarded update + DB unique index: one successful payment per order) and the order moved to PAID.

Duplicate protection: one live payment per order and method (reused for 30 min), `Idempotency-Key` header, row lock during initiation. A second successful payment (e.g. an older checkout link) or money arriving for a cancelled order becomes a `REQUESTED` refund for admins. Refunds: `POST /admin/payments/:id/refunds` (ADMIN), partial or full; a fully refunded payment moves the order to REFUNDED.

Go-live checklist: set real keys, `PAYMENT_PROVIDER=flutterwave`, register `https://<api-host>/api/v1/payments/webhooks/flutterwave` and the same secret hash in the Flutterwave dashboard, run a sandbox payment per method (MTN, Airtel, card), confirm refunds.

## Shipping & tracking

Admins create shipments for paid orders that are in PROCESSING or later and append tracking events
(`PENDING → IN_TRANSIT/CUSTOMS → ARRIVED → OUT_FOR_DELIVERY → DELIVERED`, `EXCEPTION` at any time; events cannot go backwards).
The order follows its shipments: it reaches a stage only when **every** shipment has, stepping through each intermediate status so the
customer timeline has no gaps. An open `EXCEPTION` holds the order back. Orders already further along (manual updates) are never moved backwards.
Internal costs are not exposed to customers.

## Sourcing requests & quotations

```
customer: POST /product-requests (link and/or photo)   →  SUBMITTED
admin:    PATCH …/product-requests/:id {UNDER_REVIEW | REJECTED+reason, assignedToId}
admin:    POST  …/product-requests/:id/quotations  (total computed on the server; send=true publishes)  →  request QUOTED
customer: POST /quotations/:id/accept {addressId}   →  Order(AWAITING_PAYMENT, quotationId)  →  normal payment flow
          POST /quotations/:id/reject               →  request back to UNDER_REVIEW for a new offer
```
Quotations are valid for at most 60 days; accepting is an atomic claim (only one acceptance can win) and refuses expired offers.
A new sent quotation withdraws the previous live one. Customers have at most 10 open requests.

## Admin & content API

| Area | Endpoints | Access |
|---|---|---|
| Dashboard | `GET /admin/dashboard/summary`, `/charts?days=` | ADMIN + STAFF; **revenue/money is ADMIN-only**, reported per currency (gross, refunded, net) |
| Customers | `GET /admin/customers[/:id]`, `PATCH /admin/customers/:id/status`, `GET …/spend` | list/detail ADMIN+STAFF; suspend & spend ADMIN (suspending revokes all sessions) |
| Staff | `GET/POST /admin/staff`, `PATCH /admin/users/:id/role` (STAFF↔CUSTOMER), `PATCH /admin/staff/:id/status` | ADMIN. ADMIN accounts cannot be created or changed via the API |
| Content | public `GET /content[/:slug]`; admin `GET/PUT/DELETE /admin/content/:slug` | edit ADMIN+STAFF, delete ADMIN. Bodies are inert text/Markdown — **never render as raw HTML** |
| Promotions | public `GET /promotions`; admin CRUD `/admin/promotions` | links restricted to internal paths or http(s) |
| Support | public `POST /support` (3/min); admin `GET/PATCH /admin/support` | ADMIN+STAFF |
| Currencies | `GET/POST/PATCH /admin/currencies`, `GET /admin/exchange-rates` (history) | ADMIN writes; decimals immutable |
| Moderation | `GET/PATCH /admin/reviews` | ADMIN+STAFF; ratings recomputed |
| Audit | `GET /admin/audit-logs` | ADMIN |

Backend roadmap complete. Remaining: customer & admin frontend, Dockerfiles / deployment guide.
