# V2 Phase 2d — Platform Maturity (Design Spec)

**Date:** 2026-04-26
**Project:** `datapatch-v2` (Next.js 15/16 rewrite of `esim-management-2`)
**Repo path:** `/Users/turgt/Desktop/CODES/datapatch-v2`
**Depends on:** Phase 2c (PRs #4/#5/#6 merged; tag `phase-2c-complete` to be pushed before 2d starts)
**Status:** Design approved — ready for implementation plan

---

## 1. Goal

Close the operational gap left after Phase 2c so the platform can run unattended in production:
- Give admins a UI to inspect and intervene in the BullMQ queues (Bull Board mount).
- Run the two background data-refresh jobs the platform needs to stay accurate (`packages.syncCatalog`, `email.digestAdmin`).
- Replace the full-only refund flow with an item-level partial refund flow on Paddle, including the new state machine transitions.
- Make the dual-provider checkout UX explicit instead of route-driven, so users (and admins helping users) can pick TurInvoice vs Paddle deliberately.

Out of scope: anything from the original Phase 2d list that requires currency conversion, V1 feature ports, or Zendit/TurInvoice refund support. Those move to Phase 2e / 2f.

## 2. Scope

### 2.1 In scope
1. **Bull Board admin UI** — minimal mount of `@bull-board/express` at `/admin/jobs` behind `requireAdmin`, covering the four existing queues (`webhooks`, `esim-sync`, `scheduled`, `outbox`). Built-in retry/promote/remove/clean actions only — no custom audit hook.
2. **Scheduled job: `packages.syncCatalog`** (every 6 h) — Airalo whitelist sync into `provider_packages` with soft-delete + price/spec change audit logs. Bootstrap via a one-shot CLI script.
3. **Scheduled job: `email.digestAdmin`** (daily, `DIGEST_SEND_HOUR` Europe/Istanbul) — per-tenant 24 h snapshot email to platform-super-admin and tenant admin recipients via the outbox.
4. **Partial refund flow** — admin UI (`/admin/orders/:id` Issue Refund modal) lets the operator mark each OrderItem as Full, Partial (with amount), or None; Paddle `adjustments.create` is called item-by-item with cumulative idempotency. New `OrderState.PARTIALLY_REFUNDED` and `Payment.refundedAmount` track partial state.
5. **TurInvoice UX explicit picker** — order-detail page renders two equally-weighted payment cards ("International card / Paddle" and "Russian card or СБП / TurInvoice") instead of relying on browser/locale heuristics. Adds a forward-compat `Order.paymentMethodHint` column for a future TurInvoice method preselect.
6. **USD-only invariant** — Phase 2d explicitly enforces `Order.totalCurrency === 'USD'` and `payment.currency === 'USD'` at the application layer. Schema retains the multi-currency `Money` type for future flexibility, but checkout/booking paths reject anything other than USD. (See §6.)

### 2.2 Out of scope (deferred to Phase 2e or later)
- **`fx.syncRates`** scheduled job and any FX rate model — dropped because the platform is single-currency (USD) for now. Re-add when multi-currency is a product requirement.
- Brochure generator (V1 feature port) — Phase 2e.
- Vendor reports (V1 feature port) — Phase 2e.
- TurInvoice and Zendit refund capability — adapter API gap; admin-only "Mark Cancelled" stays the workaround.
- TurInvoice payment-method preselect (`paymentMethodHint` is stored but not yet sent to TurInvoice). Phase 2f or later, requires upstream API confirmation.
- Bull Board custom audit log on retry/remove — accepted gap; admin user count is small and most actions are reversible (retry idempotent; remove on a failed job is acceptable).
- Multi-base currency or any tenant-level currency override.
- `webhook.healthCheck` / DLQ alerting job (was in original Phase 2d list — defer until we see real signal needs in production).

## 3. User-facing changes

### 3.1 Admin: `/admin/jobs`
Mounted page rendered by Bull Board's built-in UI. Visible to platform-admin role only. Surfaces all four queues with their stock UI: job list, job detail, retry / promote / remove / clean / drain. No custom chrome, no audit-log integration in 2d.

### 3.2 Admin: `/admin/orders/:id` — Issue Refund modal
Replaces the "Issue Refund (full)" button. Modal contents:
- One row per `OrderItem` with `[ ] Full / [ ] Partial / [ ] None` radio.
- Partial selection reveals an `amount` input (minor units, formatted as `$X.YY`) bounded by `0 < amount ≤ subtotalAmount - alreadyRefundedSubtotal`.
- "Reason" textarea, required, ≤ 500 chars, persisted to AuditLog.
- Live preview: total refund amount + remaining refundable amount.
- Submit disabled until at least one item is set to Full or Partial.
- The "Issue Refund" button is **always rendered** for `PAID` and `PARTIALLY_REFUNDED` orders. When `payment.providerId === 'paddle'` the button is enabled and opens the modal. When the active payment is Zendit or TurInvoice the button is disabled with helper text "Refund unsupported — use Mark Cancelled" (kept visible so the admin doesn't have to guess why the action isn't there).

### 3.3 B2C checkout: order detail provider picker
For an order in `AWAITING_PAYMENT`:
- If no `Payment` row exists yet, render two side-by-side cards (responsive: side-by-side desktop, stacked mobile):
  - **International card (Visa / Mastercard)** — Paddle.js overlay (existing flow).
  - **Russian card or СБП** — redirect to TurInvoice hosted page (existing flow).
- If a `Payment` row already exists (user came back to retry), show only that provider's resume action and a small "Use a different method" link that voids the existing pending Payment and re-renders the picker.
- Browser locale is not used to preselect a provider — explicit click only.

### 3.4 Admin daily digest email
New email template `digestAdmin`, sent once per day per tenant per recipient class:
- Subject (tenant-admin recipient): `[DataPatch] Daily digest — {tenantName} — {YYYY-MM-DD}`.
- Subject (super-admin recipient, all-tenant aggregate): `[DataPatch] Daily digest — All tenants — {YYYY-MM-DD}`.
- Body sections (rendered inline; rows omitted entirely if zero):
  - **Orders today** — counts: `PAID`, `REFUNDED`, `PARTIALLY_REFUNDED`, `EXPIRED`, plus a list of orders still in `AWAITING_PAYMENT` for >12 h.
  - **eSIMs today** — counts: `provisioned`, `failed`, status changes to `expired`.
  - **Payments today** — total captured (USD, since invariant), total refunded, count by provider.
  - **Queue health** — count of `failed` jobs in `webhooks`, `esim-sync`, `scheduled`, `outbox`, with a deep link to `/admin/jobs?queue={name}&status=failed`.
  - **Operational** — count of webhook signature mismatches in last 24 h (read from AuditLog).
- Empty days produce no email at all (full skip, including envelope).

## 4. Architecture

### 4.1 New files

```
prisma/migrations/<ts>_phase_2d_partial_refunds_payment_method_hint/migration.sql

src/server/jobs/scheduled/
  packagesSyncCatalog.ts          # Airalo whitelist sync
  emailDigestAdmin.ts             # daily digest builder + send

src/server/jobs/registerSchedules.ts   # extend SCHEDULES list
src/server/jobs/workers/scheduled.ts   # extend dispatch switch

src/server/admin/jobs/
  bullBoardMount.ts               # createBullBoard + Express mount adapter

src/server/refunds/
  paddlePartialRefund.ts          # adjustments.create per item, cumulative idempotency
  applyRefundToPayment.ts         # state transitions + Payment.refundedAmount + audit + outbox

src/server/email/digest/
  buildDailyDigest.ts             # query layer (per tenant, last 24 h)
  digestTemplate.tsx              # JSX template (Phase 2b email pattern)

apps/web/src/app/admin/orders/[id]/
  IssueRefundModal.tsx            # client component
  refund.action.ts                # server action (calls applyRefundToPayment)

apps/web/src/app/admin/jobs/[[...slug]]/route.ts  # Next.js App Router → Bull Board

apps/web/src/app/[locale]/orders/[id]/
  PaymentProviderPicker.tsx       # client component (replaces single-button render)

scripts/syncPackagesOnce.ts       # one-shot bootstrap, run via tsx after deploy
```

### 4.2 Schema additions

```prisma
enum OrderState {
  // ...existing values...
  PARTIALLY_REFUNDED
}

model Payment {
  // ...existing fields...
  refundedAmount BigInt @default(0)   // minor units, cumulative
}

model Order {
  // ...existing fields...
  paymentMethodHint String?           // 'card' | 'sbp' | 'card_ru' | null. Stored only; not yet sent to TurInvoice.
}
```

Single migration: `add_partially_refunded_state_payment_refunded_amount_payment_method_hint`. Defaults make the migration backward-compatible — Phase 2c rows pick up `refundedAmount = 0` and `paymentMethodHint = null` automatically. No data backfill needed.

### 4.3 New environment variables

```
PACKAGES_SYNC_COUNTRIES=TR,US,GB,DE,FR,ES,IT,RU
DIGEST_TIMEZONE=Europe/Istanbul
DIGEST_SEND_HOUR=8                    # 08:00 local time
DIGEST_RECIPIENTS_SUPER=admin@datapatch.net    # comma-separated
```

(No `FX_*`, no `TCMB_*`, no `ECB_*` — Phase 2d is FX-free.)

### 4.4 Schedule registration

Extend `SCHEDULES` in `src/server/jobs/registerSchedules.ts`:

```ts
const SCHEDULES: ScheduleSpec[] = [
  { name: 'esim.syncStatuses',  everyMs: 15 * 60 * 1000 },
  { name: 'order.expireStale',  everyMs: 60 * 60 * 1000 },
  { name: 'packages.syncCatalog', everyMs: 6  * 60 * 60 * 1000 },
  { name: 'email.digestAdmin',    everyMs: 24 * 60 * 60 * 1000 },
];
```

`email.digestAdmin` is registered on a 24 h cadence but the worker function checks the wall clock against `DIGEST_SEND_HOUR` in `DIGEST_TIMEZONE` and exits early if the schedule fires off-window. This avoids a separate cron parser dependency at the cost of one cheap no-op invocation per cycle when the worker boots between firings.

### 4.5 Worker dispatch

Extend the switch in `src/server/jobs/workers/scheduled.ts`:

```ts
case 'packages.syncCatalog': return runPackagesSyncCatalog();
case 'email.digestAdmin':    return runEmailDigestAdmin();
```

Existing concurrency (`1`) is fine — these jobs are I/O-bound but not co-dependent.

## 5. Component design

### 5.1 `packages.syncCatalog`

Inputs:
- `PACKAGES_SYNC_COUNTRIES` env (comma-separated ISO-2).
- Airalo Partner API client (existing in `src/server/providers/esim/airalo/`).

Algorithm:
```ts
async function runPackagesSyncCatalog(): Promise<{ countries: number; upserted: number; deactivated: number; failed: string[] }> {
  const countries = parseEnvList(env.PACKAGES_SYNC_COUNTRIES);
  const failed: string[] = [];
  let upserted = 0;

  // 1. Track which SKUs we see this run, per provider.
  const seenSkus = new Set<string>();

  for (const country of countries) {
    try {
      const remote = await airalo.listPackagesByCountry(country); // priceCurrency must be 'USD'
      for (const pkg of remote) {
        if (pkg.priceCurrency !== 'USD') {
          console.warn('[packages.syncCatalog] skipping non-USD package', { country, sku: pkg.sku, currency: pkg.priceCurrency });
          continue;
        }
        const before = await prisma.providerPackage.findUnique({ where: { providerId_sku: { providerId: 'airalo', sku: pkg.sku } } });
        await prisma.providerPackage.upsert({ /* ... */ });
        if (before && (before.priceAmount !== pkg.priceAmount || before.dataMb !== pkg.dataMb || before.durationDays !== pkg.durationDays)) {
          await prisma.auditLog.create({ data: { action: before.priceAmount !== pkg.priceAmount ? 'package.price_changed' : 'package.spec_changed', resource: 'provider_package', resourceId: before.id, metadata: { from: pickFields(before), to: pickFields(pkg) } } });
        }
        seenSkus.add(pkg.sku);
        upserted++;
      }
    } catch (err) {
      failed.push(country);
      console.error('[packages.syncCatalog] country failed', { country, error: String(err) });
    }
  }

  // 2. Soft-delete: anything currently active in DB for providerId='airalo' but not in seenSkus this run.
  const deactivated = await prisma.providerPackage.updateMany({
    where: { providerId: 'airalo', active: true, sku: { notIn: Array.from(seenSkus) } },
    data: { active: false, updatedAt: new Date() },
  });

  return { countries: countries.length, upserted, deactivated: deactivated.count, failed };
}
```

Edge cases:
- All countries fail → BullMQ retries (3 attempts, exponential). After exhaustion the job lands in DLQ visible in Bull Board.
- Partial country failure → soft-delete is **scoped to seen SKUs only**, so a failed country can't accidentally deactivate its packages. (This is the reason `seenSkus` accumulates across countries before the soft-delete step.)
- `priceCurrency !== 'USD'` → skip that package, log, continue. Defensive; Airalo today is USD.
- `provider_packages` row is FK-protected by `Order/Esim`, so we never hard-delete; `active=false` is the sentinel.

Bootstrap: `pnpm tsx scripts/syncPackagesOnce.ts` invokes the same function once after deploy so the catalog is non-empty before the first scheduled fire.

### 5.2 `email.digestAdmin`

Algorithm:
```ts
async function runEmailDigestAdmin(now = new Date()): Promise<{ sent: number; skipped: number }> {
  // 1. Window check
  const localHour = zonedNow(now, env.DIGEST_TIMEZONE).getHours();
  if (localHour !== Number(env.DIGEST_SEND_HOUR)) return { sent: 0, skipped: 0 }; // off-window noop

  const dayKey = formatDayKey(now, env.DIGEST_TIMEZONE);  // 'YYYY-MM-DD'
  const since = startOfWindow(now, env.DIGEST_TIMEZONE);  // 24 h ago aligned to local midnight

  // 2. Build per-tenant payload
  const tenants = await prisma.tenant.findMany({});
  let sent = 0, skipped = 0;

  for (const tenant of tenants) {
    const payload = await buildDailyDigest(tenant.id, since, now);
    if (isEmpty(payload)) { skipped++; continue; }

    // 3. Tenant-admin recipients
    const tenantAdmins = await prisma.userTenantMembership.findMany({
      where: { tenantId: tenant.id, role: 'admin' },
      select: { user: { select: { email: true } } },
    });
    for (const admin of tenantAdmins) {
      await prisma.outboxEvent.create({
        data: {
          dedupKey: `digest:tenant:${tenant.id}:${admin.user.email}:${dayKey}`,
          channel: 'email',
          template: 'digestAdmin',
          payload: { ...payload, recipientType: 'tenant_admin', tenantName: tenant.name } as Prisma.InputJsonValue,
          recipient: admin.user.email,
        },
      });
    }
    sent++;
  }

  // 4. Super-admin aggregate (all-tenant rollup)
  const superRecipients = (env.DIGEST_RECIPIENTS_SUPER ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (superRecipients.length) {
    const aggregate = await buildDailyDigest(null /* all tenants */, since, now);
    if (!isEmpty(aggregate)) {
      for (const recipient of superRecipients) {
        await prisma.outboxEvent.create({
          data: {
            dedupKey: `digest:super:${recipient}:${dayKey}`,
            channel: 'email',
            template: 'digestAdmin',
            payload: { ...aggregate, recipientType: 'super_admin' } as Prisma.InputJsonValue,
            recipient,
          },
        });
      }
    }
  }

  return { sent, skipped };
}
```

Notes:
- Outbox dispatcher (Phase 2a) handles Resend send + retry. Our concern is only writing the OutboxEvent rows.
- `dedupKey` ensures double-firing or re-runs for the same `dayKey` don't double-send.
- `isEmpty` returns true iff all five sections (orders/eSIMs/payments/queue/operational) are zero — that's the "skip empty days" rule.
- `buildDailyDigest(null, ...)` aggregates across all tenants; `(tenantId, ...)` scopes to one.

### 5.3 Bull Board mount

```ts
// src/server/admin/jobs/bullBoardMount.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { webhooksQueue, esimSyncQueue, scheduledQueue, outboxQueue } from '@/src/server/jobs/queue';

export function createBullBoardAdapter(basePath: string) {
  const adapter = new ExpressAdapter();
  adapter.setBasePath(basePath);
  createBullBoard({
    queues: [
      new BullMQAdapter(webhooksQueue),
      new BullMQAdapter(esimSyncQueue),
      new BullMQAdapter(scheduledQueue),
      new BullMQAdapter(outboxQueue),
    ],
    serverAdapter: adapter,
  });
  return adapter;
}
```

```ts
// apps/web/src/app/admin/jobs/[[...slug]]/route.ts
import { requireAdmin } from '@/src/server/auth/requireAdmin';
import { createBullBoardAdapter } from '@/src/server/admin/jobs/bullBoardMount';

const adapter = createBullBoardAdapter('/admin/jobs');

async function handler(req: Request) {
  await requireAdmin();
  // Hand off to the Express adapter via Next.js bridge.
  return adapter.getRouter()(req as any, /* ... */);
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

The adapter expects an Express-shaped req/res. In a Next.js App Router context we use a thin bridge — implementation detail to be confirmed during plan execution; alternative is mounting the adapter on the existing Node HTTP server entry (`server.ts`) before Next handles the rest of the routes. Plan task will pick the simpler of the two after a 30-min spike.

### 5.4 Partial refund flow

Server entry: `applyRefundToPayment(orderId, items: { orderItemId, type: 'full'|'partial', amount?: bigint }[], reason: string, actorUserId: string)`.

```ts
async function applyRefundToPayment(orderId, items, reason, actorUserId) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payments: true } });
  const payment = pickActivePayment(order.payments); // captured + providerId='paddle'

  // 1. Validate
  assertEquals(payment.currency, 'USD');                       // USD invariant
  const requestedTotal = sumRefundAmounts(items, order.items);
  const remaining = payment.amount - payment.refundedAmount;
  if (requestedTotal <= 0n || requestedTotal > remaining) throw new ValidationError(...);

  // 2. Idempotency key — cumulative new total after this refund
  const newRefundedTotal = payment.refundedAmount + requestedTotal;
  const idempotencyKey = `order-refund-${orderId}-${newRefundedTotal.toString()}`;

  // 3. Call Paddle
  const adjustment = await paddlePartialRefund({
    transactionId: payment.externalPaymentId,
    items: items.map(toPaddleItem),
    reason,
    idempotencyKey,
  });

  // 4. Persist + state transition
  await prisma.$transaction(async tx => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: newRefundedTotal,
        status: newRefundedTotal === payment.amount ? 'refunded' : 'captured',
      },
    });

    const newState = newRefundedTotal === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await tx.order.update({ where: { id: orderId }, data: { state: newState } });

    await tx.auditLog.create({
      data: {
        tenantId: order.tenantId,
        userId: actorUserId,
        action: newState === 'REFUNDED' ? 'order.refunded' : 'order.partially_refunded',
        resource: 'order',
        resourceId: orderId,
        metadata: { items, reason, paddleAdjustmentId: adjustment.id, refundedAmount: newRefundedTotal.toString() } as Prisma.InputJsonValue,
      },
    });

    await tx.outboxEvent.create({
      data: {
        dedupKey: `email:order-refund:${orderId}:${newRefundedTotal.toString()}`,
        channel: 'email',
        template: newState === 'REFUNDED' ? 'orderRefunded' : 'orderPartiallyRefunded',
        recipient: order.buyerEmail,
        payload: { orderId, refundedAmount: requestedTotal.toString(), totalRefunded: newRefundedTotal.toString(), reason } as Prisma.InputJsonValue,
      },
    });
  });
}
```

State machine additions:
```
PAID                  → PARTIALLY_REFUNDED   (cumulative refund < total)
PAID                  → REFUNDED             (single full refund)
PARTIALLY_REFUNDED    → PARTIALLY_REFUNDED   (additional partial refund, still < total)
PARTIALLY_REFUNDED    → REFUNDED             (cumulative reaches total)
```

`PARTIALLY_REFUNDED` is a terminal-ish state from the user's perspective but accepts further refunds until cumulative equals `payment.amount`.

Paddle `adjustments.create` shape (per item):
```js
{
  transaction_id,
  action: 'refund',
  reason,
  items: [
    { item_id, type: 'partial', amount: '500' },  // minor units, string
    { item_id, type: 'full' },
  ],
}
```

Email template `orderPartiallyRefunded` is new; `orderRefunded` (Phase 2c) stays unchanged. Both consume `{ orderId, refundedAmount, totalRefunded, reason }`.

### 5.5 TurInvoice UX picker

`apps/web/src/app/[locale]/orders/[id]/PaymentProviderPicker.tsx` — client component, mounted from the existing order detail server page when state is `AWAITING_PAYMENT`.

```tsx
function PaymentProviderPicker({ order }: { order: OrderViewModel }) {
  const hasActivePayment = order.activePayment !== null;
  if (hasActivePayment) {
    return <ResumePaymentCard payment={order.activePayment} onSwitch={voidAndRetry} />;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PaddleCard onClick={() => openPaddleOverlay(order)} />
      <TurInvoiceCard onClick={() => redirectToTurInvoice(order)} />
    </div>
  );
}
```

`voidAndRetry` server action: marks the existing pending Payment row `cancelled`, audit-logs, returns the page (re-renders the picker).

`Order.paymentMethodHint` is **not set** in 2d. The column exists for a future change where TurInvoice's `createOrder` accepts a method preselect — at that point the picker would write the hint when the user picks "СБП" specifically, and `turInvoiceProvider.createCheckout` would forward it.

### 5.6 USD-only invariant

Three enforcement points, all assertion-style (throw on violation, no silent coercion):

```ts
// src/server/domain/orders/createBooking.ts
assertEquals(order.totalCurrency, 'USD', 'Phase 2d invariant: orders must be USD');

// src/server/providers/payment/{paddle,turInvoice}/createCheckout.ts
for (const item of input.lineItems) {
  assertEquals(item.currency, 'USD', `${providerName} checkout: line items must be USD`);
}

// src/server/refunds/applyRefundToPayment.ts
assertEquals(payment.currency, 'USD', 'Refund: payment must be USD');
```

Rationale: the schema keeps the `Currency` union (`USD | EUR | TRY | GBP`) for forward flexibility, but every booking/checkout/refund path is locked to USD until a future product decision opens multi-currency. These checks are cheap to remove later — simple grep.

`packages.syncCatalog` already filters non-USD `priceCurrency` (defensive — Airalo is USD today).

## 6. Data flow diagrams

### 6.1 Partial refund

```
admin clicks "Issue Refund" on /admin/orders/:id
  → IssueRefundModal collects {items, reason}
  → POST refund.action.ts
    → applyRefundToPayment(orderId, items, reason, actorUserId)
      ├── validate (sum, USD, ≤ remaining)
      ├── paddlePartialRefund (adjustments.create + Idempotency-Key: order-refund-{orderId}-{newTotal})
      ├── tx: update Payment.refundedAmount, Payment.status, Order.state
      ├── tx: insert AuditLog
      └── tx: insert OutboxEvent (orderRefunded | orderPartiallyRefunded)
  outbox dispatcher → Resend → buyer email
```

### 6.2 Daily digest

```
BullMQ scheduled queue fires email.digestAdmin (every 24 h)
  → check local hour vs DIGEST_SEND_HOUR (skip if off-window)
  → for each tenant:
       buildDailyDigest(tenantId, since, now)
       if non-empty: insert OutboxEvent per tenant admin
  → if super recipients configured:
       buildDailyDigest(null, since, now)  # all-tenant rollup
       if non-empty: insert OutboxEvent per super recipient
  outbox dispatcher → Resend
```

### 6.3 Package catalog sync

```
BullMQ scheduled queue fires packages.syncCatalog (every 6 h)
  → for each country in PACKAGES_SYNC_COUNTRIES:
       airalo.listPackagesByCountry(country)
       upsert ProviderPackage rows (skip non-USD)
       audit on price/spec change
       record SKUs into seenSkus
  → soft-delete (active=false) any provider_packages.active rows for providerId='airalo' not in seenSkus
  return {countries, upserted, deactivated, failed}
```

## 7. Error handling

| Failure | Behavior |
|---|---|
| `packages.syncCatalog` — single country API error | Logged, country added to `failed`, other countries continue. Job returns `failed: [...]`; if any failed, BullMQ keeps the job result but does NOT retry (avoid hammering). |
| `packages.syncCatalog` — total wipe (all countries fail) | BullMQ retries with exponential backoff (3 attempts). After exhaustion, lands in DLQ. Soft-delete logic does not run when `seenSkus` is empty (guard-clause). |
| `email.digestAdmin` — buildDailyDigest throws | Per-tenant try/catch; one tenant's failure doesn't block others. Failure is logged with tenantId; aggregate digest still attempted. |
| `applyRefundToPayment` — Paddle 4xx | Order state unchanged (still `PAID`). Audit log `order.refund_failed`. UI surfaces error; admin can retry (idempotency key encodes new cumulative total, not retry count, so retrying the same intent is safe). |
| `applyRefundToPayment` — Paddle 5xx / network | Same as 4xx (no state change, audit, retryable). |
| `applyRefundToPayment` — DB tx failure after Paddle success | Critical. Audit log `order.refund_paddle_succeeded_db_failed` with `paddleAdjustmentId`. Manual reconciliation required. (Mitigation: keep DB tx scope minimal; Paddle call is *outside* the tx.) |
| Bull Board mount fails at boot | App fails to boot. Acceptable — surfaces immediately, admins notice. |
| TurInvoice picker — provider switch race | Old pending Payment is set to `cancelled`; webhook arriving for it is logged-and-ignored (existing handler behavior — we're not changing webhook code). |
| TCMB / ECB — N/A | No FX in 2d. |

## 8. Security considerations

- `/admin/jobs` — `requireAdmin` middleware at the route level. Bull Board itself does not have its own auth; we trust the Next.js auth layer.
- Refund modal — server action revalidates actor permissions (re-runs `requireAdmin` on the action handler, not just the page). Critical: client-side cannot be trusted.
- Paddle adjustments — Idempotency-Key prevents accidental double-refund on resubmit. Cumulative-amount-encoded key (`{orderId}-{newRefundedTotal}`) means a true retry uses the same key (safe), but a *new* refund uses a new key (correct).
- USD-only invariant — assertion-style (throws) so a misconfigured locale or bad seed data cannot silently process a non-USD order.
- Daily digest emails — recipient lists pulled from DB (`UserTenantMembership.role='admin'`) and env (`DIGEST_RECIPIENTS_SUPER`); both validated as email-shaped at startup.

## 9. Testing strategy

### 9.1 Unit / integration tests
- `packagesSyncCatalog.test.ts` — mocked Airalo client; cases: happy path (multi-country upsert), price change audit, spec change audit, soft-delete of disappeared SKU, partial-failure preserves disappeared-but-fetch-failed-country SKUs, non-USD package skipped.
- `emailDigestAdmin.test.ts` — mocked Prisma + outbox; cases: empty tenant skipped, multi-tenant emit, super-admin aggregate vs tenant view, off-window early-return, dedupKey collision (same day re-fire) does not double-emit (relies on outbox unique constraint).
- `applyRefundToPayment.test.ts` — cases: full refund, partial refund (one item partial), multi-step partials cumulative reaches total → state flips PARTIALLY_REFUNDED → REFUNDED, over-refund rejected, non-USD payment rejected, Paddle 4xx leaves state untouched + audit logged.
- `paddlePartialRefund.test.ts` — request shape (items, type:partial vs full), idempotency key construction, header attachment via fresh `new Paddle(...)` per call (Phase 2c gotcha #7).
- `bullBoardMount.test.ts` — adapter constructed with all 4 queues; smoke-test only.
- `usdOnlyInvariant.test.ts` — three-paths assertion test (createBooking, createCheckout, applyRefundToPayment) confirms throw on non-USD input.

### 9.2 E2E tests (Playwright)
- `e2e/admin-issue-partial-refund.spec.ts` — login as admin, navigate to a paid order, open modal, select one item partial $5 + one item full, submit, verify Order state = `PARTIALLY_REFUNDED`, Payment.refundedAmount updated, audit log row exists, outbox event queued. Uses MSW or a Paddle mock layer; no real Paddle call in CI.
- `e2e/checkout-provider-picker.spec.ts` — B2C flow: create order, land on picker, click TurInvoice, confirm redirect URL; back-navigate, click Paddle, confirm overlay appears.
- `e2e/admin-jobs-page.spec.ts` — login as admin, navigate to `/admin/jobs`, assert Bull Board UI renders with all 4 queues listed.

### 9.3 Manual verification (post-deploy, Phase 2c pattern)
- Trigger `packages.syncCatalog` once via `pnpm tsx scripts/syncPackagesOnce.ts`; confirm `provider_packages` row count > 0 for each country in whitelist.
- Wait for next 08:00 Europe/Istanbul; confirm digest email received (or use a test trigger that overrides the window check with `DIGEST_SEND_HOUR=<current_hour>`).
- Issue a partial refund on a real Paddle test transaction; confirm Paddle dashboard reflects partial adjustment + buyer receives `orderPartiallyRefunded` email.
- Visit `/admin/jobs`; confirm queue list and that retrying a failed job (forced via `BullMQ.add(...)` with a deliberately-broken payload) succeeds.

### 9.4 Coverage target
80%+ on new files (project standard). Existing files touched (registerSchedules, workers/scheduled, Money assertions) keep their current coverage or higher.

## 10. Migration / deployment

### 10.1 Sequence
1. Push tag `phase-2c-complete` (currently un-tagged on remote).
2. Branch `feat/phase-2d` off `main`.
3. PR-A: schema migration + USD-only invariant + `packages.syncCatalog` + bootstrap script. Merge.
4. After PR-A merge, on prod: `pnpm tsx scripts/syncPackagesOnce.ts` to seed catalog.
5. PR-B: Bull Board mount + `email.digestAdmin`. Merge.
6. PR-C: partial refund flow + TurInvoice UX picker. Merge.
7. Tag `phase-2d-complete`.

### 10.2 Rollback
- PR-A is the only one with a schema migration. Migration is additive (new enum value, new columns with defaults); rollback by removing the enum value (Postgres allows after no rows reference it) and dropping the columns. In practice we won't roll back — additive migrations are safe to leave in place even if app code reverts.
- PR-B and PR-C are app-only; revert via git revert + redeploy.

### 10.3 Feature flags
None. Phase 2d is small enough that revert is the rollback story. The TurInvoice picker change is observable to users — accepted, since the picker is a strict improvement over the implicit redirect.

## 11. PR strategy

| PR | Scope | Approx. size | Depends on |
|---|---|---|---|
| **PR-A** | Migration (3 schema changes), USD-only invariant assertions, `packages.syncCatalog` job + worker dispatch wiring + tests, `scripts/syncPackagesOnce.ts` | ~600 LoC | `main` post-2c |
| **PR-B** | Bull Board mount + admin route, `email.digestAdmin` + digest template + tests | ~500 LoC | PR-A merged (registerSchedules conflict avoidance) |
| **PR-C** | Partial refund flow (modal, server action, paddlePartialRefund, applyRefundToPayment, state machine, audit, email), TurInvoice UX picker | ~700 LoC | PR-A merged (Payment.refundedAmount column) |

PRs B and C are independent of each other after A. Memory note: user sometimes merges a PR while a follow-up commit is pending — verify PR state before pushing follow-ups; open a fresh PR off main if the original was already merged.

## 12. Open questions / risks

1. **Bull Board on Next.js App Router** — the Express-shaped `req/res` bridge is the only unknown unknown. Plan task includes a 30-min spike: if the Express adapter doesn't bridge cleanly, fallback is mounting Bull Board on the existing Node HTTP entry (`server.ts`) before Next handles the catch-all. Either path achieves the same UX.
2. **TurInvoice picker race** — if a user opens both Paddle and TurInvoice in two tabs, two pending Payments could be created. The "switch provider" path cancels the old one, but parallel-tab is a corner case. Accepted — webhook for the cancelled Payment will be ignored, no duplicate provisioning since Order state is the source of truth.
3. **Outbox dedup with multiple admins per tenant** — if a tenant has admins A and B, both should get the email; `dedupKey` includes the recipient (`digest:tenant:{tenantId}:{email}:{dayKey}`) so no collision. Confirmed in §5.2 algorithm.
4. **Daily digest performance** — for now we expect ≤10 tenants and ≤100 orders/day; the per-tenant query is fine. If the platform grows, the digest builder needs incremental aggregation (precomputed daily roll-up table). Out of scope.
5. **USD-only invariant scope** — the `Money` type still permits `EUR/TRY/GBP`. We rely on assertions in three call sites. A more thorough approach would be a Zod schema or branded type that excludes non-USD. Accepted gap; the assertion sites are the only paths that create or transform money in the booking/checkout/refund flow.

---

**Approval required to proceed to implementation plan.** After approval, the next step is invoking the `superpowers:writing-plans` skill to produce the per-PR task breakdown for subagent-driven execution.
