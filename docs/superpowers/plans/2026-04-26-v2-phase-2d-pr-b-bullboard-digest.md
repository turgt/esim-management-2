# V2 Phase 2d — PR-B: Bull Board UI + email.digestAdmin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount Bull Board's built-in admin UI at `/admin/jobs` (auth-gated to platform admins) covering the four BullMQ queues, and add the `email.digestAdmin` daily scheduled job that sends per-tenant + super-admin daily snapshot emails via the outbox.

**Architecture:** Bull Board uses its `@bull-board/express` adapter wrapped in a Next.js App Router catch-all route, with `requireAdmin` enforced before the adapter's router runs. The digest job uses a 24 h BullMQ schedule with an in-job wall-clock window check (avoids a cron parser dependency); when the window matches, it builds per-tenant payloads via a query layer and writes one OutboxEvent per recipient with a deterministic `dedupKey` so re-fires are idempotent.

**Tech Stack:** `@bull-board/api`, `@bull-board/express`, Next.js App Router, BullMQ, Prisma, React Email (`@react-email/components`), Resend (via existing outbox dispatcher).

**Spec reference:** `docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md` §3.4, §4.1, §5.2, §5.3, §11. Depends on PR-A merged (registerSchedules + worker dispatch conflict avoidance).

---

## File Structure

### Created
- `src/server/admin/jobs/bullBoardMount.ts` — adapter factory.
- `src/server/admin/jobs/bullBoardMount.test.ts` — smoke test.
- `app/[locale]/(admin)/admin/jobs/[[...slug]]/route.ts` — Next.js route handler bridging to the Express adapter.
- `src/server/email/digest/buildDailyDigest.ts` — per-tenant or aggregate query layer.
- `src/server/email/digest/buildDailyDigest.test.ts` — query tests.
- `src/server/email/digest/digestTemplate.tsx` — React Email template.
- `src/server/email/digest/digestTemplate.test.tsx` — render snapshot.
- `src/server/jobs/scheduled/emailDigestAdmin.ts` — scheduled job entry.
- `src/server/jobs/scheduled/emailDigestAdmin.test.ts` — job tests.

### Modified
- `package.json` — add `@bull-board/api`, `@bull-board/express`.
- `src/lib/env.ts` — add `DIGEST_TIMEZONE`, `DIGEST_SEND_HOUR`, `DIGEST_RECIPIENTS_SUPER`.
- `.env.example` — document new env vars.
- `src/server/jobs/registerSchedules.ts` — extend `SCHEDULES`.
- `src/server/jobs/workers/scheduled.ts` — extend dispatch switch.
- `src/server/outbox/processor.ts` — recognize `digestAdmin` template.

---

## Task 1: Add Bull Board dependencies

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Install packages**

Run: `pnpm add @bull-board/api @bull-board/express`

Expected: lockfile updates and the two packages appear under `dependencies`. Versions should be ≥6.x (latest at time of writing).

- [ ] **Step 2: Verify install**

Run: `pnpm list @bull-board/api @bull-board/express`

Expected: both packages listed with versions.

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`

Expected: PASS (no usage yet, just install).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(2d): add @bull-board/api and @bull-board/express"
```

---

## Task 2: Bull Board adapter factory

**Files:**
- Create: `src/server/admin/jobs/bullBoardMount.ts`
- Test: `src/server/admin/jobs/bullBoardMount.test.ts`

- [ ] **Step 1: Inspect existing queue exports**

Run: `cat src/server/jobs/queue.ts | head -40`

Note the export names (e.g., `webhooksQueue`, `esimSyncQueue`, `scheduledQueue`, `outboxQueue`).

- [ ] **Step 2: Write the failing test**

Create `src/server/admin/jobs/bullBoardMount.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createBullBoardAdapter } from './bullBoardMount';

describe('createBullBoardAdapter', () => {
  it('returns an Express adapter with router available', () => {
    const adapter = createBullBoardAdapter('/admin/jobs');
    expect(adapter).toBeDefined();
    expect(typeof adapter.getRouter).toBe('function');
  });

  it('sets the basePath as supplied', () => {
    const adapter = createBullBoardAdapter('/custom/base');
    // Bull Board exposes basePath via the adapter; verify by re-reading.
    expect((adapter as any).basePath).toBe('/custom/base');
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/admin/jobs/bullBoardMount.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 4: Implement the adapter factory**

Create `src/server/admin/jobs/bullBoardMount.ts`:

```ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import {
  webhooksQueue,
  esimSyncQueue,
  scheduledQueue,
  outboxQueue,
} from '@/src/server/jobs/queue';

/**
 * Builds a Bull Board adapter mounting the four BullMQ queues we run.
 * The adapter is consumed by app/[locale]/(admin)/admin/jobs/[[...slug]]/route.ts.
 *
 * No custom UI, no audit hooks: Bull Board's built-in retry / promote / remove /
 * clean / drain actions are sufficient for the small admin user base.
 */
export function createBullBoardAdapter(basePath: string): ExpressAdapter {
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

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/admin/jobs/bullBoardMount.test.ts`

Expected: PASS, both cases.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin/jobs/bullBoardMount.ts src/server/admin/jobs/bullBoardMount.test.ts
git commit -m "feat(2d): add Bull Board adapter factory"
```

---

## Task 3: Mount Bull Board in Next.js admin route

**Files:**
- Create: `app/[locale]/(admin)/admin/jobs/[[...slug]]/route.ts`

- [ ] **Step 1: Inspect the existing admin auth pattern**

Run: `grep -rn "requireAdmin\|requirePlatformAdmin" app/\[locale\]/\(admin\)/ src/server/auth/ 2>/dev/null | head -10`

Note the function name and import path for the admin guard.

- [ ] **Step 2: Implement the catch-all route**

Create `app/[locale]/(admin)/admin/jobs/[[...slug]]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createBullBoardAdapter } from '@/src/server/admin/jobs/bullBoardMount';
import { requireAdmin } from '@/src/server/auth/requireAdmin';

const adapter = createBullBoardAdapter('/admin/jobs');
const router = adapter.getRouter();

async function bridge(req: NextRequest): Promise<Response> {
  // Re-check auth on every request — Bull Board POSTs (retry/remove) cannot be trusted to inherit page-level guards.
  await requireAdmin();

  // Build a minimal Express-shaped req/res over the Web Request/Response.
  const url = new URL(req.url);
  const expressReq: any = {
    url: url.pathname.replace('/admin/jobs', '') + url.search,
    originalUrl: url.pathname,
    baseUrl: '/admin/jobs',
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.json().catch(() => ({})) : undefined,
    query: Object.fromEntries(url.searchParams.entries()),
  };

  return new Promise<Response>((resolve) => {
    const chunks: Buffer[] = [];
    let statusCode = 200;
    const headers: Record<string, string> = {};
    const expressRes: any = {
      statusCode,
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      getHeader(k: string) {
        return headers[k.toLowerCase()];
      },
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      write(chunk: Buffer | string) {
        chunks.push(Buffer.from(chunk));
      },
      end(chunk?: Buffer | string) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        resolve(new Response(body, { status: statusCode, headers }));
      },
      json(payload: unknown) {
        const body = Buffer.from(JSON.stringify(payload));
        chunks.push(body);
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        const out = Buffer.concat(chunks);
        resolve(new Response(out, { status: statusCode, headers }));
      },
      send(payload: unknown) {
        if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
          chunks.push(Buffer.from(payload as any));
        } else {
          chunks.push(Buffer.from(JSON.stringify(payload)));
        }
        const out = Buffer.concat(chunks);
        resolve(new Response(out, { status: statusCode, headers }));
      },
    };

    router(expressReq, expressRes, (err?: unknown) => {
      if (err) {
        console.error('[bullBoard] router error', err);
        resolve(new Response('Internal Server Error', { status: 500 }));
      }
    });
  });
}

export { bridge as GET, bridge as POST, bridge as PUT, bridge as DELETE, bridge as PATCH };
```

> **Note for the implementer:** the Express bridge above is the spec's "30-min spike" path. If the bridge proves flaky (e.g., POST body parsing or static asset URLs break), fall back to mounting Bull Board on the standalone Node entry point (`scripts/worker.ts`'s sibling — there is no separate `server.ts` in this Next.js setup; in that case spin up a tiny Express on a non-public port and reverse-proxy from `/admin/jobs` via Next.js `rewrites`). Do not spend more than 60 minutes on the bridge approach before switching.

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev:all` (boots Next + worker concurrently).

Open `http://localhost:3002/en/admin/jobs` while logged in as a platform admin.

Expected: Bull Board UI renders with four queues listed (webhooks, esim-sync, scheduled, outbox). Each queue shows the BullMQ stock columns (active/completed/failed/delayed/wait counts).

If you see a blank screen or a 500 error, capture the stack trace from the worker/web terminals and revisit Step 2.

- [ ] **Step 4: Manual smoke (auth)**

Log out and visit `http://localhost:3002/en/admin/jobs`.

Expected: redirect to login (or 401/403 — depends on `requireAdmin` semantics). Bull Board UI does not render.

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/\(admin\)/admin/jobs/
git commit -m "feat(2d): mount Bull Board at /admin/jobs behind requireAdmin"
```

---

## Task 4: Digest env vars

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add env entries**

In `src/lib/env.ts`, add:

```ts
DIGEST_TIMEZONE: z.string().default('Europe/Istanbul'),
DIGEST_SEND_HOUR: z.coerce.number().int().min(0).max(23).default(8),
DIGEST_RECIPIENTS_SUPER: z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().email())),
```

- [ ] **Step 2: Document in `.env.example`**

Append:

```
# Phase 2d — daily admin digest
DIGEST_TIMEZONE=Europe/Istanbul
DIGEST_SEND_HOUR=8
DIGEST_RECIPIENTS_SUPER=admin@datapatch.net
```

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/env.ts .env.example
git commit -m "feat(2d): add digest env vars (timezone, send hour, super recipients)"
```

---

## Task 5: buildDailyDigest query layer

**Files:**
- Create: `src/server/email/digest/buildDailyDigest.ts`
- Test: `src/server/email/digest/buildDailyDigest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/email/digest/buildDailyDigest.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { buildDailyDigest, type DailyDigestPayload } from './buildDailyDigest';

const since = new Date('2026-04-25T00:00:00Z');
const now = new Date('2026-04-26T00:00:00Z');

async function seedTenant(slug: string): Promise<string> {
  const t = await prisma.tenant.create({ data: { slug, name: `T-${slug}`, agencyContactEmail: 'a@b.com' } });
  return t.id;
}

describe('buildDailyDigest', () => {
  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.esim.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.tenant.deleteMany({});
  });

  it('returns isEmpty=true for a tenant with no activity', async () => {
    const tenantId = await seedTenant('empty');
    const payload = await buildDailyDigest(tenantId, since, now);
    expect(payload.isEmpty).toBe(true);
  });

  it('counts orders by state in the window', async () => {
    const tenantId = await seedTenant('busy');
    await prisma.order.create({
      data: {
        tenantId,
        buyerEmail: 'x@y.com',
        state: 'PAID',
        paymentMode: 'self_pay',
        travelerEmail: 'x@y.com',
        travelerName: 'X',
        totalAmount: 400n,
        totalCurrency: 'USD',
        createdAt: new Date('2026-04-25T12:00:00Z'),
      },
    });
    const payload = await buildDailyDigest(tenantId, since, now);
    expect(payload.isEmpty).toBe(false);
    expect(payload.orders.paid).toBe(1);
  });

  it('aggregates across all tenants when tenantId is null', async () => {
    const t1 = await seedTenant('t1');
    const t2 = await seedTenant('t2');
    for (const tenantId of [t1, t2]) {
      await prisma.order.create({
        data: {
          tenantId,
          buyerEmail: 'a@b.com',
          state: 'PAID',
          paymentMode: 'self_pay',
          travelerEmail: 'a@b.com',
          travelerName: 'A',
          totalAmount: 400n,
          totalCurrency: 'USD',
          createdAt: new Date('2026-04-25T12:00:00Z'),
        },
      });
    }
    const aggregate = await buildDailyDigest(null, since, now);
    expect(aggregate.orders.paid).toBe(2);
  });

  it('lists orders awaiting payment for >12 h', async () => {
    const tenantId = await seedTenant('stuck');
    await prisma.order.create({
      data: {
        tenantId,
        buyerEmail: 'a@b.com',
        state: 'AWAITING_PAYMENT',
        paymentMode: 'self_pay',
        travelerEmail: 'a@b.com',
        travelerName: 'A',
        totalAmount: 400n,
        totalCurrency: 'USD',
        createdAt: new Date('2026-04-25T08:00:00Z'), // ~16 h before now
      },
    });
    const payload = await buildDailyDigest(tenantId, since, now);
    expect(payload.orders.stalledAwaitingPayment.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/email/digest/buildDailyDigest.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement buildDailyDigest**

Create `src/server/email/digest/buildDailyDigest.ts`:

```ts
import { prisma } from '@/src/lib/db';
import type { OrderState } from '@prisma/client';

export interface DailyDigestPayload {
  isEmpty: boolean;
  windowStart: string; // ISO
  windowEnd: string;
  orders: {
    paid: number;
    refunded: number;
    partiallyRefunded: number;
    expired: number;
    stalledAwaitingPayment: { id: string; ageHours: number; totalAmount: string; buyerEmail: string }[];
  };
  esims: {
    provisioned: number;
    failed: number;
    expiredToday: number;
  };
  payments: {
    capturedTotalUsd: string; // formatted in major units, e.g. "1,247.00"
    refundedTotalUsd: string;
    byProvider: Array<{ providerId: string; count: number; capturedTotalUsd: string }>;
  };
  queueHealth: {
    webhooks: number;
    esimSync: number;
    scheduled: number;
    outbox: number;
  };
  operational: {
    webhookSignatureMismatches: number;
  };
}

function formatUsd(minor: bigint): string {
  const major = Number(minor) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(major).replace('$', '');
}

export async function buildDailyDigest(
  tenantId: string | null,
  windowStart: Date,
  windowEnd: Date,
): Promise<DailyDigestPayload> {
  const tenantFilter = tenantId === null ? {} : { tenantId };
  const inWindow = { createdAt: { gte: windowStart, lt: windowEnd } };

  // Orders
  const orders = await prisma.order.groupBy({
    by: ['state'],
    where: { ...tenantFilter, ...inWindow },
    _count: true,
  });
  const stateCount = (s: OrderState) =>
    orders.find((o) => o.state === s)?._count ?? 0;

  const stalledRaw = await prisma.order.findMany({
    where: {
      ...tenantFilter,
      state: 'AWAITING_PAYMENT',
      createdAt: { lt: new Date(windowEnd.getTime() - 12 * 60 * 60 * 1000) },
    },
    select: { id: true, createdAt: true, totalAmount: true, buyerEmail: true },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });
  const stalledAwaitingPayment = stalledRaw.map((o) => ({
    id: o.id,
    ageHours: Math.floor((windowEnd.getTime() - o.createdAt.getTime()) / 3600_000),
    totalAmount: formatUsd(o.totalAmount),
    buyerEmail: o.buyerEmail,
  }));

  // eSIMs
  const provisioned = await prisma.esim.count({
    where: { ...tenantFilter, status: 'provisioned', updatedAt: { gte: windowStart, lt: windowEnd } },
  });
  const failed = await prisma.esim.count({
    where: { ...tenantFilter, status: 'failed', updatedAt: { gte: windowStart, lt: windowEnd } },
  });
  const expiredToday = await prisma.esim.count({
    where: { ...tenantFilter, status: 'expired', updatedAt: { gte: windowStart, lt: windowEnd } },
  });

  // Payments
  const captured = await prisma.payment.findMany({
    where: { ...tenantFilter, status: 'captured', createdAt: { gte: windowStart, lt: windowEnd } },
    select: { providerId: true, amount: true },
  });
  const capturedTotalMinor = captured.reduce((s, p) => s + p.amount, 0n);
  const refunded = await prisma.payment.findMany({
    where: { ...tenantFilter, refundedAmount: { gt: 0n }, updatedAt: { gte: windowStart, lt: windowEnd } },
    select: { refundedAmount: true },
  });
  const refundedTotalMinor = refunded.reduce((s, p) => s + p.refundedAmount, 0n);
  const byProviderMap = new Map<string, { count: number; total: bigint }>();
  for (const p of captured) {
    const cur = byProviderMap.get(p.providerId) ?? { count: 0, total: 0n };
    cur.count++;
    cur.total += p.amount;
    byProviderMap.set(p.providerId, cur);
  }
  const byProvider = Array.from(byProviderMap.entries()).map(([providerId, v]) => ({
    providerId,
    count: v.count,
    capturedTotalUsd: formatUsd(v.total),
  }));

  // Queue health (failed counts only — Bull Board has the rest)
  const queueFailed = async (queueName: string): Promise<number> => {
    // BullMQ queues are not Prisma-backed; query Redis directly via the existing queue exports.
    // Lazy-import to keep this module testable without Redis.
    const { webhooksQueue, esimSyncQueue, scheduledQueue, outboxQueue } = await import('@/src/server/jobs/queue');
    const map: Record<string, any> = {
      webhooks: webhooksQueue,
      'esim-sync': esimSyncQueue,
      scheduled: scheduledQueue,
      outbox: outboxQueue,
    };
    return map[queueName]?.getFailedCount() ?? 0;
  };
  const queueHealth = {
    webhooks: await queueFailed('webhooks'),
    esimSync: await queueFailed('esim-sync'),
    scheduled: await queueFailed('scheduled'),
    outbox: await queueFailed('outbox'),
  };

  // Operational
  const sigMismatch = await prisma.auditLog.count({
    where: {
      ...tenantFilter,
      action: { in: ['webhook.signature_invalid', 'webhook.signature_missing'] },
      createdAt: { gte: windowStart, lt: windowEnd },
    },
  });

  const isEmpty =
    stateCount('PAID') === 0 &&
    stateCount('REFUNDED') === 0 &&
    stateCount('PARTIALLY_REFUNDED') === 0 &&
    stateCount('EXPIRED') === 0 &&
    stalledAwaitingPayment.length === 0 &&
    provisioned === 0 &&
    failed === 0 &&
    expiredToday === 0 &&
    capturedTotalMinor === 0n &&
    refundedTotalMinor === 0n &&
    queueHealth.webhooks === 0 &&
    queueHealth.esimSync === 0 &&
    queueHealth.scheduled === 0 &&
    queueHealth.outbox === 0 &&
    sigMismatch === 0;

  return {
    isEmpty,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    orders: {
      paid: stateCount('PAID'),
      refunded: stateCount('REFUNDED'),
      partiallyRefunded: stateCount('PARTIALLY_REFUNDED'),
      expired: stateCount('EXPIRED'),
      stalledAwaitingPayment,
    },
    esims: { provisioned, failed, expiredToday },
    payments: {
      capturedTotalUsd: formatUsd(capturedTotalMinor),
      refundedTotalUsd: formatUsd(refundedTotalMinor),
      byProvider,
    },
    queueHealth,
    operational: { webhookSignatureMismatches: sigMismatch },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/email/digest/buildDailyDigest.test.ts`

Expected: PASS, all 4 cases. (Note: the queue-failed queries hit Redis. If tests run without Redis, mock the queue module — see existing test patterns in `src/server/jobs/`.)

If queue tests fail because Redis is not available in the unit test runner, adjust: introduce a parameter `queueHealth?: QueueHealthFetcher` so tests inject a stub.

- [ ] **Step 5: Commit**

```bash
git add src/server/email/digest/buildDailyDigest.ts src/server/email/digest/buildDailyDigest.test.ts
git commit -m "feat(2d): add buildDailyDigest query layer"
```

---

## Task 6: digestTemplate React Email component

**Files:**
- Create: `src/server/email/digest/digestTemplate.tsx`
- Test: `src/server/email/digest/digestTemplate.test.tsx`

- [ ] **Step 1: Inspect existing email template style**

Run: `ls src/server/email/templates/ 2>/dev/null && cat src/server/email/templates/orderConfirmation.tsx 2>/dev/null | head -40`

Match the existing imports and styling conventions.

- [ ] **Step 2: Write the failing snapshot test**

Create `src/server/email/digest/digestTemplate.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@react-email/render';
import { DigestTemplate } from './digestTemplate';
import type { DailyDigestPayload } from './buildDailyDigest';

const samplePayload: DailyDigestPayload = {
  isEmpty: false,
  windowStart: '2026-04-25T00:00:00.000Z',
  windowEnd: '2026-04-26T00:00:00.000Z',
  orders: { paid: 3, refunded: 0, partiallyRefunded: 1, expired: 0, stalledAwaitingPayment: [] },
  esims: { provisioned: 3, failed: 0, expiredToday: 1 },
  payments: { capturedTotalUsd: '1,200.00', refundedTotalUsd: '0.00', byProvider: [] },
  queueHealth: { webhooks: 0, esimSync: 0, scheduled: 0, outbox: 0 },
  operational: { webhookSignatureMismatches: 0 },
};

describe('DigestTemplate', () => {
  it('renders the tenant-admin variant with paid count', async () => {
    const html = await render(
      <DigestTemplate payload={samplePayload} recipientType="tenant_admin" tenantName="Acme" dayKey="2026-04-25" />,
    );
    expect(html).toContain('Acme');
    expect(html).toContain('Paid');
    expect(html).toContain('3');
  });

  it('renders the super-admin variant with "All tenants" copy', async () => {
    const html = await render(
      <DigestTemplate payload={samplePayload} recipientType="super_admin" dayKey="2026-04-25" />,
    );
    expect(html).toContain('All tenants');
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run src/server/email/digest/digestTemplate.test.tsx`

Expected: FAIL — module missing.

- [ ] **Step 4: Implement the template**

Create `src/server/email/digest/digestTemplate.tsx`:

```tsx
import { Html, Head, Body, Container, Heading, Text, Section, Hr } from '@react-email/components';
import type { DailyDigestPayload } from './buildDailyDigest';

interface Props {
  payload: DailyDigestPayload;
  recipientType: 'tenant_admin' | 'super_admin';
  tenantName?: string;
  dayKey: string;
}

const sectionStyle = { marginBottom: '16px' };
const labelStyle = { color: '#666', fontSize: '12px' };
const valueStyle = { fontWeight: 600, fontSize: '20px' };

function CountRow({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function DigestTemplate({ payload, recipientType, tenantName, dayKey }: Props): JSX.Element {
  const scopeLabel = recipientType === 'super_admin' ? 'All tenants' : tenantName ?? 'Tenant';
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, sans-serif', background: '#f5f5f5', padding: '24px' }}>
        <Container style={{ background: 'white', borderRadius: '8px', padding: '24px', maxWidth: '600px' }}>
          <Heading as="h1" style={{ margin: 0 }}>
            Daily digest — {scopeLabel}
          </Heading>
          <Text style={labelStyle}>{dayKey}</Text>

          <Section style={sectionStyle}>
            <Heading as="h2">Orders</Heading>
            <CountRow label="Paid" value={payload.orders.paid} />
            <CountRow label="Refunded" value={payload.orders.refunded} />
            <CountRow label="Partially refunded" value={payload.orders.partiallyRefunded} />
            <CountRow label="Expired" value={payload.orders.expired} />
            {payload.orders.stalledAwaitingPayment.length > 0 && (
              <>
                <Text style={labelStyle}>Awaiting payment &gt; 12 h</Text>
                {payload.orders.stalledAwaitingPayment.map((o) => (
                  <div key={o.id}>
                    {o.id} — ${o.totalAmount} — {o.ageHours}h — {o.buyerEmail}
                  </div>
                ))}
              </>
            )}
          </Section>

          <Hr />

          <Section style={sectionStyle}>
            <Heading as="h2">eSIMs</Heading>
            <CountRow label="Provisioned" value={payload.esims.provisioned} />
            <CountRow label="Failed" value={payload.esims.failed} />
            <CountRow label="Expired today" value={payload.esims.expiredToday} />
          </Section>

          <Hr />

          <Section style={sectionStyle}>
            <Heading as="h2">Payments</Heading>
            <Text style={labelStyle}>Captured</Text>
            <Text style={valueStyle}>${payload.payments.capturedTotalUsd}</Text>
            {payload.payments.refundedTotalUsd !== '0.00' && (
              <>
                <Text style={labelStyle}>Refunded</Text>
                <Text style={valueStyle}>${payload.payments.refundedTotalUsd}</Text>
              </>
            )}
            {payload.payments.byProvider.length > 0 && (
              <>
                <Text style={labelStyle}>By provider</Text>
                {payload.payments.byProvider.map((p) => (
                  <div key={p.providerId}>
                    {p.providerId} — {p.count} — ${p.capturedTotalUsd}
                  </div>
                ))}
              </>
            )}
          </Section>

          <Hr />

          <Section style={sectionStyle}>
            <Heading as="h2">Queue health</Heading>
            <CountRow label="webhooks failed" value={payload.queueHealth.webhooks} />
            <CountRow label="esim-sync failed" value={payload.queueHealth.esimSync} />
            <CountRow label="scheduled failed" value={payload.queueHealth.scheduled} />
            <CountRow label="outbox failed" value={payload.queueHealth.outbox} />
          </Section>

          {payload.operational.webhookSignatureMismatches > 0 && (
            <>
              <Hr />
              <Section style={sectionStyle}>
                <Heading as="h2">Operational</Heading>
                <CountRow
                  label="Webhook signature mismatches"
                  value={payload.operational.webhookSignatureMismatches}
                />
              </Section>
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/email/digest/digestTemplate.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/email/digest/digestTemplate.tsx src/server/email/digest/digestTemplate.test.tsx
git commit -m "feat(2d): add DigestTemplate React Email component"
```

---

## Task 7: emailDigestAdmin scheduled job

**Files:**
- Create: `src/server/jobs/scheduled/emailDigestAdmin.ts`
- Test: `src/server/jobs/scheduled/emailDigestAdmin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/jobs/scheduled/emailDigestAdmin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runEmailDigestAdmin } from './emailDigestAdmin';

vi.mock('@/src/lib/env', () => ({
  env: {
    DIGEST_TIMEZONE: 'Europe/Istanbul',
    DIGEST_SEND_HOUR: 8,
    DIGEST_RECIPIENTS_SUPER: ['super@datapatch.net'],
  },
}));

vi.mock('@/src/server/email/digest/buildDailyDigest', () => ({
  buildDailyDigest: vi.fn(),
}));

vi.mock('@/src/lib/db', () => ({
  prisma: {
    tenant: { findMany: vi.fn() },
    userTenantMembership: { findMany: vi.fn() },
    outboxEvent: { create: vi.fn() },
  },
}));

import { buildDailyDigest } from '@/src/server/email/digest/buildDailyDigest';
import { prisma } from '@/src/lib/db';

describe('runEmailDigestAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips entirely when wall-clock hour does not match DIGEST_SEND_HOUR', async () => {
    // Pick a fixed UTC time that is NOT 08:00 in Europe/Istanbul.
    // Istanbul is UTC+3, so 08:00 local = 05:00 UTC. We pass 12:00 UTC = 15:00 local.
    const result = await runEmailDigestAdmin(new Date('2026-04-26T12:00:00Z'));
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('emits per-tenant outbox event when tenant has activity', async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([
      { id: 't1', name: 'Acme', slug: 'acme' } as any,
    ]);
    vi.mocked(buildDailyDigest).mockResolvedValue({ isEmpty: false } as any);
    vi.mocked(prisma.userTenantMembership.findMany).mockResolvedValue([
      { user: { email: 'admin1@acme.com' } } as any,
    ]);

    const result = await runEmailDigestAdmin(new Date('2026-04-26T05:00:00Z')); // 08:00 Istanbul
    expect(result.sent).toBe(1);
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupKey: expect.stringContaining('digest:tenant:t1:admin1@acme.com:'),
          template: 'digestAdmin',
          recipient: 'admin1@acme.com',
        }),
      }),
    );
  });

  it('skips empty tenant', async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([{ id: 't1', name: 'Acme' } as any]);
    vi.mocked(buildDailyDigest).mockResolvedValueOnce({ isEmpty: true } as any);
    vi.mocked(buildDailyDigest).mockResolvedValueOnce({ isEmpty: true } as any); // super-admin aggregate

    const result = await runEmailDigestAdmin(new Date('2026-04-26T05:00:00Z'));
    expect(result.skipped).toBe(1);
    expect(prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('emits super-admin aggregate when configured', async () => {
    vi.mocked(prisma.tenant.findMany).mockResolvedValue([]);
    vi.mocked(buildDailyDigest).mockResolvedValueOnce({ isEmpty: false } as any); // aggregate

    const result = await runEmailDigestAdmin(new Date('2026-04-26T05:00:00Z'));
    expect(prisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dedupKey: expect.stringContaining('digest:super:super@datapatch.net:'),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/jobs/scheduled/emailDigestAdmin.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the job**

Create `src/server/jobs/scheduled/emailDigestAdmin.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { env } from '@/src/lib/env';
import { buildDailyDigest } from '@/src/server/email/digest/buildDailyDigest';

export interface EmailDigestAdminResult {
  sent: number;
  skipped: number;
}

function localHour(now: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: tz }).format(now).replace(/\D/g, ''),
  );
}

function dayKey(now: Date, tz: string): string {
  // YYYY-MM-DD in the target timezone.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function startOfWindow(now: Date, _tz: string): Date {
  // 24 h before now (sliding window). Aligning to local midnight is a future refinement.
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export async function runEmailDigestAdmin(now: Date = new Date()): Promise<EmailDigestAdminResult> {
  const hour = localHour(now, env.DIGEST_TIMEZONE);
  if (hour !== env.DIGEST_SEND_HOUR) {
    return { sent: 0, skipped: 0 };
  }

  const dKey = dayKey(now, env.DIGEST_TIMEZONE);
  const since = startOfWindow(now, env.DIGEST_TIMEZONE);

  const tenants = await prisma.tenant.findMany();
  let sent = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    try {
      const payload = await buildDailyDigest(tenant.id, since, now);
      if (payload.isEmpty) {
        skipped++;
        continue;
      }
      const admins = await prisma.userTenantMembership.findMany({
        where: { tenantId: tenant.id, role: 'admin' },
        select: { user: { select: { email: true } } },
      });
      for (const a of admins) {
        if (!a.user?.email) continue;
        await prisma.outboxEvent.create({
          data: {
            dedupKey: `digest:tenant:${tenant.id}:${a.user.email}:${dKey}`,
            channel: 'email',
            template: 'digestAdmin',
            recipient: a.user.email,
            payload: { payload, recipientType: 'tenant_admin', tenantName: tenant.name, dayKey: dKey } as Prisma.InputJsonValue,
          },
        });
      }
      sent++;
    } catch (err) {
      console.error('[email.digestAdmin] tenant failed', { tenantId: tenant.id, error: String(err) });
    }
  }

  // Super-admin aggregate
  if (env.DIGEST_RECIPIENTS_SUPER.length > 0) {
    try {
      const aggregate = await buildDailyDigest(null, since, now);
      if (!aggregate.isEmpty) {
        for (const recipient of env.DIGEST_RECIPIENTS_SUPER) {
          await prisma.outboxEvent.create({
            data: {
              dedupKey: `digest:super:${recipient}:${dKey}`,
              channel: 'email',
              template: 'digestAdmin',
              recipient,
              payload: { payload: aggregate, recipientType: 'super_admin', dayKey: dKey } as Prisma.InputJsonValue,
            },
          });
        }
      }
    } catch (err) {
      console.error('[email.digestAdmin] aggregate failed', { error: String(err) });
    }
  }

  return { sent, skipped };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run src/server/jobs/scheduled/emailDigestAdmin.test.ts`

Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/jobs/scheduled/emailDigestAdmin.ts src/server/jobs/scheduled/emailDigestAdmin.test.ts
git commit -m "feat(2d): add email.digestAdmin scheduled job"
```

---

## Task 8: Wire schedule + worker dispatch (digest)

**Files:**
- Modify: `src/server/jobs/registerSchedules.ts`
- Modify: `src/server/jobs/workers/scheduled.ts`
- Test: `src/server/jobs/registerSchedules.test.ts`

- [ ] **Step 1: Extend the test**

Append to `src/server/jobs/registerSchedules.test.ts`:

```ts
it('registers email.digestAdmin with a 24-hour cadence', async () => {
  await registerSchedules();
  const jobs = await scheduledQueue.getRepeatableJobs();
  const digestJob = jobs.find((j) => j.name === 'email.digestAdmin');
  expect(digestJob).toBeDefined();
  expect(digestJob?.every).toBe(String(24 * 60 * 60 * 1000));
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run src/server/jobs/registerSchedules.test.ts -t "email.digestAdmin"`

Expected: FAIL.

- [ ] **Step 3: Add to SCHEDULES**

In `src/server/jobs/registerSchedules.ts`:

```ts
const SCHEDULES: ScheduleSpec[] = [
  { name: 'esim.syncStatuses',    everyMs: 15 * 60 * 1000 },
  { name: 'order.expireStale',    everyMs: 60 * 60 * 1000 },
  { name: 'packages.syncCatalog', everyMs: 6  * 60 * 60 * 1000 },
  { name: 'email.digestAdmin',    everyMs: 24 * 60 * 60 * 1000 },
];
```

- [ ] **Step 4: Add to worker dispatch**

In `src/server/jobs/workers/scheduled.ts`:

```ts
import { runEmailDigestAdmin } from '../scheduled/emailDigestAdmin';
// ...
case 'email.digestAdmin':
  return runEmailDigestAdmin();
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run src/server/jobs/registerSchedules.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/jobs/registerSchedules.ts src/server/jobs/workers/scheduled.ts src/server/jobs/registerSchedules.test.ts
git commit -m "feat(2d): wire email.digestAdmin into registerSchedules + worker dispatch"
```

---

## Task 9: Outbox dispatcher recognizes digestAdmin template

**Files:**
- Modify: `src/server/outbox/processor.ts`

- [ ] **Step 1: Inspect the template switch**

Run: `grep -n "template" src/server/outbox/processor.ts | head -20`

Locate the switch/case that maps a `template` string to a render function or React component.

- [ ] **Step 2: Add the digest case**

Add a case to the template switch (file location depends on existing pattern):

```ts
import { DigestTemplate } from '@/src/server/email/digest/digestTemplate';
// ...
case 'digestAdmin': {
  const { payload, recipientType, tenantName, dayKey } = event.payload as any;
  const subject =
    recipientType === 'super_admin'
      ? `[DataPatch] Daily digest — All tenants — ${dayKey}`
      : `[DataPatch] Daily digest — ${tenantName} — ${dayKey}`;
  const html = await render(<DigestTemplate payload={payload} recipientType={recipientType} tenantName={tenantName} dayKey={dayKey} />);
  return { subject, html };
}
```

(Match the existing case style; if the file uses arrow returns instead of `return { subject, html }`, follow that convention.)

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Manual smoke**

Boot the worker and force-trigger a digest:

```bash
pnpm tsx -e "
import { scheduledQueue } from './src/server/jobs/queue';
await scheduledQueue.add('email.digestAdmin', {}, { jobId: 'manual-digest-' + Date.now() });
process.exit(0);
"
```

Then read the OutboxEvent table for new entries with `template='digestAdmin'`. (May produce zero rows if no tenant has activity AND no super-admin recipients are configured AND it's not the right hour — manually patch `DIGEST_SEND_HOUR` to the current hour before running, or seed a fixture order in window.)

- [ ] **Step 5: Commit**

```bash
git add src/server/outbox/processor.ts
git commit -m "feat(2d): outbox dispatcher renders digestAdmin template"
```

---

## Task 10: Open PR-B

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git checkout -b feat/phase-2d-pr-b
git push -u origin feat/phase-2d-pr-b
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --base main --title "Phase 2d PR-B: Bull Board UI + email.digestAdmin" --body "$(cat <<'EOF'
## Summary
- Mount `@bull-board/express` at `/admin/jobs` behind `requireAdmin`
- Add `email.digestAdmin` scheduled job (24 h cadence, in-job hour-window check vs `DIGEST_SEND_HOUR` in `DIGEST_TIMEZONE`)
- Per-tenant + super-admin aggregate digest via outbox with deterministic dedupKeys
- New env vars: `DIGEST_TIMEZONE`, `DIGEST_SEND_HOUR`, `DIGEST_RECIPIENTS_SUPER`

## Test plan
- [ ] `pnpm vitest run` — full suite green
- [ ] `/admin/jobs` renders Bull Board with 4 queues for an admin user
- [ ] `/admin/jobs` blocks non-admin users
- [ ] Force-trigger `email.digestAdmin` at the configured hour produces OutboxEvent rows; off-hour produces none
- [ ] Empty-day tenant does not produce an OutboxEvent

🤖 Phase 2d, see docs/superpowers/specs/2026-04-26-v2-phase-2d-platform-maturity-design.md
EOF
)"
```

- [ ] **Step 3: Confirm PR is open**

Open the PR URL printed by gh, verify the diff matches Tasks 1–9, and trigger any CI required.
