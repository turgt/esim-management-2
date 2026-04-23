# V2 Phase 2c — Providers & Refunds (Design Spec)

**Date:** 2026-04-24
**Project:** `datapatch-v2` (Next.js 15/16 rewrite of `esim-management-2`)
**Repo path:** `/Users/turgt/Desktop/CODES/datapatch-v2`
**Depends on:** Phase 2b (tag `phase-2b-complete`)
**Status:** Design approved — ready for implementation plan

---

## 1. Goal

Bring V2 to production-ready parity on the **payment/eSIM provider** axis and close the operational gap for orders that do not complete happy-path. Specifically:

- Add a second payment provider (**TurInvoice**) alongside Paddle, user-selectable at checkout.
- Add a second eSIM provider (**Zendit**) for **admin-assign only** (V1 parity — no B2C/agency booking flow through Zendit).
- Wire **automated refunds** (Paddle + TurInvoice) replacing the Phase 2b state-only `REFUND_PENDING` stub.
- Add the two **production-critical scheduled jobs** (`esim.syncStatuses`, `order.expireStale`) that cover provider-webhook gaps and stale-cart cleanup.

The rest of the originally-listed Phase 2c scope (Bull Board interactive UI, `packages.syncCatalog`, `fx.syncRates`, `email.digestAdmin`, `webhook.healthCheck`, brochure generator port, vendor reports, partial refunds, early-cancel flow) is deferred to **Phase 2d** so this phase stays reviewable in one plan.

## 2. Scope

### 2.1 In scope
1. **TurInvoice payment adapter** (`PaymentProvider` impl) + webhook handler + refund method.
2. **Zendit eSIM adapter** (`EsimProvider` impl) — admin-assign only, status polling via scheduled job.
3. **Checkout payment provider picker** — Paddle vs TurInvoice radio on order-detail page, visible to all users on all tenants.
4. **Admin "Assign eSIM" flow** — page at `/admin/esims/assign` that picks a Zendit package and creates an eSIM for a user in a tenant.
5. **Paddle refund automation** (`adjustments.create`, full-only) + TurInvoice refund (if V1 exposes one; otherwise graceful Mark-Cancelled fallback).
6. **Admin "Mark Cancelled" button** — `REFUND_PENDING → CANCELLED` transition.
7. **Scheduled jobs:** `esim.syncStatuses` (15 min, state-aware backoff, Airalo + Zendit), `order.expireStale` (hourly, 24 h cutoff).

### 2.2 Out of scope (deferred to Phase 2d)
- Bull Board interactive UI (DLQ replay, retry, ignore)
- Remaining scheduled jobs: `packages.syncCatalog`, `fx.syncRates`, `email.digestAdmin`, `webhook.healthCheck`
- Brochure generator port, vendor reports
- Partial refunds
- Early-cancel flow (`AWAITING_PAYMENT → CANCELLED` UI)
- Tenant-level payment-provider enable/disable config
- V1 → V2 data import script (Phase 4/cutover concern; spec only describes the import *mapping* for Zendit eSIMs)

## 3. User-facing changes

### 3.1 B2C checkout (order detail page)
Order in state `AWAITING_PAYMENT` currently shows a Paddle overlay trigger. After 2c:
- Provider picker renders two radio options: **"International card (Visa/Mastercard) — Paddle"** and **"Turkish card or SBP — TurInvoice"**.
- Paddle branch: unchanged — opens overlay as today.
- TurInvoice branch: redirect to TurInvoice hosted page (full-page, not overlay).
- Return URL: `/{locale}/shop/{tenant}/orders/{orderId}` — shows order state refreshed post-webhook.

### 3.2 Admin order detail
State-dependent action buttons:
| Order state | Buttons |
|---|---|
| `PAID` | **Issue Refund** (confirm dialog) |
| `REFUND_PENDING` | **Retry Refund**, **Mark Cancelled** |
| `REFUNDED`, `CANCELLED`, `EXPIRED` | none (read-only) |

Confirm dialog requires typing the order ID to prevent misclick.

### 3.3 Admin Assign eSIM (new page)
`/admin/esims/assign` — platform_admin only.
Form fields:
- Tenant (select, scoped repo)
- User (select within tenant)
- Provider (fixed: Zendit — single option for now)
- Package (select from `packages.syncCatalog` result, Zendit rows only)

Submit → creates order with `paymentMode = admin_assigned`, bypasses payment, directly calls `zenditProvider.createEsim`, order transitions through `PROVISIONING → PROVISIONED`, `orderConfirmation` + `provisioningComplete` emails queue.

## 4. Architecture

### 4.1 New files
```
prisma/migrations/<ts>_phase_2c_providers/migration.sql
src/server/providers/payment/
  turinvoice.ts              # TurInvoiceProvider implements PaymentProvider
  paddle.ts                  # + refund() method added (existing file)
  index.ts                   # resolvePaymentProvider(name): PaymentProvider
src/server/providers/esim/
  zendit.ts                  # ZenditProvider implements EsimProvider
  index.ts                   # resolveEsimProvider(name): EsimProvider
src/server/webhooks/handlers/
  turinvoice.ts              # callback → order state transitions
src/server/jobs/scheduled/
  esim-sync-statuses.ts
  order-expire-stale.ts
src/server/jobs/register-schedules.ts   # called from scripts/worker.ts
src/server/domain/refund.ts             # issueRefund(orderId, adminUserId)
src/server/domain/orderAssign.ts        # createAdminAssignedOrder(...)
src/emails/orderRefunded.tsx            # React Email template
src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_components/
  PaymentProviderPicker.tsx
src/app/admin/esims/assign/
  page.tsx
  _actions/assign.ts
src/app/admin/orders/[orderId]/_actions/
  refund.ts                  # server action: issueRefund
  markCancelled.ts           # server action
tests/unit/providers/turinvoice.test.ts
tests/unit/providers/zendit.test.ts
tests/unit/domain/refund.test.ts
tests/unit/domain/shouldSyncNow.test.ts
tests/integration/webhooks/turinvoice.test.ts
tests/integration/jobs/order-expire-stale.test.ts
tests/integration/jobs/esim-sync-statuses.test.ts
tests/e2e/payment-provider-picker.spec.ts
tests/e2e/admin-refund.spec.ts
tests/e2e/admin-assign-zendit.spec.ts
```

### 4.2 Changed files
- `prisma/schema.prisma` — enum extensions, new columns (§5).
- `src/server/domain/orderStateMachine.ts` — add `REFUND_PENDING → CANCELLED` transition.
- `src/server/domain/booking.ts` — `createOrder` accepts `paymentProvider: 'paddle' | 'turinvoice'`.
- `scripts/worker.ts` — call `registerSchedules()` on startup.
- `src/server/env.ts` — Zod schema additions: `TURINVOICE_API_KEY`, `TURINVOICE_API_BASE`, `TURINVOICE_CALLBACK_SECRET`, `ZENDIT_API_KEY`, `ZENDIT_API_BASE` (all required, non-empty).
- `Dockerfile` — builder-stage dummy values for the new env vars (Phase 0 gotcha #6).
- `docker-compose.yml` (dev) — new env entries wired to local `.env` values.
- `eslint.config.mjs` — no changes expected (no new tenant-scoped models).

## 5. Data model changes

Single migration: `<timestamp>_phase_2c_providers`.

```prisma
// Enum extensions
enum PaymentProvider {
  paddle
  turinvoice
}

enum EsimProvider {
  airalo
  zendit
}

enum PaymentMode {
  b2c
  agency_booking
  admin_assigned   // NEW
}

model Order {
  // existing fields...
  paymentProvider PaymentProvider?   // NEW — set when checkout starts; null before selection
}

model Esim {
  // existing fields...
  lastStatusSyncAt DateTime?         // NEW — state-aware backoff decision input
}
```

No tenant-scoped model additions → ESLint `no-restricted-syntax` selector unchanged.

## 6. TurInvoice adapter

### 6.1 Source
Port from V1 `/Users/turgt/Desktop/CODES/esim-management-2/src/services/turinvoiceClient.js` (141 LOC). First task in plan is a read-through of V1 client to enumerate exposed methods and document actual field names — no assumptions here.

### 6.2 PaymentProvider interface
```ts
interface PaymentProvider {
  createCheckout(input: {
    order: Order;
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; externalRef: string }>;

  refund(payment: Payment): Promise<RefundResult>;
}

type RefundResult =
  | { ok: true; providerRefundId: string }
  | { ok: false; reason: 'already_refunded' | 'not_refundable' | 'provider_error'; message: string };
```

### 6.3 Flow
1. User picks TurInvoice radio + clicks **Pay** → server action `startCheckout(orderId, 'turinvoice')`.
2. `TurInvoiceProvider.createCheckout`:
   - Calls TurInvoice `POST /invoices` (or V1's equivalent) with order line items, customer, callback URL.
   - Stores `Payment` row: `provider='turinvoice'`, `externalId=invoiceId`, `state=pending`.
   - Updates `Order.paymentProvider='turinvoice'`.
3. Server action returns `{checkoutUrl}` → client `window.location.assign`.
4. User pays on TurInvoice (card or SBP QR).
5. TurInvoice → `POST /api/webhooks/turinvoice` with signed body.
6. Webhook ingest: verify signature (see §6.4), store `WebhookEvent`, enqueue `webhooks` queue.
7. `turinvoiceHandler` worker: look up `Payment` by `externalId`, transition `Order.state`:
   - `paid` event → `AWAITING_PAYMENT → PAID`, enqueue outbox `order.paid`.
   - `failed`/`cancelled` → `AWAITING_PAYMENT → FAILED`.
   - `refunded` event (external refund from TurInvoice dashboard) → `REFUND_PENDING | PAID → REFUNDED`.

### 6.4 Security — callback signature
V1 shipped with an audit finding where `TURINVOICE_CALLBACK_SECRET` unset silently bypassed verification. V2 closes this at two layers:
- `env.ts`: `TURINVOICE_CALLBACK_SECRET: z.string().min(16)` — boot fails without secret.
- Handler: if signature missing or mismatches, `400` and do NOT enqueue. No "optional" branch.

Signature scheme inherits V1's (confirm HMAC algorithm + header name during V1 read-through in plan task 1).

### 6.5 Refund
`TurInvoiceProvider.refund(payment)`:
- If V1 client exposes a refund/void endpoint → port it. On success, return `{ok:true, providerRefundId}`.
- If V1 has no such endpoint → `refund()` returns `{ok:false, reason:'not_refundable', message:'TurInvoice refunds must be issued manually in the provider dashboard; use Mark Cancelled after processing.'}`. Admin UI surfaces this message and disables Retry.

## 7. Zendit adapter

### 7.1 Source
Port from V1 `/Users/turgt/Desktop/CODES/esim-management-2/src/services/zenditClient.js` (98 LOC).

### 7.2 EsimProvider interface
```ts
interface EsimProvider {
  listPackages(): Promise<ProviderPackage[]>;
  createEsim(input: {
    packageExternalId: string;
    orderId: string;
  }): Promise<{ iccid: string; activationCode: string; qrCodeUrl: string }>;
  getStatus(iccid: string): Promise<EsimStatus>;
  getUsage(iccid: string): Promise<{ usedBytes: bigint; totalBytes: bigint | null }>;
}
```

### 7.3 Admin-assign flow
Server action `assignZenditEsim({tenantId, userId, packageExternalId, adminUserId})`:
1. Build `Order` with:
   - `tenantId`, `userId`
   - `paymentMode = 'admin_assigned'`, `paymentProvider = null`
   - Single `OrderItem` with Zendit package snapshot pricing (may be zero — admin-assigned doesn't charge)
   - `state = 'PROVISIONING'` (skip `AWAITING_PAYMENT` / `PAID` — no payment)
2. Call `zenditProvider.createEsim({packageExternalId, orderId})`.
3. On success: create `Esim` row, transition `Order → PROVISIONED`, enqueue outbox `order.provisioned` → email.
4. On failure: `Order → PROVISIONING_FAILED`, audit log, admin sees error.
5. Audit log: `admin_assigned_esim(adminUserId, tenantId, userId, orderId)`.

### 7.4 No webhook assumption
V1 does not configure Zendit webhooks; V2 will not either. All Zendit eSIM state transitions after creation happen via `esim.syncStatuses` job. Handler stubs are NOT added (avoids dead code).

### 7.5 Cutover mapping (informational, not implemented here)
When Phase 4/5 data import runs, V1 Zendit eSIMs map to V2 as:
- `Esim.provider = 'zendit'`
- `Esim.externalRef = <V1 iccid>`
- `Order.paymentMode = 'admin_assigned'`, `paymentProvider = null`
- Status polled on first `esim.syncStatuses` tick post-import.

## 8. Refund domain

### 8.1 `issueRefund(orderId, adminUserId)` — server domain function
```
1. Load order (scoped) + latest successful Payment. Require state ∈ {PAID, REFUND_PENDING}.
2. provider = resolvePaymentProvider(payment.provider)
3. result = await provider.refund(payment)
4. if result.ok:
     Payment.refundedAt = now()
     Payment.providerRefundId = result.providerRefundId
     Order.state = REFUNDED
     enqueue outbox: order.refunded → email (orderRefunded.tsx)
     audit: refund_issued(orderId, adminUserId, provider)
   else:
     keep Order.state = REFUND_PENDING (set it if currently PAID)
     audit: refund_failed(orderId, adminUserId, provider, result.reason, result.message)
     throw RefundError(result) → server action surfaces to UI
5. eSIM rows are NOT modified (B decision — admin may revoke via Airalo dashboard manually).
```

### 8.2 `markCancelled(orderId, adminUserId)` — server domain function
```
1. Load order. Require state = REFUND_PENDING.
2. Order.state = CANCELLED.
3. audit: order_force_cancelled(orderId, adminUserId).
```

### 8.3 Paddle `adjustments.create` specifics
- Call: `paddleClient.adjustments.create({action:'refund', transactionId, reason:'requested_by_customer', items:[...], type:'full'})`.
- Sandbox + prod both supported by Paddle SDK 3.8 (`@paddle/paddle-node-sdk`).
- Response failure modes: `transaction_already_refunded`, `transaction_not_refundable`, generic `4xx`. All mapped to `RefundResult` variants.
- Idempotency: include `Idempotency-Key` header = `order-refund-{orderId}` so retry clicks don't double-refund.

## 9. Scheduled jobs

### 9.1 Registration
`src/server/jobs/register-schedules.ts`:
```ts
export async function registerSchedules(queue: Queue) {
  // Idempotent: remove existing repeatable jobs with the same keys, then re-add.
  await queue.removeRepeatableByKey('esim.syncStatuses::::15m');
  await queue.removeRepeatableByKey('order.expireStale::::1h');

  await queue.add('esim.syncStatuses', {}, {
    repeat: { every: 15 * 60 * 1000 },
    jobId: 'esim.syncStatuses',
  });
  await queue.add('order.expireStale', {}, {
    repeat: { every: 60 * 60 * 1000 },
    jobId: 'order.expireStale',
  });
}
```
Called from `scripts/worker.ts` after queue connection established. Idempotent on every worker boot.

### 9.2 `esim.syncStatuses`
```
batch = select Esim where state in (PROVISIONED, IN_USE) and shouldSyncNow(lastStatusSyncAt, state)
for each esim in batch (concurrency 3):
  try:
    provider = resolveEsimProvider(esim.provider)
    status = await provider.getStatus(esim.externalRef)
    usage  = await provider.getUsage(esim.externalRef)
    update esim.state, esim.dataUsedBytes, esim.lastStatusSyncAt=now()
    if state transition (PROVISIONED→IN_USE, IN_USE→EXPIRED|DEPLETED):
      audit: esim_state_synced(esim.id, oldState, newState, provider)
  catch e:
    log.error({esimId: esim.id, provider: esim.provider}, 'sync failed')
    continue                             # one bad eSIM must not block the batch
```

**`shouldSyncNow(lastSync, state)`:**
```
if lastSync is null: true
if state == PROVISIONED: lastSync older than 15 min → true
if state == IN_USE:     lastSync older than 1 hour → true
else: false
```

No email fire on status change — order-flow `provisioningComplete` email already covers first activation; this job is a reconciliation path, not a notification source. (Admin digest in Phase 2d will summarize these transitions.)

### 9.3 `order.expireStale`
```
stale = select Order where state = AWAITING_PAYMENT and createdAt < now() - 24h
for each order in stale:
  transaction:
    Order.state = EXPIRED
    release price_lock if exists (PriceLock.releasedAt = now())
    audit: order_expired(orderId)
  # NO customer email (deliberate — avoids spamming users who abandoned)
```

### 9.4 Failure semantics
- Either job throwing at the top level → BullMQ retries per default (3 attempts, exponential backoff). After exhaustion → DLQ (monitored via read-only stats page from 2a; interactive replay in 2d).
- Per-item failures (§9.2) log + continue, do NOT fail the job — so one bad Zendit API call doesn't freeze Airalo syncing.

## 10. Config & secrets

### 10.1 New env vars
| Var | Required | Notes |
|---|---|---|
| `TURINVOICE_API_KEY` | yes | Server-side. |
| `TURINVOICE_API_BASE` | yes | e.g. `https://api.turinvoice.com/v1`. |
| `TURINVOICE_CALLBACK_SECRET` | yes (min 16 chars) | HMAC secret; must match TurInvoice dashboard. |
| `ZENDIT_API_KEY` | yes | Server-side. |
| `ZENDIT_API_BASE` | yes | e.g. `https://api.zendit.com/v1`. |

All added to:
- `src/server/env.ts` (Zod schema, `min(1)` or `min(16)` as noted).
- `Dockerfile` (builder stage dummy values, Phase 0 gotcha #6).
- `docker-compose.yml` (dev service env passthrough).
- Railway dashboard (manual step in exit criteria).

### 10.2 Callback URLs to register in provider dashboards
- TurInvoice: `https://v2.datapatch.net/api/webhooks/turinvoice`
- Zendit: **not configured** (§7.4).

## 11. Testing strategy

### 11.1 Unit (vitest, `fileParallelism: false`)
- `turinvoice.test.ts` — createCheckout happy path, refund success, refund already-refunded, signature verification (valid + invalid + missing header).
- `zendit.test.ts` — listPackages, createEsim, getStatus, getUsage, 5xx retry behavior (if port retains V1's retry).
- `orderStateMachine.test.ts` — new transition `REFUND_PENDING → CANCELLED` allowed; others still blocked.
- `refund.test.ts` — issueRefund dispatches to correct provider, handles all 3 RefundResult failure reasons, audit rows written.
- `shouldSyncNow.test.ts` — pure function truth table.

### 11.2 Integration (vitest + real Postgres/Redis)
- `turinvoice-webhook.test.ts` — POST `/api/webhooks/turinvoice` with valid HMAC → WebhookEvent insert + queue enqueue + handler transitions order to PAID.
- `turinvoice-webhook.test.ts` — invalid HMAC → 400, no DB insert, no enqueue.
- `order-expire-stale.test.ts` — seed 3 orders (1 stale AWAITING, 1 recent AWAITING, 1 PAID) → run job → only stale one becomes EXPIRED; price_lock released.
- `esim-sync-statuses.test.ts` — seed Esims with varying `lastStatusSyncAt` → run job → matching ones update; terminal ones skipped; provider API mocked.

### 11.3 E2E (Playwright)
- `payment-provider-picker.spec.ts` — B2C checkout shows both radios; selecting TurInvoice redirects off-site (stub the provider endpoint); order row has `paymentProvider='turinvoice'`.
- `admin-refund.spec.ts` — admin UI PAID order → Issue Refund → (Paddle sandbox transaction) → state REFUNDED within polling window.
- `admin-assign-zendit.spec.ts` — admin picks tenant+user+Zendit package → submit → eSIM appears in user's view with PROVISIONED state.

### 11.4 Manual prod verification (exit gate)
1. v2.datapatch.net TurInvoice sandbox order — card path + SBP QR path — each end-to-end to QR email delivery.
2. v2.datapatch.net admin Zendit eSIM assign → verify eSIM in user view → wait one `esim.syncStatuses` tick → verify `lastStatusSyncAt` advanced.
3. v2.datapatch.net Paddle sandbox order → refund via admin UI → Paddle dashboard shows refund; V2 order state REFUNDED; email delivered.
4. Insert an AWAITING_PAYMENT order with backdated `createdAt` → wait one `order.expireStale` tick → state EXPIRED.

## 12. Non-obvious risks (Phase 2c gotchas)

Building on the Phase 2b gotcha memory list, new risks to watch for:

1. **TurInvoice callback secret unset:** V1 audit (memory obs #829, #835) found this; V2 closes it via `env.ts` Zod `min(16)`. Don't loosen.
2. **Zendit has no webhook in prod:** confirmed in memory obs #821; do not add handler stubs that never fire.
3. **BigInt JSON serialization:** Paddle `adjustments.create` returns amounts as bigints; any audit-log JSON payload needs a BigInt-safe stringifier (Phase 2b gotcha carried forward).
4. **Dockerfile builder placeholders:** `TURINVOICE_*` and `ZENDIT_*` need dummy values in the `next build` stage or the build fails under `NODE_ENV=production`.
5. **Repeatable job duplication on redeploy:** without `removeRepeatableByKey` before re-add, every worker boot stacks another repeatable spec.
6. **Per-item failures inside sync job:** without try/catch around each eSIM, one bad provider call kills the whole batch — Zendit outage takes Airalo down too.
7. **Refund idempotency:** admin double-clicks "Issue Refund" in 2s → two Paddle calls without idempotency key → duplicate refund error. Use `Idempotency-Key: order-refund-{orderId}`.
8. **`paymentMode = admin_assigned` state path:** order skips `AWAITING_PAYMENT` and `PAID` states. State machine needs a `null → PROVISIONING` entry for this mode; make sure existing invariant tests don't forbid it.
9. **`Order.paymentProvider` nullable:** it's null until checkout starts AND also null for admin-assigned orders. Don't tighten to NOT NULL.
10. **TurInvoice redirect (not overlay):** user leaves the site. Make sure the return URL handles all three arrival states (just-paid-waiting-for-webhook, failed, cancelled) without racing the webhook — show "waiting for confirmation" spinner until state transitions.

## 13. Exit criteria

- [ ] CI green; unit + integration + E2E all pass; 80%+ coverage.
- [ ] Prisma migration applied in prod; Railway deploy healthy.
- [ ] New env vars set on Railway `datapatch-v2` app + worker services.
- [ ] TurInvoice callback URL registered in provider dashboard.
- [ ] Manual prod verification §11.4 all four scenarios pass.
- [ ] Worker logs show `esim.syncStatuses` running every 15 min and `order.expireStale` running hourly.
- [ ] Redis `bull:<prefix>:repeat:*` shows exactly the two scheduled jobs (no duplicates from prior deploys).
- [ ] Git tag `phase-2c-complete` on `datapatch-v2` main.
- [ ] Memory updated: `project_v2_state.md` (2c complete, 2d scope), new `feedback_phase_2c_gotchas.md` if non-obvious issues surfaced during execution.

## 14. References

- Phase 2b design: `docs/superpowers/specs/2026-04-23-v2-phase-2b-booking-flow-design.md`
- Phase 2b plan (executed): `docs/superpowers/plans/2026-04-23-v2-phase-2b-booking-flow.md`
- Target architecture: `docs/superpowers/specs/2026-04-22-v2-target-architecture-design.md` §5.2 (providers), §6.2 (jobs)
- V1 TurInvoice client: `/Users/turgt/Desktop/CODES/esim-management-2/src/services/turinvoiceClient.js`
- V1 Zendit client: `/Users/turgt/Desktop/CODES/esim-management-2/src/services/zenditClient.js`
- V1 TurInvoice plan: `docs/superpowers/plans/2026-04-14-turinvoice-payment.md`
- Memory (V1 audit findings relevant to 2c): #821 (Zendit webhook absence), #829 + #835 (TurInvoice callback secret), #823 (Zendit topup price-verification absence).
