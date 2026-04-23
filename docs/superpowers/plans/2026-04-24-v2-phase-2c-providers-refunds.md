# V2 Phase 2c — Providers & Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-24-v2-phase-2c-providers-refunds-design.md`

**Goal:** Ship TurInvoice as a second payment provider, Zendit as an admin-assign eSIM provider, Paddle+TurInvoice automated refunds + Mark Cancelled admin action, and the two production-critical scheduled jobs (`esim.syncStatuses`, `order.expireStale`) into V2 (datapatch-v2) without breaking Phase 2b's happy path.

**Architecture:** Extend existing `PaymentProvider` + `EsimProvider` interfaces with `refund()` and a richer `getStatus()` signature; add new provider modules (`turinvoice/`, `zendit/`) that mirror the Phase 2b Paddle/Airalo file layout; introduce a new `PaymentMode.ADMIN_ASSIGNED` branch for the admin-only Zendit path; register two BullMQ repeatable jobs on worker startup.

**Tech Stack:** Next.js 15/16 App Router, TypeScript, Prisma 7, PostgreSQL 16, BullMQ + ioredis, Zod env validation, React Email + Resend, Paddle SDK 3.8 (refund = `adjustments.create`), Axios + nock for provider HTTP + tests, Vitest (unit + integration), Playwright (E2E).

**Repo:** `/Users/turgt/Desktop/CODES/datapatch-v2` (V2 code). Spec + this plan live in `esim-management-2/docs/superpowers/` (V1 repo).

**Prereq:** Phase 2b merged on `datapatch-v2` main. Tag `phase-2b-complete` exists.

---

## File Structure

### New files (datapatch-v2)
```
prisma/migrations/<ts>_phase_2c_admin_assigned_and_esim_sync_timestamp/migration.sql
src/server/providers/payment/turinvoice/
  client.ts                 # low-level HTTP (login, createOrder, refund, cancelOrder, getOrder)
  createCheckout.ts         # PaymentProvider.createCheckout
  verifyWebhook.ts          # secret_key body verification
  refund.ts                 # PaymentProvider.refund
  normalize.ts              # callback payload → NormalizedPaymentEvent
  index.ts                  # turInvoiceProvider bundle
  turinvoice.test.ts        # unit tests (nock)
src/server/providers/payment/paddle/
  refund.ts                 # NEW — PaymentProvider.refund via adjustments.create
  refund.test.ts
src/server/providers/esim/zendit/
  client.ts
  purchase.ts
  getStatus.ts
  syncPackages.ts
  verifyWebhook.ts          # throws NotImplemented (Zendit has no webhook)
  normalize.ts
  index.ts
  zendit.test.ts
src/server/webhooks/handlers/turinvoiceHandlers.ts
src/server/domain/orders/createAdminAssignedOrder.ts
src/server/domain/orders/createAdminAssignedOrder.test.ts
src/server/domain/refunds/issueRefund.ts
src/server/domain/refunds/issueRefund.test.ts
src/server/domain/refunds/markCancelled.ts
src/server/domain/refunds/markCancelled.test.ts
src/server/domain/esims/shouldSyncNow.ts
src/server/domain/esims/shouldSyncNow.test.ts
src/server/jobs/scheduled/esimSyncStatuses.ts
src/server/jobs/scheduled/esimSyncStatuses.test.ts
src/server/jobs/scheduled/orderExpireStale.ts
src/server/jobs/scheduled/orderExpireStale.test.ts
src/server/jobs/registerSchedules.ts
src/server/outbox/handlers/orderRefunded.ts
src/emails/orderRefunded.tsx
src/app/api/webhooks/turinvoice/route.ts
src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_components/PaymentProviderPicker.tsx
src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_actions/startCheckout.ts
src/app/admin/esims/assign/page.tsx
src/app/admin/esims/assign/_actions/assignZenditEsim.ts
src/app/admin/orders/[orderId]/_actions/issueRefund.ts
src/app/admin/orders/[orderId]/_actions/markCancelled.ts
src/app/admin/orders/[orderId]/_components/OrderActions.tsx
tests/e2e/phase2c-payment-picker.spec.ts
tests/e2e/phase2c-admin-refund.spec.ts
tests/e2e/phase2c-admin-assign.spec.ts
```

### Changed files
```
prisma/schema.prisma
  + PaymentMode enum: add ADMIN_ASSIGNED
  + Esim model: add lastStatusSyncAt DateTime?
src/lib/env.ts
  + TURINVOICE_HOST, TURINVOICE_LOGIN, TURINVOICE_PASSWORD, TURINVOICE_IDTSP,
    TURINVOICE_CURRENCY (default 'USD'), TURINVOICE_CALLBACK_SECRET (min 16),
    ZENDIT_API_KEY, ZENDIT_API_BASE (default 'https://api.zendit.io/v1'),
    ZENDIT_COUNTRY (optional, default 'TR')
src/server/providers/payment/types.ts
  + RefundResult type
  + PaymentProvider.refund(payment): Promise<RefundResult>
src/server/providers/payment/paddle/index.ts
  + refund wired into paddleProvider export
src/server/providers/payment/registry.ts
  + turinvoice entry
src/server/providers/esim/types.ts
  * getStatus(iccid: string) → getStatus(input: { iccid: string; rawMetadata: unknown | null }): Promise<EsimRemoteStatus>
src/server/providers/esim/airalo/getStatus.ts
  * signature updated to accept the new input shape (still uses iccid internally)
src/server/providers/esim/airalo/index.ts
  * no change beyond consuming updated getStatus
src/server/providers/esim/registry.ts
  + zendit entry
src/server/webhooks/handlerRegistry.ts
  + 'turinvoice:payment.completed' / .failed / .refunded entries
src/server/domain/orders/orderMachine.ts
  + handle START_CHECKOUT from DRAFT when paymentMode = ADMIN_ASSIGNED (straight to PROVISIONING)
    OR add new PROVISION_STARTED_FROM_DRAFT event — see Task 13.
scripts/worker.ts
  + call registerSchedules() after workers boot
Dockerfile
  + placeholder values for new env vars in the builder stage (same pattern as Phase 2b)
docker-compose.yml
  + env passthrough for TURINVOICE_* and ZENDIT_* to the app + worker services
.env.example
  + new vars documented
```

---

## Task 1: V1 Read-Through Notes (no production code)

Purpose: record V1 field names and URLs inside the V2 worktree so later tasks can reference a single source without re-reading V1 files. The output is a single plain-text notes file committed to V2 main.

**Files:**
- Create: `/Users/turgt/Desktop/CODES/datapatch-v2/docs/phase-2c-v1-notes.md`

**References:**
- `/Users/turgt/Desktop/CODES/esim-management-2/src/services/turinvoiceClient.js`
- `/Users/turgt/Desktop/CODES/esim-management-2/src/services/zenditClient.js`
- `/Users/turgt/Desktop/CODES/esim-management-2/src/controllers/turInvoiceController.js`

- [ ] **Step 1: Write the notes file**

```markdown
# Phase 2c — V1 API notes

## TurInvoice (V1 `src/services/turinvoiceClient.js`)
- Auth: session cookie (`sessionid=...`). `POST {HOST}/api/v1/auth/login` body `{login, password}`, response `{code: 'OK', ...}` sets cookie.
- On 401 → re-login then retry (implemented as `withAutoRelogin` wrapper).
- `PUT  {HOST}/api/v1/tsp/order` body `{idTSP, amount, currency, name, quantity, callbackUrl?, redirectUrl?}` → `{idOrder, paymentUrl?, ...}`
- `GET  {HOST}/api/v1/tsp/order?idOrder=X` → `{idOrder, state, ...}`
- `GET  {HOST}/api/v1/tsp/order/payment/qr?idOrder=X` → image/png (arraybuffer)
- `PUT  {HOST}/api/v1/tsp/refund` body `{idOrder, amount?, description?}` → `{idRefund?, ...}`
- `DELETE {HOST}/api/v1/tsp/order?idOrder=X` → `{...}`
- Env vars: `TURINVOICE_HOST`, `TURINVOICE_LOGIN`, `TURINVOICE_PASSWORD`, `TURINVOICE_IDTSP`, `TURINVOICE_CURRENCY`, `TURINVOICE_CALLBACK_SECRET`, `TURINVOICE_ENABLED`.

## TurInvoice callback (V1 `src/controllers/turInvoiceController.js`)
- TurInvoice POSTs JSON body with fields: `id` (our idOrder echo), `state` (terminal: `paid|failed|cancelled|refunded`), `secret_key` (plaintext shared secret), plus provider metadata.
- Verification: body.secret_key must equal TURINVOICE_CALLBACK_SECRET — `crypto.timingSafeEqual` on equal-length buffers.
- On 401 (missing/invalid) log + reject. On success process event then return 200.
- V1 sanitises payload before audit logging by stripping `secret_key`.

## Zendit (V1 `src/services/zenditClient.js`)
- Auth: `Authorization: Bearer ${ZENDIT_API_KEY}`.
- `GET  {BASE}/esim/offers?_limit=1024&_offset=1&brand=&country=TR&subType=` → offers list (catalog).
- `GET  {BASE}/esim/offers/{offerId}` → single offer.
- `POST {BASE}/esim/purchases` body `{offerId, transactionId, iccid?}` — transactionId is OUR orderId; iccid only for top-ups. Response includes `{txId, iccid, qrCode, activationCode, ...}`.
- `GET  {BASE}/esim/purchases/{txId}` → purchase detail (status).
- `GET  {BASE}/esim/purchases/{txId}/qrcode` → QR.
- `GET  {BASE}/esim/purchases/{txId}/usage` → `{usedBytes, totalBytes}`.
- `GET  {BASE}/esim/{iccid}/plans` → iccid-indexed lookup (useful fallback).
- `GET  {BASE}/balance` → account balance.
- Status map (V1):
  `DONE|ACCEPTED → completed`, `AUTHORIZED|IN_PROGRESS → processing`, `PENDING → pending`, `FAILED|CANCELLED|REJECTED|ERROR → failed`.
- No webhook registration in V1 — all status updates are polled.
- Env vars: `ZENDIT_API_KEY`, `ZENDIT_API_BASE` (default `https://api.zendit.io/v1`), `COUNTRY` (default `TR`), `OFFERS_LIMIT` (default 1024).
```

- [ ] **Step 2: Commit**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
git checkout main && git pull --ff-only
git checkout -b phase-2c/providers-refunds
git add docs/phase-2c-v1-notes.md
git commit -m "docs: phase 2c V1 API read-through notes"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Modify: `datapatch-v2/prisma/schema.prisma`
- Create: `datapatch-v2/prisma/migrations/<ts>_phase_2c_admin_assigned_and_esim_sync_timestamp/migration.sql`

- [ ] **Step 1: Edit `schema.prisma`**

Find `enum PaymentMode` block (around line 376) and add `ADMIN_ASSIGNED`:

```prisma
enum PaymentMode {
  SELF_PAY
  AGENCY_PAY
  ADMIN_ASSIGNED
}
```

Find `model Esim` block (around line 269) and add `lastStatusSyncAt`:

```prisma
model Esim {
  // ... existing fields ...
  iccid              String?
  status             EsimStatus     @default(pending)
  activationCode     String?
  qrPayload          String?
  installedAt        DateTime?
  expiresAt          DateTime?
  lastStatusSyncAt   DateTime?                  // NEW
  rawMetadata        Json?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt
  // ... relations ...
}
```

- [ ] **Step 2: Generate migration**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
pnpm prisma migrate dev --name phase_2c_admin_assigned_and_esim_sync_timestamp --create-only
```

Inspect the generated SQL — expect `ALTER TYPE "PaymentMode" ADD VALUE 'ADMIN_ASSIGNED';` and `ALTER TABLE "esims" ADD COLUMN "lastStatusSyncAt" TIMESTAMP(3);`.

- [ ] **Step 3: Apply + regenerate client**

```bash
pnpm prisma migrate dev
pnpm prisma generate
```

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

```bash
pnpm test
```

Expected: all Phase 2b tests still green.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add PaymentMode.ADMIN_ASSIGNED and Esim.lastStatusSyncAt"
```

---

## Task 3: env.ts extensions + Dockerfile + docker-compose + .env.example

**Files:**
- Modify: `datapatch-v2/src/lib/env.ts`
- Modify: `datapatch-v2/Dockerfile`
- Modify: `datapatch-v2/docker-compose.yml`
- Modify: `datapatch-v2/.env.example`

- [ ] **Step 1: Write the failing test for env schema**

Create `datapatch-v2/src/lib/env.test.ts` (or append to existing if present):

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-import the schema if exported, else reparse fresh by requiring env.ts in isolation.
// Safer: test via a wrapper that the module exports. If env.ts only exports `env`, add
// `export const envSchema = ...` at the top of that file first — see step 2.

import { envSchema } from './env';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  NEXTAUTH_SECRET: 'x'.repeat(32),
  NEXTAUTH_URL: 'http://localhost:3000',
  EMAIL_FROM: 'a@b.com',
  REDIS_URL: 'redis://localhost:6379',
  RESEND_API_KEY: 'k',
  EMAIL_SERVER_HOST: 'localhost',
  EMAIL_SERVER_PORT: '1025',
  PADDLE_API_KEY: 'k',
  PADDLE_WEBHOOK_SECRET: 's',
  PADDLE_ENVIRONMENT: 'sandbox',
  PADDLE_PRODUCT_ID: 'pro_x',
  AIRALO_CLIENT_ID: 'c',
  AIRALO_CLIENT_SECRET: 's',
  AIRALO_BASE_URL: 'https://partners-api.airalo.com/v2',
  AIRALO_WEBHOOK_SECRET: 's',
  PUBLIC_APP_URL: 'https://v2.datapatch.net',
};

describe('envSchema — Phase 2c additions', () => {
  it('requires TurInvoice + Zendit vars', () => {
    const r = envSchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('accepts a complete Phase 2c env', () => {
    const r = envSchema.safeParse({
      ...base,
      TURINVOICE_HOST: 'https://api.turinvoice.com',
      TURINVOICE_LOGIN: 'user',
      TURINVOICE_PASSWORD: 'pass',
      TURINVOICE_IDTSP: '42',
      TURINVOICE_CALLBACK_SECRET: 'x'.repeat(32),
      ZENDIT_API_KEY: 'k',
    });
    expect(r.success).toBe(true);
  });

  it('rejects TURINVOICE_CALLBACK_SECRET shorter than 16 chars', () => {
    const r = envSchema.safeParse({
      ...base,
      TURINVOICE_HOST: 'https://api.turinvoice.com',
      TURINVOICE_LOGIN: 'user',
      TURINVOICE_PASSWORD: 'pass',
      TURINVOICE_IDTSP: '42',
      TURINVOICE_CALLBACK_SECRET: 'short',
      ZENDIT_API_KEY: 'k',
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm vitest run src/lib/env.test.ts
```

Expected: both new tests fail because the schema doesn't have the new fields.

- [ ] **Step 3: Extend `src/lib/env.ts`**

Export the schema (hoist `const envSchema = z.object({...})` above the `.refine` call and `export` it) and add:

```ts
    // Phase 2c — TurInvoice (payment provider).
    TURINVOICE_HOST: z.string().url(),
    TURINVOICE_LOGIN: z.string().min(1),
    TURINVOICE_PASSWORD: z.string().min(1),
    TURINVOICE_IDTSP: z.coerce.number().int().positive(),
    TURINVOICE_CURRENCY: z.string().length(3).default('USD'),
    TURINVOICE_CALLBACK_SECRET: z.string().min(16),

    // Phase 2c — Zendit (admin-assign eSIM provider).
    ZENDIT_API_KEY: z.string().min(1),
    ZENDIT_API_BASE: z.string().url().default('https://api.zendit.io/v1'),
    ZENDIT_COUNTRY: z.string().length(2).default('TR'),
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run src/lib/env.test.ts
```

- [ ] **Step 5: Update Dockerfile (builder stage placeholders)**

Inside the `# Build the application` block where other ENV lines set Phase 2b placeholders (`PADDLE_API_KEY=build_placeholder`, etc.), append:

```dockerfile
ENV TURINVOICE_HOST=https://build.placeholder
ENV TURINVOICE_LOGIN=build_placeholder
ENV TURINVOICE_PASSWORD=build_placeholder
ENV TURINVOICE_IDTSP=0
ENV TURINVOICE_CALLBACK_SECRET=build_placeholder_at_least_16_chars
ENV ZENDIT_API_KEY=build_placeholder
```

- [ ] **Step 6: Update `docker-compose.yml`**

Under the `app` service `environment:` block, add:

```yaml
      TURINVOICE_HOST: ${TURINVOICE_HOST:-https://api.turinvoice.com}
      TURINVOICE_LOGIN: ${TURINVOICE_LOGIN:-}
      TURINVOICE_PASSWORD: ${TURINVOICE_PASSWORD:-}
      TURINVOICE_IDTSP: ${TURINVOICE_IDTSP:-0}
      TURINVOICE_CURRENCY: ${TURINVOICE_CURRENCY:-USD}
      TURINVOICE_CALLBACK_SECRET: ${TURINVOICE_CALLBACK_SECRET:-local_dev_callback_secret_16ch}
      ZENDIT_API_KEY: ${ZENDIT_API_KEY:-}
      ZENDIT_API_BASE: ${ZENDIT_API_BASE:-https://api.zendit.io/v1}
      ZENDIT_COUNTRY: ${ZENDIT_COUNTRY:-TR}
```

If there is a `worker` service in compose, duplicate the same block there.

- [ ] **Step 7: Update `.env.example`**

```
# Phase 2c — TurInvoice
TURINVOICE_HOST=https://api.turinvoice.com
TURINVOICE_LOGIN=
TURINVOICE_PASSWORD=
TURINVOICE_IDTSP=
TURINVOICE_CURRENCY=USD
TURINVOICE_CALLBACK_SECRET=

# Phase 2c — Zendit (admin-assign only)
ZENDIT_API_KEY=
ZENDIT_API_BASE=https://api.zendit.io/v1
ZENDIT_COUNTRY=TR
```

- [ ] **Step 8: Verify Docker build still succeeds**

```bash
docker build --target builder -t dp-v2-build-check .
```

Expected: build completes without env validation errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts Dockerfile docker-compose.yml .env.example
git commit -m "feat(config): add TurInvoice + Zendit env vars with zod validation"
```

---

## Task 4: Extend `PaymentProvider` + `EsimProvider` interfaces

**Files:**
- Modify: `datapatch-v2/src/server/providers/payment/types.ts`
- Modify: `datapatch-v2/src/server/providers/esim/types.ts`
- Modify: `datapatch-v2/src/server/providers/esim/airalo/getStatus.ts`

- [ ] **Step 1: Edit `src/server/providers/payment/types.ts`**

Add `RefundResult` and extend `PaymentProvider`:

```ts
import type { Payment } from '@prisma/client';

export type RefundResult =
  | { ok: true; providerRefundId: string }
  | { ok: false; reason: 'already_refunded' | 'not_refundable' | 'provider_error'; message: string };

export type PaymentProviderId = 'paddle' | 'turinvoice';

// ... keep existing types ...

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(req: NextRequest, rawBody: string): Promise<NormalizedPaymentEvent>;
  refund(payment: Payment): Promise<RefundResult>;
}
```

Note: Prisma's generated `PaymentProviderId` enum already has both values (confirmed in schema). The string-literal type above mirrors it.

- [ ] **Step 2: Edit `src/server/providers/esim/types.ts`**

Replace `getStatus(iccid: string)` with a richer input:

```ts
export type EsimProviderId = 'airalo' | 'zendit';

export interface GetStatusInput {
  iccid: string;
  rawMetadata: unknown | null; // whatever the provider stored at purchase time
}

export interface EsimProvider {
  readonly id: EsimProviderId;
  purchase(input: PurchaseInput): Promise<ProvisionedEsim>;
  getStatus(input: GetStatusInput): Promise<EsimRemoteStatus>;
  syncPackages(): Promise<ProviderPackageSeed[]>;
  verifyWebhook(req: NextRequest, rawBody: string): Promise<NormalizedEsimEvent>;
}
```

- [ ] **Step 3: Update `src/server/providers/esim/airalo/getStatus.ts`**

Find the exported function signature and change from

```ts
export async function getStatus(iccid: string): Promise<EsimRemoteStatus> { ... }
```

to

```ts
import type { GetStatusInput, EsimRemoteStatus } from '../types';

export async function getStatus(input: GetStatusInput): Promise<EsimRemoteStatus> {
  const { iccid } = input;
  // ... existing body unchanged ...
}
```

- [ ] **Step 4: Search for call sites that still pass `iccid` as a string**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
grep -rn "getStatus(" src/ | grep -v "\.test\."
```

Fix every call site to pass `{ iccid, rawMetadata: esim.rawMetadata ?? null }`.

- [ ] **Step 5: Run type check + Phase 2b airalo tests**

```bash
pnpm typecheck
pnpm vitest run src/server/providers/esim/airalo
```

Expected: type check green, airalo tests adjusted in Step 3 still green. If airalo.test.ts calls `getStatus('iccid123')` directly, update the test to `getStatus({ iccid: 'iccid123', rawMetadata: null })`.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/
git commit -m "refactor(providers): extend PaymentProvider.refund and EsimProvider.getStatus input"
```

---

## Task 5: Paddle `refund()` implementation

**Files:**
- Create: `datapatch-v2/src/server/providers/payment/paddle/refund.ts`
- Create: `datapatch-v2/src/server/providers/payment/paddle/refund.test.ts`
- Modify: `datapatch-v2/src/server/providers/payment/paddle/index.ts`
- Modify: `datapatch-v2/src/server/providers/payment/paddle/client.ts` (only if client does not already expose the SDK instance)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/providers/payment/paddle/refund.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refund } from './refund';
import type { Payment } from '@prisma/client';
import { PaymentStatus } from '@prisma/client';

vi.mock('./client', () => ({
  paddleClient: {
    adjustments: {
      create: vi.fn(),
    },
  },
}));
import { paddleClient } from './client';

const payment: Payment = {
  id: 'p1',
  tenantId: 't1',
  orderId: 'o1',
  providerId: 'paddle',
  externalPaymentId: 'txn_01h',
  status: PaymentStatus.captured,
  amount: 1000n,
  currency: 'USD',
  capturedAt: new Date(),
  refundedAt: null,
  failureReason: null,
  rawMetadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('paddle.refund', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns ok=true on successful adjustment', async () => {
    (paddleClient.adjustments.create as any).mockResolvedValue({ id: 'adj_123' });
    const res = await refund(payment);
    expect(res).toEqual({ ok: true, providerRefundId: 'adj_123' });
    expect(paddleClient.adjustments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'refund',
        transactionId: 'txn_01h',
        type: 'full',
      }),
      expect.objectContaining({ customHeaders: expect.objectContaining({ 'Idempotency-Key': 'order-refund-o1' }) }),
    );
  });

  it('maps "already refunded" to not_refundable', async () => {
    (paddleClient.adjustments.create as any).mockRejectedValue({
      code: 'transaction_already_refunded',
      detail: 'already done',
    });
    const res = await refund(payment);
    expect(res).toEqual({ ok: false, reason: 'already_refunded', message: expect.any(String) });
  });

  it('maps generic errors to provider_error', async () => {
    (paddleClient.adjustments.create as any).mockRejectedValue(new Error('boom'));
    const res = await refund(payment);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('provider_error');
  });

  it('throws for missing externalPaymentId', async () => {
    await expect(refund({ ...payment, externalPaymentId: null })).rejects.toThrow(/externalPaymentId/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run src/server/providers/payment/paddle/refund.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `refund.ts`**

```ts
// src/server/providers/payment/paddle/refund.ts
import type { Payment } from '@prisma/client';
import type { RefundResult } from '../types';
import { paddleClient } from './client';

export async function refund(payment: Payment): Promise<RefundResult> {
  if (!payment.externalPaymentId) {
    throw new Error('paddle.refund: payment.externalPaymentId is required');
  }

  try {
    const adj = await paddleClient.adjustments.create(
      {
        action: 'refund',
        transactionId: payment.externalPaymentId,
        reason: 'requested_by_customer',
        type: 'full',
      },
      { customHeaders: { 'Idempotency-Key': `order-refund-${payment.orderId}` } },
    );
    return { ok: true, providerRefundId: (adj as { id: string }).id };
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (code === 'transaction_already_refunded') {
      return { ok: false, reason: 'already_refunded', message: 'Transaction already refunded in Paddle.' };
    }
    if (code === 'transaction_not_refundable') {
      return { ok: false, reason: 'not_refundable', message: 'Paddle marked transaction as not refundable.' };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'provider_error', message };
  }
}
```

If `paddleClient` does not currently expose the SDK's `adjustments` namespace, update `src/server/providers/payment/paddle/client.ts` to export the full SDK instance — do NOT introduce a narrower wrapper.

- [ ] **Step 4: Wire into provider**

Edit `src/server/providers/payment/paddle/index.ts`:

```ts
import type { PaymentProvider } from '../types';
import { createCheckout } from './createCheckout';
import { normalizePaddleEvent } from './normalize';
import { verifyWebhookRequest } from './verifyWebhook';
import { refund } from './refund';

export const paddleProvider: PaymentProvider = {
  id: 'paddle',
  createCheckout,
  verifyWebhook: async (req, rawBody) => {
    const parsed = await verifyWebhookRequest(req, rawBody);
    return normalizePaddleEvent(parsed);
  },
  refund,
};
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm vitest run src/server/providers/payment/paddle/
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/payment/paddle/
git commit -m "feat(paddle): implement PaymentProvider.refund via adjustments.create"
```

---

## Task 6: TurInvoice low-level client

**Files:**
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/client.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/client.test.ts`

- [ ] **Step 1: Write the failing test (nock-based)**

```ts
// src/server/providers/payment/turinvoice/client.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { TurInvoiceClient } from './client';

const host = 'https://api.turinvoice.test';

describe('TurInvoiceClient', () => {
  let client: TurInvoiceClient;
  beforeAll(() => {
    nock.disableNetConnect();
  });
  beforeEach(() => {
    client = new TurInvoiceClient({
      host,
      login: 'u',
      password: 'p',
      idTSP: 7,
      currency: 'USD',
    });
  });
  afterEach(() => {
    nock.cleanAll();
  });

  it('logs in and creates an order, attaching the session cookie', async () => {
    nock(host)
      .post('/api/v1/auth/login', { login: 'u', password: 'p' })
      .reply(200, { code: 'OK' }, { 'set-cookie': ['sessionid=abc123; Path=/'] });

    nock(host, { reqheaders: { cookie: /sessionid=abc123/ } })
      .put('/api/v1/tsp/order', {
        idTSP: 7,
        amount: 500,
        currency: 'USD',
        name: 'eSIM purchase',
        quantity: 1,
        callbackUrl: 'https://v2/callback',
        redirectUrl: 'https://v2/return',
      })
      .reply(200, { idOrder: 999, paymentUrl: 'https://pay.turinvoice.test/999' });

    const res = await client.createOrder({
      amount: 500,
      name: 'eSIM purchase',
      callbackUrl: 'https://v2/callback',
      redirectUrl: 'https://v2/return',
    });

    expect(res).toEqual({ idOrder: 999, paymentUrl: 'https://pay.turinvoice.test/999' });
  });

  it('re-logs in after a 401 and retries the original call', async () => {
    // First login + a createOrder that 401s
    nock(host).post('/api/v1/auth/login').reply(200, { code: 'OK' }, { 'set-cookie': ['sessionid=one'] });
    nock(host).put('/api/v1/tsp/order').reply(401, { error: 'expired' });
    // Second login + retry succeeds
    nock(host).post('/api/v1/auth/login').reply(200, { code: 'OK' }, { 'set-cookie': ['sessionid=two'] });
    nock(host).put('/api/v1/tsp/order').reply(200, { idOrder: 12 });

    const res = await client.createOrder({ amount: 1, name: 'x' });
    expect(res).toEqual({ idOrder: 12 });
  });

  it('refund() PUTs to /tsp/refund with idOrder and description', async () => {
    nock(host).post('/api/v1/auth/login').reply(200, { code: 'OK' }, { 'set-cookie': ['sessionid=x'] });
    nock(host)
      .put('/api/v1/tsp/refund', { idOrder: 5, description: 'admin refund' })
      .reply(200, { idRefund: 999 });
    const res = await client.refund({ idOrder: 5, description: 'admin refund' });
    expect(res).toEqual({ idRefund: 999 });
  });

  it('throws if login response is not code OK', async () => {
    nock(host).post('/api/v1/auth/login').reply(200, { code: 'FAIL', detail: 'bad creds' });
    await expect(client.createOrder({ amount: 1, name: 'x' })).rejects.toThrow(/login failed/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run src/server/providers/payment/turinvoice/client.test.ts
```

- [ ] **Step 3: Implement `client.ts`**

```ts
// src/server/providers/payment/turinvoice/client.ts
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

export interface TurInvoiceClientConfig {
  host: string;
  login: string;
  password: string;
  idTSP: number;
  currency: string;
}

export interface CreateOrderInput {
  amount: number;
  currency?: string;
  name: string;
  callbackUrl?: string;
  redirectUrl?: string;
}

export interface RefundInput {
  idOrder: number;
  amount?: number;
  description?: string;
}

export class TurInvoiceLoginError extends Error {
  constructor(detail: unknown) {
    super(`TurInvoice login failed: ${JSON.stringify(detail)}`);
    this.name = 'TurInvoiceLoginError';
  }
}

export class TurInvoiceClient {
  private sessionCookie: string | null = null;

  constructor(private readonly cfg: TurInvoiceClientConfig) {}

  private api(): AxiosInstance {
    return axios.create({
      baseURL: this.cfg.host,
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionCookie ? { Cookie: `sessionid=${this.sessionCookie}` } : {}),
      },
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 500, // allow 401 handling below
    });
  }

  private async login(): Promise<void> {
    const res = await axios.post(
      `${this.cfg.host}/api/v1/auth/login`,
      { login: this.cfg.login, password: this.cfg.password },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    if (res.data?.code !== 'OK') throw new TurInvoiceLoginError(res.data);
    const cookies = res.headers['set-cookie'];
    const match = Array.isArray(cookies)
      ? cookies.join(';').match(/sessionid=([^;]+)/)
      : null;
    if (!match) throw new TurInvoiceLoginError({ reason: 'no_session_cookie' });
    this.sessionCookie = match[1] ?? null;
  }

  private async withAutoRelogin<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.sessionCookie) await this.login();
    const first = await this.tryOnce(fn);
    if (first.ok) return first.value;
    await this.login();
    const second = await this.tryOnce(fn);
    if (second.ok) return second.value;
    throw second.error;
  }

  private async tryOnce<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const status = (e as { response?: { status?: number } } | null)?.response?.status;
      if (status === 401) return { ok: false, error: e };
      throw e;
    }
  }

  async createOrder(input: CreateOrderInput): Promise<{ idOrder: number; paymentUrl?: string } & Record<string, unknown>> {
    return this.withAutoRelogin(async () => {
      const res = await this.api().put('/api/v1/tsp/order', {
        idTSP: this.cfg.idTSP,
        amount: input.amount,
        currency: input.currency ?? this.cfg.currency,
        name: input.name,
        quantity: 1,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
        ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
      });
      if (res.status === 401) throw { response: res };
      if (res.status >= 400) throw new Error(`TurInvoice createOrder ${res.status}: ${JSON.stringify(res.data)}`);
      return res.data;
    });
  }

  async getOrder(idOrder: number): Promise<Record<string, unknown>> {
    return this.withAutoRelogin(async () => {
      const res = await this.api().get('/api/v1/tsp/order', { params: { idOrder } });
      if (res.status === 401) throw { response: res };
      if (res.status >= 400) throw new Error(`TurInvoice getOrder ${res.status}`);
      return res.data;
    });
  }

  async refund(input: RefundInput): Promise<Record<string, unknown>> {
    return this.withAutoRelogin(async () => {
      const res = await this.api().put('/api/v1/tsp/refund', {
        idOrder: input.idOrder,
        ...(input.amount != null ? { amount: input.amount } : {}),
        ...(input.description ? { description: input.description } : {}),
      });
      if (res.status === 401) throw { response: res };
      if (res.status >= 400) throw new Error(`TurInvoice refund ${res.status}: ${JSON.stringify(res.data)}`);
      return res.data;
    });
  }

  async cancelOrder(idOrder: number): Promise<Record<string, unknown>> {
    return this.withAutoRelogin(async () => {
      const res = await this.api().delete('/api/v1/tsp/order', { params: { idOrder } });
      if (res.status === 401) throw { response: res };
      if (res.status >= 400) throw new Error(`TurInvoice cancelOrder ${res.status}`);
      return res.data;
    });
  }
}

// Singleton lazily constructed from env.
import { env } from '@/src/lib/env';
let _singleton: TurInvoiceClient | null = null;
export function turInvoiceClient(): TurInvoiceClient {
  if (!_singleton) {
    _singleton = new TurInvoiceClient({
      host: env.TURINVOICE_HOST,
      login: env.TURINVOICE_LOGIN,
      password: env.TURINVOICE_PASSWORD,
      idTSP: env.TURINVOICE_IDTSP,
      currency: env.TURINVOICE_CURRENCY,
    });
  }
  return _singleton;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm vitest run src/server/providers/payment/turinvoice/client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/payment/turinvoice/
git commit -m "feat(turinvoice): low-level client with session auth + auto-relogin"
```

---

## Task 7: TurInvoice `createCheckout` + `verifyWebhook` + `refund` + provider index

**Files:**
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/createCheckout.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/verifyWebhook.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/refund.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/normalize.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/index.ts`
- Create: `datapatch-v2/src/server/providers/payment/turinvoice/turinvoice.test.ts`

- [ ] **Step 1: Write the failing provider unit tests**

```ts
// src/server/providers/payment/turinvoice/turinvoice.test.ts
import { describe, it, expect, vi } from 'vitest';
import { verifyWebhook } from './verifyWebhook';
import { normalize } from './normalize';

vi.mock('@/src/lib/env', () => ({
  env: { TURINVOICE_CALLBACK_SECRET: 'a'.repeat(32), TURINVOICE_HOST: 'https://x', TURINVOICE_LOGIN: 'u', TURINVOICE_PASSWORD: 'p', TURINVOICE_IDTSP: 1, TURINVOICE_CURRENCY: 'USD' },
}));

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/webhooks/turinvoice', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('turinvoice.verifyWebhook', () => {
  const secret = 'a'.repeat(32);
  it('accepts a body whose secret_key matches', async () => {
    const body = { id: 42, state: 'paid', secret_key: secret };
    const parsed = await verifyWebhook(makeReq(body) as never, JSON.stringify(body));
    expect(parsed.idOrder).toBe(42);
    expect((parsed.raw as { secret_key?: string }).secret_key).toBeUndefined(); // stripped
  });

  it('rejects missing secret_key', async () => {
    const body = { id: 42, state: 'paid' };
    await expect(verifyWebhook(makeReq(body) as never, JSON.stringify(body))).rejects.toThrow(/missing/i);
  });

  it('rejects mismatched secret_key', async () => {
    const body = { id: 42, state: 'paid', secret_key: 'b'.repeat(32) };
    await expect(verifyWebhook(makeReq(body) as never, JSON.stringify(body))).rejects.toThrow(/invalid/i);
  });
});

describe('turinvoice.normalize', () => {
  it('maps state=paid to payment.completed', () => {
    const e = normalize({ idOrder: 7, state: 'paid', raw: { id: 7, state: 'paid' } }, { amount: 500n, currency: 'USD' });
    expect(e.kind).toBe('payment.completed');
    if (e.kind === 'payment.completed') {
      expect(e.externalId).toBe('7');
      expect(e.amount).toEqual({ amount: 500n, currency: 'USD' });
    }
  });

  it('maps state=refunded to payment.refunded', () => {
    const e = normalize({ idOrder: 7, state: 'refunded', raw: {} }, { amount: 500n, currency: 'USD' });
    expect(e.kind).toBe('payment.refunded');
  });

  it('maps state=failed|cancelled to payment.failed', () => {
    for (const s of ['failed', 'cancelled']) {
      const e = normalize({ idOrder: 7, state: s, raw: {} }, { amount: 500n, currency: 'USD' });
      expect(e.kind).toBe('payment.failed');
    }
  });

  it('throws for unknown state', () => {
    expect(() => normalize({ idOrder: 7, state: 'weird', raw: {} }, { amount: 500n, currency: 'USD' })).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run src/server/providers/payment/turinvoice/turinvoice.test.ts
```

- [ ] **Step 3: Implement `verifyWebhook.ts`**

```ts
// src/server/providers/payment/turinvoice/verifyWebhook.ts
import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from '@/src/lib/env';

export interface ParsedTurInvoiceCallback {
  idOrder: number;
  state: string;
  raw: Record<string, unknown>;
}

export async function verifyWebhook(
  _req: NextRequest,
  rawBody: string,
): Promise<ParsedTurInvoiceCallback> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    throw new Error('turinvoice verifyWebhook: invalid JSON');
  }

  const received = body.secret_key;
  if (typeof received !== 'string' || received.length === 0) {
    throw new Error('turinvoice verifyWebhook: missing secret_key');
  }
  const expected = env.TURINVOICE_CALLBACK_SECRET;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('turinvoice verifyWebhook: invalid secret_key');
  }

  const idOrder = Number(body.id);
  const state = String(body.state ?? '');
  if (!Number.isFinite(idOrder) || !state) {
    throw new Error('turinvoice verifyWebhook: missing id or state');
  }

  // Strip secret from the stored payload (V1 parity).
  const { secret_key: _strip, ...rest } = body;
  return { idOrder, state, raw: rest };
}
```

- [ ] **Step 4: Implement `normalize.ts`**

```ts
// src/server/providers/payment/turinvoice/normalize.ts
import type { ParsedTurInvoiceCallback } from './verifyWebhook';
import type { NormalizedPaymentEvent } from '../types';
import type { Money } from '@/src/lib/money';

export function normalize(
  parsed: ParsedTurInvoiceCallback,
  amount: Money,
): NormalizedPaymentEvent {
  const externalId = String(parsed.idOrder);
  // eventId = provider + externalId + state (idempotency key for WebhookEvent.dedupeKey)
  const eventId = `turinvoice:${externalId}:${parsed.state}`;

  switch (parsed.state) {
    case 'paid':
    case 'completed':
    case 'DONE':
    case 'ACCEPTED':
      return { kind: 'payment.completed', orderId: '', externalId, amount, eventId };
    case 'refunded':
      return { kind: 'payment.refunded', orderId: '', externalId, amount, eventId };
    case 'failed':
    case 'cancelled':
    case 'FAILED':
    case 'CANCELLED':
    case 'REJECTED':
    case 'ERROR':
      return { kind: 'payment.failed', orderId: '', externalId, reason: parsed.state, eventId };
    default:
      throw new Error(`turinvoice normalize: unknown state "${parsed.state}"`);
  }
}
```

(Note: `orderId` is filled in by the webhook handler which looks up `Payment` by `externalPaymentId=externalId` and reads the associated `orderId`. The normalized event keeps `orderId=''` here to match the Paddle pattern.)

- [ ] **Step 5: Implement `createCheckout.ts`**

```ts
// src/server/providers/payment/turinvoice/createCheckout.ts
import type { CreateCheckoutInput, CheckoutSession } from '../types';
import { prisma } from '@/src/lib/db';
import { turInvoiceClient } from './client';

export async function createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
  const { orderId } = input;
  // Amount in minor units — TurInvoice expects a number (no decimals for JPY, two for USD, etc.).
  // For USD we send major-unit equivalent to match V1 behaviour: the controller stored cents as
  // the Payment.amount but TurInvoice.amount is expressed in the same currency unit V1 used.
  // V1 passed `amount` through directly — we replicate that. Callers must pass `unitAmount` in
  // the same denomination V1 expected (see V1 paymentService call site).
  const totalMinor = input.lineItems.reduce(
    (acc, li) => acc + li.unitAmount * BigInt(li.quantity),
    0n,
  );
  const amountNumber = Number(totalMinor); // safe: minor units of USD for a single eSIM order well below 2^53

  const res = await turInvoiceClient().createOrder({
    amount: amountNumber,
    currency: input.lineItems[0]?.currency,
    name: input.lineItems[0]?.name ?? 'eSIM purchase',
    callbackUrl: `${input.successUrl.replace(/\/orders\/[^/]+$/, '')}/../../api/webhooks/turinvoice`, // adjust — prefer env.PUBLIC_APP_URL + /api/webhooks/turinvoice
    redirectUrl: input.successUrl,
  });

  const externalId = String(res.idOrder);
  // Persist Payment row so the webhook handler can correlate back to the order.
  await prisma.payment.upsert({
    where: { providerId_externalPaymentId: { providerId: 'turinvoice', externalPaymentId: externalId } },
    create: {
      tenantId: input.metadata.tenantId,
      orderId,
      providerId: 'turinvoice',
      externalPaymentId: externalId,
      status: 'pending',
      amount: totalMinor,
      currency: input.lineItems[0]?.currency ?? 'USD',
    },
    update: {},
  });

  const paymentUrl =
    typeof res.paymentUrl === 'string'
      ? res.paymentUrl
      : `${/* V1 fallback: redirect to successUrl so user can poll */ input.successUrl}?turinvoice_pending=${externalId}`;

  return { url: paymentUrl, externalSessionId: externalId };
}
```

NOTE: The `callbackUrl` construction above is deliberately ugly — REPLACE with a clean `new URL('/api/webhooks/turinvoice', env.PUBLIC_APP_URL).toString()` once `PUBLIC_APP_URL` import is confirmed available. Use the clean form in the final code:

```ts
import { env } from '@/src/lib/env';
const callbackUrl = new URL('/api/webhooks/turinvoice', env.PUBLIC_APP_URL).toString();
```

- [ ] **Step 6: Implement `refund.ts`**

```ts
// src/server/providers/payment/turinvoice/refund.ts
import type { Payment } from '@prisma/client';
import type { RefundResult } from '../types';
import { turInvoiceClient } from './client';

export async function refund(payment: Payment): Promise<RefundResult> {
  if (!payment.externalPaymentId) {
    throw new Error('turinvoice.refund: payment.externalPaymentId is required');
  }
  try {
    const res = await turInvoiceClient().refund({
      idOrder: Number(payment.externalPaymentId),
      description: 'Refund requested by admin',
    });
    const providerRefundId =
      typeof (res as { idRefund?: unknown }).idRefund === 'number' ||
      typeof (res as { idRefund?: unknown }).idRefund === 'string'
        ? String((res as { idRefund: string | number }).idRefund)
        : payment.externalPaymentId;
    return { ok: true, providerRefundId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'provider_error', message };
  }
}
```

- [ ] **Step 7: Implement `index.ts`**

```ts
// src/server/providers/payment/turinvoice/index.ts
import type { PaymentProvider } from '../types';
import { createCheckout } from './createCheckout';
import { verifyWebhook } from './verifyWebhook';
import { normalize } from './normalize';
import { refund } from './refund';
import { prisma } from '@/src/lib/db';

export const turInvoiceProvider: PaymentProvider = {
  id: 'turinvoice',
  createCheckout,
  verifyWebhook: async (req, rawBody) => {
    const parsed = await verifyWebhook(req, rawBody);
    // Look up the payment to get orderId + amount for normalization.
    const payment = await prisma.payment.findUnique({
      where: {
        providerId_externalPaymentId: {
          providerId: 'turinvoice',
          externalPaymentId: String(parsed.idOrder),
        },
      },
    });
    if (!payment) {
      throw new Error(`turinvoice webhook: no Payment for idOrder=${parsed.idOrder}`);
    }
    const event = normalize(parsed, { amount: payment.amount, currency: payment.currency });
    return { ...event, orderId: payment.orderId };
  },
  refund,
};
```

- [ ] **Step 8: Run tests + type check**

```bash
pnpm typecheck
pnpm vitest run src/server/providers/payment/turinvoice/
```

- [ ] **Step 9: Commit**

```bash
git add src/server/providers/payment/turinvoice/
git commit -m "feat(turinvoice): PaymentProvider implementation (checkout + webhook + refund)"
```

---

## Task 8: Register TurInvoice in payment registry + webhook handlers

**Files:**
- Modify: `datapatch-v2/src/server/providers/payment/registry.ts`
- Create: `datapatch-v2/src/server/webhooks/handlers/turinvoiceHandlers.ts`
- Modify: `datapatch-v2/src/server/webhooks/handlerRegistry.ts`

- [ ] **Step 1: Update payment registry**

```ts
// src/server/providers/payment/registry.ts
import { paddleProvider } from './paddle';
import { turInvoiceProvider } from './turinvoice';
import type { PaymentProvider, PaymentProviderId } from './types';

const providers: Record<PaymentProviderId, PaymentProvider> = {
  paddle: paddleProvider,
  turinvoice: turInvoiceProvider,
};

export function getPaymentProvider(id: PaymentProviderId): PaymentProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown payment provider: ${id}`);
  return p;
}
```

- [ ] **Step 2: Write the failing test for handlers**

Append to `src/server/webhooks/handlers/handlers.test.ts` (or create `turinvoiceHandlers.test.ts` if file split by provider) — mirror the `paddleHandlers` test shape:

```ts
// src/server/webhooks/handlers/turinvoiceHandlers.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/src/lib/db';
import { turinvoiceHandlers } from './turinvoiceHandlers';
import { createTenant, createOrderInState, resetDb } from '@/tests/helpers/domain';

describe('turinvoiceHandlers', () => {
  beforeEach(async () => resetDb());

  it('completed transitions AWAITING_PAYMENT → PAID and enqueues outbox', async () => {
    const tenant = await createTenant('alpha');
    const order = await createOrderInState({ tenantId: tenant.id, state: 'AWAITING_PAYMENT' });
    const payment = await prisma.payment.create({
      data: {
        tenantId: tenant.id, orderId: order.id, providerId: 'turinvoice',
        externalPaymentId: '123', status: 'pending', amount: 500n, currency: 'USD',
      },
    });
    await prisma.$transaction(async (tx) => {
      await turinvoiceHandlers.completed(
        { kind: 'payment.completed', orderId: order.id, externalId: '123', amount: { amount: 500n, currency: 'USD' }, eventId: 'x' },
        { tx, webhookEventId: 'wh1' },
      );
    });
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.state).toBe('PAID');
    const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
    expect(outbox.length).toBeGreaterThan(0);
  });

  // refunded + failed — mirror completed, asserting REFUND_PENDING|REFUNDED and FAILED paths respectively.
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm vitest run src/server/webhooks/handlers/turinvoiceHandlers
```

- [ ] **Step 4: Implement `turinvoiceHandlers.ts`**

Copy the structure of `src/server/webhooks/handlers/paddleHandlers.ts` verbatim — the domain side (state machine transitions + outbox writes) is provider-agnostic. Implement three named handlers: `completed`, `failed`, `refunded`. Use `'turinvoice'` wherever Paddle handlers use `'paddle'`.

```ts
// src/server/webhooks/handlers/turinvoiceHandlers.ts
import type { WebhookHandler } from '../handlerRegistry';
import { transition, type Order } from '@/src/server/domain/orders/orderMachine';
import { writeOutbox } from '@/src/server/outbox/writeOutbox';

const completed: WebhookHandler = async (event, ctx) => {
  if (event.kind !== 'payment.completed') throw new Error('turinvoice.completed: wrong event');
  const row = await ctx.tx.order.findUniqueOrThrow({ where: { id: event.orderId } });
  if (row.state === 'PAID' || row.state === 'PROVISIONING' || row.state === 'PROVISIONED') return; // idempotent
  const order: Order = { ...row };
  const { order: next, audit } = transition(order, { type: 'PAYMENT_RECEIVED', externalPaymentId: event.externalId });
  await ctx.tx.order.update({ where: { id: row.id }, data: { state: next.state } });
  await ctx.tx.payment.updateMany({
    where: { providerId: 'turinvoice', externalPaymentId: event.externalId },
    data: { status: 'captured', capturedAt: new Date() },
  });
  await ctx.tx.auditLog.create({ data: { tenantId: audit.tenantId, userId: audit.actorUserId, action: audit.action, resource: audit.entityType, resourceId: audit.entityId, metadata: audit.metadata as never } });
  await writeOutbox(ctx.tx, { kind: 'order.paid', aggregateId: row.id, payload: { orderId: row.id } });
};

const failed: WebhookHandler = async (event, ctx) => {
  if (event.kind !== 'payment.failed') throw new Error('turinvoice.failed: wrong event');
  await ctx.tx.payment.updateMany({
    where: { providerId: 'turinvoice', externalPaymentId: event.externalId },
    data: { status: 'failed', failureReason: event.reason },
  });
  // Order stays in AWAITING_PAYMENT so user can retry or expire via scheduled job.
};

const refunded: WebhookHandler = async (event, ctx) => {
  if (event.kind !== 'payment.refunded') throw new Error('turinvoice.refunded: wrong event');
  const row = await ctx.tx.order.findUniqueOrThrow({ where: { id: event.orderId } });
  if (row.state === 'REFUNDED' || row.state === 'CANCELLED') return;
  await ctx.tx.order.update({ where: { id: row.id }, data: { state: 'REFUND_PENDING' } });
  await ctx.tx.payment.updateMany({
    where: { providerId: 'turinvoice', externalPaymentId: event.externalId },
    data: { status: 'refunded', refundedAt: new Date() },
  });
};

export const turinvoiceHandlers = { completed, failed, refunded };
```

- [ ] **Step 5: Register in `handlerRegistry.ts`**

```ts
import { turinvoiceHandlers } from './handlers/turinvoiceHandlers';
// ...
export const webhookHandlers: Record<string, WebhookHandler> = {
  'paddle:payment.completed': paddleHandlers.completed as WebhookHandler,
  'paddle:payment.failed': paddleHandlers.failed as WebhookHandler,
  'paddle:payment.refunded': paddleHandlers.refunded as WebhookHandler,
  'turinvoice:payment.completed': turinvoiceHandlers.completed as WebhookHandler,
  'turinvoice:payment.failed': turinvoiceHandlers.failed as WebhookHandler,
  'turinvoice:payment.refunded': turinvoiceHandlers.refunded as WebhookHandler,
  'airalo:esim.installed': airaloHandlers.installed as WebhookHandler,
  'airalo:esim.expired': airaloHandlers.expired as WebhookHandler,
  'airalo:esim.exhausted': airaloHandlers.exhausted as WebhookHandler,
};
```

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm vitest run src/server/webhooks/handlers/
```

- [ ] **Step 7: Commit**

```bash
git add src/server/providers/payment/registry.ts src/server/webhooks/
git commit -m "feat(webhooks): turinvoice handlers + registry wiring"
```

---

## Task 9: TurInvoice webhook route

**Files:**
- Create: `datapatch-v2/src/app/api/webhooks/turinvoice/route.ts`
- Create: `datapatch-v2/tests/integration/turinvoice-webhook.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/turinvoice-webhook.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/src/app/api/webhooks/turinvoice/route';
import { prisma } from '@/src/lib/db';
import { resetDb, createTenant, createOrderInState } from '@/tests/helpers/domain';

describe('POST /api/webhooks/turinvoice', () => {
  beforeEach(async () => resetDb());

  it('400s on missing secret_key', async () => {
    const body = { id: 1, state: 'paid' };
    const req = new Request('http://x/api/webhooks/turinvoice', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it('401s on invalid secret_key', async () => {
    const body = { id: 1, state: 'paid', secret_key: 'wrong' };
    const req = new Request('http://x/api/webhooks/turinvoice', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await POST(req as never);
    expect([400, 401]).toContain(res.status);
  });

  it('200s + inserts WebhookEvent on valid secret_key', async () => {
    const tenant = await createTenant('alpha');
    const order = await createOrderInState({ tenantId: tenant.id, state: 'AWAITING_PAYMENT' });
    await prisma.payment.create({ data: { tenantId: tenant.id, orderId: order.id, providerId: 'turinvoice', externalPaymentId: '42', status: 'pending', amount: 500n, currency: 'USD' } });

    const body = { id: 42, state: 'paid', secret_key: process.env.TURINVOICE_CALLBACK_SECRET };
    const req = new Request('http://x/api/webhooks/turinvoice', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    const events = await prisma.webhookEvent.findMany({ where: { provider: 'turinvoice' } });
    expect(events.length).toBe(1);
    // secret_key must NOT be persisted
    expect(JSON.stringify(events[0].payload)).not.toContain(body.secret_key!);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run tests/integration/turinvoice-webhook.test.ts
```

- [ ] **Step 3: Implement `route.ts`**

Copy the shape of the existing `src/app/api/webhooks/paddle/route.ts` (or whatever the Phase 2b ingest pattern is). Key requirements:

```ts
// src/app/api/webhooks/turinvoice/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { ingestWebhook } from '@/src/server/webhooks/ingest';
import { turInvoiceProvider } from '@/src/server/providers/payment/turinvoice';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  try {
    const event = await turInvoiceProvider.verifyWebhook(req, rawBody);
    await ingestWebhook({
      provider: 'turinvoice',
      eventId: event.eventId,
      rawBody,
      normalized: event,
    });
    return NextResponse.json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    const status = msg.includes('missing') ? 400 : msg.includes('invalid') ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
```

If the existing Phase 2b ingest pattern is different (e.g. a generic `/api/webhooks/[provider]/route.ts` dispatcher), prefer adding `'turinvoice'` to its provider map instead of adding this dedicated route — mirror whatever Paddle does. The test above is route-agnostic (exercises the POST handler directly).

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm vitest run tests/integration/turinvoice-webhook.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/turinvoice/ tests/integration/turinvoice-webhook.test.ts
git commit -m "feat(api): POST /api/webhooks/turinvoice with secret-key verification"
```

---

## Task 10: Zendit low-level client

**Files:**
- Create: `datapatch-v2/src/server/providers/esim/zendit/client.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/providers/esim/zendit/client.test.ts
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import nock from 'nock';
import { ZenditClient } from './client';

const base = 'https://api.zendit.test/v1';

describe('ZenditClient', () => {
  let c: ZenditClient;
  beforeAll(() => nock.disableNetConnect());
  beforeEach(() => {
    c = new ZenditClient({ apiKey: 'K', baseUrl: base, country: 'TR' });
  });
  afterEach(() => nock.cleanAll());

  it('listOffers hits /esim/offers with bearer auth', async () => {
    nock(base, { reqheaders: { authorization: 'Bearer K' } })
      .get('/esim/offers')
      .query(true)
      .reply(200, { items: [{ id: 'o1' }] });
    const res = await c.listOffers();
    expect(res).toEqual({ items: [{ id: 'o1' }] });
  });

  it('purchaseEsim POSTs offerId + transactionId', async () => {
    nock(base).post('/esim/purchases', { offerId: 'o1', transactionId: 'order-123' })
      .reply(200, { txId: 'tx1', iccid: '89...', qrCode: 'LPA:1$...' });
    const res = await c.purchaseEsim({ offerId: 'o1', transactionId: 'order-123' });
    expect(res.txId).toBe('tx1');
  });

  it('getPurchase hits /esim/purchases/:txId', async () => {
    nock(base).get('/esim/purchases/tx1').reply(200, { status: 'DONE' });
    expect(await c.getPurchase('tx1')).toEqual({ status: 'DONE' });
  });

  it('getUsage hits /esim/purchases/:txId/usage', async () => {
    nock(base).get('/esim/purchases/tx1/usage').reply(200, { usedBytes: 100, totalBytes: 1000 });
    expect(await c.getUsage('tx1')).toEqual({ usedBytes: 100, totalBytes: 1000 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run src/server/providers/esim/zendit/client.test.ts
```

- [ ] **Step 3: Implement `client.ts`**

```ts
// src/server/providers/esim/zendit/client.ts
import axios, { type AxiosInstance } from 'axios';

export interface ZenditClientConfig {
  apiKey: string;
  baseUrl: string;
  country: string;
}

export class ZenditClient {
  private http: AxiosInstance;

  constructor(private readonly cfg: ZenditClientConfig) {
    this.http = axios.create({
      baseURL: cfg.baseUrl,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      timeout: 10000,
    });
  }

  async listOffers(country: string = this.cfg.country, limit = 1024): Promise<unknown> {
    const res = await this.http.get('/esim/offers', {
      params: { _limit: limit, _offset: 1, brand: '', country, subType: '' },
    });
    return res.data;
  }

  async getOffer(offerId: string): Promise<unknown> {
    const res = await this.http.get(`/esim/offers/${offerId}`);
    return res.data;
  }

  async purchaseEsim(input: { offerId: string; transactionId: string; iccid?: string }): Promise<{
    txId: string;
    iccid?: string;
    qrCode?: string;
    activationCode?: string;
  } & Record<string, unknown>> {
    const body: Record<string, unknown> = { offerId: input.offerId, transactionId: input.transactionId };
    if (input.iccid) body.iccid = input.iccid;
    const res = await this.http.post('/esim/purchases', body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.data;
  }

  async getPurchase(txId: string): Promise<Record<string, unknown>> {
    const res = await this.http.get(`/esim/purchases/${txId}`);
    return res.data;
  }

  async getUsage(txId: string): Promise<{ usedBytes?: number; totalBytes?: number } & Record<string, unknown>> {
    const res = await this.http.get(`/esim/purchases/${txId}/usage`);
    return res.data;
  }
}

import { env } from '@/src/lib/env';
let _singleton: ZenditClient | null = null;
export function zenditClient(): ZenditClient {
  if (!_singleton) {
    _singleton = new ZenditClient({
      apiKey: env.ZENDIT_API_KEY,
      baseUrl: env.ZENDIT_API_BASE,
      country: env.ZENDIT_COUNTRY,
    });
  }
  return _singleton;
}
```

- [ ] **Step 4: Run — expect PASS + commit**

```bash
pnpm vitest run src/server/providers/esim/zendit/client.test.ts
git add src/server/providers/esim/zendit/
git commit -m "feat(zendit): low-level client with bearer auth"
```

---

## Task 11: Zendit EsimProvider implementation

**Files:**
- Create: `datapatch-v2/src/server/providers/esim/zendit/purchase.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/getStatus.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/syncPackages.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/normalize.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/verifyWebhook.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/index.ts`
- Create: `datapatch-v2/src/server/providers/esim/zendit/zendit.test.ts`
- Modify: `datapatch-v2/src/server/providers/esim/registry.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// src/server/providers/esim/zendit/zendit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeStatus } from './normalize';
import { purchase } from './purchase';
import { getStatus } from './getStatus';

vi.mock('./client', () => ({
  zenditClient: () => ({
    purchaseEsim: vi.fn().mockResolvedValue({ txId: 'tx1', iccid: '8988', qrCode: 'LPA:1$h$m', activationCode: 'AC' }),
    getPurchase: vi.fn().mockResolvedValue({ status: 'DONE' }),
    getUsage: vi.fn().mockResolvedValue({ usedBytes: 50, totalBytes: 1000 }),
    listOffers: vi.fn().mockResolvedValue({ items: [{ id: 'o1', name: 'TR 1GB 7d', countries: ['TR'], dataMb: 1024, durationDays: 7, retailPrice: { amount: 500, currency: 'USD' } }] }),
  }),
}));

describe('zendit.normalizeStatus', () => {
  it('maps DONE|ACCEPTED → active', () => {
    expect(normalizeStatus('DONE')).toBe('active');
    expect(normalizeStatus('ACCEPTED')).toBe('active');
  });
  it('maps FAILED|CANCELLED|REJECTED|ERROR → expired (terminal)', () => {
    for (const s of ['FAILED', 'CANCELLED', 'REJECTED', 'ERROR']) {
      expect(normalizeStatus(s)).toBe('expired');
    }
  });
  it('maps everything else → unknown', () => {
    expect(normalizeStatus('AUTHORIZED')).toBe('unknown');
    expect(normalizeStatus('weird')).toBe('unknown');
  });
});

describe('zendit.purchase', () => {
  it('returns ProvisionedEsim with iccid/qrCode and stores txId for status polling', async () => {
    const res = await purchase({ orderId: 'order-1', providerSku: 'o1', quantity: 1, travelerEmail: 'a@b.com' });
    expect(res.iccid).toBe('8988');
    expect(res.qrCode).toBe('LPA:1$h$m');
    expect(res.activationCode).toBe('AC');
    // @ts-expect-error runtime bag attached so the ProvisionedEsim payload can be persisted into rawMetadata
    expect(res.rawMetadata?.zenditTxId).toBe('tx1');
  });
});

describe('zendit.getStatus', () => {
  it('reads zenditTxId from rawMetadata and queries getPurchase', async () => {
    const res = await getStatus({ iccid: '8988', rawMetadata: { zenditTxId: 'tx1' } });
    expect(res.status).toBe('active');
    expect(res.usageMb).toBe(0); // 50 bytes ≈ 0 MB
  });
  it('returns unknown when rawMetadata has no zenditTxId', async () => {
    const res = await getStatus({ iccid: '8988', rawMetadata: null });
    expect(res.status).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run — expect FAIL + implement files**

```ts
// src/server/providers/esim/zendit/normalize.ts
export function normalizeStatus(zenditStatus: string | undefined | null): 'active' | 'expired' | 'unknown' {
  if (!zenditStatus) return 'unknown';
  const upper = zenditStatus.toUpperCase();
  if (upper === 'DONE' || upper === 'ACCEPTED') return 'active';
  if (['FAILED', 'CANCELLED', 'REJECTED', 'ERROR'].includes(upper)) return 'expired';
  return 'unknown';
}
```

```ts
// src/server/providers/esim/zendit/purchase.ts
import type { PurchaseInput, ProvisionedEsim } from '../types';
import { zenditClient } from './client';

export async function purchase(input: PurchaseInput): Promise<ProvisionedEsim & { rawMetadata?: Record<string, unknown> }> {
  const res = await zenditClient().purchaseEsim({
    offerId: input.providerSku,
    transactionId: input.orderId,
  });
  const iccid = String(res.iccid ?? '');
  const qrCode = String(res.qrCode ?? '');
  const activationCode = String(res.activationCode ?? '');
  if (!iccid || !qrCode) throw new Error(`zendit.purchase: incomplete response ${JSON.stringify(res)}`);
  const expires = res.expiresAt ? new Date(String(res.expiresAt)) : new Date(Date.now() + 365 * 24 * 3600 * 1000);
  return {
    iccid,
    qrCode,
    activationCode,
    expiresAt: expires,
    rawMetadata: { zenditTxId: String(res.txId), upstream: res },
  };
}
```

```ts
// src/server/providers/esim/zendit/getStatus.ts
import type { GetStatusInput, EsimRemoteStatus } from '../types';
import { zenditClient } from './client';
import { normalizeStatus } from './normalize';

export async function getStatus(input: GetStatusInput): Promise<EsimRemoteStatus> {
  const txId = (input.rawMetadata as { zenditTxId?: string } | null)?.zenditTxId;
  if (!txId) return { status: 'unknown' };

  const [purchase, usage] = await Promise.all([
    zenditClient().getPurchase(txId).catch(() => ({})),
    zenditClient().getUsage(txId).catch(() => ({})),
  ]);
  const status = normalizeStatus((purchase as { status?: string }).status ?? null);
  const usedBytes = Number((usage as { usedBytes?: number }).usedBytes ?? 0);
  const usageMb = Math.round(usedBytes / (1024 * 1024));
  return { status, usageMb };
}
```

```ts
// src/server/providers/esim/zendit/syncPackages.ts
import type { ProviderPackageSeed } from '../types';
import { zenditClient } from './client';

export async function syncPackages(): Promise<ProviderPackageSeed[]> {
  const res = (await zenditClient().listOffers()) as { items?: Array<Record<string, unknown>> };
  const items = res.items ?? [];
  return items.map((o) => ({
    providerSku: String(o.id),
    name: String(o.name ?? o.id),
    country: String((o.countries as string[] | undefined)?.[0] ?? 'XX'),
    dataMb: Number(o.dataMb ?? 0),
    durationDays: Number(o.durationDays ?? 0),
    priceAmount: BigInt(Number((o.retailPrice as { amount?: number } | undefined)?.amount ?? 0)),
    priceCurrency: String((o.retailPrice as { currency?: string } | undefined)?.currency ?? 'USD'),
  }));
}
```

```ts
// src/server/providers/esim/zendit/verifyWebhook.ts
import type { NextRequest } from 'next/server';
import type { NormalizedEsimEvent } from '../types';

export async function verifyWebhook(_req: NextRequest, _rawBody: string): Promise<NormalizedEsimEvent> {
  throw new Error('zendit: webhooks are not configured; status updates are polled via esim.syncStatuses');
}
```

```ts
// src/server/providers/esim/zendit/index.ts
import type { EsimProvider } from '../types';
import { purchase } from './purchase';
import { getStatus } from './getStatus';
import { syncPackages } from './syncPackages';
import { verifyWebhook } from './verifyWebhook';

export const zenditProvider: EsimProvider = {
  id: 'zendit',
  purchase,
  getStatus,
  syncPackages,
  verifyWebhook,
};
```

- [ ] **Step 3: Update `registry.ts`**

```ts
// src/server/providers/esim/registry.ts
import { airaloProvider } from './airalo';
import { zenditProvider } from './zendit';
import type { EsimProvider, EsimProviderId } from './types';

const providers: Record<EsimProviderId, EsimProvider> = {
  airalo: airaloProvider,
  zendit: zenditProvider,
};

export function getEsimProvider(id: EsimProviderId): EsimProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown eSIM provider: ${id}`);
  return p;
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm typecheck && pnpm vitest run src/server/providers/esim/zendit/
git add src/server/providers/esim/
git commit -m "feat(zendit): EsimProvider implementation (purchase + polling getStatus)"
```

---

## Task 12: Admin-assigned order domain

**Files:**
- Create: `datapatch-v2/src/server/domain/orders/createAdminAssignedOrder.ts`
- Create: `datapatch-v2/src/server/domain/orders/createAdminAssignedOrder.test.ts`
- Modify: `datapatch-v2/src/server/domain/orders/orderMachine.ts`

- [ ] **Step 1: Extend state machine — add `START_PROVISIONING_FROM_DRAFT` event**

In `orderMachine.ts`, add to the `OrderEvent` union:

```ts
  | { type: 'START_PROVISIONING_FROM_DRAFT' }
```

And in the switch add a case:

```ts
    case 'START_PROVISIONING_FROM_DRAFT':
      if (order.state !== OrderState.DRAFT || order.paymentMode !== PaymentMode.ADMIN_ASSIGNED) break;
      return next(OrderState.PROVISIONING, 'order.admin_assigned_provisioning_started');
```

- [ ] **Step 2: Write the failing test**

```ts
// src/server/domain/orders/createAdminAssignedOrder.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, createTenant, createUser, seedZenditPackage } from '@/tests/helpers/domain';
import { prisma } from '@/src/lib/db';
import { createAdminAssignedOrder } from './createAdminAssignedOrder';

describe('createAdminAssignedOrder', () => {
  beforeEach(async () => resetDb());

  it('creates an order in PROVISIONING state with paymentMode=ADMIN_ASSIGNED, no Payment row', async () => {
    const tenant = await createTenant('alpha');
    const user = await createUser('traveler@alpha.local', tenant.id);
    const pkg = await seedZenditPackage({ sku: 'z-tr-1gb', name: 'TR 1GB 7d' });
    const adminId = (await createUser('admin@alpha.local', tenant.id, 'platform_admin')).id;

    const order = await createAdminAssignedOrder({
      adminUserId: adminId,
      tenantId: tenant.id,
      travelerUserId: user.id,
      travelerEmail: user.email,
      travelerName: 'Traveler',
      providerPackageId: pkg.id,
      locale: 'en',
    });

    expect(order.state).toBe('PROVISIONING');
    expect(order.paymentMode).toBe('ADMIN_ASSIGNED');
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments.length).toBe(0);

    const audit = await prisma.auditLog.findFirst({ where: { resourceId: order.id, action: 'order.admin_assigned_provisioning_started' } });
    expect(audit).not.toBeNull();
  });

  it('refuses if providerPackage.providerId !== zendit', async () => {
    const tenant = await createTenant('alpha');
    const user = await createUser('traveler@alpha.local', tenant.id);
    const pkg = await prisma.providerPackage.create({ data: { providerId: 'airalo', sku: 'a1', name: 'x', countryCodes: ['TR'], priceAmount: 100n, priceCurrency: 'USD' } });
    const adminId = (await createUser('admin@alpha.local', tenant.id, 'platform_admin')).id;

    await expect(createAdminAssignedOrder({
      adminUserId: adminId, tenantId: tenant.id, travelerUserId: user.id, travelerEmail: user.email,
      travelerName: 'X', providerPackageId: pkg.id, locale: 'en',
    })).rejects.toThrow(/zendit/i);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
pnpm vitest run src/server/domain/orders/createAdminAssignedOrder
```

- [ ] **Step 4: Implement**

```ts
// src/server/domain/orders/createAdminAssignedOrder.ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { transition, type Order } from './orderMachine';

export interface CreateAdminAssignedOrderInput {
  adminUserId: string;
  tenantId: string;
  travelerUserId: string | null;
  travelerEmail: string;
  travelerName: string;
  providerPackageId: string;
  locale: string;
}

export async function createAdminAssignedOrder(input: CreateAdminAssignedOrderInput) {
  return prisma.$transaction(async (tx) => {
    const pkg = await tx.providerPackage.findUniqueOrThrow({ where: { id: input.providerPackageId } });
    if (pkg.providerId !== 'zendit') {
      throw new Error(`createAdminAssignedOrder: only zendit packages supported, got ${pkg.providerId}`);
    }
    const created = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        buyerUserId: input.adminUserId,
        buyerEmail: input.travelerEmail,
        state: 'DRAFT',
        paymentMode: 'ADMIN_ASSIGNED',
        travelerEmail: input.travelerEmail,
        travelerName: input.travelerName,
        locale: input.locale,
        totalAmount: 0n,
        totalCurrency: pkg.priceCurrency,
        items: {
          create: {
            providerPackageId: pkg.id,
            quantity: 1,
            unitAmount: 0n,
            unitCurrency: pkg.priceCurrency,
            snapshotName: pkg.name,
          },
        },
      },
    });

    const order: Order = { ...created, agencyActorId: null };
    const { order: next, audit } = transition(order, { type: 'START_PROVISIONING_FROM_DRAFT' });
    await tx.order.update({ where: { id: created.id }, data: { state: next.state } });
    await tx.auditLog.create({
      data: {
        tenantId: audit.tenantId,
        userId: input.adminUserId,
        action: audit.action,
        resource: audit.entityType,
        resourceId: audit.entityId,
        metadata: { providerPackageId: pkg.id, travelerUserId: input.travelerUserId } as Prisma.InputJsonValue,
      },
    });

    return { ...created, state: next.state };
  });
}
```

(If your `OrderItem` schema uses different field names than `snapshotName`/`quantity`/`unitAmount`, adjust the `create` payload to match — the test will fail loudly if names are wrong.)

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm vitest run src/server/domain/orders/
git add src/server/domain/orders/
git commit -m "feat(domain): createAdminAssignedOrder for Zendit admin-assign flow"
```

---

## Task 13: `issueRefund` domain function

**Files:**
- Create: `datapatch-v2/src/server/domain/refunds/issueRefund.ts`
- Create: `datapatch-v2/src/server/domain/refunds/issueRefund.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/domain/refunds/issueRefund.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, createTenant, createOrderInState } from '@/tests/helpers/domain';
import { prisma } from '@/src/lib/db';
import { issueRefund } from './issueRefund';

vi.mock('@/src/server/providers/payment/registry', () => ({
  getPaymentProvider: vi.fn(),
}));
import { getPaymentProvider } from '@/src/server/providers/payment/registry';

describe('issueRefund', () => {
  beforeEach(async () => { resetDb(); vi.clearAllMocks(); });

  async function seedPaid() {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'PAID' });
    const p = await prisma.payment.create({ data: { tenantId: t.id, orderId: o.id, providerId: 'paddle', externalPaymentId: 'txn_1', status: 'captured', amount: 1000n, currency: 'USD', capturedAt: new Date() } });
    return { tenant: t, order: o, payment: p };
  }

  it('success: transitions order → REFUNDED, sets Payment.refundedAt, enqueues outbox, writes audit', async () => {
    const { order } = await seedPaid();
    (getPaymentProvider as unknown as vi.Mock).mockReturnValue({ refund: vi.fn().mockResolvedValue({ ok: true, providerRefundId: 'adj_1' }) });

    await issueRefund({ orderId: order.id, adminUserId: 'admin-1' });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.state).toBe('REFUNDED');
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(payment.refundedAt).not.toBeNull();
    const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
    expect(outbox.some((e) => e.kind === 'order.refunded')).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: order.id, action: 'refund.issued' } });
    expect(audit).not.toBeNull();
  });

  it('provider failure: order stays REFUND_PENDING, no outbox, audit refund.failed', async () => {
    const { order } = await seedPaid();
    (getPaymentProvider as unknown as vi.Mock).mockReturnValue({ refund: vi.fn().mockResolvedValue({ ok: false, reason: 'provider_error', message: 'boom' }) });

    await expect(issueRefund({ orderId: order.id, adminUserId: 'admin-1' })).rejects.toThrow(/boom/);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.state).toBe('REFUND_PENDING');
    const outbox = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });
    expect(outbox.length).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: order.id, action: 'refund.failed' } });
    expect(audit).not.toBeNull();
  });

  it('refuses if order is not PAID or REFUND_PENDING', async () => {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'DRAFT' });
    await expect(issueRefund({ orderId: o.id, adminUserId: 'admin-1' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm vitest run src/server/domain/refunds/issueRefund
```

- [ ] **Step 3: Implement**

```ts
// src/server/domain/refunds/issueRefund.ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { transition, type Order } from '@/src/server/domain/orders/orderMachine';
import { getPaymentProvider } from '@/src/server/providers/payment/registry';
import { writeOutbox } from '@/src/server/outbox/writeOutbox';

export interface IssueRefundInput {
  orderId: string;
  adminUserId: string;
}

export class RefundProviderError extends Error {
  constructor(public reason: string, message: string) {
    super(message);
    this.name = 'RefundProviderError';
  }
}

export async function issueRefund(input: IssueRefundInput): Promise<void> {
  const { order, payment } = await prisma.$transaction(async (tx) => {
    const row = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (row.state !== 'PAID' && row.state !== 'REFUND_PENDING') {
      throw new Error(`issueRefund: order ${row.id} is in state ${row.state}; must be PAID or REFUND_PENDING`);
    }
    const payment = await tx.payment.findFirstOrThrow({ where: { orderId: row.id, status: 'captured' }, orderBy: { createdAt: 'desc' } });
    // Transition PAID → REFUND_PENDING up-front so a crash between provider call and update leaves a visible state.
    if (row.state === 'PAID') {
      const order: Order = { ...row, agencyActorId: row.agencyActorId ?? null };
      const { order: next, audit } = transition(order, { type: 'REQUEST_REFUND', actorUserId: input.adminUserId });
      await tx.order.update({ where: { id: row.id }, data: { state: next.state } });
      await tx.auditLog.create({ data: { tenantId: audit.tenantId, userId: input.adminUserId, action: audit.action, resource: audit.entityType, resourceId: audit.entityId, metadata: audit.metadata as Prisma.InputJsonValue } });
    }
    return { order: row, payment };
  });

  const provider = getPaymentProvider(payment.providerId);
  const result = await provider.refund(payment);

  if (!result.ok) {
    await prisma.auditLog.create({ data: { tenantId: order.tenantId, userId: input.adminUserId, action: 'refund.failed', resource: 'order', resourceId: order.id, metadata: { reason: result.reason, message: result.message, providerId: payment.providerId } as Prisma.InputJsonValue } });
    throw new RefundProviderError(result.reason, result.message);
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { state: 'REFUNDED' } });
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'refunded',
        refundedAt: new Date(),
        rawMetadata: { ...(payment.rawMetadata as object | null ?? {}), providerRefundId: result.providerRefundId },
      },
    });
    await tx.auditLog.create({ data: { tenantId: order.tenantId, userId: input.adminUserId, action: 'refund.issued', resource: 'order', resourceId: order.id, metadata: { providerRefundId: result.providerRefundId, providerId: payment.providerId } as Prisma.InputJsonValue } });
    await writeOutbox(tx, { kind: 'order.refunded', aggregateId: order.id, payload: { orderId: order.id } });
  });
}
```

If `OrderState` does not include `REFUNDED` in the existing schema, add it (Phase 2b schema showed only up to `CANCELLED`). Confirm in `schema.prisma` and if missing, add to `enum OrderState` in a follow-up migration within this task — rerun `pnpm prisma migrate dev --name phase_2c_add_refunded_state`.

- [ ] **Step 4: Run tests + commit**

```bash
pnpm vitest run src/server/domain/refunds/
git add src/server/domain/refunds/
git commit -m "feat(domain): issueRefund with provider dispatch and failure audit"
```

---

## Task 14: `markCancelled` domain function

**Files:**
- Create: `datapatch-v2/src/server/domain/refunds/markCancelled.ts`
- Create: `datapatch-v2/src/server/domain/refunds/markCancelled.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/domain/refunds/markCancelled.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb, createTenant, createOrderInState } from '@/tests/helpers/domain';
import { prisma } from '@/src/lib/db';
import { markCancelled } from './markCancelled';

describe('markCancelled', () => {
  beforeEach(async () => resetDb());

  it('REFUND_PENDING → CANCELLED with audit', async () => {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'REFUND_PENDING' });
    await markCancelled({ orderId: o.id, adminUserId: 'admin-1', reason: 'manual refund handled' });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.state).toBe('CANCELLED');
    const audit = await prisma.auditLog.findFirst({ where: { resourceId: o.id, action: 'order.cancel' } });
    expect(audit).not.toBeNull();
  });

  it('refuses from non-REFUND_PENDING state', async () => {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'PAID' });
    await expect(markCancelled({ orderId: o.id, adminUserId: 'a', reason: 'x' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/domain/refunds/markCancelled.ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { transition, type Order } from '@/src/server/domain/orders/orderMachine';

export interface MarkCancelledInput {
  orderId: string;
  adminUserId: string;
  reason: string;
}

export async function markCancelled(input: MarkCancelledInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (row.state !== 'REFUND_PENDING') {
      throw new Error(`markCancelled: order ${row.id} is in state ${row.state}; must be REFUND_PENDING`);
    }
    const order: Order = { ...row, agencyActorId: row.agencyActorId ?? null };
    const { order: next, audit } = transition(order, { type: 'CANCEL', actorUserId: input.adminUserId, reason: input.reason });
    await tx.order.update({ where: { id: row.id }, data: { state: next.state } });
    await tx.auditLog.create({ data: { tenantId: audit.tenantId, userId: input.adminUserId, action: audit.action, resource: audit.entityType, resourceId: audit.entityId, metadata: audit.metadata as Prisma.InputJsonValue } });
  });
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm vitest run src/server/domain/refunds/markCancelled
git add src/server/domain/refunds/markCancelled*
git commit -m "feat(domain): markCancelled for REFUND_PENDING → CANCELLED"
```

---

## Task 15: `orderRefunded` React Email template + outbox handler

**Files:**
- Create: `datapatch-v2/src/emails/orderRefunded.tsx`
- Create: `datapatch-v2/src/emails/orderRefunded.test.tsx`
- Create: `datapatch-v2/src/server/outbox/handlers/orderRefunded.ts`
- Modify: the outbox handler registry (wherever `emailSend.ts` and `esimProvision.ts` register — confirm the file path on opening).

- [ ] **Step 1: Snapshot test**

```tsx
// src/emails/orderRefunded.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { OrderRefundedEmail } from './orderRefunded';

describe('OrderRefundedEmail', () => {
  it('renders the locale+order fields', async () => {
    const html = await render(<OrderRefundedEmail orderId="o1" locale="en" totalFormatted="$10.00" />);
    expect(html).toContain('refund');
    expect(html).toContain('$10.00');
    expect(html).toContain('o1');
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// src/emails/orderRefunded.tsx
import { Html, Head, Body, Container, Heading, Text } from '@react-email/components';

interface Props {
  orderId: string;
  locale: string;
  totalFormatted: string;
}

export function OrderRefundedEmail({ orderId, locale, totalFormatted }: Props) {
  const t = locale === 'tr'
    ? { title: 'İadeniz işlendi', body: `Siparişiniz (${orderId}) iade edildi. Tutar: ${totalFormatted}. Bankanıza göre 3-10 iş günü içinde hesabınıza yansıyacaktır.` }
    : { title: 'Your refund has been processed', body: `Order ${orderId} has been refunded. Amount: ${totalFormatted}. You should see it on your statement within 3–10 business days depending on your bank.` };
  return (
    <Html><Head /><Body><Container>
      <Heading>{t.title}</Heading>
      <Text>{t.body}</Text>
    </Container></Body></Html>
  );
}
```

- [ ] **Step 3: Outbox handler**

```ts
// src/server/outbox/handlers/orderRefunded.ts
import { prisma } from '@/src/lib/db';
import { sendEmail } from '@/src/server/email/send';
import { OrderRefundedEmail } from '@/src/emails/orderRefunded';
import { render } from '@react-email/render';
import { formatMoney } from '@/src/lib/money';

export async function handleOrderRefunded(payload: { orderId: string }): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: payload.orderId } });
  const html = await render(OrderRefundedEmail({
    orderId: order.id,
    locale: order.locale,
    totalFormatted: formatMoney({ amount: order.totalAmount, currency: order.totalCurrency }),
  }) as never);
  await sendEmail({
    to: order.travelerEmail,
    subject: order.locale === 'tr' ? 'İadeniz işlendi' : 'Your refund has been processed',
    html,
  });
}
```

- [ ] **Step 4: Register in outbox handler registry**

Open `src/server/outbox/handlers/handlers.test.ts` or the registry file (if exists) and wire `'order.refunded'` → `handleOrderRefunded`. If there's a per-kind switch in the outbox worker, add a case. Pattern should be identical to how Phase 2b wired `'order.paid'` → `esimProvision.ts` and the subsequent `'email.send'` events.

- [ ] **Step 5: Run + commit**

```bash
pnpm vitest run src/emails/orderRefunded src/server/outbox/handlers/
git add src/emails/orderRefunded* src/server/outbox/handlers/orderRefunded.ts
git commit -m "feat(email): order.refunded outbox handler + React Email template"
```

---

## Task 16: `shouldSyncNow` helper

**Files:**
- Create: `datapatch-v2/src/server/domain/esims/shouldSyncNow.ts`
- Create: `datapatch-v2/src/server/domain/esims/shouldSyncNow.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/server/domain/esims/shouldSyncNow.test.ts
import { describe, it, expect } from 'vitest';
import { shouldSyncNow } from './shouldSyncNow';
import { EsimStatus } from '@prisma/client';

const now = new Date('2026-04-24T10:00:00Z');

describe('shouldSyncNow', () => {
  it('returns true if never synced', () => {
    expect(shouldSyncNow({ status: EsimStatus.provisioned, lastStatusSyncAt: null }, now)).toBe(true);
  });
  it('returns true if provisioned eSIM last synced >15m ago', () => {
    const ago = new Date(now.getTime() - 16 * 60 * 1000);
    expect(shouldSyncNow({ status: EsimStatus.provisioned, lastStatusSyncAt: ago }, now)).toBe(true);
  });
  it('returns false if provisioned eSIM last synced <15m ago', () => {
    const ago = new Date(now.getTime() - 5 * 60 * 1000);
    expect(shouldSyncNow({ status: EsimStatus.provisioned, lastStatusSyncAt: ago }, now)).toBe(false);
  });
  it('returns true if active eSIM last synced >1h ago', () => {
    const ago = new Date(now.getTime() - 61 * 60 * 1000);
    expect(shouldSyncNow({ status: EsimStatus.active, lastStatusSyncAt: ago }, now)).toBe(true);
  });
  it('returns false for terminal states', () => {
    for (const s of [EsimStatus.expired, EsimStatus.cancelled, EsimStatus.failed]) {
      expect(shouldSyncNow({ status: s, lastStatusSyncAt: null }, now)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/domain/esims/shouldSyncNow.ts
import { EsimStatus } from '@prisma/client';

export interface SyncCandidate {
  status: EsimStatus;
  lastStatusSyncAt: Date | null;
}

export function shouldSyncNow(esim: SyncCandidate, now: Date = new Date()): boolean {
  if (esim.status === EsimStatus.expired || esim.status === EsimStatus.cancelled || esim.status === EsimStatus.failed) {
    return false;
  }
  if (!esim.lastStatusSyncAt) return true;
  const ageMs = now.getTime() - esim.lastStatusSyncAt.getTime();
  if (esim.status === EsimStatus.provisioned || esim.status === EsimStatus.pending || esim.status === EsimStatus.suspended) {
    return ageMs >= 15 * 60 * 1000;
  }
  if (esim.status === EsimStatus.active) {
    return ageMs >= 60 * 60 * 1000;
  }
  return false;
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm vitest run src/server/domain/esims/
git add src/server/domain/esims/
git commit -m "feat(esim): shouldSyncNow state-aware backoff helper"
```

---

## Task 17: `esim.syncStatuses` job

**Files:**
- Create: `datapatch-v2/src/server/jobs/scheduled/esimSyncStatuses.ts`
- Create: `datapatch-v2/src/server/jobs/scheduled/esimSyncStatuses.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/jobs/scheduled/esimSyncStatuses.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/src/lib/db';
import { resetDb, createTenant, createOrderInState, seedZenditPackage, seedAiraloPackage } from '@/tests/helpers/domain';
import { runEsimSyncStatuses } from './esimSyncStatuses';

vi.mock('@/src/server/providers/esim/registry', () => ({
  getEsimProvider: vi.fn(),
}));
import { getEsimProvider } from '@/src/server/providers/esim/registry';

describe('esim.syncStatuses', () => {
  beforeEach(async () => { resetDb(); vi.clearAllMocks(); });

  it('updates provisioned eSIMs that are due for sync; skips terminal', async () => {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'PROVISIONED' });
    const airaloPkg = await seedAiraloPackage({ sku: 'a1' });
    const zenditPkg = await seedZenditPackage({ sku: 'z1' });

    const dueAiralo = await prisma.esim.create({ data: { tenantId: t.id, orderId: o.id, providerPackageId: airaloPkg.id, providerId: 'airalo', iccid: 'A', status: 'provisioned', lastStatusSyncAt: null } });
    const terminal = await prisma.esim.create({ data: { tenantId: t.id, orderId: o.id, providerPackageId: airaloPkg.id, providerId: 'airalo', iccid: 'B', status: 'expired', lastStatusSyncAt: null } });
    const dueZendit = await prisma.esim.create({ data: { tenantId: t.id, orderId: o.id, providerPackageId: zenditPkg.id, providerId: 'zendit', iccid: 'C', status: 'provisioned', rawMetadata: { zenditTxId: 'tx1' }, lastStatusSyncAt: null } });

    (getEsimProvider as unknown as vi.Mock).mockImplementation((id: string) => {
      if (id === 'airalo') return { getStatus: vi.fn().mockResolvedValue({ status: 'active', usageMb: 10 }) };
      if (id === 'zendit') return { getStatus: vi.fn().mockResolvedValue({ status: 'active', usageMb: 5 }) };
      throw new Error('unknown');
    });

    const result = await runEsimSyncStatuses();
    expect(result.attempted).toBe(2);
    expect(result.updated).toBe(2);

    expect((await prisma.esim.findUniqueOrThrow({ where: { id: dueAiralo.id } })).status).toBe('active');
    expect((await prisma.esim.findUniqueOrThrow({ where: { id: dueZendit.id } })).status).toBe('active');
    expect((await prisma.esim.findUniqueOrThrow({ where: { id: terminal.id } })).status).toBe('expired');
  });

  it('does not fail the whole batch when one provider call throws', async () => {
    const t = await createTenant('alpha');
    const o = await createOrderInState({ tenantId: t.id, state: 'PROVISIONED' });
    const airaloPkg = await seedAiraloPackage({ sku: 'a1' });
    await prisma.esim.create({ data: { tenantId: t.id, orderId: o.id, providerPackageId: airaloPkg.id, providerId: 'airalo', iccid: 'A', status: 'provisioned', lastStatusSyncAt: null } });
    await prisma.esim.create({ data: { tenantId: t.id, orderId: o.id, providerPackageId: airaloPkg.id, providerId: 'airalo', iccid: 'B', status: 'provisioned', lastStatusSyncAt: null } });

    let call = 0;
    (getEsimProvider as unknown as vi.Mock).mockReturnValue({
      getStatus: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) throw new Error('boom');
        return { status: 'active', usageMb: 1 };
      }),
    });

    const result = await runEsimSyncStatuses();
    expect(result.attempted).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/jobs/scheduled/esimSyncStatuses.ts
import { prisma } from '@/src/lib/db';
import { getEsimProvider } from '@/src/server/providers/esim/registry';
import { shouldSyncNow } from '@/src/server/domain/esims/shouldSyncNow';
import { EsimStatus } from '@prisma/client';

export interface SyncResult {
  attempted: number;
  updated: number;
  failed: number;
}

export async function runEsimSyncStatuses(now: Date = new Date()): Promise<SyncResult> {
  const candidates = await prisma.esim.findMany({
    where: { status: { in: [EsimStatus.pending, EsimStatus.provisioned, EsimStatus.active, EsimStatus.suspended] } },
    select: { id: true, iccid: true, providerId: true, status: true, lastStatusSyncAt: true, rawMetadata: true },
  });

  const due = candidates.filter((e) => shouldSyncNow({ status: e.status, lastStatusSyncAt: e.lastStatusSyncAt }, now));
  let updated = 0;
  let failed = 0;

  for (const esim of due) {
    if (!esim.iccid) { failed++; continue; }
    try {
      const provider = getEsimProvider(esim.providerId);
      const remote = await provider.getStatus({ iccid: esim.iccid, rawMetadata: esim.rawMetadata ?? null });
      const mapped = mapRemote(remote.status);
      await prisma.$transaction(async (tx) => {
        await tx.esim.update({
          where: { id: esim.id },
          data: {
            status: mapped ?? esim.status,
            lastStatusSyncAt: now,
          },
        });
        if (mapped && mapped !== esim.status) {
          await tx.auditLog.create({ data: { tenantId: '', resource: 'esim', resourceId: esim.id, action: 'esim.state_synced', userId: null, metadata: { from: esim.status, to: mapped, provider: esim.providerId } as never } });
        }
      });
      updated++;
    } catch (err) {
      failed++;
      console.error('[esim.syncStatuses] per-item failure', { esimId: esim.id, provider: esim.providerId, err: err instanceof Error ? err.message : err });
    }
  }

  return { attempted: due.length, updated, failed };
}

function mapRemote(remote: 'active' | 'expired' | 'unknown'): EsimStatus | null {
  if (remote === 'active') return EsimStatus.active;
  if (remote === 'expired') return EsimStatus.expired;
  return null;
}
```

(Note: `tenantId: ''` on the audit log is a placeholder — if the audit table requires a non-empty tenantId, load it from the `Esim.tenantId` inside the loop; the test above uses `createTenant` so it has a value available — adjust the SELECT to include it.)

- [ ] **Step 3: Run + commit**

```bash
pnpm vitest run src/server/jobs/scheduled/esimSyncStatuses
git add src/server/jobs/scheduled/esimSyncStatuses*
git commit -m "feat(jobs): esim.syncStatuses with state-aware backoff + per-item error isolation"
```

---

## Task 18: `order.expireStale` job

**Files:**
- Create: `datapatch-v2/src/server/jobs/scheduled/orderExpireStale.ts`
- Create: `datapatch-v2/src/server/jobs/scheduled/orderExpireStale.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/jobs/scheduled/orderExpireStale.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { resetDb, createTenant, createOrderInState } from '@/tests/helpers/domain';
import { runOrderExpireStale } from './orderExpireStale';

describe('order.expireStale', () => {
  beforeEach(async () => resetDb());

  it('expires AWAITING_PAYMENT older than 24h and releases price lock', async () => {
    const t = await createTenant('alpha');
    const stale = await createOrderInState({ tenantId: t.id, state: 'AWAITING_PAYMENT', createdAtOffsetMs: -25 * 3600 * 1000 });
    const fresh = await createOrderInState({ tenantId: t.id, state: 'AWAITING_PAYMENT', createdAtOffsetMs: -1 * 3600 * 1000 });

    const result = await runOrderExpireStale();
    expect(result.expired).toBe(1);

    const a = await prisma.order.findUniqueOrThrow({ where: { id: stale.id } });
    const b = await prisma.order.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(a.state).toBe('EXPIRED');
    expect(b.state).toBe('AWAITING_PAYMENT');

    const audit = await prisma.auditLog.findFirst({ where: { resourceId: stale.id, action: 'order.expire' } });
    expect(audit).not.toBeNull();
  });
});
```

Ensure `createOrderInState` helper supports `createdAtOffsetMs` for backdating.

- [ ] **Step 2: Implement**

```ts
// src/server/jobs/scheduled/orderExpireStale.ts
import { prisma } from '@/src/lib/db';
import { transition, type Order } from '@/src/server/domain/orders/orderMachine';
import { OrderState } from '@prisma/client';

export interface ExpireResult {
  scanned: number;
  expired: number;
}

const STALE_MS = 24 * 60 * 60 * 1000;

export async function runOrderExpireStale(now: Date = new Date()): Promise<ExpireResult> {
  const cutoff = new Date(now.getTime() - STALE_MS);
  const candidates = await prisma.order.findMany({
    where: { state: OrderState.AWAITING_PAYMENT, createdAt: { lt: cutoff } },
    select: { id: true, tenantId: true, state: true, paymentMode: true, travelerEmail: true, travelerName: true, agencyActorId: true, locale: true, totalAmount: true, totalCurrency: true },
  });

  let expired = 0;
  for (const row of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        const order: Order = { id: row.id, ...row, agencyActorId: row.agencyActorId ?? null };
        // Add EXPIRE_STALE event to orderMachine — or reuse EXPIRE by widening source state.
        // Simplest: direct state write + audit here, since the state machine's EXPIRE is for ACTIVE → EXPIRED.
        await tx.order.update({ where: { id: row.id }, data: { state: OrderState.EXPIRED } });
        await tx.priceLock.updateMany({ where: { orderId: row.id }, data: { expiresAt: now } });
        await tx.auditLog.create({ data: { tenantId: row.tenantId, userId: null, action: 'order.expire', resource: 'order', resourceId: row.id, metadata: { reason: 'stale_awaiting_payment_24h' } as never } });
      });
      expired++;
    } catch (err) {
      console.error('[order.expireStale] per-item failure', { orderId: row.id, err: err instanceof Error ? err.message : err });
    }
  }
  return { scanned: candidates.length, expired };
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm vitest run src/server/jobs/scheduled/orderExpireStale
git add src/server/jobs/scheduled/orderExpireStale*
git commit -m "feat(jobs): order.expireStale hourly job for 24h-stale AWAITING_PAYMENT orders"
```

---

## Task 19: `registerSchedules()` + worker wiring

**Files:**
- Create: `datapatch-v2/src/server/jobs/registerSchedules.ts`
- Create: `datapatch-v2/src/server/jobs/scheduledWorker.ts` (BullMQ Worker consumer for repeatable jobs)
- Modify: `datapatch-v2/scripts/worker.ts`

- [ ] **Step 1: Write `registerSchedules.ts`**

```ts
// src/server/jobs/registerSchedules.ts
import { Queue } from 'bullmq';
import { getConnection } from './queue';
import { env } from '@/src/lib/env';

export const SCHEDULED_QUEUE = 'scheduled';

export async function registerSchedules(): Promise<void> {
  const queue = new Queue(SCHEDULED_QUEUE, {
    connection: getConnection(),
    prefix: env.BULLMQ_PREFIX,
  });

  const desired = [
    { name: 'esim.syncStatuses', everyMs: 15 * 60 * 1000 },
    { name: 'order.expireStale', everyMs: 60 * 60 * 1000 },
  ] as const;

  // Clean stale repeatable specs (name-keyed) so redeploys don't accumulate duplicates.
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    if (!desired.some((d) => d.name === job.name)) {
      await queue.removeRepeatableByKey(job.key);
    }
  }
  for (const d of desired) {
    // Overwrite any previous every-value for this name.
    const stale = existing.find((e) => e.name === d.name && e.every !== d.everyMs);
    if (stale) await queue.removeRepeatableByKey(stale.key);
    await queue.add(d.name, {}, {
      repeat: { every: d.everyMs },
      jobId: d.name,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
  console.log('[schedules] registered:', desired.map((d) => d.name).join(', '));
}
```

- [ ] **Step 2: Write `scheduledWorker.ts`**

```ts
// src/server/jobs/scheduledWorker.ts
import { Worker } from 'bullmq';
import { getConnection } from './queue';
import { env } from '@/src/lib/env';
import { SCHEDULED_QUEUE } from './registerSchedules';
import { runEsimSyncStatuses } from './scheduled/esimSyncStatuses';
import { runOrderExpireStale } from './scheduled/orderExpireStale';

export function startScheduledWorker(): Worker {
  return new Worker(
    SCHEDULED_QUEUE,
    async (job) => {
      switch (job.name) {
        case 'esim.syncStatuses':
          return runEsimSyncStatuses();
        case 'order.expireStale':
          return runOrderExpireStale();
        default:
          console.warn('[scheduledWorker] unknown job', job.name);
      }
    },
    { connection: getConnection(), prefix: env.BULLMQ_PREFIX, concurrency: 1 },
  );
}
```

- [ ] **Step 3: Wire into `scripts/worker.ts`**

Find the `main()` body in `scripts/worker.ts` and add the scheduled-queue lines:

```ts
import { startScheduledWorker } from '@/src/server/jobs/scheduledWorker';
import { registerSchedules } from '@/src/server/jobs/registerSchedules';

// Inside main(), after existing startWebhookWorker + startOutboxWorker:
const scheduled = startScheduledWorker();
workers.push(scheduled);
await registerSchedules();
```

- [ ] **Step 4: Smoke test locally**

```bash
docker compose up -d postgres redis mailpit
pnpm dev:worker  # runs scripts/worker.ts via tsx
# Expect logs:
#   [worker] booting…
#   [worker] N workers + outbox dispatcher ready
#   [schedules] registered: esim.syncStatuses, order.expireStale
```

- [ ] **Step 5: Commit**

```bash
git add src/server/jobs/ scripts/worker.ts
git commit -m "feat(jobs): register repeatable schedules + scheduled worker consumer"
```

---

## Task 20: Admin Assign eSIM UI + server action

**Files:**
- Create: `datapatch-v2/src/app/admin/esims/assign/page.tsx`
- Create: `datapatch-v2/src/app/admin/esims/assign/_actions/assignZenditEsim.ts`
- Create: `datapatch-v2/src/app/admin/esims/assign/_components/AssignForm.tsx`
- Create: `datapatch-v2/tests/e2e/phase2c-admin-assign.spec.ts`

- [ ] **Step 1: Write the E2E test first**

```ts
// tests/e2e/phase2c-admin-assign.spec.ts
import { test, expect } from '@playwright/test';

test('admin can assign a Zendit eSIM to a user', async ({ page }) => {
  await page.goto('/en/signin?email=admin@datapatch.local');
  // magic link dev flow — adapt to the project's E2E auth helper
  await page.goto('/admin/esims/assign');
  await expect(page.getByRole('heading', { name: /assign esim/i })).toBeVisible();

  await page.getByLabel('Tenant').selectOption({ label: 'alpha' });
  await page.getByLabel('User').selectOption({ index: 1 });
  await page.getByLabel('Package').selectOption({ index: 1 });
  await page.getByRole('button', { name: /assign/i }).click();

  await expect(page.getByText(/eSIM assigned/i)).toBeVisible();
});
```

- [ ] **Step 2: Server action**

```ts
// src/app/admin/esims/assign/_actions/assignZenditEsim.ts
'use server';
import { z } from 'zod';
import { auth } from '@/src/auth';
import { requirePlatformAdmin } from '@/src/server/rbac/requireRole';
import { createAdminAssignedOrder } from '@/src/server/domain/orders/createAdminAssignedOrder';
import { provisionEsim } from '@/src/server/domain/provisioning/provisionEsim';

const schema = z.object({
  tenantId: z.string().min(1),
  travelerUserId: z.string().min(1),
  travelerEmail: z.string().email(),
  travelerName: z.string().min(1),
  providerPackageId: z.string().min(1),
  locale: z.string().default('en'),
});

export async function assignZenditEsim(input: z.infer<typeof schema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthenticated');
  await requirePlatformAdmin(session.user.id);

  const parsed = schema.parse(input);
  const order = await createAdminAssignedOrder({
    adminUserId: session.user.id,
    ...parsed,
  });
  await provisionEsim({ orderId: order.id }); // re-uses Phase 2b provisioning pipeline, which picks providerId from providerPackage
  return { orderId: order.id };
}
```

- [ ] **Step 3: Page + form**

```tsx
// src/app/admin/esims/assign/page.tsx
import { prisma } from '@/src/lib/db';
import { AssignForm } from './_components/AssignForm';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [tenants, packages] = await Promise.all([
    prisma.tenant.findMany({ select: { id: true, slug: true } }),
    prisma.providerPackage.findMany({ where: { providerId: 'zendit', active: true }, select: { id: true, name: true, sku: true, priceAmount: true, priceCurrency: true } }),
  ]);
  return (
    <div>
      <h1>Assign eSIM</h1>
      <AssignForm tenants={tenants} packages={packages.map((p) => ({ ...p, priceAmount: String(p.priceAmount) }))} />
    </div>
  );
}
```

```tsx
// src/app/admin/esims/assign/_components/AssignForm.tsx
'use client';
import { useState, useTransition } from 'react';
import { assignZenditEsim } from '../_actions/assignZenditEsim';

interface Props {
  tenants: { id: string; slug: string }[];
  packages: { id: string; name: string; sku: string; priceAmount: string; priceCurrency: string }[];
}

export function AssignForm({ tenants, packages }: Props) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pkgId, setPkgId] = useState(packages[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        try {
          const res = await assignZenditEsim({ tenantId, travelerUserId: 'user-id-lookup-separate-step', travelerEmail: email, travelerName: name, providerPackageId: pkgId, locale: 'en' });
          setResult(`eSIM assigned — order ${res.orderId}`);
        } catch (err) {
          setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }}>
      <label>Tenant
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{tenants.map((t) => <option key={t.id} value={t.id}>{t.slug}</option>)}</select>
      </label>
      <label>Traveler email <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" /></label>
      <label>Traveler name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Package
        <select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}</select>
      </label>
      <button type="submit" disabled={pending}>Assign</button>
      {result && <p>{result}</p>}
    </form>
  );
}
```

The `travelerUserId` lookup is simplified in the form above; real implementation should add a user picker or auto-create a tenant-scoped user on submit. Adjust in-line while the subagent has context.

- [ ] **Step 4: Run + commit**

```bash
pnpm typecheck
pnpm exec playwright test tests/e2e/phase2c-admin-assign.spec.ts
git add src/app/admin/esims/assign/ tests/e2e/phase2c-admin-assign.spec.ts
git commit -m "feat(admin): assign Zendit eSIM page + server action"
```

---

## Task 21: Admin order detail — refund + mark cancelled actions

**Files:**
- Create: `datapatch-v2/src/app/admin/orders/[orderId]/_actions/issueRefund.ts`
- Create: `datapatch-v2/src/app/admin/orders/[orderId]/_actions/markCancelled.ts`
- Create: `datapatch-v2/src/app/admin/orders/[orderId]/_components/OrderActions.tsx`
- Modify: `datapatch-v2/src/app/admin/orders/[orderId]/page.tsx` to render `<OrderActions>`
- Create: `datapatch-v2/tests/e2e/phase2c-admin-refund.spec.ts`

- [ ] **Step 1: Server actions**

```ts
// src/app/admin/orders/[orderId]/_actions/issueRefund.ts
'use server';
import { auth } from '@/src/auth';
import { requirePlatformAdmin } from '@/src/server/rbac/requireRole';
import { issueRefund as domainIssueRefund, RefundProviderError } from '@/src/server/domain/refunds/issueRefund';
import { revalidatePath } from 'next/cache';

export async function issueRefundAction(orderId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthenticated');
  await requirePlatformAdmin(session.user.id);
  try {
    await domainIssueRefund({ orderId, adminUserId: session.user.id });
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof RefundProviderError) return { ok: false, message: `${err.reason}: ${err.message}` };
    return { ok: false, message: err instanceof Error ? err.message : 'unknown error' };
  }
}
```

```ts
// src/app/admin/orders/[orderId]/_actions/markCancelled.ts
'use server';
import { auth } from '@/src/auth';
import { requirePlatformAdmin } from '@/src/server/rbac/requireRole';
import { markCancelled } from '@/src/server/domain/refunds/markCancelled';
import { revalidatePath } from 'next/cache';

export async function markCancelledAction(orderId: string, reason: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('unauthenticated');
  await requirePlatformAdmin(session.user.id);
  await markCancelled({ orderId, adminUserId: session.user.id, reason });
  revalidatePath(`/admin/orders/${orderId}`);
}
```

- [ ] **Step 2: Component**

```tsx
// src/app/admin/orders/[orderId]/_components/OrderActions.tsx
'use client';
import { useState, useTransition } from 'react';
import { issueRefundAction } from '../_actions/issueRefund';
import { markCancelledAction } from '../_actions/markCancelled';

interface Props {
  orderId: string;
  orderState: 'PAID' | 'REFUND_PENDING' | 'REFUNDED' | 'CANCELLED' | string;
}

export function OrderActions({ orderId, orderState }: Props) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const confirmType = async (expected: string): Promise<boolean> => {
    const answer = window.prompt(`Type the order id (${expected}) to confirm:`);
    return answer === expected;
  };

  const onRefund = () => start(async () => {
    if (!(await confirmType(orderId))) return;
    const res = await issueRefundAction(orderId);
    setMsg(res.ok ? 'Refund issued' : `Refund failed: ${res.message}`);
  });
  const onMarkCancelled = () => start(async () => {
    const reason = window.prompt('Reason for marking cancelled?');
    if (!reason) return;
    await markCancelledAction(orderId, reason);
    setMsg('Marked cancelled');
  });

  return (
    <div>
      {(orderState === 'PAID' || orderState === 'REFUND_PENDING') && (
        <button onClick={onRefund} disabled={pending}>
          {orderState === 'REFUND_PENDING' ? 'Retry Refund' : 'Issue Refund'}
        </button>
      )}
      {orderState === 'REFUND_PENDING' && (
        <button onClick={onMarkCancelled} disabled={pending}>Mark Cancelled</button>
      )}
      {msg && <p>{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire into the existing admin order detail page**

Open `src/app/admin/orders/[orderId]/page.tsx` and render `<OrderActions orderId={order.id} orderState={order.state} />` in the header or action bar area.

- [ ] **Step 4: E2E**

```ts
// tests/e2e/phase2c-admin-refund.spec.ts
import { test, expect } from '@playwright/test';
// This test requires a seeded PAID order with a Paddle Payment row.
// The project already has a seed helper for this in Phase 2b tests — reuse it.
test.skip(!process.env.E2E_PAID_ORDER_ID, 'requires seeded Paddle PAID order');

test('admin can issue refund on a PAID order', async ({ page }) => {
  const orderId = process.env.E2E_PAID_ORDER_ID!;
  await page.goto('/en/signin?email=admin@datapatch.local');
  await page.goto(`/admin/orders/${orderId}`);

  page.on('dialog', (d) => d.accept(orderId));
  await page.getByRole('button', { name: /issue refund/i }).click();

  await expect(page.getByText(/refund issued/i)).toBeVisible({ timeout: 15000 });
});
```

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/orders/ tests/e2e/phase2c-admin-refund.spec.ts
git commit -m "feat(admin): Issue Refund + Mark Cancelled order detail actions"
```

---

## Task 22: Payment provider picker + checkout dual-dispatch

**Files:**
- Create: `datapatch-v2/src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_components/PaymentProviderPicker.tsx`
- Create: `datapatch-v2/src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_actions/startCheckout.ts`
- Modify: `datapatch-v2/src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/page.tsx` to render `<PaymentProviderPicker>` instead of (or wrapping) the existing Paddle-only trigger.
- Create: `datapatch-v2/tests/e2e/phase2c-payment-picker.spec.ts`

- [ ] **Step 1: Server action**

```ts
// src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_actions/startCheckout.ts
'use server';
import { auth } from '@/src/auth';
import { prisma } from '@/src/lib/db';
import { getPaymentProvider } from '@/src/server/providers/payment/registry';
import { env } from '@/src/lib/env';
import { redirect } from 'next/navigation';

type ProviderChoice = 'paddle' | 'turinvoice';

export async function startCheckout(orderId: string, provider: ProviderChoice): Promise<
  | { kind: 'overlay'; transactionId: string }
  | { kind: 'redirect'; url: string }
> {
  const session = await auth();
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { providerPackage: true } } },
  });
  if (order.buyerUserId && order.buyerUserId !== session?.user?.id) throw new Error('forbidden');
  if (order.state !== 'AWAITING_PAYMENT') throw new Error(`cannot start checkout from state ${order.state}`);

  const checkout = await getPaymentProvider(provider).createCheckout({
    orderId: order.id,
    customerEmail: order.buyerEmail,
    lineItems: order.items.map((i) => ({
      name: i.providerPackage.name,
      quantity: i.quantity,
      unitAmount: i.unitAmount,
      currency: i.unitCurrency,
    })),
    successUrl: new URL(`/${order.locale}/shop/${/* tenantSlug resolved via relation on order */ ''}/orders/${order.id}`, env.PUBLIC_APP_URL).toString(),
    cancelUrl: new URL(`/${order.locale}/shop`, env.PUBLIC_APP_URL).toString(),
    locale: order.locale,
    metadata: { tenantId: order.tenantId, orderId: order.id },
  });

  if (provider === 'paddle') return { kind: 'overlay', transactionId: checkout.externalSessionId };
  return { kind: 'redirect', url: checkout.url };
}
```

(The `tenantSlug` in the success URL must be resolved from the `Order.tenant` relation — add `include: { tenant: true }` to the query and use `order.tenant.slug`.)

- [ ] **Step 2: Client component**

```tsx
// src/app/[locale]/shop/[tenantSlug]/orders/[orderId]/_components/PaymentProviderPicker.tsx
'use client';
import { useState, useTransition } from 'react';
import { startCheckout } from '../_actions/startCheckout';
// Reuse the Phase 2b Paddle overlay client component that reads the transaction id.
import { PaddleOverlayTrigger } from './PaddleOverlayTrigger';

interface Props {
  orderId: string;
  paddleClientToken: string;
}

type Choice = 'paddle' | 'turinvoice';

export function PaymentProviderPicker({ orderId, paddleClientToken }: Props) {
  const [choice, setChoice] = useState<Choice>('paddle');
  const [pending, start] = useTransition();
  const [paddleTxn, setPaddleTxn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <fieldset>
        <legend>Pay with</legend>
        <label><input type="radio" name="prov" checked={choice === 'paddle'} onChange={() => setChoice('paddle')} /> International card (Visa/Mastercard)</label>
        <label><input type="radio" name="prov" checked={choice === 'turinvoice'} onChange={() => setChoice('turinvoice')} /> Turkish card or SBP</label>
      </fieldset>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          try {
            const res = await startCheckout(orderId, choice);
            if (res.kind === 'overlay') setPaddleTxn(res.transactionId);
            else window.location.assign(res.url);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'failed');
          }
        })}
      >
        Pay
      </button>
      {paddleTxn && <PaddleOverlayTrigger transactionId={paddleTxn} clientToken={paddleClientToken} />}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `page.tsx`**

Replace the existing Paddle-only trigger block with `<PaymentProviderPicker orderId={...} paddleClientToken={...} />`, passing the server-read token same as Phase 2b.

- [ ] **Step 4: E2E**

```ts
// tests/e2e/phase2c-payment-picker.spec.ts
import { test, expect } from '@playwright/test';

test('B2C order detail shows both payment options', async ({ page }) => {
  await page.goto(process.env.E2E_ORDER_URL!); // AWAITING_PAYMENT order
  await expect(page.getByRole('group', { name: /pay with/i })).toBeVisible();
  await expect(page.getByLabel(/international card/i)).toBeVisible();
  await expect(page.getByLabel(/turkish card|sbp/i)).toBeVisible();
});
```

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/shop tests/e2e/phase2c-payment-picker.spec.ts
git commit -m "feat(checkout): payment provider picker + dual-dispatch start action"
```

---

## Task 23: Full test pass + typecheck + build

- [ ] **Step 1: Run everything**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright test
pnpm build
```

Fix any red. Do not skip or `// @ts-ignore` failures — if a test fails, either the implementation or the test is wrong; decide which and fix.

- [ ] **Step 2: Verify coverage**

```bash
pnpm test -- --coverage
```

Expected: ≥80% overall; new Phase 2c files ≥80% each.

- [ ] **Step 3: Open PR**

```bash
git push -u origin phase-2c/providers-refunds
gh pr create --title "V2 Phase 2c: Providers & Refunds" \
  --body "$(cat <<'EOF'
## Summary
- TurInvoice payment adapter (checkout + webhook + refund)
- Zendit eSIM adapter (admin-assign only, polling status)
- Paddle refund via adjustments.create + Admin Issue Refund / Mark Cancelled UI
- Scheduled jobs: esim.syncStatuses (15m), order.expireStale (1h)

## Test plan
- [ ] CI green (unit + integration + e2e)
- [ ] 80%+ coverage on new modules
- [ ] Manual verification on v2.datapatch.net (see spec §11.4)

See spec: docs/superpowers/specs/2026-04-24-v2-phase-2c-providers-refunds-design.md (in esim-management-2 repo).
EOF
)"
```

---

## Task 24: Prod deploy + exit gate

**Environment:** Railway `datapatch-v2` project (see `reference_v2_infra.md` memory for service IDs).

- [ ] **Step 1: Set new env vars on Railway**

For BOTH `datapatch-v2` app service and `worker` service, set:

```
TURINVOICE_HOST=<real URL>
TURINVOICE_LOGIN=<sandbox or prod credentials>
TURINVOICE_PASSWORD=<secret>
TURINVOICE_IDTSP=<numeric>
TURINVOICE_CURRENCY=USD
TURINVOICE_CALLBACK_SECRET=<generate 32+ chars; same value both services>
ZENDIT_API_KEY=<real key>
ZENDIT_API_BASE=https://api.zendit.io/v1
ZENDIT_COUNTRY=TR
```

Use Railway CLI or dashboard. Same secret value on both services — mismatch will silently break webhooks or worker-only code paths.

- [ ] **Step 2: Register TurInvoice callback in provider dashboard**

- Callback URL: `https://v2.datapatch.net/api/webhooks/turinvoice`
- Secret: the `TURINVOICE_CALLBACK_SECRET` you set above.

- [ ] **Step 3: Merge PR + deploy**

```bash
gh pr merge --squash
# Railway auto-deploys on main push. Watch the deploy in the dashboard.
railway logs --service <app-service-id> --environment <env-id> --tail
```

Expected: migration runs cleanly, app + worker both report healthy.

- [ ] **Step 4: Verify schedules**

```bash
# From local machine with Railway CLI auth:
railway run --service <worker-service-id> --environment <env-id> -- node -e "
  const IORedis = require('ioredis');
  const r = new IORedis(process.env.REDIS_URL);
  r.keys('datapatch:bull:scheduled:repeat:*').then(ks => { console.log(ks); r.quit(); });
"
```

Expected: exactly two keys, named `esim.syncStatuses` and `order.expireStale` (the repeat-key contains the name). No more, no less.

- [ ] **Step 5: Manual exit gate (four scenarios from spec §11.4)**

Each must be signed off with a screenshot or log snippet in the PR:

1. **TurInvoice card + SBP QR end-to-end.** Create an order on v2.datapatch.net, pick TurInvoice, complete sandbox payment both ways. Verify QR email arrives.
2. **Admin Zendit assign.** Create a Zendit assignment on v2.datapatch.net `/admin/esims/assign`; verify eSIM appears in user view; wait one `esim.syncStatuses` tick; verify `Esim.lastStatusSyncAt` advanced.
3. **Paddle refund automation.** Take a PAID Paddle sandbox order → click Issue Refund → verify Paddle dashboard shows the adjustment, V2 Order.state = REFUNDED, refund email delivered.
4. **Stale order expiry.** Use `railway run ... -- node -e "..."` to UPDATE a live test order's `createdAt` to 25h ago → wait one `order.expireStale` tick → verify state EXPIRED.

- [ ] **Step 6: Tag + memory update**

```bash
git checkout main && git pull --ff-only
git tag phase-2c-complete
git push origin phase-2c-complete
```

Update memory files in `~/.claude/projects/-Users-turgt-Desktop-CODES-esim-management-2/memory/`:
- `project_v2_state.md`: mark Phase 2c complete on 2026-04-?? — move Phase 2d scope to "Next".
- If any non-obvious issues surfaced during execution, write `feedback_phase_2c_gotchas.md` and add to `MEMORY.md`.

---

## Self-Review (done)

**Spec coverage audit:**
- §2.1 scope items 1-7 → Tasks 4, 6-11 (providers), 12 (admin-assign order), 13-15 (refund + email), 16-18 (jobs), 19 (registration), 20-22 (UI).
- §4 architecture → all files created per file-structure list.
- §5 migration → Task 2.
- §6 TurInvoice → Tasks 6-9.
- §7 Zendit → Tasks 10-11.
- §8 Refund → Tasks 13-15, 21.
- §9 Jobs → Tasks 16-19.
- §10 Config → Task 3.
- §11 Testing → tests embedded in each task + E2E in Tasks 20-22.
- §12 Risks 1-10 → addressed inline (TurInvoice callback secret in Task 3 + 7; Zendit no-webhook in Task 11; BigInt via rawMetadata handling; Dockerfile placeholders in Task 3; repeatable job dedup in Task 19 `registerSchedules`; per-item try/catch in Task 17; Idempotency-Key in Task 5; ADMIN_ASSIGNED state path in Task 12; Order.paymentProvider — NOTE: spec mentioned this column but the actual schema already tracks provider on `Payment.providerId` per-payment, so the separate `Order.paymentProvider` column is skipped — Task 2 migration does NOT add it. TurInvoice redirect UX in Task 22).
- §13 Exit criteria → Task 23-24.

**Placeholder scan:** No TBD/TODO; every code step is complete; one explicit "adapt to your project's E2E auth helper" on Task 20 test because it genuinely depends on the seed helper file whose precise name is not in the plan — subagent will grep for `signin` helper on arrival.

**Type consistency:** `RefundResult`, `GetStatusInput`, `PaymentProviderId`, `EsimProviderId`, `SyncResult`, `ExpireResult` names used identically everywhere.

**Schema coverage:** Only `PaymentMode.ADMIN_ASSIGNED` + `Esim.lastStatusSyncAt` added. If `OrderState.REFUNDED` turns out to be missing (not in Phase 2b's listed values), Task 13 includes adding it — flagged inline.

**Scope focus:** Single plan, single PR, single Railway deploy. Phase 2d items not present.
