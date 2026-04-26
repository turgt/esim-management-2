# V2 Phase 2d — PR-C: Partial Refunds + TurInvoice UX Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-only Paddle refund with an item-level partial refund flow (server + admin modal), wire `Payment.refundedAmount` and `OrderState.PARTIALLY_REFUNDED` into the state machine, and replace the implicit checkout redirect with an explicit two-card payment provider picker on the B2C order detail page.

**Architecture:** A new `paddlePartialRefund` SDK call accepts per-item full/partial directives and uses a cumulative idempotency key (`order-refund-{orderId}-{newRefundedTotal}`) so a true retry of the same refund intent is safe. `applyRefundToPayment` orchestrates: validation → Paddle call OUTSIDE the DB tx → DB tx that updates Payment.refundedAmount, transitions Order, writes audit, queues outbox email. The TurInvoice UX picker is a client component that renders two equal cards when no Payment exists yet, and a "resume or switch" view when one does; the switch path goes through a `voidAndRetry` server action that cancels the pending Payment.

**Tech Stack:** Paddle Node SDK 3.8 (per-call client to attach Idempotency-Key — Phase 2c gotcha #7), Next.js Server Actions, Base UI (existing component library in V2), Playwright for E2E, Prisma transactions.

**Spec reference:** `docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md` §3.2, §3.3, §5.4, §5.5, §6.1, §11. Depends on PR-A merged (`Payment.refundedAmount`, `Order.paymentMethodHint`, `OrderState.PARTIALLY_REFUNDED`, `assertUsdMoney`).

---

## File Structure

### Created
- `src/server/refunds/paddlePartialRefund.ts` — wraps Paddle SDK `adjustments.create` with item-level partial support.
- `src/server/refunds/paddlePartialRefund.test.ts` — unit tests.
- `src/server/refunds/applyRefundToPayment.ts` — orchestrator (validation, state machine, audit, outbox).
- `src/server/refunds/applyRefundToPayment.test.ts` — unit tests.
- `src/server/email/templates/orderPartiallyRefunded.tsx` — React Email template.
- `src/server/email/templates/orderPartiallyRefunded.test.tsx` — render snapshot.
- `app/[locale]/(admin)/admin/orders/[id]/refund.action.ts` — server action wrapping applyRefundToPayment.
- `app/[locale]/(admin)/admin/orders/[id]/IssueRefundModal.tsx` — admin client component.
- `app/[locale]/(customer)/shop/orders/[id]/PaymentProviderPicker.tsx` — B2C client component.
- `app/[locale]/(customer)/shop/orders/[id]/voidAndRetry.action.ts` — server action.
- `e2e/admin-issue-partial-refund.spec.ts` — Playwright.
- `e2e/checkout-provider-picker.spec.ts` — Playwright.

### Modified
- `src/server/outbox/processor.ts` — recognize `orderPartiallyRefunded` template.
- `src/server/domain/orders/orderMachine.ts` — accept new transitions involving `PARTIALLY_REFUNDED`.
- `app/[locale]/(admin)/admin/orders/[id]/page.tsx` — render Issue Refund button + modal.
- `app/[locale]/(customer)/shop/orders/[id]/page.tsx` — render PaymentProviderPicker.

---

## Task 1: orderMachine — accept PARTIALLY_REFUNDED transitions

**Files:**
- Modify: `src/server/domain/orders/orderMachine.ts`
- Test: `src/server/domain/orders/orderMachine.test.ts`

- [ ] **Step 1: Inspect existing state machine**

Run: `cat src/server/domain/orders/orderMachine.ts | head -80`

Find the transition table or `transition()` function. Identify how `PAID → REFUNDED` is currently encoded.

- [ ] **Step 2: Write the failing test**

Append to `src/server/domain/orders/orderMachine.test.ts`:

```ts
describe('PARTIALLY_REFUNDED transitions', () => {
  it('allows PAID → PARTIALLY_REFUNDED via PARTIAL_REFUND event', () => {
    const next = transition({ state: 'PAID' } as any, { type: 'PARTIAL_REFUND' });
    expect(next.state).toBe('PARTIALLY_REFUNDED');
  });

  it('allows PARTIALLY_REFUNDED → PARTIALLY_REFUNDED on additional partial', () => {
    const next = transition({ state: 'PARTIALLY_REFUNDED' } as any, { type: 'PARTIAL_REFUND' });
    expect(next.state).toBe('PARTIALLY_REFUNDED');
  });

  it('allows PARTIALLY_REFUNDED → REFUNDED when cumulative reaches total (FULL_REFUND event)', () => {
    const next = transition({ state: 'PARTIALLY_REFUNDED' } as any, { type: 'FULL_REFUND' });
    expect(next.state).toBe('REFUNDED');
  });

  it('still allows PAID → REFUNDED via FULL_REFUND', () => {
    const next = transition({ state: 'PAID' } as any, { type: 'FULL_REFUND' });
    expect(next.state).toBe('REFUNDED');
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/domain/orders/orderMachine.test.ts -t "PARTIALLY_REFUNDED"`

Expected: FAIL — events / state values not recognized.

- [ ] **Step 4: Add transitions**

In `src/server/domain/orders/orderMachine.ts`, find the transition table (likely a switch on `state` then on `event.type`). Add the new edges:

```ts
// PAID
case 'PAID':
  switch (event.type) {
    case 'FULL_REFUND': return { ...order, state: 'REFUNDED' };
    case 'PARTIAL_REFUND': return { ...order, state: 'PARTIALLY_REFUNDED' };
    // ...existing transitions...
  }

// PARTIALLY_REFUNDED
case 'PARTIALLY_REFUNDED':
  switch (event.type) {
    case 'PARTIAL_REFUND': return { ...order, state: 'PARTIALLY_REFUNDED' };
    case 'FULL_REFUND':    return { ...order, state: 'REFUNDED' };
    // PARTIALLY_REFUNDED is otherwise terminal-ish from user POV.
  }
```

(Match the actual format of the existing file. If the existing machine uses a transition map/object instead of switches, mirror that pattern.)

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/domain/orders/orderMachine.test.ts`

Expected: all PASS, including new and existing.

- [ ] **Step 6: Commit**

```bash
git add src/server/domain/orders/orderMachine.ts src/server/domain/orders/orderMachine.test.ts
git commit -m "feat(2d): orderMachine accepts PARTIAL_REFUND and PARTIALLY_REFUNDED → REFUNDED edges"
```

---

## Task 2: paddlePartialRefund

**Files:**
- Create: `src/server/refunds/paddlePartialRefund.ts`
- Test: `src/server/refunds/paddlePartialRefund.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/refunds/paddlePartialRefund.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { paddlePartialRefund } from './paddlePartialRefund';

const adjustmentsCreate = vi.fn();
const PaddleCtor = vi.fn(() => ({ adjustments: { create: adjustmentsCreate } }));

vi.mock('@paddle/paddle-node-sdk', () => ({
  Paddle: PaddleCtor,
  Environment: { production: 'production', sandbox: 'sandbox' },
}));

vi.mock('@/src/lib/env', () => ({
  env: { PADDLE_API_KEY: 'pdl_test', PADDLE_ENVIRONMENT: 'sandbox' },
}));

describe('paddlePartialRefund', () => {
  beforeEach(() => {
    PaddleCtor.mockClear();
    adjustmentsCreate.mockReset();
  });

  it('constructs a fresh Paddle client per call with the cumulative Idempotency-Key', async () => {
    adjustmentsCreate.mockResolvedValue({ id: 'adj_1' });

    await paddlePartialRefund({
      transactionId: 'txn_123',
      items: [{ paddleItemId: 'pi_a', type: 'partial', amount: 500n }],
      reason: 'requested_by_customer',
      idempotencyKey: 'order-refund-order_1-500',
    });

    expect(PaddleCtor).toHaveBeenCalledOnce();
    expect(PaddleCtor).toHaveBeenCalledWith(
      'pdl_test',
      expect.objectContaining({
        customHeaders: { 'Idempotency-Key': 'order-refund-order_1-500' },
      }),
    );
  });

  it('forwards items to adjustments.create with correct shape', async () => {
    adjustmentsCreate.mockResolvedValue({ id: 'adj_2' });
    await paddlePartialRefund({
      transactionId: 'txn_456',
      items: [
        { paddleItemId: 'pi_a', type: 'partial', amount: 500n },
        { paddleItemId: 'pi_b', type: 'full' },
      ],
      reason: 'duplicate_charge',
      idempotencyKey: 'order-refund-order_2-1000',
    });
    expect(adjustmentsCreate).toHaveBeenCalledWith({
      action: 'refund',
      transactionId: 'txn_456',
      reason: 'duplicate_charge',
      items: [
        { itemId: 'pi_a', type: 'partial', amount: '500' },
        { itemId: 'pi_b', type: 'full' },
      ],
    });
  });

  it('returns provider adjustment id on success', async () => {
    adjustmentsCreate.mockResolvedValue({ id: 'adj_3' });
    const r = await paddlePartialRefund({
      transactionId: 'txn_x',
      items: [{ paddleItemId: 'pi_a', type: 'full' }],
      reason: 'requested_by_customer',
      idempotencyKey: 'order-refund-order_x-400',
    });
    expect(r.providerRefundId).toBe('adj_3');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/refunds/paddlePartialRefund.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement paddlePartialRefund**

Create `src/server/refunds/paddlePartialRefund.ts`:

```ts
import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import { env } from '@/src/lib/env';

export interface PaddlePartialRefundItem {
  paddleItemId: string;
  type: 'full' | 'partial';
  amount?: bigint; // minor units, required when type === 'partial'
}

export interface PaddlePartialRefundInput {
  transactionId: string;
  items: PaddlePartialRefundItem[];
  reason: string;
  idempotencyKey: string;
}

export interface PaddlePartialRefundResult {
  providerRefundId: string;
}

/**
 * Per-item Paddle refund. Constructs a fresh Paddle client each call so the
 * Idempotency-Key header is attached at SDK init time (Paddle SDK 3.8 does
 * not accept per-request custom headers — Phase 2c gotcha #7).
 *
 * The idempotency key encodes the cumulative new refunded total
 * (`order-refund-{orderId}-{newRefundedTotal}`) so a true retry of the same
 * intent is safe, while a separate refund attempt produces a new key.
 */
export async function paddlePartialRefund(
  input: PaddlePartialRefundInput,
): Promise<PaddlePartialRefundResult> {
  const client = new Paddle(env.PADDLE_API_KEY, {
    environment:
      env.PADDLE_ENVIRONMENT === 'production' ? Environment.production : Environment.sandbox,
    customHeaders: { 'Idempotency-Key': input.idempotencyKey },
  });

  const adjustment = await client.adjustments.create({
    action: 'refund',
    transactionId: input.transactionId,
    reason: input.reason,
    items: input.items.map((item) => {
      if (item.type === 'partial') {
        if (item.amount === undefined) {
          throw new Error('paddlePartialRefund: partial item requires amount');
        }
        return { itemId: item.paddleItemId, type: 'partial' as const, amount: item.amount.toString() };
      }
      return { itemId: item.paddleItemId, type: 'full' as const };
    }),
  });

  return { providerRefundId: adjustment.id };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/refunds/paddlePartialRefund.test.ts`

Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/refunds/paddlePartialRefund.ts src/server/refunds/paddlePartialRefund.test.ts
git commit -m "feat(2d): add paddlePartialRefund (item-level adjustments.create)"
```

---

## Task 3: applyRefundToPayment orchestrator

**Files:**
- Create: `src/server/refunds/applyRefundToPayment.ts`
- Test: `src/server/refunds/applyRefundToPayment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/refunds/applyRefundToPayment.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/src/lib/db';
import { applyRefundToPayment } from './applyRefundToPayment';

vi.mock('./paddlePartialRefund', () => ({
  paddlePartialRefund: vi.fn(),
}));
import { paddlePartialRefund } from './paddlePartialRefund';

async function seedPaidOrder(opts: { totalAmount: bigint; paddleItemIds?: string[] }): Promise<{ orderId: string; paymentId: string; itemIds: string[] }> {
  const tenant = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', agencyContactEmail: 'a@b.com' } });
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo',
      sku: `sku-${Date.now()}`,
      name: 'P',
      countryCodes: ['TR'],
      dataMb: 1024,
      durationDays: 7,
      priceAmount: opts.totalAmount,
      priceCurrency: 'USD',
      active: true,
    },
  });
  const order = await prisma.order.create({
    data: {
      tenantId: tenant.id,
      buyerEmail: 'a@b.com',
      state: 'PAID',
      paymentMode: 'self_pay',
      travelerEmail: 'a@b.com',
      travelerName: 'A',
      totalAmount: opts.totalAmount,
      totalCurrency: 'USD',
      items: {
        create: [
          {
            providerPackageId: pkg.id,
            quantity: 1,
            unitAmount: opts.totalAmount,
            unitCurrency: 'USD',
            subtotalAmount: opts.totalAmount,
            subtotalCurrency: 'USD',
          },
        ],
      },
    },
    include: { items: true },
  });
  const payment = await prisma.payment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      providerId: 'paddle',
      externalPaymentId: 'paddle_tx_1',
      status: 'captured',
      amount: opts.totalAmount,
      currency: 'USD',
      refundedAmount: 0n,
      // Paddle-specific item ids stored in rawMetadata
      rawMetadata: { paddleItemIds: opts.paddleItemIds ?? ['pi_a'] },
    },
  });
  return { orderId: order.id, paymentId: payment.id, itemIds: order.items.map((i) => i.id) };
}

describe('applyRefundToPayment', () => {
  beforeEach(async () => {
    vi.mocked(paddlePartialRefund).mockReset();
    await prisma.outboxEvent.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.providerPackage.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  it('full refund transitions PAID → REFUNDED and zeroes remaining', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValue({ providerRefundId: 'adj_1' });

    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'full' }],
      reason: 'requested_by_customer',
      actorUserId: 'admin_1',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('REFUNDED');
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.refundedAmount).toBe(1000n);
    expect(payment.status).toBe('refunded');
  });

  it('partial refund transitions PAID → PARTIALLY_REFUNDED and updates refundedAmount', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValue({ providerRefundId: 'adj_2' });

    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 300n }],
      reason: 'partial-bad-coverage',
      actorUserId: 'admin_1',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('PARTIALLY_REFUNDED');
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.refundedAmount).toBe(300n);
    expect(payment.status).toBe('captured');
  });

  it('cumulative partial refund eventually flips to REFUNDED', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValueOnce({ providerRefundId: 'adj_3a' });
    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 700n }],
      reason: 'partial',
      actorUserId: 'admin_1',
    });
    vi.mocked(paddlePartialRefund).mockResolvedValueOnce({ providerRefundId: 'adj_3b' });
    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 300n }],
      reason: 'remainder',
      actorUserId: 'admin_1',
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.state).toBe('REFUNDED');
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(payment.refundedAmount).toBe(1000n);
  });

  it('rejects over-refund', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    await expect(
      applyRefundToPayment({
        orderId,
        items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 1500n }],
        reason: 'fat-finger',
        actorUserId: 'admin_1',
      }),
    ).rejects.toThrowError(/exceeds remaining/);
    expect(paddlePartialRefund).not.toHaveBeenCalled();
  });

  it('writes audit log with paddleAdjustmentId on partial refund', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValue({ providerRefundId: 'adj_x' });
    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 200n }],
      reason: 'partial',
      actorUserId: 'admin_1',
    });
    const audits = await prisma.auditLog.findMany({ where: { resourceId: orderId } });
    expect(audits.some((a) => a.action === 'order.partially_refunded')).toBe(true);
    const partial = audits.find((a) => a.action === 'order.partially_refunded')!;
    expect((partial.metadata as any).paddleAdjustmentId).toBe('adj_x');
  });

  it('queues orderPartiallyRefunded outbox email on partial', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValue({ providerRefundId: 'adj_y' });
    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'partial', amount: 100n }],
      reason: 'partial',
      actorUserId: 'admin_1',
    });
    const outbox = await prisma.outboxEvent.findMany({});
    expect(outbox.some((o) => o.template === 'orderPartiallyRefunded')).toBe(true);
  });

  it('queues orderRefunded outbox email on full', async () => {
    const { orderId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    vi.mocked(paddlePartialRefund).mockResolvedValue({ providerRefundId: 'adj_z' });
    await applyRefundToPayment({
      orderId,
      items: [{ orderItemId: itemIds[0]!, type: 'full' }],
      reason: 'full',
      actorUserId: 'admin_1',
    });
    const outbox = await prisma.outboxEvent.findMany({});
    expect(outbox.some((o) => o.template === 'orderRefunded')).toBe(true);
  });

  it('refuses to refund a non-USD payment', async () => {
    const { orderId, paymentId, itemIds } = await seedPaidOrder({ totalAmount: 1000n });
    await prisma.payment.update({ where: { id: paymentId }, data: { currency: 'EUR' } });
    await expect(
      applyRefundToPayment({
        orderId,
        items: [{ orderItemId: itemIds[0]!, type: 'full' }],
        reason: 'x',
        actorUserId: 'admin_1',
      }),
    ).rejects.toThrowError(/Phase 2d invariant: applyRefundToPayment payment must be USD/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/refunds/applyRefundToPayment.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement applyRefundToPayment**

Create `src/server/refunds/applyRefundToPayment.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';
import { paddlePartialRefund, type PaddlePartialRefundItem } from './paddlePartialRefund';

export interface ApplyRefundItem {
  orderItemId: string;
  type: 'full' | 'partial';
  amount?: bigint; // required when type === 'partial', minor units
}

export interface ApplyRefundInput {
  orderId: string;
  items: ApplyRefundItem[];
  reason: string;
  actorUserId: string;
}

export interface ApplyRefundResult {
  newOrderState: 'REFUNDED' | 'PARTIALLY_REFUNDED';
  newRefundedAmount: bigint;
  paddleAdjustmentId: string;
}

function sumRefundAmounts(items: ApplyRefundItem[], orderItems: Array<{ id: string; subtotalAmount: bigint }>): bigint {
  return items.reduce((acc, it) => {
    if (it.type === 'full') {
      const oi = orderItems.find((o) => o.id === it.orderItemId);
      if (!oi) throw new Error(`orderItem ${it.orderItemId} not found`);
      return acc + oi.subtotalAmount;
    }
    if (it.amount === undefined || it.amount <= 0n) {
      throw new Error('partial refund requires positive amount');
    }
    return acc + it.amount;
  }, 0n);
}

export async function applyRefundToPayment(input: ApplyRefundInput): Promise<ApplyRefundResult> {
  // 1. Load order + payment + items
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: { items: true, payments: true },
  });
  const payment = order.payments.find((p) => p.providerId === 'paddle' && (p.status === 'captured' || p.status === 'refunded'));
  if (!payment) {
    throw new Error(`applyRefundToPayment: no captured Paddle payment on order ${input.orderId}`);
  }
  assertUsdMoney({ currency: payment.currency }, 'applyRefundToPayment payment');

  // 2. Validate
  const requestedTotal = sumRefundAmounts(input.items, order.items);
  const remaining = payment.amount - payment.refundedAmount;
  if (requestedTotal <= 0n || requestedTotal > remaining) {
    throw new Error(`applyRefundToPayment: requested ${requestedTotal} exceeds remaining ${remaining}`);
  }

  // 3. Build idempotency key — cumulative new total
  const newRefundedTotal = payment.refundedAmount + requestedTotal;
  const idempotencyKey = `order-refund-${input.orderId}-${newRefundedTotal.toString()}`;

  // 4. Map orderItem -> paddleItemId from Payment.rawMetadata
  // Convention: Payment.rawMetadata = { paddleItemIds: { [orderItemId]: 'pi_xxx' } }
  // Phase 2c stored these on the Payment row when the Paddle checkout was created.
  const meta = (payment.rawMetadata ?? {}) as { paddleItemIds?: Record<string, string> };
  const paddleItemMap = meta.paddleItemIds ?? {};

  const paddleItems: PaddlePartialRefundItem[] = input.items.map((it) => {
    const paddleItemId = paddleItemMap[it.orderItemId];
    if (!paddleItemId) {
      throw new Error(`applyRefundToPayment: no paddleItemId mapped for orderItem ${it.orderItemId}`);
    }
    if (it.type === 'partial') {
      return { paddleItemId, type: 'partial', amount: it.amount! };
    }
    return { paddleItemId, type: 'full' };
  });

  if (!payment.externalPaymentId) {
    throw new Error('applyRefundToPayment: payment.externalPaymentId is missing');
  }

  // 5. Call Paddle (OUTSIDE the DB tx to keep it minimal)
  const { providerRefundId } = await paddlePartialRefund({
    transactionId: payment.externalPaymentId,
    items: paddleItems,
    reason: input.reason,
    idempotencyKey,
  });

  // 6. Persist atomically
  const newOrderState: 'REFUNDED' | 'PARTIALLY_REFUNDED' =
    newRefundedTotal === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedAmount: newRefundedTotal,
        status: newRefundedTotal === payment.amount ? 'refunded' : 'captured',
      },
    });

    await tx.order.update({
      where: { id: input.orderId },
      data: { state: newOrderState },
    });

    await tx.auditLog.create({
      data: {
        tenantId: order.tenantId,
        userId: input.actorUserId,
        action: newOrderState === 'REFUNDED' ? 'order.refunded' : 'order.partially_refunded',
        resource: 'order',
        resourceId: input.orderId,
        metadata: {
          items: input.items.map((it) => ({ ...it, amount: it.amount?.toString() })),
          reason: input.reason,
          paddleAdjustmentId: providerRefundId,
          refundedAmountThisStep: requestedTotal.toString(),
          refundedAmountCumulative: newRefundedTotal.toString(),
        } as Prisma.InputJsonValue,
      },
    });

    await tx.outboxEvent.create({
      data: {
        dedupKey: `email:order-refund:${input.orderId}:${newRefundedTotal.toString()}`,
        channel: 'email',
        template: newOrderState === 'REFUNDED' ? 'orderRefunded' : 'orderPartiallyRefunded',
        recipient: order.buyerEmail,
        payload: {
          orderId: input.orderId,
          refundedAmountThisStep: requestedTotal.toString(),
          refundedAmountCumulative: newRefundedTotal.toString(),
          totalAmount: payment.amount.toString(),
          reason: input.reason,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    newOrderState,
    newRefundedAmount: newRefundedTotal,
    paddleAdjustmentId: providerRefundId,
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/refunds/applyRefundToPayment.test.ts`

Expected: PASS, all 8 cases.

> **Note:** the test seed sets `payment.rawMetadata = { paddleItemIds: ['pi_a'] }` (an array). The implementation expects a `Record<string, string>` keyed by orderItemId. The test as written will fail this lookup. To make tests pass: change `seedPaidOrder` to set `rawMetadata: { paddleItemIds: { [orderItem.id]: 'pi_a' } }` after the order is created (a small follow-up update). Make this fix in the test before running.

- [ ] **Step 5: Commit**

```bash
git add src/server/refunds/applyRefundToPayment.ts src/server/refunds/applyRefundToPayment.test.ts
git commit -m "feat(2d): add applyRefundToPayment orchestrator"
```

---

## Task 4: orderPartiallyRefunded email template

**Files:**
- Create: `src/server/email/templates/orderPartiallyRefunded.tsx`
- Test: `src/server/email/templates/orderPartiallyRefunded.test.tsx`

- [ ] **Step 1: Inspect the existing orderRefunded template**

Run: `cat src/server/email/templates/orderRefunded.tsx 2>/dev/null | head -50`

Mirror its style and prop shape.

- [ ] **Step 2: Write the snapshot test**

Create `src/server/email/templates/orderPartiallyRefunded.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { OrderPartiallyRefunded } from './orderPartiallyRefunded';

describe('OrderPartiallyRefunded template', () => {
  it('renders cumulative + this-step totals + reason', async () => {
    const html = await render(
      <OrderPartiallyRefunded
        orderId="ord_1"
        refundedAmountThisStep="3.00"
        refundedAmountCumulative="5.00"
        totalAmount="10.00"
        reason="Customer reported partial coverage"
      />,
    );
    expect(html).toContain('Customer reported partial coverage');
    expect(html).toContain('$3.00');
    expect(html).toContain('$5.00');
    expect(html).toContain('$10.00');
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/email/templates/orderPartiallyRefunded.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement the template**

Create `src/server/email/templates/orderPartiallyRefunded.tsx`:

```tsx
import { Html, Head, Body, Container, Heading, Text, Hr } from '@react-email/components';

interface Props {
  orderId: string;
  refundedAmountThisStep: string; // formatted major units, e.g. '3.00'
  refundedAmountCumulative: string;
  totalAmount: string;
  reason: string;
}

export function OrderPartiallyRefunded({
  orderId,
  refundedAmountThisStep,
  refundedAmountCumulative,
  totalAmount,
  reason,
}: Props): JSX.Element {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '560px' }}>
          <Heading as="h1">Partial refund processed</Heading>
          <Text>Order ID: {orderId}</Text>
          <Hr />
          <Text>
            We've issued a partial refund of <strong>${refundedAmountThisStep}</strong>.
          </Text>
          <Text>
            Total refunded so far: <strong>${refundedAmountCumulative}</strong> of ${totalAmount}.
          </Text>
          <Text style={{ color: '#555' }}>Reason: {reason}</Text>
          <Hr />
          <Text style={{ color: '#888', fontSize: '12px' }}>
            Funds typically appear on your statement within 5–10 business days, depending on your bank.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/email/templates/orderPartiallyRefunded.test.tsx`

Expected: PASS.

- [ ] **Step 6: Wire into outbox processor**

Open `src/server/outbox/processor.ts`. Add a new case to the template switch:

```ts
import { OrderPartiallyRefunded } from '@/src/server/email/templates/orderPartiallyRefunded';
// ...
case 'orderPartiallyRefunded': {
  const p = event.payload as any;
  const subject = `Partial refund issued for your order ${p.orderId}`;
  // Format minor units to major units for display:
  const fmt = (minor: string) => (Number(BigInt(minor)) / 100).toFixed(2);
  const html = await render(
    <OrderPartiallyRefunded
      orderId={p.orderId}
      refundedAmountThisStep={fmt(p.refundedAmountThisStep)}
      refundedAmountCumulative={fmt(p.refundedAmountCumulative)}
      totalAmount={fmt(p.totalAmount)}
      reason={p.reason}
    />,
  );
  return { subject, html };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/server/email/templates/orderPartiallyRefunded.tsx src/server/email/templates/orderPartiallyRefunded.test.tsx src/server/outbox/processor.ts
git commit -m "feat(2d): add orderPartiallyRefunded email template + outbox case"
```

---

## Task 5: Admin refund server action

**Files:**
- Create: `app/[locale]/(admin)/admin/orders/[id]/refund.action.ts`

- [ ] **Step 1: Inspect existing admin server action pattern**

Run: `find app/\[locale\]/\(admin\) -name "*.action.ts" 2>/dev/null | head -5 && echo "---" && cat $(find app/\[locale\]/\(admin\) -name "*.action.ts" 2>/dev/null | head -1) 2>/dev/null`

Note how `requireAdmin` is invoked and how zod is used for input validation.

- [ ] **Step 2: Implement the action**

Create `app/[locale]/(admin)/admin/orders/[id]/refund.action.ts`:

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/src/server/auth/requireAdmin';
import { applyRefundToPayment } from '@/src/server/refunds/applyRefundToPayment';

const RefundItemSchema = z.discriminatedUnion('type', [
  z.object({ orderItemId: z.string().min(1), type: z.literal('full') }),
  z.object({ orderItemId: z.string().min(1), type: z.literal('partial'), amount: z.coerce.bigint().positive() }),
]);

const RefundActionSchema = z.object({
  orderId: z.string().min(1),
  items: z.array(RefundItemSchema).min(1),
  reason: z.string().min(1).max(500),
});

export interface RefundActionResult {
  ok: boolean;
  message?: string;
  newOrderState?: 'REFUNDED' | 'PARTIALLY_REFUNDED';
}

export async function refundAction(formData: FormData): Promise<RefundActionResult> {
  const session = await requireAdmin();
  const raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  const parsed = RefundActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  try {
    const result = await applyRefundToPayment({
      orderId: parsed.data.orderId,
      items: parsed.data.items.map((it) => (it.type === 'partial' ? { ...it } : { ...it })),
      reason: parsed.data.reason,
      actorUserId: session.user.id,
    });
    revalidatePath(`/admin/orders/${parsed.data.orderId}`);
    return { ok: true, newOrderState: result.newOrderState };
  } catch (err) {
    console.error('[refundAction] failed', err);
    return { ok: false, message: err instanceof Error ? err.message : 'Refund failed' };
  }
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(admin\)/admin/orders/[id]/refund.action.ts
git commit -m "feat(2d): add refundAction server action"
```

---

## Task 6: IssueRefundModal client component

**Files:**
- Create: `app/[locale]/(admin)/admin/orders/[id]/IssueRefundModal.tsx`

- [ ] **Step 1: Inspect existing modal pattern**

Run: `grep -rln "Dialog\|Modal" app/\[locale\]/\(admin\)/ 2>/dev/null | head -5`

Note which UI library is in use. Spec assumes Base UI (`@base-ui/react`); if a different library is in play, follow that.

- [ ] **Step 2: Implement the modal**

Create `app/[locale]/(admin)/admin/orders/[id]/IssueRefundModal.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { refundAction } from './refund.action';

interface OrderItemView {
  id: string;
  name: string;
  subtotalAmount: string; // minor units, stringified BigInt
  alreadyRefundedFromThisItem: string;
}

interface Props {
  orderId: string;
  payment: { providerId: string; amount: string; refundedAmount: string; currency: string };
  items: OrderItemView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ItemSelection =
  | { type: 'none' }
  | { type: 'full' }
  | { type: 'partial'; amountInput: string };

function fmtUsd(minorString: string): string {
  return `$${(Number(BigInt(minorString)) / 100).toFixed(2)}`;
}

export function IssueRefundModal({ orderId, payment, items, open, onOpenChange }: Props): JSX.Element {
  const [selections, setSelections] = useState<Record<string, ItemSelection>>(() =>
    Object.fromEntries(items.map((i) => [i.id, { type: 'none' as const }])),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (payment.providerId !== 'paddle') {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>Refund unsupported</Dialog.Title>
            <Dialog.Description>
              Refunds are only supported for Paddle payments. For Zendit / TurInvoice, use Mark Cancelled instead.
            </Dialog.Description>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const remaining = BigInt(payment.amount) - BigInt(payment.refundedAmount);
  const requestedTotal = items.reduce((acc, item) => {
    const sel = selections[item.id];
    if (!sel || sel.type === 'none') return acc;
    if (sel.type === 'full') return acc + (BigInt(item.subtotalAmount) - BigInt(item.alreadyRefundedFromThisItem));
    const parsed = BigInt(Math.round(parseFloat(sel.amountInput || '0') * 100));
    return acc + parsed;
  }, 0n);

  const canSubmit =
    reason.trim().length > 0 && requestedTotal > 0n && requestedTotal <= remaining && !pending;

  function setItem(id: string, sel: ItemSelection): void {
    setSelections((prev) => ({ ...prev, [id]: sel }));
  }

  function submit(): void {
    setError(null);
    const payload = {
      orderId,
      reason,
      items: items
        .map((item) => {
          const sel = selections[item.id];
          if (!sel || sel.type === 'none') return null;
          if (sel.type === 'full') return { orderItemId: item.id, type: 'full' as const };
          const minor = BigInt(Math.round(parseFloat(sel.amountInput) * 100));
          return { orderItemId: item.id, type: 'partial' as const, amount: minor.toString() };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };

    const fd = new FormData();
    fd.set('payload', JSON.stringify(payload));
    startTransition(async () => {
      const result = await refundAction(fd);
      if (!result.ok) {
        setError(result.message ?? 'Refund failed');
      } else {
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Issue refund</Dialog.Title>
          <Dialog.Description>Select items to refund and provide a reason.</Dialog.Description>
          <div>
            <p>Remaining refundable: {fmtUsd(remaining.toString())}</p>
            <p>This refund: {fmtUsd(requestedTotal.toString())}</p>
          </div>
          <ul>
            {items.map((item) => {
              const sel = selections[item.id]!;
              return (
                <li key={item.id}>
                  <strong>{item.name}</strong> — {fmtUsd(item.subtotalAmount)}
                  <div>
                    {(['none', 'full', 'partial'] as const).map((kind) => (
                      <label key={kind}>
                        <input
                          type="radio"
                          name={`refund-${item.id}`}
                          checked={sel.type === kind}
                          onChange={() =>
                            setItem(
                              item.id,
                              kind === 'partial' ? { type: 'partial', amountInput: '' } : { type: kind },
                            )
                          }
                        />{' '}
                        {kind}
                      </label>
                    ))}
                  </div>
                  {sel.type === 'partial' && (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={(Number(BigInt(item.subtotalAmount)) / 100).toString()}
                      placeholder="0.00"
                      value={sel.amountInput}
                      onChange={(e) => setItem(item.id, { type: 'partial', amountInput: e.target.value })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <textarea
            maxLength={500}
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <p style={{ color: 'red' }}>{error}</p>}
          <div>
            <button type="button" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={!canSubmit}>
              {pending ? 'Processing…' : 'Submit refund'}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`

Expected: PASS. (Adjust the Dialog imports if the project uses a different namespace — `@base-ui-components/react` is the actual installed package per `package.json`, but the namespace import path may differ. If unsure, run `grep -r "from '@base-ui" app/ src/` for examples.)

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(admin\)/admin/orders/[id]/IssueRefundModal.tsx
git commit -m "feat(2d): add IssueRefundModal admin client component"
```

---

## Task 7: Wire modal into admin order detail page

**Files:**
- Modify: `app/[locale]/(admin)/admin/orders/[id]/page.tsx`

- [ ] **Step 1: Read the existing page**

Run: `cat app/\[locale\]/\(admin\)/admin/orders/\[id\]/page.tsx`

Note the imports, props shape (page params), and how the existing "Issue Refund (full)" button is wired (if present).

- [ ] **Step 2: Add a client wrapper for the modal trigger**

Create or extend the file. The existing page is a Server Component; add a tiny Client Component sibling for the trigger:

Create `app/[locale]/(admin)/admin/orders/[id]/RefundButton.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { IssueRefundModal } from './IssueRefundModal';

interface Props {
  orderId: string;
  payment: { providerId: string; amount: string; refundedAmount: string; currency: string };
  items: Array<{ id: string; name: string; subtotalAmount: string; alreadyRefundedFromThisItem: string }>;
}

export function RefundButton({ orderId, payment, items }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const isPaddle = payment.providerId === 'paddle';
  return (
    <>
      <button
        type="button"
        disabled={!isPaddle}
        onClick={() => isPaddle && setOpen(true)}
        title={isPaddle ? 'Issue a full or partial refund' : 'Refund unsupported — use Mark Cancelled'}
      >
        Issue refund
      </button>
      {!isPaddle && (
        <span style={{ color: '#888', fontSize: '12px' }}>Refund unsupported — use Mark Cancelled</span>
      )}
      <IssueRefundModal
        orderId={orderId}
        payment={payment}
        items={items}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
```

- [ ] **Step 3: Render the trigger from the page**

In `app/[locale]/(admin)/admin/orders/[id]/page.tsx`, inside the JSX where actions live (find the existing "Mark Cancelled" or similar button), insert:

```tsx
import { RefundButton } from './RefundButton';

// ...inside the component, after fetching order + items + payment...
{(order.state === 'PAID' || order.state === 'PARTIALLY_REFUNDED') && order.payments.length > 0 && (
  <RefundButton
    orderId={order.id}
    payment={{
      providerId: activePayment.providerId,
      amount: activePayment.amount.toString(),
      refundedAmount: activePayment.refundedAmount.toString(),
      currency: activePayment.currency,
    }}
    items={order.items.map((it) => ({
      id: it.id,
      name: it.providerPackage.name,
      subtotalAmount: it.subtotalAmount.toString(),
      alreadyRefundedFromThisItem: '0', // simplified for now; partial-per-item bookkeeping is a future refinement
    }))}
  />
)}
```

(`activePayment` should be the captured/refunded Paddle payment — adapt the destructuring to the existing page's data shape.)

- [ ] **Step 4: Manual smoke**

Run: `pnpm dev:all`. Log in as an admin. Visit a `PAID` order. Click "Issue refund". Confirm the modal opens and shows the order items.

Try a partial refund: set one item to "partial" with `$2.00`, fill reason "test", submit. Expect Paddle sandbox call, success toast, page reloads with `Order.state = PARTIALLY_REFUNDED`.

Try a full refund of the remainder: select "full", reason "rest", submit. Expect `state = REFUNDED`.

If the Paddle SDK errors (e.g., transaction not refundable in sandbox), check the order has a real Paddle transaction associated — seed with a real test order if necessary.

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/\(admin\)/admin/orders/[id]/page.tsx app/[locale]/\(admin\)/admin/orders/[id]/RefundButton.tsx
git commit -m "feat(2d): wire IssueRefundModal into admin order detail page"
```

---

## Task 8: Payment provider picker — voidAndRetry server action

**Files:**
- Create: `app/[locale]/(customer)/shop/orders/[id]/voidAndRetry.action.ts`

- [ ] **Step 1: Implement the action**

Create the file:

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/src/lib/db';
import { requireAuth } from '@/src/server/auth/requireAuth';

const VoidAndRetrySchema = z.object({
  orderId: z.string().min(1),
});

export async function voidAndRetryAction(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const session = await requireAuth();
  const parsed = VoidAndRetrySchema.safeParse({ orderId: formData.get('orderId') });
  if (!parsed.success) return { ok: false, message: 'Invalid orderId' };

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    include: { payments: true },
  });
  if (!order) return { ok: false, message: 'Order not found' };
  if (order.buyerUserId !== session.user.id && order.buyerEmail !== session.user.email) {
    return { ok: false, message: 'Forbidden' };
  }
  if (order.state !== 'AWAITING_PAYMENT') {
    return { ok: false, message: 'Order is no longer awaiting payment' };
  }

  // Cancel pending payments — leave captured/refunded ones untouched.
  const pending = order.payments.filter((p) => p.status === 'pending');
  await prisma.$transaction(async (tx) => {
    for (const p of pending) {
      await tx.payment.update({ where: { id: p.id }, data: { status: 'cancelled' } });
      await tx.auditLog.create({
        data: {
          tenantId: order.tenantId,
          userId: session.user.id,
          action: 'payment.voided_for_retry',
          resource: 'payment',
          resourceId: p.id,
          metadata: { orderId: order.id, providerId: p.providerId } as any,
        },
      });
    }
  });

  revalidatePath(`/shop/orders/${order.id}`);
  return { ok: true };
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`

Expected: PASS. (`requireAuth` exists from earlier phases — if not, swap to whatever the project uses for B2C session.)

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/\(customer\)/shop/orders/[id]/voidAndRetry.action.ts
git commit -m "feat(2d): add voidAndRetry server action for B2C payment provider switching"
```

---

## Task 9: PaymentProviderPicker client component

**Files:**
- Create: `app/[locale]/(customer)/shop/orders/[id]/PaymentProviderPicker.tsx`

- [ ] **Step 1: Implement the picker**

Create the file:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { voidAndRetryAction } from './voidAndRetry.action';

interface Props {
  orderId: string;
  paddleCheckoutUrl: string | null;
  turinvoicePaymentUrl: string | null;
  activePayment: { providerId: 'paddle' | 'turinvoice'; status: string } | null;
}

export function PaymentProviderPicker({
  orderId,
  paddleCheckoutUrl,
  turinvoicePaymentUrl,
  activePayment,
}: Props): JSX.Element {
  const [pending, startTransition] = useTransition();

  function switchProvider(): void {
    const fd = new FormData();
    fd.set('orderId', orderId);
    startTransition(async () => {
      await voidAndRetryAction(fd);
      // page revalidates and re-renders the picker without an active payment
    });
  }

  if (activePayment && activePayment.status === 'pending') {
    const url = activePayment.providerId === 'paddle' ? paddleCheckoutUrl : turinvoicePaymentUrl;
    return (
      <div>
        <h2>Resume payment</h2>
        <p>Continue with {activePayment.providerId === 'paddle' ? 'International card' : 'Russian card / СБП'}.</p>
        {url ? (
          <a href={url}>Continue checkout</a>
        ) : (
          <p>Payment URL is not available — please retry later.</p>
        )}
        <button type="button" onClick={switchProvider} disabled={pending}>
          {pending ? 'Switching…' : 'Use a different method'}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <article>
        <h3>International card</h3>
        <p>Visa / Mastercard / Amex via Paddle.</p>
        {paddleCheckoutUrl ? (
          <a href={paddleCheckoutUrl}>Pay with Paddle</a>
        ) : (
          <button type="button" disabled>Paddle unavailable</button>
        )}
      </article>
      <article>
        <h3>Russian card or СБП</h3>
        <p>СБП QR or local Russian card via TurInvoice.</p>
        {turinvoicePaymentUrl ? (
          <a href={turinvoicePaymentUrl}>Pay with TurInvoice</a>
        ) : (
          <button type="button" disabled>TurInvoice unavailable</button>
        )}
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/\(customer\)/shop/orders/[id]/PaymentProviderPicker.tsx
git commit -m "feat(2d): add PaymentProviderPicker B2C client component"
```

---

## Task 10: Wire picker into B2C order detail page

**Files:**
- Modify: `app/[locale]/(customer)/shop/orders/[id]/page.tsx`

- [ ] **Step 1: Read the existing page**

Run: `cat app/\[locale\]/\(customer\)/shop/orders/\[id\]/page.tsx`

Note: how the page currently renders the Paddle button or the redirect-to-TurInvoice action.

- [ ] **Step 2: Replace the single-provider rendering with the picker**

Inside the page component, after the order is loaded:

```tsx
import { PaymentProviderPicker } from './PaymentProviderPicker';
import { getPaymentProvider } from '@/src/server/providers/payment/registry';

// ...inside the page component...
let paddleCheckoutUrl: string | null = null;
let turinvoicePaymentUrl: string | null = null;

if (order.state === 'AWAITING_PAYMENT') {
  // Generate fresh checkout URLs for each provider on demand. createCheckout
  // is idempotent against the order; existing pending Payment rows are reused.
  try {
    const paddle = await getPaymentProvider('paddle');
    paddleCheckoutUrl = (await paddle.createCheckout(toCheckoutInput(order))).checkoutUrl ?? null;
  } catch (err) {
    console.error('[orders/page] paddle.createCheckout failed', err);
  }
  try {
    const turinvoice = await getPaymentProvider('turinvoice');
    turinvoicePaymentUrl = (await turinvoice.createCheckout(toCheckoutInput(order))).checkoutUrl ?? null;
  } catch (err) {
    console.error('[orders/page] turinvoice.createCheckout failed', err);
  }
}

const activePayment = order.payments.find((p) => p.status === 'pending') ?? null;

// ...in JSX, where the old payment button was...
{order.state === 'AWAITING_PAYMENT' && (
  <PaymentProviderPicker
    orderId={order.id}
    paddleCheckoutUrl={paddleCheckoutUrl}
    turinvoicePaymentUrl={turinvoicePaymentUrl}
    activePayment={
      activePayment
        ? { providerId: activePayment.providerId as 'paddle' | 'turinvoice', status: activePayment.status }
        : null
    }
  />
)}
```

(`toCheckoutInput(order)` is whatever helper the existing page uses to map an Order to the `PaymentCheckoutInput` shape. If the existing page calls only one provider's createCheckout, replicate the same mapping for the second.)

> **Caution:** calling both providers' `createCheckout` on every render of an `AWAITING_PAYMENT` page may pre-create two pending Payments. Phase 2c's createBooking moved Payment row creation into createBooking (gotcha from spec §1's "Phase 2c non-obvious corrections"). Before merging, confirm: does `paddle.createCheckout` create a Payment row, or does it just produce a checkout URL? If it creates a row, the picker design changes — call `createCheckout` only when the user clicks the card. If clicking is required, render the cards as `<form action={...}>` server actions instead of plain links.

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev:all`. Create a test order via B2C flow. Land on the picker. Click "Pay with Paddle" → Paddle.js overlay opens. Back-navigate. Click "Pay with TurInvoice" → TurInvoice page loads.

Confirm only one Payment row was created per click (check Prisma Studio).

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(customer\)/shop/orders/[id]/page.tsx
git commit -m "feat(2d): render PaymentProviderPicker on B2C order detail"
```

---

## Task 11: E2E — admin issues partial refund

**Files:**
- Create: `e2e/admin-issue-partial-refund.spec.ts`

- [ ] **Step 1: Implement the spec**

Create `e2e/admin-issue-partial-refund.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('admin issues partial refund', () => {
  test('partial refund flips order to PARTIALLY_REFUNDED', async ({ page }) => {
    // Pre-seeded admin user from scripts/seed.ts.
    await page.goto('/en/login');
    await page.fill('[name=email]', 'admin@datapatch.net');
    await page.fill('[name=password]', 'devpassword');
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/admin/);

    // Pre-seeded paid order.
    await page.goto('/en/admin/orders/seed-paid-order-1');
    await page.click('button:has-text("Issue refund")');

    // Pick partial $2 on first item.
    await page.click('input[name^="refund-"][value=partial]');
    await page.fill('input[type=number]', '2.00');
    await page.fill('textarea', 'partial test');
    await page.click('button:has-text("Submit refund")');

    // Expect modal closes and order page reflects PARTIALLY_REFUNDED.
    await expect(page.locator('text=PARTIALLY_REFUNDED')).toBeVisible({ timeout: 10_000 });
  });
});
```

(Adjust selectors to match the actual rendered DOM. The seed `seed-paid-order-1` and admin credentials must exist via `scripts/seed.ts` — check that file and adapt.)

- [ ] **Step 2: Run the spec against a local dev environment**

Boot `pnpm dev:all` in one terminal. In another:

Run: `pnpm test:e2e -g "partial refund"`

Expected: spec passes. If Paddle sandbox is hit by the underlying refund call and the seed order's `externalPaymentId` doesn't match a real Paddle transaction, the test will fail. In that case, mock Paddle in the test environment (use the existing Paddle mock pattern from Phase 2c E2E tests, e.g., in `e2e/booking-self-pay.spec.ts`).

- [ ] **Step 3: Commit**

```bash
git add e2e/admin-issue-partial-refund.spec.ts
git commit -m "test(2d): E2E for admin partial refund flow"
```

---

## Task 12: E2E — checkout provider picker

**Files:**
- Create: `e2e/checkout-provider-picker.spec.ts`

- [ ] **Step 1: Implement the spec**

Create `e2e/checkout-provider-picker.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('checkout payment provider picker', () => {
  test('renders both options and clicking each routes to its provider', async ({ page, context }) => {
    // Seed login + order via existing fixture / seed scripts.
    await page.goto('/en/shop/orders/seed-awaiting-payment-1');
    await expect(page.locator('text=International card')).toBeVisible();
    await expect(page.locator('text=Russian card or СБП')).toBeVisible();

    // Click Paddle — overlay or hosted page should be navigated to.
    const [paddlePage] = await Promise.all([
      context.waitForEvent('page', { predicate: (p) => /paddle\.com|sandbox-checkout\.paddle/.test(p.url()) }),
      page.click('a:has-text("Pay with Paddle")'),
    ]).catch(() => [null] as any);
    if (paddlePage) await paddlePage.close();

    // Back to order, click TurInvoice.
    await page.goto('/en/shop/orders/seed-awaiting-payment-1');
    const [tiPage] = await Promise.all([
      context.waitForEvent('page', { predicate: (p) => /turinvoice/.test(p.url()) }),
      page.click('a:has-text("Pay with TurInvoice")'),
    ]).catch(() => [null] as any);
    if (tiPage) await tiPage.close();
  });
});
```

(If the Paddle integration uses `Paddle.js` overlay rather than a hosted redirect, the assertion needs to look for the overlay iframe, not a new tab. Adjust accordingly.)

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e -g "provider picker"`

Expected: spec passes.

- [ ] **Step 3: Commit**

```bash
git add e2e/checkout-provider-picker.spec.ts
git commit -m "test(2d): E2E for checkout provider picker"
```

---

## Task 13: Open PR-C

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git checkout -b feat/phase-2d-pr-c
git push -u origin feat/phase-2d-pr-c
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --title "Phase 2d PR-C: partial refunds + TurInvoice UX picker" --body "$(cat <<'EOF'
## Summary
- `paddlePartialRefund` (item-level adjustments.create + cumulative idempotency key)
- `applyRefundToPayment` orchestrator (validation → Paddle → atomic DB tx → audit + outbox)
- New email template `orderPartiallyRefunded`
- Admin Issue Refund modal + `refundAction` server action
- B2C `PaymentProviderPicker` client component + `voidAndRetry` server action
- `orderMachine` accepts `PAID → PARTIALLY_REFUNDED` and `PARTIALLY_REFUNDED → REFUNDED` edges

## Test plan
- [ ] `pnpm vitest run` — full suite green
- [ ] E2E `admin-issue-partial-refund` passes
- [ ] E2E `checkout-provider-picker` passes
- [ ] Manual: partial $X refund on a paid Paddle order → state PARTIALLY_REFUNDED, Payment.refundedAmount = X minor units
- [ ] Manual: cumulative refunds reaching total flip Order.state to REFUNDED
- [ ] Manual: B2C order page renders both cards; clicking each routes to its provider; "Use a different method" link voids the pending Payment

🤖 Phase 2d, see docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md
EOF
)"
```

- [ ] **Step 3: Final verification**

Once all three PRs (A, B, C) are merged, push the phase tag:

```bash
git checkout main && git pull && git tag phase-2d-complete && git push origin phase-2d-complete
```

Update memory:

- Mark Phase 2d as complete in `project_v2_state.md`.
- Note any non-obvious corrections discovered during implementation in a new feedback memory file (mirror Phase 2c's `feedback_paddle_integration_gotchas.md` pattern).
