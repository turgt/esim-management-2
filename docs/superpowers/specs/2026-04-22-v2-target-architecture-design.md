# eSIM Platform V2 — Target Architecture Design

**Date:** 2026-04-22
**Status:** Approved (brainstorm phase complete)
**Author:** turgt (solo, AI-assisted)
**Scope:** Full rewrite of esim-management-2 as a parallel V2 project. V1 remains untouched until cutover.

---

## 1. Context & Motivation

### Current State (V1)
- Express.js (ES Modules) + EJS + PostgreSQL/Sequelize + Tailwind v4 + Docker
- ~9,235 LOC backend, 28 migrations, 16 Sequelize models, 12 controllers, 14 services
- Multi-role: end-user, admin, agency, vendor (each with dedicated view folder)
- Payment providers: Paddle + TurInvoice + Zendit (legacy)
- eSIM providers: Zendit + Airalo
- Email: Resend (webhook-verified) + SMTP fallback
- 5 cron jobs via `node-cron` (not cluster-safe)
- Only 3 integration test files (auth/profile/admin) — minimal coverage
- Open security debts: CSP unsafe-inline, in-memory rate limiter, Airalo webhook auth not verified

### Why Rewrite
User selected option 6 from the brainstorm — "hepsi bir arada": code quality + product/scale ambitions + stack modernization + security + operations concerns combined. The V1 codebase is considered "close enough to rewrite cost that starting clean wins."

### Constraints
- **Developer profile:** Solo maintainer, primarily writing code via AI agents (Claude Code).
- **Deploy capacity:** Railway, 8GB RAM / 8 vCPU.
- **Users today:** ~20 vendors, low daily volume; low concurrent user count.
- **Growth expectation:** Volume expected to rise; global expansion possible; customer model is B2B+B2C mixed.

### Implications of Solo + AI-Assisted Profile
- TypeScript is mandatory (not optional) — types act as guardrails reducing hallucination.
- Boring/mainstream stack beats novel stack — AI has far more training data for it.
- Small focused files (<300 lines) beat large modules — AI reads one file at a time.
- Convention over configuration — AI struggles with custom DSLs, excels with framework conventions.
- Monorepo with a single deploy beats microservices — AI can see the whole system.
- Managed services beat self-host — reduces operational surface AI can mishandle.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Runtime | Node 20 LTS + TypeScript strict |
| Framework | Next.js 15 (App Router) |
| UI | Tailwind v4 + shadcn/ui (Radix primitives) |
| ORM | Prisma |
| Auth | Auth.js v5 (NextAuth) + Prisma adapter |
| DB | Postgres 16 (Railway-native prod, Docker dev) |
| Cache + queue | Redis 7 (Railway-native prod, Docker dev) |
| Background jobs | BullMQ |
| Storage | Cloudflare R2 (S3-compatible) |
| Email | Resend |
| Payments | Paddle + TurInvoice (behind abstraction) |
| Validation | Zod (end-to-end) |
| Logging | Pino → Better Stack |
| Errors | Sentry |
| Uptime | BetterStack Uptime |
| Testing | Vitest + Playwright |
| Package manager | pnpm |

### Deferred / Phase 2
- OpenTelemetry distributed tracing (egress + setup cost too high for current capacity)
- Subdomain-based tenant resolution (MVP is path-based)
- Agency-branded traveler storefront (MVP agency portal is internal-only)
- Custom per-tenant domains (Phase 3)
- SSO/OIDC for enterprise agencies (Phase 3)
- DE/AR/RU languages (MVP is EN + TR)

---

## 3. Repository Layout

Single Next.js app, route groups separate the three surfaces. No monorepo/turbo — solo + AI does not justify the workspace overhead.

```
esim-platform/
├── app/
│   ├── (marketing)/              # Landing, pricing, about — public
│   ├── (auth)/                   # login, register, forgot, magic-link
│   ├── (customer)/               # B2C traveler portal
│   │   ├── shop/                 # Package browse + checkout
│   │   └── my-esims/             # Post-purchase self-service
│   ├── (agency)/
│   │   └── a/[agencySlug]/       # Agency staff portal (MVP internal-only)
│   ├── (admin)/
│   │   └── admin/                # Platform staff panel
│   ├── api/
│   │   ├── webhooks/             # paddle, turinvoice, airalo, zendit, resend
│   │   ├── public/v1/            # Public API (agency API keys)
│   │   └── health/
│   └── layout.tsx
├── src/
│   ├── lib/                      # Pure utilities (no IO)
│   ├── server/
│   │   ├── db/                   # Prisma client, transaction helpers, scoped-prisma
│   │   ├── auth/                 # Auth.js config, RBAC helpers, session
│   │   ├── tenancy/              # Tenant resolution middleware, AsyncLocalStorage ctx
│   │   ├── providers/
│   │   │   ├── payment/          # Paddle, TurInvoice impls + interface
│   │   │   └── esim/             # Airalo, Zendit impls + interface
│   │   ├── domain/
│   │   │   ├── booking/          # Order creation, state machine
│   │   │   ├── payment/          # Payment state transitions
│   │   │   ├── esim/             # Provisioning, status sync
│   │   │   └── pricing/          # Server-side price authority + lock
│   │   ├── jobs/                 # BullMQ workers + scheduled jobs
│   │   ├── webhooks/             # Ingest pipeline, processor, replay
│   │   └── outbox/               # Side-effect queue
│   ├── ui/                       # shadcn components + app-specific
│   └── features/                 # Optional feature-scoped (colocated UI+server)
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── messages/                     # next-intl translation files
│   ├── en.json
│   └── tr.json
├── tests/                        # Vitest (unit + integration)
├── e2e/                          # Playwright
├── scripts/
│   └── migrate-from-v1.ts        # One-shot data migration
├── Dockerfile                    # Node 20, Next standalone build
├── docker-compose.yml            # app + postgres + redis + mailpit
└── package.json
```

**File size target:** <300 lines. Critical for AI-assisted development quality.

---

## 4. Multi-Tenancy & Auth

### 4.1 Tenancy Model
Shared DB + `tenantId` discriminator column (row-level scoping).
- Every tenant-scoped table: `tenantId UUID NOT NULL REFERENCES tenants(id)` + composite index on `(tenantId, ...)` for hot paths.
- Platform-level tables (`tenants`, `users`, `audit_logs`) are tenant-less.
- Schema-per-tenant and DB-per-tenant explicitly rejected — migration cost too high for 20–1000 tenant scale.

### 4.2 Tenant Resolution
| Phase | Strategy | Example |
|---|---|---|
| **MVP** | Path-based | `/a/[agencySlug]/dashboard` |
| **Phase 2** | Subdomain | `acme.datapatch.app` |
| **Phase 3** | Custom domain | `shop.acme-travel.com` |

Resolution happens in `middleware.ts` → stored in `AsyncLocalStorage` → consumed by all server code.

### 4.3 Surfaces
```
datapatch.net/                    → Marketing + house B2C shop
datapatch.net/shop                → B2C traveler checkout (no tenant)
datapatch.net/a/[agencySlug]      → Agency staff portal (MVP)
datapatch.net/admin               → Internal staff panel
acme.datapatch.net                → (Phase 2) Agency-branded traveler shop
```

**MVP scope:** Agency portal is internal-only — agency staff creates bookings on behalf of travelers. Agency-branded public storefront (white-label) deferred to Phase 2.

### 4.4 Roles (extensible)
```ts
type Role =
  | 'customer'          // B2C traveler
  | 'agency_staff'      // Agency portal user (basic)
  | 'agency_admin'      // Manage team, settings, billing
  | 'platform_staff'    // Internal support
  | 'platform_admin';   // Sysadmin
```

- Role → permissions mapping centralized in config, NOT hardcoded in business logic. Adding a new role is a config change.
- Users ↔ tenants are many-to-many via `UserTenantMembership(userId, tenantId, role)`.

### 4.5 Data Scoping Strategy
1. **App-level (primary):** `getScopedPrisma(tenantId)` helper adds `where: { tenantId }` automatically. Direct `prisma.<model>.findMany()` is blocked by a custom ESLint rule.
2. **DB-level:** `tenantId` NOT NULL FK — impossible to persist orphaned rows.
3. **Postgres RLS (Phase 2):** Defense-in-depth. MVP skip — Prisma RLS setup complexity not worth it for solo.

### 4.6 Auth
- Email + password (bcrypt) + magic link (via Resend) — MVP primary.
- Google OAuth: Phase 2 (B2C only).
- SSO/OIDC: Phase 3 (enterprise agencies).
- Session: DB sessions via Auth.js Prisma adapter. No Redis session store needed at current scale.
- 2FA (TOTP): Phase 2, mandatory for `agency_admin` + `platform_*`.
- `mustChangePassword` bootstrap flag preserved.
- Session regeneration on login: built-in to Auth.js.

### 4.7 Agency API Keys
- Format: `ak_live_<24char>` / `ak_test_<24char>`.
- Storage: hashed only (plaintext returned once at creation).
- Per-key scopes (`bookings:read`, `bookings:write`, `esims:read`).
- Per-key rate limit (`@upstash/ratelimit` library, works with any Redis — backed by Railway Redis in prod).
- Last-used tracking (async, batched).

---

## 5. Domain Layer

The single most important architectural improvement over V1.

### 5.1 PaymentProvider (strategy pattern)
```ts
interface PaymentProvider {
  id: PaymentProviderId;
  createCheckout(order: Order, ctx: TenantContext): Promise<CheckoutSession>;
  capturePayment(paymentId: string): Promise<PaymentResult>;
  cancelPayment(paymentId: string): Promise<void>;
  refundPayment(paymentId: string, amount?: Money): Promise<RefundResult>;
  verifyWebhook(req: Request): Promise<NormalizedPaymentEvent>;
}
```
- One impl per file in `src/server/providers/payment/`.
- Tenant config specifies enabled providers + ordering.
- Domain code sees only `PaymentProvider` — never provider-specific fields.
- Adding a provider = one new file + registry entry.

### 5.2 EsimProvider
```ts
interface EsimProvider {
  id: EsimProviderId;
  listPackages(filters: PackageFilter): Promise<Package[]>;
  purchase(pkg: Package, traveler: Traveler, ctx: TenantContext): Promise<ProvisionedEsim>;
  getStatus(iccid: string): Promise<EsimStatus>;
  topup(iccid: string, pkg: Package): Promise<TopupResult>;
  cancel(iccid: string): Promise<void>;
  verifyWebhook(req: Request): Promise<NormalizedEsimEvent>;
}
```
- Package catalog cached locally; daily sync job refreshes from upstream.
- Provider selection during booking = domain logic (availability, price, tenant override).
- V1's `airaloPackages` table generalized to `provider_packages(providerId, sku, ...)`.

### 5.3 Webhook Ingestion Pipeline
Replaces V1's direct-to-DB handlers (which silently drop events on DB slowness).

```
POST /api/webhooks/{provider}
  ↓
[1] INSERT raw payload + signature into webhook_events (unique key: provider + externalEventId)
[2] Enqueue eventId to BullMQ "webhooks" queue
[3] Return 200 (<100ms target)

──── async worker ────

[4] Worker pulls event
[5] Verify provider signature
[6] Normalize → DomainEvent (payment.completed, esim.provisioned, ...)
[7] Apply to aggregate (Order, Esim, ...)
[8] Mark webhook_events.status = 'processed'
[9] Push side-effect events to outbox

──── retry ────
Fail → exponential backoff (1m, 5m, 30m, 2h, 12h) → 5 retries → DLQ + alert
```

**Benefits:**
- Idempotent via unique `externalEventId`.
- Replayable from admin UI.
- Full observability (every webhook logged, pass + fail).
- No lost events on transient DB/network issues.

**DLQ:** Admin UI shows events exceeding max retries with manual replay/ignore/fix.

### 5.4 Outbox Pattern (outbound side effects)
Prevents "DB committed but email never sent" and "email sent twice" inconsistencies.

```ts
await prisma.$transaction(async (tx) => {
  await tx.order.update({ where: { id }, data: { status: 'paid' } });
  await tx.outbox.create({
    data: {
      tenantId,
      kind: 'email.send',
      payload: { template: 'order_confirmation', to, orderId },
      status: 'pending',
    },
  });
});
// Dedicated worker drains outbox → calls Resend → marks sent / retries on failure
```

Use cases: confirmation emails, admin notifications, post-payment provisioning calls, audit log shipping, analytics events.

### 5.5 Order State Machine (explicit)
```
draft → awaiting_payment → paid → provisioning → provisioned → active → expired
              ↓                ↓         ↓
          cancelled        refunded   failed (→ refund path)
```

- Transitions implemented as pure functions: `orderMachine.transition(order, event) → Order | Error`.
- Invalid transitions throw; guard clauses enforce preconditions.
- Each transition writes to `audit_logs` automatically.

### 5.6 Domain Services Organization
```
src/server/domain/
├── booking/
│   ├── createBooking.ts          # Orchestrates offer→price lock→order→payment init
│   ├── orderMachine.ts
│   └── types.ts
├── payment/
│   ├── processPayment.ts         # Webhook → state transition
│   └── refundPolicy.ts
├── esim/
│   ├── provisionEsim.ts          # Order paid → provider.purchase → persist
│   └── syncStatus.ts
└── pricing/
    ├── calculatePrice.ts         # Server-side price authority
    └── lockPrice.ts              # Lock price at checkout time
```

Pricing is server-side authoritative — client-supplied prices never trusted (V1 security fix propagated structurally).

---

## 6. Cross-Cutting Concerns

### 6.1 i18n + Currency
- `next-intl` (App Router native).
- MVP languages: EN (default), TR. Phase 2: DE, AR, RU.
- Locale URL prefix: `/en/shop`, `/tr/shop`.
- Resolution order: cookie → `user.preferredLanguage` → `Accept-Language` → EN.
- `Money { amount: bigint (minor units), currency: ISO4217 }` — floats forbidden.
- FX rates: daily sync (TCMB + ECB), cached in DB with "as of" timestamp.
- Checkout price lock at time of order creation.

### 6.2 Background Jobs — BullMQ
Replaces V1's in-process `node-cron` (not cluster-safe, no retry, no observability).

**Queues:** `webhooks`, `outbox`, `esim-sync`, `scheduled`, `emails`.

**Scheduled jobs (repeatable):**
| Job | Interval |
|---|---|
| `esim.syncStatuses` | 15 min |
| `packages.syncCatalog` | 6 h |
| `fx.syncRates` | daily |
| `webhook.healthCheck` | 5 min |
| `order.expireStale` | hourly |
| `email.digestAdmin` | daily |

**Dashboard:** Bull Board at `/admin/jobs` — `platform_admin` only.

**Deploy shape:** Next.js app + BullMQ worker in the same Railway service, started as two processes (via `concurrently` or `pm2`). Postgres and Redis run as separate Railway services in the same project, connected via Railway's private network. Fits within the 8GB/8vCPU app budget because DB and Redis each have their own Railway service with independent resources.

### 6.3 Observability
Tuned for 8GB/8vCPU capacity; no distributed tracing at MVP.

| Telemetry | Tool |
|---|---|
| Structured logs | Pino → Better Stack (free 1GB/day) |
| Errors | Sentry (free 5k events/month) |
| Uptime + status page | BetterStack Uptime (free 10 monitors) |
| Queue health | Bull Board in-app |
| Tracing | Request-level `traceId` in Pino logs. Full OpenTelemetry → Axiom deferred to Phase 2. |

**Health endpoint** (`GET /api/health`):
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "providers": { "paddle": "ok", "airalo": "ok" },
  "queues": { "pending": 12, "failed": 0 }
}
```

**Audit log** retained 2 years (GDPR). Filterable admin UI.

### 6.4 Testing Strategy (tiered, not flat 80%)
| Layer | Coverage | Rationale |
|---|---|---|
| Critical paths (payment, webhook, auth, tenant scoping, pricing, state machine) | **90%+ mandatory** | Bugs here = money/data loss |
| Domain services (booking, provisioning, pricing) | 70%+ target | Contract + integration tests dominant |
| Provider adapters (Paddle, TurInvoice, Airalo, Zendit) | Contract tests (record/replay) | Scenario list, not % |
| UI components | Smoke + E2E journey | Unit tests on UI = wasted time |
| **Overall baseline** | **60% floor** | Realistic solo + AI ambition |

- CI ratchet: PR cannot drop coverage below floor.
- Test DB: testcontainers ephemeral Postgres + Redis — fresh schema per suite.
- Vitest + Playwright. Jest not used (ESM-native + faster).

### 6.5 CI/CD
- GitHub Actions: `ci.yml` (lint + typecheck + test + build) on every PR.
- `deploy.yml`: main merge → Railway auto-deploy via GitHub integration.
- Solo dev: PR + self-review + CI green required. No force-push to main.
- Release version: exposed at `/api/version` as git SHA. No semver tags.

### 6.6 Security Posture (day 1)
V1 audit debts resolved structurally in V2:

| Debt | V2 resolution |
|---|---|
| Stored XSS (email HTML) | DOMPurify + iframe sandbox |
| IDOR | App-level tenant scoping + repository pattern |
| Session fixation | Auth.js rotates on login |
| CSP unsafe-inline | Strict CSP with nonces (Next.js built-in) |
| Rate limit (in-memory) | `@upstash/ratelimit` against Railway Redis |
| Webhook auth optional | Mandatory at ingest layer; no env bypass |
| ICCID spoofing | DB-side lookup; client-supplied never trusted |
| Price manipulation | Server-side price authority + lock |
| npm vulns | Renovate auto-PR (weekly) |
| Secrets in .env | Railway variables + Zod schema validation at boot |

**Additional:**
- CSRF: `csrf-csrf` + Auth.js.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax`.
- Password policy: min 12 chars + zxcvbn strength check.
- Login rate limit: per-IP + per-account.
- Admin 2FA (TOTP) mandatory (Phase 2 rollout).
- Pre-launch external pen test / security review.

### 6.7 Developer Experience (solo + AI priority)
- `pnpm dev` → docker compose (pg + redis + mailpit) + Next dev + worker dev. Single command.
- `pnpm test:watch` — Vitest watch.
- `pnpm db:studio` — Prisma Studio.
- `pnpm db:reset` — drop + migrate + seed.
- Seed data: 2 tenants, 3 agency users, 5 B2C users, 10 packages, 3 bookings — fresh every env.
- Storybook: Phase 2.

---

## 7. Phase Plan

Timeline: **10 weeks** (~2.5 months) for solo + AI-assisted.

### Phase 0 — Foundation (1 week)
- Repo `esim-platform-v2`, Next.js 15 + TS strict + ESLint + Prettier.
- Docker compose (app + pg + redis + mailpit).
- Prisma schema skeleton: `tenants`, `users`, `memberships`, `audit_logs`.
- Auth.js + magic link bootstrap.
- Tailwind v4 + shadcn/ui init.
- Vitest + Playwright scaffold.
- GitHub Actions CI.
- Railway staging environment (app + Postgres + Redis services in one Railway project).
- **Exit criterion:** "hello world" deployed; magic-link login works; CI green.

### Phase 1 — Platform Core (2 weeks)
- Tenant model + path-based resolution middleware.
- RBAC + `getScopedPrisma` + ESLint rule blocking raw Prisma on tenant-scoped models.
- Admin panel skeleton (`/admin`) — tenants, users, memberships CRUD.
- Agency portal skeleton (`/a/[slug]`).
- B2C shop skeleton (`/shop`) — package listing (static mock).
- i18n infra (EN + TR).
- Audit log.
- **Exit criterion:** Three surfaces live; multi-tenancy enforced; cross-tenant read proven impossible by test.

### Phase 2 — Domain & Providers (3 weeks)
- Order state machine + pricing service.
- PaymentProvider interface + Paddle + TurInvoice adapters.
- EsimProvider interface + Airalo + Zendit adapters.
- Package catalog sync job.
- Booking flow end-to-end (B2C + agency).
- Webhook ingestion pipeline + BullMQ worker.
- Outbox pattern.
- Email templates (Resend) port.
- **End of Phase 2: deploy v2.datapatch.net staging + first prod data import** (see Phase 5 strategy).
- **Exit criterion:** Test tenant on v2.datapatch.net — Paddle sandbox purchase → QR generation → email delivery works with imported data.

### Phase 3 — Admin & Operations (2 weeks)
- Admin: tenants, users, orders, payments, webhooks, jobs (Bull Board), audit views.
- Agency portal: bookings list + detail, create booking, team mgmt, API keys.
- Brochure generator (port from V1).
- Pricing management.
- Refund / cancel flows.
- Weekly incremental v1→v2 data sync script runs during this phase.
- **Exit criterion:** Support cases resolvable from admin UI; operational "lost customer" scenario tested.

### Phase 4 — Hardening + Real-Data Testing (1 week)
- Security scan (OWASP ZAP, npm audit, Snyk).
- Load test (k6) — 100 concurrent checkouts.
- Backup strategy: Railway Postgres daily automatic backups + weekly `pg_dump` to R2 via Railway cron.
- Runbook: webhook replay, tenant provision, emergency cancel, data export, DR.
- GDPR: privacy policy, data export endpoint, delete-me flow.
- Alert rules: Sentry + BetterStack + queue depth.
- Payment provider live-mode internal test transactions (low value).
- **Exit criterion:** External security review passed; live-mode smoke payment successful.

### Phase 5 — Cutover (1 week)
See Section 8.

**Parallel v1 activity:** V1 bug fixes continue independently throughout all phases — they do not block V2.

---

## 8. Cutover Strategy (Big Bang + Early Staging)

Key insight: user count is still low, so we can do a one-shot cutover. But V2 is exposed as **v2.datapatch.net** from end of Phase 2 so real data testing happens in parallel for 5 weeks before cutover.

### Staging Phase (Phase 2 end, week ~5)
- V2 deployed to Railway, custom domain **v2.datapatch.net** (separate service from v1).
- Initial **prod data import** v1 Postgres snapshot → v2 schema mapping → v2 Railway Postgres.
- Payment providers in sandbox mode.
- Emails routed through Resend test domain + BCC internal; no real customer mail.
- V1 continues serving production. V2 reachable with admin login for iterative testing.

### Iterative Hardening (Phase 3 + 4, weeks 5–8)
- Admin, operations, hardening work happens directly on v2.datapatch.net.
- Weekly incremental sync v1 → v2 so recent bookings appear in V2.
- Internal users (and optionally trusted agency users) preview V2 with real data.
- Payment live-mode activated at end of Phase 4 with small internal test transactions.

### Big Bang Cutover (Phase 5, week ~10)
Pre-cutover: DNS TTL for `datapatch.net` dropped to 60 seconds at least 24h ahead.

| T | Action | Duration |
|---|---|---|
| T-24h | User announcement (email + in-app banner): "~30 min maintenance at X" | — |
| T-0 | V1 switched to read-only (banner + booking disabled) | 2 min |
| T+2m | Final incremental sync v1 → v2 (delta since last sync) | 10 min |
| T+12m | v2.datapatch.net smoke test (test account + sandbox payment) | 5 min |
| T+17m | DNS flip: `datapatch.net` CNAME → V2 Railway service | 1 min |
| T+18m | Verify V2 responds on `datapatch.net`; `v2.datapatch.net` now 301 → `datapatch.net` | 2 min |
| T+20m | Monitor Sentry + BetterStack + smoke test real-user flow | 30 min |
| T+1h | Announce "maintenance complete" | — |

**Post-cutover:**
- V1 kept read-only for 2 weeks (emergency data access).
- After 2 weeks: final Postgres dump → R2 archive → V1 Railway service shut down.

**Rollback plan:**
- Within cutover window: revert DNS (TTL 60s → ~2 min to propagate) → V1 read-only → write re-enabled → export any small V2-created delta to merge.

### Data Migration Mapping
| V1 table | V2 table | Notes |
|---|---|---|
| `users` | `users` + `memberships` | Role determines membership rows |
| `agencies` | `tenants` | Generate tenant slugs |
| `vendors` | tenant config entries | Vendor → provider mapping |
| `esims` | `esims` | Add `tenantId` + provider FK |
| `payments` | `payments` | FK remap |
| `audit_logs` | `audit_logs` (new schema) | Schema translation |
| `emailLogs` | archived only | Not migrated; v2 generates fresh |
| `airaloPackages` | `provider_packages` | Generalized |

Migration script: `scripts/migrate-from-v1.ts` — idempotent, re-runnable, logs every record mapping.

---

## 9. Non-Negotiables (tracked for later)

- Subdomain tenant resolution (Phase 2 after MVP path-based).
- Agency-branded traveler storefront (Phase 2).
- DE / AR / RU language support (Phase 2).
- OpenTelemetry distributed tracing (Phase 2 when capacity permits).
- Custom per-tenant domains (Phase 3).
- SSO / OIDC for enterprise agencies (Phase 3).
- Role system must remain extensible — adding a role is config, not code refactor.
- Storybook for shadcn + app UI (Phase 2).

---

## 10. Success Criteria

V2 is considered production-ready at cutover when:
1. All critical-path tests (payment, webhook, auth, tenant scoping, pricing) pass at 90%+ coverage.
2. External security review has no open CRITICAL or HIGH issues.
3. Load test (100 concurrent checkouts) passes without errors.
4. Data migration script runs cleanly on a prod snapshot twice in a row (idempotency proven).
5. Rollback drill executed successfully at least once on staging.
6. Runbook documented and self-followable.
7. Sentry error rate on v2.datapatch.net < 1/day over the final week of hardening.
