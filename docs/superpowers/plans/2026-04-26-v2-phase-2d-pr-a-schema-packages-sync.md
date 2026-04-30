# V2 Phase 2d — PR-A: Schema Migration + USD Invariant + packages.syncCatalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the foundational schema changes (`PARTIALLY_REFUNDED` state, `Payment.refundedAmount`, `Order.paymentMethodHint`), enforce USD-only invariant at the four money-handling boundaries, and add the `packages.syncCatalog` scheduled job (with country whitelist) backed by a refactored `applyPackagesSync` service.

**Architecture:** Single Prisma migration is additive (new enum value + 2 nullable/defaulted columns). USD invariant is a tiny `assertUsdMoney` helper called from 4 sites (`createBooking`, `paddle/createCheckout`, `turinvoice/createCheckout`, `paddle/refund`). Packages sync extracts the existing upsert logic from `scripts/sync-packages.ts` into a reusable service that adds price/spec audit logs and country-whitelist-scoped soft-delete; the scheduled job and the bootstrap script both call it.

**Tech Stack:** Prisma 7, Vitest, BullMQ, TypeScript ESM. Runs in `/Users/turgt/Desktop/CODES/datapatch-v2`.

**Spec reference:** `docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md` §4.2, §5.1, §5.6, §10–§11.

---

## File Structure

### Created
- `prisma/migrations/<timestamp>_phase_2d_partial_refunds_payment_method_hint/migration.sql` — additive migration.
- `src/lib/assertUsdMoney.ts` — invariant helper.
- `src/lib/assertUsdMoney.test.ts` — helper tests.
- `src/server/providers/esim/airalo/applyPackagesSync.ts` — reusable upsert + audit + soft-delete service.
- `src/server/providers/esim/airalo/applyPackagesSync.test.ts` — service tests.
- `src/server/jobs/scheduled/packagesSyncCatalog.ts` — scheduled job entry.
- `src/server/jobs/scheduled/packagesSyncCatalog.test.ts` — scheduled job tests.

### Modified
- `prisma/schema.prisma` — add enum value + 2 columns.
- `src/lib/env.ts` — add `PACKAGES_SYNC_COUNTRIES`.
- `src/server/domain/orders/createBooking.ts` — invoke `assertUsdMoney`.
- `src/server/providers/payment/paddle/createCheckout.ts` — invoke `assertUsdMoney`.
- `src/server/providers/payment/turinvoice/createCheckout.ts` — invoke `assertUsdMoney`.
- `src/server/providers/payment/paddle/refund.ts` — invoke `assertUsdMoney` against payment.
- `src/server/jobs/registerSchedules.ts` — extend `SCHEDULES`.
- `src/server/jobs/workers/scheduled.ts` — extend dispatch switch.
- `scripts/sync-packages.ts` — call new `applyPackagesSync` service instead of inline upsert.
- `.env.example` — document new env var.

---

## Task 1: Database migration — partial refunds + payment method hint

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase_2d_partial_refunds_payment_method_hint/migration.sql` (auto-generated)

- [ ] **Step 1: Edit schema — add `PARTIALLY_REFUNDED` to OrderState enum**

In `prisma/schema.prisma`, find the `enum OrderState` block (search for `enum OrderState`). Add `PARTIALLY_REFUNDED` as a new value, keeping the existing values intact:

```prisma
enum OrderState {
  DRAFT
  AWAITING_PAYMENT
  AWAITING_INVOICE
  PAID
  PROVISIONING
  PROVISIONED
  REFUND_PENDING
  REFUNDED
  PARTIALLY_REFUNDED
  CANCELLED
  EXPIRED
}
```

- [ ] **Step 2: Edit schema — add `refundedAmount` to Payment**

Find `model Payment {` and add the new field next to the existing `amount` field:

```prisma
model Payment {
  // ...existing fields...
  amount            BigInt
  currency          String
  refundedAmount    BigInt   @default(0)
  // ...remaining existing fields...
}
```

- [ ] **Step 3: Edit schema — add `paymentMethodHint` to Order**

Find `model Order {` and add the new field next to `locale`:

```prisma
model Order {
  // ...existing fields...
  locale              String   @default("en")
  paymentMethodHint   String?
  // ...remaining existing fields...
}
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm prisma migrate dev --name phase_2d_partial_refunds_payment_method_hint --create-only`

Expected: a new directory under `prisma/migrations/` with a single `migration.sql` file containing `ALTER TYPE "OrderState" ADD VALUE 'PARTIALLY_REFUNDED';`, `ALTER TABLE "payments" ADD COLUMN "refundedAmount" BIGINT NOT NULL DEFAULT 0;`, and `ALTER TABLE "orders" ADD COLUMN "paymentMethodHint" TEXT;`.

- [ ] **Step 5: Inspect the generated SQL**

Open the generated `migration.sql` and confirm: only the three additive statements above are present (no DROP, no NOT NULL violations on existing rows). If anything else appears, abort and re-edit the schema.

- [ ] **Step 6: Apply the migration locally**

Run: `pnpm prisma migrate dev`

Expected: migration applies cleanly. `pnpm prisma generate` runs automatically. `OrderState`, `Order`, and `Payment` types in generated client now include the new fields/value.

- [ ] **Step 7: Verify type-check passes**

Run: `pnpm typecheck`

Expected: PASS. (No code yet uses the new fields, so no compilation errors.)

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(2d): add PARTIALLY_REFUNDED state, Payment.refundedAmount, Order.paymentMethodHint"
```

---

## Task 2: USD-only invariant helper

**Files:**
- Create: `src/lib/assertUsdMoney.ts`
- Test: `src/lib/assertUsdMoney.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/assertUsdMoney.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assertUsdMoney } from './assertUsdMoney';

describe('assertUsdMoney', () => {
  it('accepts USD currency', () => {
    expect(() => assertUsdMoney({ currency: 'USD' }, 'test')).not.toThrow();
  });

  it('throws on EUR', () => {
    expect(() => assertUsdMoney({ currency: 'EUR' }, 'test')).toThrowError(
      /Phase 2d invariant: test must be USD, got EUR/,
    );
  });

  it('throws on TRY', () => {
    expect(() => assertUsdMoney({ currency: 'TRY' }, 'test')).toThrowError(/got TRY/);
  });

  it('throws on lowercase usd (string-strict)', () => {
    expect(() => assertUsdMoney({ currency: 'usd' }, 'test')).toThrowError(/got usd/);
  });

  it('uses the provided context label in the message', () => {
    expect(() => assertUsdMoney({ currency: 'GBP' }, 'paddle.createCheckout line item')).toThrowError(
      /paddle\.createCheckout line item must be USD/,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/lib/assertUsdMoney.test.ts`

Expected: FAIL with "Cannot find module './assertUsdMoney'".

- [ ] **Step 3: Implement the helper**

Create `src/lib/assertUsdMoney.ts`:

```ts
/**
 * Phase 2d invariant: every money-bearing object that crosses
 * createBooking / createCheckout / refund must carry currency='USD'.
 *
 * Removed once the platform opens to multi-currency. The three call sites
 * are easy to grep: `assertUsdMoney(`.
 */
export function assertUsdMoney(money: { currency: string }, contextLabel: string): void {
  if (money.currency !== 'USD') {
    throw new Error(
      `Phase 2d invariant: ${contextLabel} must be USD, got ${money.currency}`,
    );
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/lib/assertUsdMoney.test.ts`

Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assertUsdMoney.ts src/lib/assertUsdMoney.test.ts
git commit -m "feat(2d): add assertUsdMoney invariant helper"
```

---

## Task 3: Apply USD invariant in createBooking

**Files:**
- Modify: `src/server/domain/orders/createBooking.ts`
- Test: same file's existing test (`src/server/domain/orders/createBooking.test.ts`) — extend.

- [ ] **Step 1: Write the failing test (append to existing test file)**

Open `src/server/domain/orders/createBooking.test.ts`. Add a new test inside the existing `describe('createBooking')` block (or top-level if structure differs):

```ts
it('rejects a package whose priceCurrency is not USD (Phase 2d invariant)', async () => {
  // Seed a fixture package with EUR pricing.
  await prisma.providerPackage.create({
    data: {
      providerId: 'airalo',
      sku: 'eur-fixture-1',
      name: 'EUR Fixture',
      countryCodes: ['DE'],
      dataMb: 1024,
      durationDays: 7,
      priceAmount: 500n,
      priceCurrency: 'EUR',
      active: true,
    },
  });

  await expect(
    createBooking({
      tenantId: testTenant.id,
      packageId: '<the package id created above>',
      quantity: 1,
      traveler: { email: 'a@b.com', name: 'A' },
      paymentMode: 'self_pay' as const,
      locale: 'en',
    }),
  ).rejects.toThrowError(/Phase 2d invariant: order total must be USD, got EUR/);
});
```

(If `testTenant` and the seeding helpers are not already imported in the test file, follow the existing pattern in the same file for setting up a tenant.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/domain/orders/createBooking.test.ts -t "Phase 2d invariant"`

Expected: FAIL — order is created with EUR currency without complaint (since the invariant isn't wired yet).

- [ ] **Step 3: Wire `assertUsdMoney` into createBooking**

In `src/server/domain/orders/createBooking.ts`, after `lockPrice` returns and the Order's total has been written, but before any side effects (Paddle, outbox), insert the assertion. Find the line where `lockPrice` is called and the Order's `totalCurrency` is updated; immediately after that block insert:

```ts
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';

// ...inside createBooking, after lockPrice + Order total update...
const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
assertUsdMoney({ currency: updatedOrder.totalCurrency }, 'order total');
```

(If the function already has `updatedOrder` or equivalent in scope, reuse it instead of re-querying.)

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/domain/orders/createBooking.test.ts -t "Phase 2d invariant"`

Expected: PASS — booking now rejects EUR-priced packages.

- [ ] **Step 5: Run the full createBooking test file to confirm no regressions**

Run: `pnpm vitest run src/server/domain/orders/createBooking.test.ts`

Expected: all existing tests still PASS plus the new invariant test.

- [ ] **Step 6: Commit**

```bash
git add src/server/domain/orders/createBooking.ts src/server/domain/orders/createBooking.test.ts
git commit -m "feat(2d): enforce USD invariant in createBooking"
```

---

## Task 4: Apply USD invariant in paddle/createCheckout

**Files:**
- Modify: `src/server/providers/payment/paddle/createCheckout.ts`
- Test: `src/server/providers/payment/paddle/createCheckout.test.ts` (extend) — if file does not exist, create it.

- [ ] **Step 1: Inspect the current createCheckout signature**

Run: `cat src/server/providers/payment/paddle/createCheckout.ts | head -40`

Note the input shape. The line items will look like `{ amount, currency }` per the `Money`/payment types — confirm field names. (Skill assumes `input.lineItems[].currency` per spec §5.6; if the actual field is `input.amount.currency` or similar, adjust the assertion.)

- [ ] **Step 2: Write the failing test**

Open or create `src/server/providers/payment/paddle/createCheckout.test.ts`. Add:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCheckout } from './createCheckout';

describe('paddle.createCheckout — USD invariant', () => {
  it('throws when a line item is not USD', async () => {
    const input = {
      orderId: 'order_1',
      buyerEmail: 'a@b.com',
      lineItems: [{ amount: 500n, currency: 'EUR', sku: 'sku_1', name: 'Fixture' }],
      tenantId: 'tenant_1',
    };
    await expect(createCheckout(input as any)).rejects.toThrowError(
      /Phase 2d invariant: paddle\.createCheckout line item must be USD, got EUR/,
    );
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/providers/payment/paddle/createCheckout.test.ts -t "USD invariant"`

Expected: FAIL.

- [ ] **Step 4: Wire `assertUsdMoney` at the top of createCheckout**

In `src/server/providers/payment/paddle/createCheckout.ts`, immediately after the input is received (top of the function body), iterate the line items:

```ts
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';

export async function createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
  for (const item of input.lineItems) {
    assertUsdMoney({ currency: item.currency }, 'paddle.createCheckout line item');
  }
  // ...existing body unchanged...
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/providers/payment/paddle/createCheckout.test.ts`

Expected: PASS, all tests including any pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/payment/paddle/createCheckout.ts src/server/providers/payment/paddle/createCheckout.test.ts
git commit -m "feat(2d): enforce USD invariant in paddle.createCheckout"
```

---

## Task 5: Apply USD invariant in turinvoice/createCheckout

**Files:**
- Modify: `src/server/providers/payment/turinvoice/createCheckout.ts`
- Test: `src/server/providers/payment/turinvoice/turinvoice.test.ts` (existing — extend).

- [ ] **Step 1: Write the failing test**

Open `src/server/providers/payment/turinvoice/turinvoice.test.ts`. Append:

```ts
describe('turinvoice.createCheckout — USD invariant', () => {
  it('throws when a line item is not USD', async () => {
    const input = {
      orderId: 'order_1',
      buyerEmail: 'a@b.com',
      lineItems: [{ amount: 500n, currency: 'TRY', sku: 'sku_1', name: 'Fixture' }],
      tenantId: 'tenant_1',
    };
    await expect(createCheckout(input as any)).rejects.toThrowError(
      /Phase 2d invariant: turinvoice\.createCheckout line item must be USD, got TRY/,
    );
  });
});
```

(If `createCheckout` is not already imported in this test file, add `import { createCheckout } from './createCheckout';`.)

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/providers/payment/turinvoice/turinvoice.test.ts -t "USD invariant"`

Expected: FAIL.

- [ ] **Step 3: Wire `assertUsdMoney` at the top of createCheckout**

In `src/server/providers/payment/turinvoice/createCheckout.ts`, at the top of the function body, before `const currency = input.lineItems[0]?.currency ?? env.TURINVOICE_CURRENCY;`:

```ts
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';

export async function createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
  for (const item of input.lineItems) {
    assertUsdMoney({ currency: item.currency }, 'turinvoice.createCheckout line item');
  }
  // ...existing body unchanged...
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/providers/payment/turinvoice/turinvoice.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/payment/turinvoice/createCheckout.ts src/server/providers/payment/turinvoice/turinvoice.test.ts
git commit -m "feat(2d): enforce USD invariant in turinvoice.createCheckout"
```

---

## Task 6: Apply USD invariant in paddle/refund

**Files:**
- Modify: `src/server/providers/payment/paddle/refund.ts`
- Test: `src/server/providers/payment/paddle/refund.test.ts` — if exists, extend; else create.

- [ ] **Step 1: Write the failing test**

Create or extend `src/server/providers/payment/paddle/refund.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { refund } from './refund';
import type { Payment } from '@prisma/client';

describe('paddle.refund — USD invariant', () => {
  it('throws when payment.currency is not USD', async () => {
    const payment = {
      id: 'p1',
      orderId: 'o1',
      currency: 'EUR',
      amount: 1000n,
      refundedAmount: 0n,
      externalPaymentId: 'paddle_tx_1',
    } as unknown as Payment;
    await expect(refund(payment)).rejects.toThrowError(
      /Phase 2d invariant: paddle\.refund payment must be USD, got EUR/,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/providers/payment/paddle/refund.test.ts -t "USD invariant"`

Expected: FAIL.

- [ ] **Step 3: Wire `assertUsdMoney` at the top of refund**

In `src/server/providers/payment/paddle/refund.ts`, at the top of the `refund` function:

```ts
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';

export async function refund(payment: Payment): Promise<RefundResult> {
  if (!payment.externalPaymentId) {
    throw new Error('paddle.refund: payment.externalPaymentId is required');
  }
  assertUsdMoney({ currency: payment.currency }, 'paddle.refund payment');
  // ...existing body unchanged...
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/providers/payment/paddle/refund.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/providers/payment/paddle/refund.ts src/server/providers/payment/paddle/refund.test.ts
git commit -m "feat(2d): enforce USD invariant in paddle.refund"
```

---

## Task 7: Country whitelist env var

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Inspect the current env validation file**

Run: `cat src/lib/env.ts`

Note the zod schema pattern (most likely `z.object({...}).parse(process.env)`).

- [ ] **Step 2: Add `PACKAGES_SYNC_COUNTRIES` to the schema**

In `src/lib/env.ts`, inside the zod object, add:

```ts
PACKAGES_SYNC_COUNTRIES: z
  .string()
  .default('TR,US,GB,DE,FR,ES,IT,RU')
  .transform((s) =>
    s
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().length(2))),
```

This produces `env.PACKAGES_SYNC_COUNTRIES: string[]` (already split + upper-cased + length-validated).

- [ ] **Step 3: Document in `.env.example`**

Append to `.env.example`:

```
# Phase 2d — countries to include in scheduled Airalo catalog sync
# Comma-separated ISO-3166-1 alpha-2 codes. Defaults to 'TR,US,GB,DE,FR,ES,IT,RU'.
PACKAGES_SYNC_COUNTRIES=TR,US,GB,DE,FR,ES,IT,RU
```

- [ ] **Step 4: Verify type-check**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(2d): add PACKAGES_SYNC_COUNTRIES env var"
```

---

## Task 8: Refactor — extract applyPackagesSync service

**Files:**
- Create: `src/server/providers/esim/airalo/applyPackagesSync.ts`
- Test: `src/server/providers/esim/airalo/applyPackagesSync.test.ts`
- Reference (existing logic to extract): `scripts/sync-packages.ts` lines 4–37

- [ ] **Step 1: Write the failing test — happy path upsert**

Create `src/server/providers/esim/airalo/applyPackagesSync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { applyPackagesSync } from './applyPackagesSync';
import type { ProviderPackageSeed } from '../types';

const baseRow: ProviderPackageSeed = {
  providerSku: 'airalo-tr-1gb-7d',
  name: 'TR 1 GB / 7 days',
  country: 'TR',
  dataMb: 1024,
  durationDays: 7,
  priceAmount: 400n,
  priceCurrency: 'USD',
};

describe('applyPackagesSync', () => {
  beforeEach(async () => {
    await prisma.providerPackage.deleteMany({ where: { providerId: 'airalo' } });
  });

  it('upserts new packages and reports counts', async () => {
    const result = await applyPackagesSync([baseRow], { whitelist: ['TR'] });
    expect(result.upserted).toBe(1);
    expect(result.deactivated).toBe(0);
    const row = await prisma.providerPackage.findUnique({
      where: { providerId_sku: { providerId: 'airalo', sku: baseRow.providerSku } },
    });
    expect(row?.active).toBe(true);
    expect(row?.priceAmount).toBe(400n);
  });

  it('skips non-USD packages and does not deactivate them', async () => {
    const eur: ProviderPackageSeed = { ...baseRow, providerSku: 'eur-row', priceCurrency: 'EUR' };
    const result = await applyPackagesSync([baseRow, eur], { whitelist: ['TR'] });
    expect(result.upserted).toBe(1);
    expect(result.skippedNonUsd).toBe(1);
    const eurRow = await prisma.providerPackage.findUnique({
      where: { providerId_sku: { providerId: 'airalo', sku: 'eur-row' } },
    });
    expect(eurRow).toBeNull();
  });

  it('writes audit log on price change', async () => {
    await applyPackagesSync([baseRow], { whitelist: ['TR'] });
    await applyPackagesSync([{ ...baseRow, priceAmount: 500n }], { whitelist: ['TR'] });
    const audits = await prisma.auditLog.findMany({
      where: { action: 'package.price_changed' },
    });
    expect(audits).toHaveLength(1);
    expect((audits[0].metadata as any).from.priceAmount).toBe('400');
    expect((audits[0].metadata as any).to.priceAmount).toBe('500');
  });

  it('writes audit log on spec change (dataMb)', async () => {
    await applyPackagesSync([baseRow], { whitelist: ['TR'] });
    await applyPackagesSync([{ ...baseRow, dataMb: 2048 }], { whitelist: ['TR'] });
    const audits = await prisma.auditLog.findMany({
      where: { action: 'package.spec_changed' },
    });
    expect(audits).toHaveLength(1);
  });

  it('soft-deletes whitelist-scoped active packages that are no longer present', async () => {
    await applyPackagesSync([baseRow], { whitelist: ['TR'] });
    const result = await applyPackagesSync([], { whitelist: ['TR'] });
    expect(result.deactivated).toBe(1);
    const row = await prisma.providerPackage.findUnique({
      where: { providerId_sku: { providerId: 'airalo', sku: baseRow.providerSku } },
    });
    expect(row?.active).toBe(false);
  });

  it('does NOT deactivate packages whose country is outside the whitelist', async () => {
    await prisma.providerPackage.create({
      data: {
        providerId: 'airalo',
        sku: 'jp-row',
        name: 'JP 1 GB / 7 days',
        countryCodes: ['JP'],
        dataMb: 1024,
        durationDays: 7,
        priceAmount: 500n,
        priceCurrency: 'USD',
        active: true,
      },
    });
    await applyPackagesSync([], { whitelist: ['TR'] });
    const jp = await prisma.providerPackage.findUnique({
      where: { providerId_sku: { providerId: 'airalo', sku: 'jp-row' } },
    });
    expect(jp?.active).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/providers/esim/airalo/applyPackagesSync.test.ts`

Expected: FAIL — `applyPackagesSync` not exported.

- [ ] **Step 3: Implement applyPackagesSync**

Create `src/server/providers/esim/airalo/applyPackagesSync.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import type { ProviderPackageSeed } from '../types';

export interface ApplyPackagesSyncOptions {
  whitelist: string[]; // ISO-3166-1 alpha-2 codes, upper-cased.
}

export interface ApplyPackagesSyncResult {
  upserted: number;
  deactivated: number;
  skippedNonUsd: number;
}

interface ChangeFields {
  priceAmount: bigint;
  dataMb: number;
  durationDays: number;
}

function pickChangeFields(p: { priceAmount: bigint; dataMb: number | null; durationDays: number | null }): ChangeFields {
  return {
    priceAmount: p.priceAmount,
    dataMb: p.dataMb ?? 0,
    durationDays: p.durationDays ?? 0,
  };
}

function serializeChange(c: ChangeFields): Record<string, string | number> {
  return { priceAmount: c.priceAmount.toString(), dataMb: c.dataMb, durationDays: c.durationDays };
}

export async function applyPackagesSync(
  rows: ProviderPackageSeed[],
  opts: ApplyPackagesSyncOptions,
): Promise<ApplyPackagesSyncResult> {
  const whitelist = new Set(opts.whitelist.map((c) => c.toUpperCase()));
  const seenSkus = new Set<string>();
  let upserted = 0;
  let skippedNonUsd = 0;

  for (const row of rows) {
    if (row.priceCurrency !== 'USD') {
      console.warn('[applyPackagesSync] skipping non-USD row', {
        sku: row.providerSku,
        currency: row.priceCurrency,
      });
      skippedNonUsd++;
      continue;
    }
    if (!whitelist.has(row.country.toUpperCase())) {
      // Whitelist filter applies to incoming rows too: we never upsert outside whitelist.
      continue;
    }

    const before = await prisma.providerPackage.findUnique({
      where: { providerId_sku: { providerId: 'airalo', sku: row.providerSku } },
    });

    await prisma.providerPackage.upsert({
      where: { providerId_sku: { providerId: 'airalo', sku: row.providerSku } },
      create: {
        providerId: 'airalo',
        sku: row.providerSku,
        name: row.name,
        countryCodes: [row.country.toUpperCase()],
        dataMb: row.dataMb,
        durationDays: row.durationDays,
        priceAmount: row.priceAmount,
        priceCurrency: 'USD',
        active: true,
      },
      update: {
        name: row.name,
        countryCodes: [row.country.toUpperCase()],
        dataMb: row.dataMb,
        durationDays: row.durationDays,
        priceAmount: row.priceAmount,
        priceCurrency: 'USD',
        syncedAt: new Date(),
        active: true,
      },
    });
    seenSkus.add(row.providerSku);
    upserted++;

    if (before) {
      const beforeFields = pickChangeFields(before);
      const afterFields = pickChangeFields({
        priceAmount: row.priceAmount,
        dataMb: row.dataMb,
        durationDays: row.durationDays,
      });
      const priceChanged = beforeFields.priceAmount !== afterFields.priceAmount;
      const specChanged =
        beforeFields.dataMb !== afterFields.dataMb || beforeFields.durationDays !== afterFields.durationDays;
      if (priceChanged || specChanged) {
        await prisma.auditLog.create({
          data: {
            tenantId: null,
            userId: null,
            action: priceChanged ? 'package.price_changed' : 'package.spec_changed',
            resource: 'provider_package',
            resourceId: before.id,
            metadata: {
              from: serializeChange(beforeFields),
              to: serializeChange(afterFields),
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
  }

  // Soft-delete: whitelist-scoped active rows whose SKU disappeared this run.
  const whitelistArray = Array.from(whitelist);
  const deactivated = await prisma.providerPackage.updateMany({
    where: {
      providerId: 'airalo',
      active: true,
      countryCodes: { hasSome: whitelistArray },
      sku: { notIn: Array.from(seenSkus) },
    },
    data: {
      active: false,
      updatedAt: new Date(),
    },
  });

  return { upserted, deactivated: deactivated.count, skippedNonUsd };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/providers/esim/airalo/applyPackagesSync.test.ts`

Expected: PASS, all 6 cases. (Tests rely on a real DB connection. If your test setup mocks Prisma, switch this file to use the integration test runner; the existing `applyPackagesSync` analogue is the Phase 2c `esimSyncStatuses` test which already hits real Postgres.)

- [ ] **Step 5: Verify AuditLog schema accepts `tenantId: null`**

Run: `grep -n "tenantId" prisma/schema.prisma | grep -A2 "model AuditLog"` and confirm `tenantId String?` (nullable). If it's required (`String`, not `String?`), use a sentinel "system" tenant or add `tenantId String?` in the migration. (Per current Phase 2c memory, AuditLog accepts a null tenantId; verify before assuming.)

- [ ] **Step 6: Commit**

```bash
git add src/server/providers/esim/airalo/applyPackagesSync.ts src/server/providers/esim/airalo/applyPackagesSync.test.ts
git commit -m "feat(2d): extract applyPackagesSync service with audit + whitelist soft-delete"
```

---

## Task 9: Scheduled job runPackagesSyncCatalog

**Files:**
- Create: `src/server/jobs/scheduled/packagesSyncCatalog.ts`
- Test: `src/server/jobs/scheduled/packagesSyncCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/jobs/scheduled/packagesSyncCatalog.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPackagesSyncCatalog } from './packagesSyncCatalog';

vi.mock('@/src/server/providers/esim/airalo', () => ({
  airaloProvider: {
    syncPackages: vi.fn(),
  },
}));

vi.mock('@/src/server/providers/esim/airalo/applyPackagesSync', () => ({
  applyPackagesSync: vi.fn(),
}));

vi.mock('@/src/lib/env', () => ({
  env: { PACKAGES_SYNC_COUNTRIES: ['TR', 'US'] },
}));

import { airaloProvider } from '@/src/server/providers/esim/airalo';
import { applyPackagesSync } from '@/src/server/providers/esim/airalo/applyPackagesSync';

describe('runPackagesSyncCatalog', () => {
  beforeEach(() => {
    vi.mocked(airaloProvider.syncPackages).mockReset();
    vi.mocked(applyPackagesSync).mockReset();
  });

  it('fetches Airalo, applies sync with whitelist, returns counts', async () => {
    vi.mocked(airaloProvider.syncPackages).mockResolvedValue([
      { providerSku: 's1', name: 'n1', country: 'TR', dataMb: 1024, durationDays: 7, priceAmount: 400n, priceCurrency: 'USD' },
    ]);
    vi.mocked(applyPackagesSync).mockResolvedValue({ upserted: 1, deactivated: 0, skippedNonUsd: 0 });

    const result = await runPackagesSyncCatalog();
    expect(airaloProvider.syncPackages).toHaveBeenCalledOnce();
    expect(applyPackagesSync).toHaveBeenCalledWith(
      expect.any(Array),
      { whitelist: ['TR', 'US'] },
    );
    expect(result.upserted).toBe(1);
  });

  it('propagates errors from the Airalo client (BullMQ retries)', async () => {
    vi.mocked(airaloProvider.syncPackages).mockRejectedValue(new Error('Airalo /packages 502'));
    await expect(runPackagesSyncCatalog()).rejects.toThrowError(/Airalo \/packages 502/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/jobs/scheduled/packagesSyncCatalog.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the scheduled job**

Create `src/server/jobs/scheduled/packagesSyncCatalog.ts`:

```ts
import { airaloProvider } from '@/src/server/providers/esim/airalo';
import { applyPackagesSync } from '@/src/server/providers/esim/airalo/applyPackagesSync';
import { env } from '@/src/lib/env';

export interface PackagesSyncCatalogResult {
  fetched: number;
  upserted: number;
  deactivated: number;
  skippedNonUsd: number;
  durationMs: number;
}

/**
 * Pulls the full Airalo catalog, then applies the in-memory whitelist filter +
 * upsert + soft-delete via applyPackagesSync. Throws on Airalo client failure
 * so BullMQ's retry policy picks it up.
 *
 * Called every 6 hours by the scheduled queue. Also reused at deploy time by
 * scripts/sync-packages.ts.
 */
export async function runPackagesSyncCatalog(): Promise<PackagesSyncCatalogResult> {
  const start = Date.now();
  const rows = await airaloProvider.syncPackages();
  const result = await applyPackagesSync(rows, {
    whitelist: env.PACKAGES_SYNC_COUNTRIES,
  });
  const durationMs = Date.now() - start;
  console.log('[packages.syncCatalog]', { fetched: rows.length, ...result, durationMs });
  return { fetched: rows.length, ...result, durationMs };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/jobs/scheduled/packagesSyncCatalog.test.ts`

Expected: PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/jobs/scheduled/packagesSyncCatalog.ts src/server/jobs/scheduled/packagesSyncCatalog.test.ts
git commit -m "feat(2d): add packages.syncCatalog scheduled job"
```

---

## Task 10: Wire schedule + worker dispatch

**Files:**
- Modify: `src/server/jobs/registerSchedules.ts`
- Modify: `src/server/jobs/workers/scheduled.ts`
- Test: `src/server/jobs/registerSchedules.test.ts` (existing — extend).

- [ ] **Step 1: Inspect the registerSchedules test pattern**

Run: `cat src/server/jobs/registerSchedules.test.ts`

Note how existing schedule entries are asserted.

- [ ] **Step 2: Extend the test**

Append to the existing `describe('registerSchedules')` block:

```ts
it('registers packages.syncCatalog with a 6-hour cadence', async () => {
  await registerSchedules();
  const jobs = await scheduledQueue.getRepeatableJobs();
  const pkgJob = jobs.find((j) => j.name === 'packages.syncCatalog');
  expect(pkgJob).toBeDefined();
  expect(pkgJob?.every).toBe(String(6 * 60 * 60 * 1000));
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/jobs/registerSchedules.test.ts -t "packages.syncCatalog"`

Expected: FAIL — packages.syncCatalog is not in SCHEDULES yet.

- [ ] **Step 4: Add to SCHEDULES**

In `src/server/jobs/registerSchedules.ts`, extend the array:

```ts
const SCHEDULES: ScheduleSpec[] = [
  { name: 'esim.syncStatuses',  everyMs: 15 * 60 * 1000 },
  { name: 'order.expireStale',  everyMs: 60 * 60 * 1000 },
  { name: 'packages.syncCatalog', everyMs: 6 * 60 * 60 * 1000 },
];
```

- [ ] **Step 5: Add to worker dispatch**

In `src/server/jobs/workers/scheduled.ts`, extend the `switch` block:

```ts
import { runPackagesSyncCatalog } from '../scheduled/packagesSyncCatalog';
// ...
switch (job.name) {
  case 'esim.syncStatuses':
    return runEsimSyncStatuses();
  case 'order.expireStale':
    return runOrderExpireStale();
  case 'packages.syncCatalog':
    return runPackagesSyncCatalog();
  default:
    console.warn('[scheduledWorker] unknown job', job.name);
    return { skipped: true };
}
```

- [ ] **Step 6: Run test — expect PASS**

Run: `pnpm vitest run src/server/jobs/registerSchedules.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/jobs/registerSchedules.ts src/server/jobs/workers/scheduled.ts src/server/jobs/registerSchedules.test.ts
git commit -m "feat(2d): wire packages.syncCatalog into registerSchedules + worker dispatch"
```

---

## Task 11: Refactor scripts/sync-packages.ts to use the service

**Files:**
- Modify: `scripts/sync-packages.ts`

- [ ] **Step 1: Replace the inline upsert loop**

Replace the entire body of `scripts/sync-packages.ts` with a thin wrapper that calls the new scheduled-job entry, so the bootstrap path uses identical logic:

```ts
import { runPackagesSyncCatalog } from '@/src/server/jobs/scheduled/packagesSyncCatalog';
import { prisma } from '@/src/lib/db';

async function main(): Promise<void> {
  console.log('Bootstrapping Airalo catalog (one-shot)…');
  const result = await runPackagesSyncCatalog();
  console.log('Bootstrap complete:', result);
  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script locally**

Run: `pnpm sync:packages`

Expected: terminal logs `Bootstrap complete: { fetched: <N>, upserted: <M>, deactivated: 0, skippedNonUsd: 0, durationMs: ... }` where `M` is the number of whitelist-matching packages. (`deactivated` should be 0 on the first bootstrap run — nothing to soft-delete.)

- [ ] **Step 3: Verify DB state**

Run: `pnpm prisma studio` (or use psql / direct query). Confirm `provider_packages.active=true` rows exist for each country in `PACKAGES_SYNC_COUNTRIES`. Spot-check a row's `priceCurrency='USD'`.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-packages.ts
git commit -m "refactor(2d): scripts/sync-packages.ts uses runPackagesSyncCatalog"
```

---

## Task 12: Smoke test — boot worker, confirm schedule registration

**Files:** none modified.

- [ ] **Step 1: Boot worker**

Run: `pnpm dev:worker` (in a separate terminal if other services are running).

Expected console output (first ~3 seconds):

```
[schedules] registered: [ 'esim.syncStatuses', 'order.expireStale', 'packages.syncCatalog' ]
[worker] 3 workers + outbox dispatcher ready
```

If `packages.syncCatalog` is missing from the schedules array, revisit Task 10. If the worker crashes on boot, capture the stack trace and re-check the import paths in Task 10 step 5.

- [ ] **Step 2: Force-trigger one job for end-to-end smoke**

In a new terminal:

```bash
pnpm tsx -e "
import { scheduledQueue } from './src/server/jobs/queue';
await scheduledQueue.add('packages.syncCatalog', {}, { jobId: 'manual-smoke-' + Date.now() });
console.log('queued');
process.exit(0);
"
```

Watch the worker terminal for `[packages.syncCatalog] { fetched: ..., upserted: ..., ... }`. Job should complete in <30 s.

- [ ] **Step 3: Stop worker (Ctrl+C) and commit any incidental fixes**

If you discovered any bugs during smoke that needed code edits, commit them with a descriptive message. If everything was clean, no commit needed for this step.

---

## Task 13: Open PR-A

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/phase-2d-pr-a
```

(Assumes you started PR-A on a fresh branch `feat/phase-2d-pr-a` — if not, branch and push now: `git checkout -b feat/phase-2d-pr-a && git push -u origin feat/phase-2d-pr-a`.)

- [ ] **Step 2: Create PR via gh**

```bash
gh pr create --base main --title "Phase 2d PR-A: schema + USD invariant + packages.syncCatalog" --body "$(cat <<'EOF'
## Summary
- Add `OrderState.PARTIALLY_REFUNDED`, `Payment.refundedAmount`, `Order.paymentMethodHint` (additive migration)
- Enforce USD-only invariant in `createBooking`, `paddle/createCheckout`, `turinvoice/createCheckout`, `paddle/refund`
- Extract `applyPackagesSync` service with audit-on-change + whitelist-scoped soft-delete
- Add `packages.syncCatalog` scheduled job (every 6 h) and wire into `registerSchedules` + worker dispatch
- Refactor `scripts/sync-packages.ts` to call the same service path

## Test plan
- [ ] Migration applies cleanly on a fresh DB (`pnpm prisma migrate reset --force`)
- [ ] `pnpm vitest run` — full suite green
- [ ] `pnpm sync:packages` — bootstraps catalog with whitelist filter
- [ ] Worker boot logs include `'packages.syncCatalog'` in registered schedules
- [ ] Manual job trigger completes in <30 s with non-zero `upserted`
- [ ] Audit log entries created when re-running with a forged price change

🤖 Phase 2d, see docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md
EOF
)"
```

- [ ] **Step 2: Confirm PR is open**

The command prints the PR URL. Open it, verify all CI checks start, and verify the diff contains exactly the 11 commits from Tasks 1–11. If any commit accidentally bundles unrelated files, abort the PR and clean the branch before re-pushing.
