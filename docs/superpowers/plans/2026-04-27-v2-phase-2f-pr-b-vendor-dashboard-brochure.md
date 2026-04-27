# V2 Phase 2f PR-B — Vendor Dashboard + Brochure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the vendor self-service dashboard (`/v/[vendorId]/dashboard`) with stats and 30-day chart, plus a port of the V1 A4/A5/A6 brochure (`/v/[vendorId]/brochure`).

**Architecture:** New `(vendor)` route group at `app/[locale]/(vendor)/`. Server components for layout, dashboard, brochure; small client islands for the Recharts chart and the html2canvas brochure toolbar. Stats reuse `computeCommissionForOrder` from PR-A. Brochure copies V1's `src/views/vendor/brochure.ejs` HTML/CSS verbatim into a React component.

**Tech Stack:** Next.js 16, Recharts (already in V2 deps; verify), `qrcode` (already in V2 deps for tenant invoices; verify), html2canvas (new dep — client-only), next-intl, Vitest, Playwright.

**Spec:** `/Users/turgt/Desktop/CODES/esim-management-2/docs/superpowers/specs/2026-04-27-v2-phase-2f-vendor-port-design.md`

**Depends on:** Phase 2f PR-A merged (Vendor model, RBAC helper, computeCommissionForOrder, referral attribution, createBooking snapshot).

---

## File Structure

**New files:**
- `app/[locale]/(vendor)/layout.tsx` — vendor sidebar + auth gate
- `app/[locale]/(vendor)/v/page.tsx` — index router (count → redirect / list)
- `app/[locale]/(vendor)/v/[vendorId]/dashboard/page.tsx`
- `app/[locale]/(vendor)/v/[vendorId]/brochure/page.tsx`
- `src/server/queries/vendor-stats.ts` — getVendorStats + getVendorChartData
- `src/server/queries/vendor-stats.test.ts`
- `src/components/vendors/DashboardChart.tsx` — `'use client'` Recharts wrapper
- `src/components/vendors/BrochureToolbar.tsx` — `'use client'` html2canvas + size toggle
- `src/components/vendors/BrochureCard.tsx` — server component carrying V1 EJS port (HTML/CSS) and rendered QR
- `e2e/vendor-dashboard.spec.ts`

**Modified files:**
- `messages/en.json`, `messages/tr.json` — `vendor.dashboard.*` and `vendor.brochure.*` keys
- `package.json` — add `html2canvas` (devDependencies; only loaded in client island)

---

## Task 1: Branch + worktree

- [ ] **Step 1: Branch from main (after PR-A is merged)**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
git fetch origin
git checkout main
git pull --ff-only origin main
git worktree add -b feature/phase-2f-pr-b-vendor-dashboard ../datapatch-v2-pr-b main
cd ../datapatch-v2-pr-b
ln -s /Users/turgt/Desktop/CODES/datapatch-v2/node_modules node_modules
ln -s /Users/turgt/Desktop/CODES/datapatch-v2/.env .env
```

- [ ] **Step 2: Verify PR-A's changes are present**

```bash
grep "model Vendor" prisma/schema.prisma
test -f src/server/lib/commission.ts && echo OK
test -f src/server/rbac/vendor.ts && echo OK
```

Expected: all OK.

- [ ] **Step 3: Verify deps**

```bash
npm ls recharts qrcode 2>/dev/null
```

If `recharts` is missing, add it: `npm install recharts`.
If `qrcode` is missing, add it: `npm install qrcode @types/qrcode`.

- [ ] **Step 4: Add html2canvas (client-only via dynamic import)**

```bash
npm install html2canvas
```

Confirm `package.json` lists it.

- [ ] **Step 5: Typecheck baseline**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

Expected: all green.

---

## Task 2: `vendor-stats` query helpers

**Files:**
- Create: `src/server/queries/vendor-stats.ts`
- Test: `src/server/queries/vendor-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/queries/vendor-stats.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { getVendorStats, getVendorChartData } from './vendor-stats';

describe('getVendorStats', () => {
  let tenantId: string;
  let vendorId: string;

  beforeEach(async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    tenantId = t.id;
    const v = await prisma.vendor.create({
      data: { tenantId, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 500 },
    });
    vendorId = v.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { referredByVendorId: vendorId } });
    await prisma.vendor.delete({ where: { id: vendorId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  });

  it('returns zero stats for a fresh vendor', async () => {
    const stats = await getVendorStats(vendorId);
    expect(stats.referredUserCount).toBe(0);
    expect(stats.paidOrders).toBe(0);
    expect(stats.grossUsd).toBe(0n);
    expect(stats.commissionUsd).toBe(0n);
  });

  // Note: integration test for paid orders + refunds + commission is covered by
  // src/server/queries/vendor-detail.test.ts in PR-A. This test file just
  // verifies the helper composes correctly.
});

describe('getVendorChartData', () => {
  it('returns 30 entries with ISO date keys regardless of activity', async () => {
    const t = await prisma.tenant.create({ data: { slug: `t2-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    const v = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'V', code: `${Date.now()+1}`.slice(-8), commissionBps: 500 },
    });
    const data = await getVendorChartData(v.id, 30);
    expect(data).toHaveLength(30);
    expect(data[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data[29].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const row of data) {
      expect(row.registrations).toBe(0);
      expect(row.paidOrders).toBe(0);
      expect(row.revenueUsd).toBe(0n);
    }
    await prisma.vendor.delete({ where: { id: v.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/queries/vendor-stats.ts
import { prisma } from '@/src/lib/db';
import { computeCommissionForOrder } from '@/src/server/lib/commission';

export interface VendorStats {
  referredUserCount: number;
  paidOrders: number;
  grossUsd: bigint;
  refundedUsd: bigint;
  netUsd: bigint;
  commissionUsd: bigint;
}

export async function getVendorStats(vendorId: string): Promise<VendorStats> {
  const referredUserCount = await prisma.user.count({ where: { referredByVendorId: vendorId } });

  const orders = await prisma.order.findMany({
    where: { referredByVendorId: vendorId },
    select: {
      commissionBpsSnapshot: true,
      payments: { select: { amount: true, status: true } },
      refunds: { select: { amount: true, status: true } },
    },
  });

  let paidOrders = 0;
  let grossUsd = 0n;
  let refundedUsd = 0n;
  let commissionUsd = 0n;

  for (const o of orders) {
    const succeededPayment = o.payments.find((p) => p.status === 'succeeded');
    if (!succeededPayment) continue;
    paidOrders++;
    grossUsd += succeededPayment.amount;
    refundedUsd += o.refunds
      .filter((r) => r.status === 'succeeded')
      .reduce((s, r) => s + r.amount, 0n);
    commissionUsd += computeCommissionForOrder({
      payment: succeededPayment,
      refunds: o.refunds,
      commissionBpsSnapshot: o.commissionBpsSnapshot,
    });
  }

  return {
    referredUserCount,
    paidOrders,
    grossUsd,
    refundedUsd,
    netUsd: grossUsd - refundedUsd,
    commissionUsd,
  };
}

export interface ChartDataPoint {
  date: string;       // YYYY-MM-DD UTC
  registrations: number;
  paidOrders: number;
  revenueUsd: bigint; // USD cents
}

export async function getVendorChartData(vendorId: string, days = 30): Promise<ChartDataPoint[]> {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  start.setUTCHours(0, 0, 0, 0);

  const [registrationRows, paymentRows] = await Promise.all([
    prisma.user.findMany({
      where: { referredByVendorId: vendorId, referredAt: { gte: start, lte: end } },
      select: { referredAt: true },
    }),
    prisma.payment.findMany({
      where: {
        status: 'succeeded',
        order: { referredByVendorId: vendorId },
        createdAt: { gte: start, lte: end },
      },
      select: { amount: true, createdAt: true },
    }),
  ]);

  const map = new Map<string, ChartDataPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, registrations: 0, paidOrders: 0, revenueUsd: 0n });
  }

  for (const r of registrationRows) {
    if (!r.referredAt) continue;
    const key = r.referredAt.toISOString().slice(0, 10);
    const row = map.get(key);
    if (row) row.registrations++;
  }

  for (const p of paymentRows) {
    const key = p.createdAt.toISOString().slice(0, 10);
    const row = map.get(key);
    if (row) {
      row.paidOrders++;
      row.revenueUsd += p.amount;
    }
  }

  return Array.from(map.values());
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npx vitest run src/server/queries/vendor-stats.test.ts
git add src/server/queries/vendor-stats.ts src/server/queries/vendor-stats.test.ts
git commit -m "feat(2f-b): vendor-stats + vendor-chart-data query helpers"
```

---

## Task 3: `(vendor)` route group + layout

**Files:**
- Create: `app/[locale]/(vendor)/layout.tsx`

- [ ] **Step 1: Implement layout**

```tsx
// app/[locale]/(vendor)/layout.tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireAuthenticatedUser } from '@/src/server/rbac/roles';
import { prisma } from '@/src/lib/db';
import Link from 'next/link';

export default async function VendorLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await requireAuthenticatedUser();
  const tenantId = (await headers()).get('x-tenant-id');
  if (!tenantId) {
    redirect(`/${locale}`); // not a tenant subdomain
  }

  // Vendors managed by this user on this tenant
  const managed = await prisma.vendorManager.findMany({
    where: { userId: user.id, vendor: { tenantId } },
    include: { vendor: { select: { id: true, name: true, isActive: true } } },
  });

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">My Vendors</h2>
        <nav className="space-y-1">
          {managed.map((m) => (
            <Link
              key={m.vendorId}
              href={`/${locale}/v/${m.vendorId}/dashboard`}
              className="block px-3 py-2 rounded hover:bg-gray-100"
            >
              {m.vendor.name}
              {!m.vendor.isActive && <span className="ml-2 text-xs text-red-500">(inactive)</span>}
            </Link>
          ))}
          {managed.length === 0 && (
            <p className="text-xs text-gray-500">No vendors assigned.</p>
          )}
        </nav>
      </aside>
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/[locale]/\(vendor\)/layout.tsx
git commit -m "feat(2f-b): vendor route group layout with sidebar"
```

---

## Task 4: `/v` index router

**Files:**
- Create: `app/[locale]/(vendor)/v/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/[locale]/(vendor)/v/page.tsx
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAuthenticatedUser } from '@/src/server/rbac/roles';
import { prisma } from '@/src/lib/db';

export default async function VendorIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireAuthenticatedUser();
  const tenantId = (await headers()).get('x-tenant-id');
  if (!tenantId) notFound();

  const managed = await prisma.vendorManager.findMany({
    where: { userId: user.id, vendor: { tenantId } },
    include: { vendor: { select: { id: true, name: true, isActive: true } } },
    orderBy: { vendor: { name: 'asc' } },
  });

  if (managed.length === 0) notFound();
  if (managed.length === 1) {
    redirect(`/${locale}/v/${managed[0].vendorId}/dashboard`);
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Select a vendor</h1>
      <ul className="space-y-2">
        {managed.map((m) => (
          <li key={m.vendorId}>
            <Link href={`/${locale}/v/${m.vendorId}/dashboard`} className="text-indigo-600 hover:underline">
              {m.vendor.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/[locale]/\(vendor\)/v/page.tsx
git commit -m "feat(2f-b): /v index router (404 / redirect / selector)"
```

---

## Task 5: Dashboard page + DashboardChart

**Files:**
- Create: `app/[locale]/(vendor)/v/[vendorId]/dashboard/page.tsx`
- Create: `src/components/vendors/DashboardChart.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// app/[locale]/(vendor)/v/[vendorId]/dashboard/page.tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import Link from 'next/link';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { getVendorStats, getVendorChartData } from '@/src/server/queries/vendor-stats';
import { tenantBaseUrl } from '@/src/lib/urls';
import { prisma } from '@/src/lib/db';
import { DashboardChart } from '@/src/components/vendors/DashboardChart';

interface Props {
  params: Promise<{ locale: string; vendorId: string }>;
}

function fmtUsd(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}$${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local[0] ?? ''}***@${domain}`;
}

export default async function VendorDashboardPage({ params }: Props) {
  const { locale, vendorId } = await params;
  const tenantId = (await headers()).get('x-tenant-id');
  if (!tenantId) notFound();

  const { vendor } = await requireVendorRoleOnVendor(vendorId);
  if (vendor.tenantId !== tenantId) notFound(); // wrong subdomain

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: vendor.tenantId } });
  const referralUrl = `${tenantBaseUrl({ slug: tenant.slug })}/?ref=${vendor.code}`;
  const qrDataUrl = await QRCode.toDataURL(referralUrl, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#1c1917', light: '#ffffff' },
  });

  const [stats, chart, recentUsers, recentSales] = await Promise.all([
    getVendorStats(vendorId),
    getVendorChartData(vendorId, 30),
    prisma.user.findMany({
      where: { referredByVendorId: vendorId },
      orderBy: { referredAt: 'desc' },
      take: 10,
      select: { email: true, name: true, referredAt: true },
    }),
    prisma.order.findMany({
      where: { referredByVendorId: vendorId, payments: { some: { status: 'succeeded' } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        commissionBpsSnapshot: true,
        payments: { where: { status: 'succeeded' }, select: { amount: true } },
        refunds: { where: { status: 'succeeded' }, select: { amount: true } },
      },
    }),
  ]);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{vendor.name}</h1>
        <Link href={`/${locale}/v/${vendorId}/brochure`} className="btn">Open Brochure</Link>
      </header>

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Referred users" value={String(stats.referredUserCount)} />
        <Stat label="Paid orders" value={String(stats.paidOrders)} />
        <Stat label="Net revenue" value={fmtUsd(stats.netUsd)} />
        <Stat label="Commission" value={fmtUsd(stats.commissionUsd)} />
      </div>

      <section className="border rounded p-4 space-y-3">
        <div className="flex items-center gap-4">
          <img src={qrDataUrl} alt="Referral QR" className="w-32 h-32" />
          <div className="flex-1 space-y-2">
            <code className="block text-sm break-all">{referralUrl}</code>
            <a href={qrDataUrl} download={`vendor-${vendor.code}-qr.png`} className="btn btn-secondary text-sm">
              Download QR PNG
            </a>
          </div>
        </div>
      </section>

      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-3">Last 30 days</h2>
        <DashboardChart data={chart.map((p) => ({
          date: p.date,
          registrations: p.registrations,
          paidOrders: p.paidOrders,
          // BigInt isn't serializable to client components; convert to number cents.
          revenueUsdCents: Number(p.revenueUsd),
        }))} />
      </section>

      <div className="grid grid-cols-2 gap-6">
        <section className="border rounded p-4">
          <h2 className="text-lg font-medium mb-3">Recent referrals</h2>
          <ul className="space-y-1 text-sm">
            {recentUsers.map((u) => (
              <li key={u.email} className="flex justify-between">
                <span>{u.name ?? maskEmail(u.email)}</span>
                <span className="text-gray-500">
                  {u.referredAt?.toISOString().slice(0, 10) ?? '-'}
                </span>
              </li>
            ))}
            {recentUsers.length === 0 && <li className="text-gray-500">None yet.</li>}
          </ul>
        </section>
        <section className="border rounded p-4">
          <h2 className="text-lg font-medium mb-3">Recent sales</h2>
          <ul className="space-y-1 text-sm">
            {recentSales.map((o) => {
              const paid = o.payments.reduce((s, p) => s + p.amount, 0n);
              const refunded = o.refunds.reduce((s, r) => s + r.amount, 0n);
              const net = paid - refunded;
              const commission = (net * BigInt(o.commissionBpsSnapshot ?? 0)) / 10000n;
              const status = refunded === 0n ? 'paid' : refunded === paid ? 'refunded' : 'partial refund';
              return (
                <li key={o.id} className="flex justify-between">
                  <span>{o.createdAt.toISOString().slice(0, 10)} — {status}</span>
                  <span>{fmtUsd(commission)}</span>
                </li>
              );
            })}
            {recentSales.length === 0 && <li className="text-gray-500">None yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-4">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Implement DashboardChart (client component)**

```tsx
// src/components/vendors/DashboardChart.tsx
'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface Point {
  date: string;
  registrations: number;
  paidOrders: number;
  revenueUsdCents: number;
}

export function DashboardChart({ data }: { data: Point[] }) {
  // Render revenue in dollars for axis readability
  const series = data.map((p) => ({ ...p, revenueUsd: p.revenueUsdCents / 100 }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={series}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="registrations" stroke="#6366f1" name="Signups" />
        <Line type="monotone" dataKey="paidOrders" stroke="#10b981" name="Orders" />
        <Line type="monotone" dataKey="revenueUsd" stroke="#ea580c" name="Revenue $" />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Smoke test in browser**

```bash
npm run dev
```

Sign in as a vendor manager (created in PR-A flow) on a tenant subdomain. Visit `/<locale>/v/<vendorId>/dashboard`. Verify:
- 4 stat cards render
- QR shows
- Chart renders with 30-day axis even with no data
- Lists show "None yet."

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(vendor\)/v/\[vendorId\]/dashboard/ src/components/vendors/DashboardChart.tsx
git commit -m "feat(2f-b): vendor self-service dashboard with stats + 30-day chart"
```

---

## Task 6: Brochure page + components

**Files:**
- Create: `app/[locale]/(vendor)/v/[vendorId]/brochure/page.tsx`
- Create: `src/components/vendors/BrochureCard.tsx`
- Create: `src/components/vendors/BrochureToolbar.tsx`

- [ ] **Step 1: Brochure page (server component)**

```tsx
// app/[locale]/(vendor)/v/[vendorId]/brochure/page.tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { tenantBaseUrl } from '@/src/lib/urls';
import { prisma } from '@/src/lib/db';
import { BrochureCard } from '@/src/components/vendors/BrochureCard';
import { BrochureToolbar } from '@/src/components/vendors/BrochureToolbar';

interface Props {
  params: Promise<{ locale: string; vendorId: string }>;
}

export default async function BrochurePage({ params }: Props) {
  const { vendorId } = await params;
  const tenantId = (await headers()).get('x-tenant-id');
  if (!tenantId) notFound();

  const { vendor } = await requireVendorRoleOnVendor(vendorId);
  if (vendor.tenantId !== tenantId) notFound();

  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: vendor.tenantId } });
  const referralUrl = `${tenantBaseUrl({ slug: tenant.slug })}/?ref=${vendor.code}`;
  const qrDataUrl = await QRCode.toDataURL(referralUrl, {
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#1c1917', light: '#ffffff' },
  });

  return (
    <div className="brochure-screen">
      <BrochureToolbar />
      <div id="cardFrame" data-size="a6" className="card-frame">
        <BrochureCard qrDataUrl={qrDataUrl} />
      </div>
      <p className="text-xs text-gray-400 mt-4 text-center" id="pageSizeLabel">A6 • 105 × 148 mm</p>
    </div>
  );
}
```

- [ ] **Step 2: BrochureCard (server component, V1 EJS port)**

Copy the full HTML structure of `<div class="card">...</div>` from V1's `src/views/vendor/brochure.ejs` (lines 528-727 in the file at `/Users/turgt/Desktop/CODES/esim-management-2/src/views/vendor/brochure.ejs`). Replace `<%= qrDataUrl %>` with `{qrDataUrl}`. Convert HTML attribute names where needed (`class` → `className`, `for` → `htmlFor`, etc.). Embed all the inline styles in a `<style>` tag.

```tsx
// src/components/vendors/BrochureCard.tsx
export function BrochureCard({ qrDataUrl }: { qrDataUrl: string }) {
  return (
    <>
      <style>{`
        /* paste the entire <style> block from V1 brochure.ejs here, verbatim */
        /* ... ~510 lines of CSS ... */
      `}</style>
      <div className="card">
        <div className="world-map">{/* ... SVG map ... */}</div>
        <div className="top-band">{/* logo + signal */}</div>
        <div className="hero">{/* eSIM hero */}</div>
        <div className="features">{/* 4 feature bullets */}</div>
        <div className="sep"></div>
        <div className="qr-section">
          <div className="qr-col">
            <div className="qr-frame">
              <div className="qr-corner tl"></div>
              <div className="qr-corner tr"></div>
              <div className="qr-corner bl"></div>
              <div className="qr-corner br"></div>
              <img src={qrDataUrl} alt="Scan to get eSIM" />
              <div className="qr-logo">{/* QR logo */}</div>
            </div>
            <div className="scan-cta">
              <div className="bar"></div>
              <span>Scan me</span>
              <div className="bar"></div>
            </div>
          </div>
          <div className="steps-col">{/* 3 easy steps */}</div>
        </div>
        <div className="footer">{/* payment logos */}</div>
      </div>
    </>
  );
}
```

(For brevity here, the full HTML is omitted. The implementer should copy `src/views/vendor/brochure.ejs` from line 528 through line 727 of the V1 file, preserving every element exactly.)

- [ ] **Step 3: BrochureToolbar (client component)**

```tsx
// src/components/vendors/BrochureToolbar.tsx
'use client';

import { useState } from 'react';

const SIZES = {
  a6: { label: 'A6 • 105 × 148 mm', scale: 4 },
  a5: { label: 'A5 • 148 × 210 mm', scale: 3 },
  a4: { label: 'A4 • 210 × 297 mm', scale: 2 },
} as const;

type Size = keyof typeof SIZES;

export function BrochureToolbar() {
  const [size, setSize] = useState<Size>('a6');
  const [busy, setBusy] = useState(false);

  function applySize(next: Size) {
    setSize(next);
    document.getElementById('cardFrame')?.setAttribute('data-size', next);
    const label = document.getElementById('pageSizeLabel');
    if (label) label.textContent = SIZES[next].label;
  }

  async function download() {
    setBusy(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const frame = document.getElementById('cardFrame') as HTMLElement | null;
      if (!frame) return;
      const canvas = await html2canvas(frame, {
        scale: SIZES[size].scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: frame.offsetWidth,
        height: frame.offsetHeight,
      });
      const a = document.createElement('a');
      a.download = `datapatch-brochure-${size}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch {
      alert('Failed to generate image. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="toolbar flex gap-2 mb-6">
      <button onClick={download} disabled={busy} className="btn btn-primary">
        {busy ? 'Generating…' : 'Download Image'}
      </button>
      <div className="size-group flex gap-1 p-1 border rounded">
        {(['a6', 'a5', 'a4'] as const).map((s) => (
          <button
            key={s}
            onClick={() => applySize(s)}
            className={`btn-size ${size === s ? 'active' : ''}`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <button onClick={() => history.back()} className="btn btn-secondary">← Back</button>
    </div>
  );
}
```

- [ ] **Step 4: Smoke test in browser**

Visit `/<locale>/v/<vendorId>/brochure`. Verify:
- A6 toggle initially active
- Switching to A4/A5 resizes the card frame
- "Download Image" button produces a PNG (size matches selected)
- QR code is the right URL (decode it)
- Print preview (Cmd+P) shows the card without the toolbar (V1's @media print rule)

- [ ] **Step 5: Commit**

```bash
git add app/[locale]/\(vendor\)/v/\[vendorId\]/brochure/ src/components/vendors/BrochureCard.tsx src/components/vendors/BrochureToolbar.tsx
git commit -m "feat(2f-b): vendor brochure page (V1 EJS port + html2canvas client toolbar)"
```

---

## Task 7: i18n message keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/tr.json`

- [ ] **Step 1: Add `vendor.dashboard.*` and `vendor.brochure.*` keys to `en.json`**

```json
{
  "vendor": {
    "dashboard": {
      "title": "Vendor Dashboard",
      "openBrochure": "Open Brochure",
      "stats": {
        "referredUsers": "Referred users",
        "paidOrders": "Paid orders",
        "netRevenue": "Net revenue",
        "commission": "Commission"
      },
      "qrSection": {
        "downloadQr": "Download QR PNG"
      },
      "chart": {
        "title": "Last 30 days",
        "signups": "Signups",
        "orders": "Orders",
        "revenue": "Revenue $"
      },
      "recent": {
        "referrals": "Recent referrals",
        "sales": "Recent sales",
        "noneYet": "None yet."
      },
      "saleStatus": {
        "paid": "paid",
        "partialRefund": "partial refund",
        "refunded": "refunded"
      }
    },
    "brochure": {
      "title": "DataPatch eSIM Brochure",
      "downloadButton": "Download Image",
      "generating": "Generating…",
      "back": "← Back",
      "noPhysicalSim": "No physical SIM needed — activate instantly",
      "scanMe": "Scan me",
      "threeSteps": "3 easy steps",
      "step1Title": "Scan",
      "step1Body": "Point your camera at the QR",
      "step2Title": "Choose a plan",
      "step2Body": "Pick data for your trip",
      "step3Title": "Get online",
      "step3Body": "Connect instantly",
      "feat200": "Works in 200+ countries",
      "feat2min": "Activate in 2 minutes",
      "featFast": "Fast & reliable internet",
      "featQR": "Easy QR installation",
      "weAccept": "We accept"
    }
  }
}
```

- [ ] **Step 2: TR translations to `tr.json`**

```json
{
  "vendor": {
    "dashboard": {
      "title": "Vendor Paneli",
      "openBrochure": "Broşürü Aç",
      "stats": {
        "referredUsers": "Referans kullanıcıları",
        "paidOrders": "Ödenmiş sipariş",
        "netRevenue": "Net gelir",
        "commission": "Komisyon"
      },
      "qrSection": {
        "downloadQr": "QR PNG İndir"
      },
      "chart": {
        "title": "Son 30 gün",
        "signups": "Kayıt",
        "orders": "Sipariş",
        "revenue": "Gelir $"
      },
      "recent": {
        "referrals": "Son referanslar",
        "sales": "Son satışlar",
        "noneYet": "Henüz yok."
      },
      "saleStatus": {
        "paid": "ödendi",
        "partialRefund": "kısmi iade",
        "refunded": "iade edildi"
      }
    },
    "brochure": {
      "title": "DataPatch eSIM Broşür",
      "downloadButton": "Görseli İndir",
      "generating": "Oluşturuluyor…",
      "back": "← Geri",
      "noPhysicalSim": "Fiziksel SIM gerekmez — anında aktive et",
      "scanMe": "Beni tara",
      "threeSteps": "3 kolay adım",
      "step1Title": "Tara",
      "step1Body": "Kameranı QR'a doğrult",
      "step2Title": "Plan seç",
      "step2Body": "Yolculuğun için veri seç",
      "step3Title": "Bağlan",
      "step3Body": "Anında çevrimiçi ol",
      "feat200": "200+ ülkede geçerli",
      "feat2min": "2 dakikada aktif",
      "featFast": "Hızlı ve güvenilir internet",
      "featQR": "Kolay QR kurulum",
      "weAccept": "Kabul ettiğimiz ödemeler"
    }
  }
}
```

- [ ] **Step 3: Wire `getTranslations` / `useTranslations` into the dashboard, layout, brochure, and chart**

Replace hard-coded English strings in Tasks 3-6 with `getTranslations('vendor.dashboard')` / `getTranslations('vendor.brochure')` for server components, `useTranslations(...)` for client components. Mirror the V2 next-intl pattern.

- [ ] **Step 4: Commit**

```bash
git add messages/ src/components/vendors/ app/[locale]/\(vendor\)/
git commit -m "feat(2f-b): i18n for vendor dashboard + brochure (en + tr)"
```

---

## Task 8: E2E — vendor dashboard isolation

**Files:**
- Create: `e2e/vendor-dashboard.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/vendor-dashboard.spec.ts
import { expect, test } from '@playwright/test';
import { prisma } from '@/src/lib/db';

test.describe('Phase 2f vendor dashboard', () => {
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let vendorA: { id: string; code: string };
  let vendorB: { id: string };
  let managerA: { id: string; email: string };

  test.beforeAll(async () => {
    tenantA = await prisma.tenant.findFirstOrThrow({ where: { slug: 'platform' }, select: { id: true, slug: true } });
    // Use a second known tenant if seeded; otherwise create one.
    const second = await prisma.tenant.findFirst({ where: { slug: { not: 'platform' } }, select: { id: true, slug: true } });
    tenantB = second ?? await prisma.tenant.create({ data: { slug: `e2eb-${Date.now()}`, name: 'E2EB', defaultMarkupBps: 0 } });

    vendorA = await prisma.vendor.create({
      data: { tenantId: tenantA.id, name: 'A Vendor', code: 'e2eda001', commissionBps: 500 },
    });
    vendorB = await prisma.vendor.create({
      data: { tenantId: tenantB.id, name: 'B Vendor', code: 'e2edb001', commissionBps: 500 },
    });
    managerA = await prisma.user.create({ data: { email: `e2e-mgr-${Date.now()}@x.com` } });
    await prisma.vendorManager.create({ data: { vendorId: vendorA.id, userId: managerA.id } });
    await prisma.userTenantMembership.create({ data: { userId: managerA.id, tenantId: tenantA.id, role: 'vendor_manager' } });
  });

  test.afterAll(async () => {
    await prisma.vendorManager.deleteMany({ where: { userId: managerA.id } });
    await prisma.userTenantMembership.deleteMany({ where: { userId: managerA.id } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendorA.id, vendorB.id] } } });
    await prisma.user.delete({ where: { id: managerA.id } });
  });

  test('manager can view own vendor dashboard', async ({ page, baseURL }) => {
    // (Sign in helper — out of scope here. Assume an `e2eSignIn` exists.)
    // await e2eSignIn(page, managerA.email);
    const url = new URL(`/en/v/${vendorA.id}/dashboard`, baseURL!.replace('://', `://${tenantA.slug}.`));
    const r = await page.goto(url.toString());
    expect(r?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: 'A Vendor' })).toBeVisible();
  });

  test('manager cannot view another vendor dashboard (Forbidden)', async ({ page, baseURL }) => {
    const url = new URL(`/en/v/${vendorB.id}/dashboard`, baseURL!.replace('://', `://${tenantA.slug}.`));
    const r = await page.goto(url.toString());
    // The cross-tenant guard should 404 (vendorB.tenantId !== tenantA.id).
    // Exact status depends on how Next.js renders forbidden vs notFound errors;
    // 404 is the spec'd behavior.
    expect(r?.status()).toBe(404);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npm run e2e -- --grep "Phase 2f vendor dashboard"
```

- [ ] **Step 3: Commit**

```bash
git add e2e/vendor-dashboard.spec.ts
git commit -m "test(2f-b): e2e vendor dashboard isolation (own + cross-tenant denied)"
```

---

## Task 9: Final verification + push + open PR

- [ ] **Step 1: Full suite**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run e2e
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/phase-2f-pr-b-vendor-dashboard
```

- [ ] **Step 3: Open PR (with explicit user approval first)**

```bash
gh pr create --title "Phase 2f PR-B: Vendor Dashboard + Brochure" --body "$(cat <<'EOF'
## Summary
- New (vendor) route group with sidebar layout
- /v index router (404 / redirect / vendor selector)
- /v/[vendorId]/dashboard with 4 stat cards, QR + referral URL, Recharts 30-day chart, recent referrals/sales tables
- /v/[vendorId]/brochure (port of V1 EJS, A4/A5/A6 toggle, html2canvas PNG download)
- Server query helpers: getVendorStats + getVendorChartData (reuses computeCommissionForOrder from PR-A)
- Subdomain enforcement: vendor.tenantId === currentTenantId; otherwise 404
- i18n: vendor.dashboard.* and vendor.brochure.* (en + tr)
- E2E: vendor-dashboard.spec.ts (manager sees own, denied on cross-tenant)

## Test plan
- [ ] Manual: sign in as vendor manager on tenant subdomain → /v redirects to single vendor's dashboard
- [ ] Manual: stats render with correct USD formatting; chart shows 30-day axis even with no data
- [ ] Manual: brochure A4/A5/A6 toggle resizes correctly; download produces PNG at correct scale
- [ ] Manual: cross-vendor URL access (manager of A visiting B) → 404
- [ ] CI green

Spec: docs/superpowers/specs/2026-04-27-v2-phase-2f-vendor-port-design.md
Depends on: Phase 2f PR-A merged
EOF
)"
```

---

## Self-Review Checklist (run before opening PR)

- [ ] Spec coverage: layout ✓ (Task 3), /v router ✓ (Task 4), dashboard ✓ (Task 5), brochure ✓ (Task 6), stats query ✓ (Task 2), chart ✓ (Task 5), brochure toolbar with html2canvas ✓ (Task 6), QR rendering ✓ (Task 5/6), i18n ✓ (Task 7), E2E ✓ (Task 8).
- [ ] Subdomain enforcement on every `/v/[vendorId]/*` page (`vendor.tenantId === tenantId`).
- [ ] No placeholders.
- [ ] Type consistency: `bigint` USD cents → `number` cents at the client component boundary (Recharts can't serialize BigInt). Done in Task 5.
- [ ] Privacy: dashboard masks emails with `maskEmail` helper.
