# V2 Phase 2e — Subdomain Routing & Per-Tenant Pricing

**Status:** Draft (2026-04-26)
**Predecessors:** Phase 2d (PRs #7, #8, #9 merged 2026-04-26).
**Successor:** Phase 2f — Vendor port (brochure generator + vendor reports).

## Context

Phase 2d closed the operational maturity gap (USD invariant, packages.syncCatalog, Bull Board, partial refunds, TurInvoice payment-method picker). Phase 2e is the **infrastructure layer for tenant-scoped vendor work**: per-tenant subdomain routing and per-tenant pricing. Phase 2f will port the V1 brochure generator and vendor reports on top of this layer.

Two PRs, no runtime dependency between them:
- **PR-A — Subdomain Infrastructure**: edge-resolved tenant binding by host header.
- **PR-B — Per-Tenant Pricing**: hybrid model (default markup + optional absolute override).

## Goals

- Each tenant occupies its own subdomain under `*.v2.datapatch.net`. Cookie scope is per-subdomain (NextAuth host-only default), giving tenant isolation at the HTTP level.
- Each tenant controls its own pricing via a default markup percentage (basis points) plus optional per-package absolute overrides; USD-only invariant from Phase 2d holds.
- Webhook URLs do not change. Provider (Paddle / Resend / Airalo / TurInvoice) re-config is zero.
- Phase 2f vendor work has a clean foundation: vendor brochure QR codes will encode tenant subdomain URLs, vendor commission base will read effective tenant prices.

## Non-goals

- Apex (`datapatch.net`) migration. Stays on `v2.datapatch.net` namespace.
- Custom tenant domains (`buy.acme.com`). Deferred to Phase 2g+.
- Multi-currency (FX). USD-only invariant retained.
- Cross-tenant impersonation / "view as tenant" UX for super-admin. Deferred.
- Vendor data model, brochure generator, vendor reports. Phase 2f.
- Region-tiered or duration-bucketed pricing. Deferred.

---

## PR-A — Subdomain Infrastructure

### Domain map

| Host | Audience | Notes |
|-|-|-|
| `www.v2.datapatch.net` | marketing / landing | Reserved subdomain. |
| `<slug>.v2.datapatch.net/` | B2C buyer storefront | Tenant-scoped catalog + checkout. |
| `<slug>.v2.datapatch.net/admin` | agency_admin | Login + tenant management. |
| `admin.v2.datapatch.net` | super_admin | Platform-wide admin. Reserved. |
| `v2.datapatch.net/api/webhooks/*` | providers | Webhook URLs remain on apex of v2 namespace; tenant resolved from payload (already implemented in Phase 2c/2d). |

### Schema

No schema changes. `Tenant.slug` (already `@unique`) doubles as the subdomain identifier.

**Slug constraint tightening (data migration):**

- DNS-safe regex enforced at create/update: `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$` (3–30 chars, lowercase alphanumeric + hyphen, no leading/trailing hyphen).
- Reserved denylist: `www`, `admin`, `app`, `api`, `mail`, `webhook`, `static`, `cdn`, `assets`, `auth`, `support`, `status`, `help`, `docs`, `blog`.
- Migration scans existing tenants. Any conflicting slug is renamed (suffix `-1`, `-2`, …) with audit log + super-admin notification. Defensive only; existing seed slugs (`alpha`, `beta`) are clean.

### Tenant resolution (Next.js edge middleware)

`middleware.ts` extends current next-intl matcher:

1. Extract `host` header. Strip port for local dev.
2. Compute subdomain by removing `.v2.datapatch.net` (or `.localhost` for dev). Empty subdomain → apex behavior.
3. Branch:
   - Reserved (`www`) → marketing route.
   - `admin` → super_admin scope; set `x-platform-context: super-admin` request header.
   - Apex `v2.datapatch.net` (no subdomain) → webhook routes pass through; everything else → 404 or redirect to `www`.
   - Otherwise → tenant lookup by slug.
4. Tenant lookup uses an edge-friendly cache (in-memory LRU on the Node runtime; revalidated every 60s or on `tenant.created`/`tenant.updated` event). Edge cannot hit Prisma directly — middleware runs Node runtime (`export const runtime = 'nodejs'`) with a thin DB proxy (`getTenantBySlug`).
5. Unknown subdomain → render branded 404 with link to `www.v2.datapatch.net`.
6. Resolved tenant → set `x-tenant-id` and `x-tenant-slug` request headers; downstream `runInTenant({ tenantId, tenantSlug }, ...)` ALS hooks read from these headers in route handlers / server actions.

### NextAuth integration

- `session: { strategy: 'jwt' }` retained.
- `cookies.sessionToken.options.domain` **not set** → host-only cookies. Cookie on `acme.v2.datapatch.net` is invisible to `beta.v2.datapatch.net` and `admin.v2.datapatch.net`.
- `trustHost: true` enabled in `auth.config.ts`.
- `auth.ts` request URL derivation: NextAuth v5 derives base URL from request automatically when `trustHost` is on; `NEXTAUTH_URL` env var becomes optional and is removed from `env.ts`.
- Magic link callback URL (`magicLinkEmail.ts`) reads request host at send time; magic links delivered to a tenant subdomain return to that subdomain.
- `admin.v2.datapatch.net` is a separate cookie scope; super-admin must log in there explicitly.
- RBAC binding: `requireAgencyRole` validates tenant cookie against `x-tenant-id` header. An agency_admin who carries a session for tenant A but lands on tenant B's subdomain receives 401.

### URL construction

`env.PUBLIC_APP_URL` is replaced by:

- `env.PLATFORM_BASE_URL` — fixed `https://v2.datapatch.net`. Used for webhook callbacks, super-admin URLs, magic links sent from platform context.
- `tenantBaseUrl(tenant)` helper — `https://${tenant.slug}.v2.datapatch.net`. Used for booking success/cancel URLs, tenant magic links, vendor brochure QR codes (Phase 2f).

Affected call sites:
- `src/server/domain/orders/createBooking.ts:194-195` — `successUrl`/`cancelUrl` → `tenantBaseUrl(input.tenant)`.
- `app/[locale]/(customer)/shop/orders/[orderId]/selectPaymentProvider.action.ts:104-105` — same.
- `src/server/providers/payment/turinvoice/createCheckout.ts:39` — `callbackUrl` stays on `PLATFORM_BASE_URL` (webhook).
- `src/server/auth/magicLinkEmail.ts` — context-dependent: tenant URL when sent from tenant scope, platform URL when sent from super-admin scope.

Tests setting `PUBLIC_APP_URL` (`tests/setup.ts:28`, `src/lib/env.test.ts:22`, `src/server/providers/payment/turinvoice/turinvoice.test.ts:12`) migrate to `PLATFORM_BASE_URL`.

### Local development

- `*.localhost:3000` works in Chrome / Firefox / Safari / Edge without `/etc/hosts` modifications.
- Seed updated: `alpha.localhost:3000`, `beta.localhost:3000`, `admin.localhost:3000` for super-admin.
- README dev section updated with subdomain examples.

### Production deployment (Railway)

- Custom domain on Railway: `*.v2.datapatch.net` wildcard.
- DNS (Cloudflare): `CNAME *.v2 → cname.up.railway.app` (or per Railway's wildcard onboarding flow).
- TLS: Railway-provisioned wildcard cert via Let's Encrypt, or Cloudflare proxy with flexible TLS termination at edge.
- New tenant creation triggers no DNS work — wildcard handles every slug automatically.
- Existing `v2.datapatch.net` apex host stays bound for webhook ingress.

### Migration plan

- All existing magic links / shared URLs currently point at `https://v2.datapatch.net/...` with no tenant prefix. To prevent breakage during cutover, add a 30-day fallback: requests to apex `v2.datapatch.net` carrying `?t=<slug>` or a tenant cookie redirect to `https://<slug>.v2.datapatch.net/...`. Removed in a follow-up clean-up PR after Phase 2e ships.
- Webhook URLs (`v2.datapatch.net/api/webhooks/*`) remain unchanged — providers untouched.

### Test strategy

- **Unit:** subdomain extraction (host string → slug), reserved denylist, slug regex, edge tenant cache TTL.
- **Integration:** middleware → tenant resolver → request context. Existing `runInTenant` repository tests extended with subdomain-driven entry path.
- **E2E (Playwright):** `alpha.localhost:3000` and `beta.localhost:3000` behave as separate tenants — login on one is invalid on the other; cross-subdomain cookie sniff returns 401; super-admin at `admin.localhost:3000` is isolated from tenant subdomains.

---

## PR-B — Per-Tenant Pricing

### Pricing model

Hybrid:

- Each tenant has a `defaultMarkupBps` (basis points; `2500` = 25%).
- Optional per-package absolute override stored in `TenantPackagePrice`.
- Effective price resolution:
  1. If override exists for `(tenantId, packageId)` → use override `priceAmount`/`priceCurrency`.
  2. Else → `unit.amount = pkg.priceAmount * (10000 + tenant.defaultMarkupBps) / 10000` (BigInt floor division). `unit.currency = pkg.priceCurrency`.
- USD-only invariant (Phase 2d) enforced at every output: `assertUsdMoney(unit)` on the `calculatePrice` return path and on every `TenantPackagePrice` write endpoint.

### Schema

**`Tenant`:** add `defaultMarkupBps Int @default(0)` (additive migration; default 0 lets the migration succeed without a backfill, but new-tenant create-form requires an explicit value).

**New table `TenantPackagePrice` (`@@map("tenant_package_prices")`):**

```prisma
model TenantPackagePrice {
  id            String           @id @default(cuid())
  tenantId      String
  packageId     String
  priceAmount   BigInt
  priceCurrency String
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  tenant        Tenant           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  package       ProviderPackage  @relation(fields: [packageId], references: [id], onDelete: Cascade)

  @@unique([tenantId, packageId])
  @@index([tenantId])
  @@map("tenant_package_prices")
}
```

### `calculatePrice` API change

Current signature:
```ts
calculatePrice({ packageId, quantity }) → PriceQuote
```

New signature:
```ts
calculatePrice({ tenantId, packageId, quantity }) → PriceQuote
```

`tenantId` is required. Callers either pass it explicitly or resolve from `getCurrentTenant()` ALS context.

Algorithm:
1. Fetch `ProviderPackage` (existing).
2. Lookup `TenantPackagePrice` by `(tenantId, packageId)`.
3. If override → `unit = override.priceAmount/Currency`.
4. Else → fetch `Tenant.defaultMarkupBps`, compute `unit.amount = pkg.priceAmount * (10000 + markupBps) / 10000n` (BigInt math; floor).
5. `assertUsdMoney(unit)`.
6. `total = multiply(unit, quantity)`.

### Affected call sites

- `src/server/domain/orders/createBooking.ts` — `calculatePrice` call passes `tenantId` from context.
- `src/server/domain/orders/createBooking.test.ts` — fixtures supply `tenantId`.
- B2C catalog page (`app/[locale]/(customer)/shop/page.tsx` or equivalent) — list query maps each package through `calculatePrice(tenantId, ...)`. Performance: a single `tenantPackagePrice.findMany({ where: { tenantId } })` lookup pre-loads overrides into a `Map`, then iterate packages.
- `OrderItem.unitPriceAmount` snapshot semantics retained (`PriceLock`); historic orders are unaffected.

### B2C catalog behavior

- `defaultMarkupBps = 0` AND no overrides → packages display at upstream cost. Tenant accepts the warning at config time (see "Agency_admin UI"). No B2C banner — selling at cost is a deliberate (mis)configuration, not an error state.
- Override active → that package shows override price; clearing the override reverts to markup formula on the next request.
- ProviderPackage soft-delete (Phase 2d whitelist) → not in catalog (existing behavior).

### Agency_admin UI: `/admin/pricing`

Single page under `<slug>.v2.datapatch.net/admin/pricing`, gated by `requireAgencyRole(['agency_admin'])`.

**Top section — Default markup:**
- Numeric input "Default markup (%)" displaying `defaultMarkupBps / 100` with 0.01% step.
- Save → server action: validate, write `Tenant.defaultMarkupBps`, audit log, revalidate.
- Entering `0` triggers an inline confirm dialog: "You are selling at upstream cost. Confirm?"

**Bottom section — Package list:**
- Table, paginated 50/page, search by SKU / name / country code.
- Columns: Package (name + country flag chip), Provider (Airalo / Zendit), Upstream cost (USD), Effective price, Margin %, Action.
- "Effective price" cell shows the resolved price plus an "Override" badge when an override is set.
- "Set override" inline → modal: amount input (USD); submit creates/updates `TenantPackagePrice`.
- "Clear override" inline action where applicable.

**Bulk action:**
- "Clear all overrides" — confirm modal, audit log, single transactional delete.
- (Deferred to Phase 2f/2g: CSV import/export, region-bulk markup.)

### Audit log entries

- `tenant.markup_bps_changed` — `{ from, to }`
- `tenant.package_price_override_set` — `{ packageId, priceAmount }`
- `tenant.package_price_override_cleared` — `{ packageId }`
- `tenant.all_overrides_cleared` — `{ count }`

### Migration

1. Additive `Tenant.defaultMarkupBps Int @default(0)`.
2. Create `tenant_package_prices` table.
3. No data backfill. New-tenant create form (super-admin) requires `defaultMarkupBps`. Existing tenants begin at `0` (cost) until super-admin or agency_admin sets a value — production tenants at this stage are test data only, so no real revenue impact.
4. Super-admin dashboard surfaces a banner listing tenants whose `defaultMarkupBps = 0` and have no overrides; banner persists until each is configured.

### Test strategy

- **Unit (`calculatePrice`):**
  - override present → returns override.
  - no override + markup `2500` → returns `cost * 1.25`.
  - no override + markup `0` → returns cost.
  - non-USD package → `assertUsdMoney` throws.
  - package not found → throws (existing).
  - quantity invalid → throws (existing).
- **Integration:** tenant A's override does not leak into tenant B's quote (cross-tenant isolation via `runInTenant`).
- **E2E (Playwright):** agency_admin at `alpha.localhost:3000/admin` updates markup → buyer at `alpha.localhost:3000/shop` sees updated price; the same package on `beta.localhost:3000/shop` is unaffected.
- Vitest config keeps `*.test.ts(x?)` matcher (Phase 2d PR-B fix retained).
- Test cleanup respects FK order: `TenantPackagePrice` deleted before `Tenant` / `ProviderPackage` (already handled by Cascade, but explicit in fixture teardown).

### USD-only invariant

`assertUsdMoney` enforced at three new sites:
- `calculatePrice` return path.
- `TenantPackagePrice` create endpoint.
- Override modal server action.

Multi-currency support remains schema-level (Money type with currency code) but blocked at runtime. Lifted in a future Phase 2g+ FX initiative.

---

## Phase tags & rollout

- Tag local: `phase-2e-pr-a-complete`, `phase-2e-pr-b-complete`. Push together as `phase-2e-complete` once both PRs merge.
- Manual smoke after each PR (per user preference): subdomain routing for PR-A; pricing edits for PR-B.
- PR sequencing: PR-A first (foundation), PR-B independently (no PR-A dependency). User may parallelize if isolated worktrees are convenient.
- Rollback safety: PR-A reverts to single-host routing by removing middleware logic and `Tenant` slug constraint tightening (denylist additions are forward-compatible). PR-B reverts via dropping `tenant_package_prices` and removing `defaultMarkupBps` (additive migration; existing data unaffected since `OrderItem.unitPriceAmount` is snapshotted).

## Open questions deferred (not blocking Phase 2e)

- "View as tenant" impersonation flow for super-admin — Phase 2f or later.
- CSV / bulk pricing tools — Phase 2g.
- Custom tenant domain (`buy.acme.com`) provisioning — Phase 2g+.
- Region- or duration-tiered markup — Phase 2g+.
- FX / multi-currency — Phase 2g+ when product opens beyond USD-only.
