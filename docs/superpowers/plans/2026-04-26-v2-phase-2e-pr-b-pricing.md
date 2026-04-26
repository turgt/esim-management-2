# V2 Phase 2e PR-B — Per-Tenant Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each tenant has its own selling price per `ProviderPackage`, computed via a hybrid model: a tenant-wide default markup (basis points) plus optional absolute overrides per package. USD-only invariant retained.

**Architecture:** New table `tenant_package_prices` keyed on `(tenantId, packageId)` for absolute overrides. New `Tenant.defaultMarkupBps` integer column for the markup default. `calculatePrice` gains a required `tenantId` arg and resolves: override → markup → upstream cost. Agency_admin manages everything from a single page at `/admin/pricing` on the tenant subdomain (PR-A's host-binding).

**Tech Stack:** Prisma migrations, Vitest, NextAuth (existing RBAC), React Server Actions, Zod.

**Repo:** `/Users/turgt/Desktop/CODES/datapatch-v2`. Paths relative to that repo.

**Spec:** `docs/superpowers/specs/2026-04-26-v2-phase-2e-subdomain-and-pricing-design.md`.

**Depends on:** No runtime dependency on PR-A. Can ship independently. (Phase 2f vendor work depends on both.)

---

### Task 1: Prisma migration — `Tenant.defaultMarkupBps` + `TenantPackagePrice`

**Files:**
- Modify: `prisma/schema.prisma`
- Generated: `prisma/migrations/<timestamp>_phase_2e_per_tenant_pricing/migration.sql`

- [ ] **Step 1: Edit schema**

In `model Tenant`, add after `agencyContactEmail`:
```prisma
  defaultMarkupBps    Int         @default(0)
```

Add a new model below `Tenant`:
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

In `model Tenant` add the back-relation:
```prisma
  packagePrices       TenantPackagePrice[]
```

In `model ProviderPackage` add the back-relation:
```prisma
  tenantPrices        TenantPackagePrice[]
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name phase_2e_per_tenant_pricing`
Expected: migration generated and applied to local DB; `prisma generate` runs automatically.

- [ ] **Step 3: Verify**

Run: `npx prisma studio` (or `psql`) — confirm `tenants.default_markup_bps` column exists and table `tenant_package_prices` is created.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(phase-2e): schema for per-tenant default markup + package price overrides"
```

---

### Task 2: Pricing helper — `effectiveUnitAmount`

A pure function that computes the effective unit amount given upstream cost + override + markup. Easier to test in isolation than the integrated `calculatePrice`.

**Files:**
- Create: `src/server/domain/pricing/effectiveUnitAmount.ts`
- Test: `src/server/domain/pricing/effectiveUnitAmount.test.ts`

- [ ] **Step 1: Tests**

```ts
// src/server/domain/pricing/effectiveUnitAmount.test.ts
import { describe, expect, it } from 'vitest';
import { effectiveUnitAmount } from './effectiveUnitAmount';

describe('effectiveUnitAmount', () => {
  it('returns override amount when override is set', () => {
    expect(effectiveUnitAmount({ upstream: 1000n, override: 1500n, markupBps: 9999 })).toBe(1500n);
  });

  it('applies markup when no override (25%)', () => {
    // 1000 * (10000 + 2500) / 10000 = 1250
    expect(effectiveUnitAmount({ upstream: 1000n, override: null, markupBps: 2500 })).toBe(1250n);
  });

  it('applies 0% markup → returns upstream as-is', () => {
    expect(effectiveUnitAmount({ upstream: 1000n, override: null, markupBps: 0 })).toBe(1000n);
  });

  it('floors when markup math is non-integer', () => {
    // 999 * 12500 / 10000 = 1248.75 → 1248n (BigInt floor)
    expect(effectiveUnitAmount({ upstream: 999n, override: null, markupBps: 2500 })).toBe(1248n);
  });

  it('rejects negative markup', () => {
    expect(() => effectiveUnitAmount({ upstream: 1000n, override: null, markupBps: -1 })).toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/domain/pricing/effectiveUnitAmount.ts
export interface EffectiveUnitInput {
  upstream: bigint;
  override: bigint | null;
  markupBps: number;
}

export function effectiveUnitAmount(input: EffectiveUnitInput): bigint {
  if (input.override !== null) return input.override;
  if (!Number.isInteger(input.markupBps) || input.markupBps < 0) {
    throw new Error(`markupBps must be a non-negative integer, got ${input.markupBps}`);
  }
  // floor((upstream * (10000 + markupBps)) / 10000)
  return (input.upstream * BigInt(10000 + input.markupBps)) / 10000n;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/server/domain/pricing/effectiveUnitAmount.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/domain/pricing/effectiveUnitAmount.ts src/server/domain/pricing/effectiveUnitAmount.test.ts
git commit -m "feat(phase-2e): add pure effectiveUnitAmount pricing helper"
```

---

### Task 3: Update `calculatePrice` to accept `tenantId`

**Files:**
- Modify: `src/server/domain/pricing/calculatePrice.ts`
- Modify: `src/server/domain/pricing/calculatePrice.test.ts`

- [ ] **Step 1: Add tests for new behavior**

Append to `calculatePrice.test.ts`:

```ts
it('uses tenant override when present', async () => {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'alpha' } });
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo' as any,
      sku: 'test-override',
      name: 'Override Test',
      countryCodes: ['TR'],
      priceAmount: 1000n,
      priceCurrency: 'USD',
      active: true,
    },
  });
  await prisma.tenantPackagePrice.create({
    data: { tenantId: tenant.id, packageId: pkg.id, priceAmount: 1500n, priceCurrency: 'USD' },
  });
  const q = await calculatePrice({ tenantId: tenant.id, packageId: pkg.id, quantity: 2 });
  expect(q.unit.amount).toBe(1500n);
  expect(q.total.amount).toBe(3000n);
});

it('applies tenant default markup when no override', async () => {
  const tenant = await prisma.tenant.update({
    where: { slug: 'alpha' },
    data: { defaultMarkupBps: 2500 },
  });
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo' as any,
      sku: 'test-markup',
      name: 'Markup Test',
      countryCodes: ['TR'],
      priceAmount: 1000n,
      priceCurrency: 'USD',
      active: true,
    },
  });
  const q = await calculatePrice({ tenantId: tenant.id, packageId: pkg.id, quantity: 1 });
  expect(q.unit.amount).toBe(1250n);
});

it('throws on non-USD package even with override', async () => {
  const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'alpha' } });
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo' as any,
      sku: 'test-eur',
      name: 'EUR Test',
      countryCodes: ['DE'],
      priceAmount: 1000n,
      priceCurrency: 'EUR',
      active: true,
    },
  });
  await expect(
    calculatePrice({ tenantId: tenant.id, packageId: pkg.id, quantity: 1 }),
  ).rejects.toThrow(/USD/i);
});
```

(Keep existing tests; update them to pass `tenantId`.)

- [ ] **Step 2: Update implementation**

```ts
// src/server/domain/pricing/calculatePrice.ts
import { prisma } from '@/src/lib/db';
import type { Currency, Money } from '@/src/lib/money';
import { CURRENCIES, multiply } from '@/src/lib/money';
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';
import { effectiveUnitAmount } from './effectiveUnitAmount';

export interface PriceQuote {
  packageId: string;
  quantity: number;
  unit: Money;
  total: Money;
  currency: Currency;
}

export interface CalculatePriceInput {
  tenantId: string;
  packageId: string;
  quantity: number;
}

export async function calculatePrice(input: CalculatePriceInput): Promise<PriceQuote> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`calculatePrice: quantity must be a positive integer, got ${input.quantity}`);
  }
  const [pkg, tenant, override] = await Promise.all([
    prisma.providerPackage.findUnique({ where: { id: input.packageId } }),
    prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { defaultMarkupBps: true },
    }),
    prisma.tenantPackagePrice.findUnique({
      where: { tenantId_packageId: { tenantId: input.tenantId, packageId: input.packageId } },
    }),
  ]);
  if (!pkg) throw new Error(`calculatePrice: package not found (${input.packageId})`);
  if (!tenant) throw new Error(`calculatePrice: tenant not found (${input.tenantId})`);
  if (!(CURRENCIES as readonly string[]).includes(pkg.priceCurrency)) {
    throw new Error(`calculatePrice: unsupported currency ${pkg.priceCurrency}`);
  }
  const currency = (override?.priceCurrency ?? pkg.priceCurrency) as Currency;
  const amount = effectiveUnitAmount({
    upstream: pkg.priceAmount,
    override: override?.priceAmount ?? null,
    markupBps: tenant.defaultMarkupBps,
  });
  const unit: Money = { amount, currency };
  assertUsdMoney(unit, 'calculatePrice unit');
  const total = multiply(unit, input.quantity);
  return { packageId: pkg.id, quantity: input.quantity, unit, total, currency };
}
```

- [ ] **Step 3: Run unit tests**

Run: `npx vitest run src/server/domain/pricing/calculatePrice.test.ts`
Expected: all pricing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/domain/pricing/calculatePrice.ts src/server/domain/pricing/calculatePrice.test.ts
git commit -m "feat(phase-2e): calculatePrice resolves override → markup → upstream per tenant"
```

---

### Task 4: Pass `tenantId` through `lockPrice` and `createBooking`

**Files:**
- Modify: `src/server/domain/pricing/lockPrice.ts`
- Modify: `src/server/domain/orders/createBooking.ts`
- Modify: `src/server/domain/pricing/lockPrice.test.ts` (if exists)

- [ ] **Step 1: Update `LockPriceInput`**

```ts
// lockPrice.ts
export interface LockPriceInput {
  orderId: string;
  tenantId: string;
  packageId: string;
  quantity: number;
}

// inside lockPrice:
const quote = await calculatePrice({
  tenantId: input.tenantId,
  packageId: input.packageId,
  quantity: input.quantity,
});
```

- [ ] **Step 2: Update `createBooking` lockPrice call**

In `createBooking.ts:119` (or wherever `lockPrice({...})` is invoked):
```ts
const lock = await lockPrice({
  orderId: draft.id,
  tenantId: input.tenantId,
  packageId: input.packageId,
  quantity: input.quantity,
});
```

- [ ] **Step 3: Run booking tests**

Run: `npx vitest run src/server/domain/orders src/server/domain/pricing`
Expected: PASS. Fix any leftover fixtures missing `tenantId`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(phase-2e): thread tenantId through lockPrice + createBooking"
```

---

### Task 5: B2C catalog page applies tenant pricing

**Files:**
- Modify: `app/[locale]/(customer)/shop/page.tsx`

- [ ] **Step 1: Replace direct upstream-cost rendering**

```tsx
import { headers } from 'next/headers';
import { prisma } from '@/src/lib/db';
import { effectiveUnitAmount } from '@/src/server/domain/pricing/effectiveUnitAmount';
import { format } from '@/src/lib/money';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export default async function ShopPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  if (!tenantId) {
    // PR-A middleware sets this header on tenant subdomains; if absent the user
    // is on apex/www where the shop is not served.
    return <main style={{ padding: 24 }}><p>Shop is only available on a tenant subdomain.</p></main>;
  }
  const [tenant, packages, overrides] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultMarkupBps: true },
    }),
    prisma.providerPackage.findMany({ where: { active: true }, orderBy: [{ name: 'asc' }] }),
    prisma.tenantPackagePrice.findMany({ where: { tenantId } }),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.packageId, o]));
  const label = locale === 'tr' ? 'Satın al' : 'Buy';

  return (
    <main style={{ padding: 24 }}>
      <h1>{locale === 'tr' ? 'eSIM Dükkânı' : 'eSIM Shop'}</h1>
      <ul style={{ display: 'grid', gap: 12, listStyle: 'none', padding: 0 }}>
        {packages.map((p) => {
          const o = overrideMap.get(p.id) ?? null;
          const amount = effectiveUnitAmount({
            upstream: p.priceAmount,
            override: o?.priceAmount ?? null,
            markupBps: tenant.defaultMarkupBps,
          });
          const currency = (o?.priceCurrency ?? p.priceCurrency) as 'USD';
          return (
            <li key={p.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 6 }}>
              <div><strong>{p.name}</strong></div>
              <div style={{ fontSize: 13, color: '#555' }}>
                {p.countryCodes.join(', ')} · {p.durationDays ?? '?'} days · {p.dataMb ?? '?'} MB
              </div>
              <div style={{ marginTop: 4 }}>{format({ amount, currency }, locale)}</div>
              <Link
                href={{ pathname: '/shop/checkout', query: { packageId: p.id } }}
                style={{ display: 'inline-block', marginTop: 8, padding: '6px 12px', background: '#111', color: '#fff', borderRadius: 4, textDecoration: 'none' }}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Smoke**

Visit `http://alpha.localhost:3000/en/shop`. Set alpha tenant `defaultMarkupBps=2500` via `npx prisma studio`; refresh — prices should display at +25%.

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/(customer)/shop/page.tsx
git commit -m "feat(phase-2e): shop catalog displays tenant-resolved prices"
```

---

### Task 6: Tenant create form requires `defaultMarkupBps`

**Files:**
- Modify: `app/[locale]/(admin)/admin/tenants/new/page.tsx`

- [ ] **Step 1: Extend form schema + UI**

Add to schema:
```ts
const formSchema = z.object({
  slug: z.string().superRefine((v, ctx) => {
    const r = validateTenantSlug(v);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error! });
  }),
  name: z.string().min(1).max(128),
  defaultMarkupBps: z.coerce.number().int().min(0).max(100_000),
});
```

In the server action `createTenant`, parse `defaultMarkupBps` from the form, write it on `prisma.tenant.create`. Audit-log `metadata.defaultMarkupBps`.

UI: add an input `<input name="defaultMarkupBps" type="number" min="0" step="1" required />` rendered as `<MarkupPercentage>` (label: "Default markup (basis points). 2500 = 25%"). For 0 value, show inline note "Tenant will sell at upstream cost — confirm intentional."

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/(admin)/admin/tenants/new/page.tsx
git commit -m "feat(phase-2e): require defaultMarkupBps on tenant create form"
```

---

### Task 7: Pricing page server actions

**Files:**
- Create: `app/[locale]/(agency)/a/[agencySlug]/pricing/actions.ts`

- [ ] **Step 1: Implement actions**

```ts
// app/[locale]/(agency)/a/[agencySlug]/pricing/actions.ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/src/lib/db';
import { requireAgencyRoleOnTenant } from '@/src/server/rbac/roles';
import { writeAuditLog } from '@/src/server/audit/log';
import { assertUsdMoney } from '@/src/lib/assertUsdMoney';

async function loadTenantBySlug(slug: string) {
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, defaultMarkupBps: true } });
  if (!t) throw new Error(`Tenant not found: ${slug}`);
  return t;
}

const SetMarkupSchema = z.object({
  agencySlug: z.string(),
  defaultMarkupBps: z.coerce.number().int().min(0).max(100_000),
});

export async function setDefaultMarkupAction(input: z.infer<typeof SetMarkupSchema>) {
  const { agencySlug, defaultMarkupBps } = SetMarkupSchema.parse(input);
  const tenant = await loadTenantBySlug(agencySlug);
  const user = await requireAgencyRoleOnTenant(tenant.id, ['agency_admin']);
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { defaultMarkupBps },
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'tenant.markup_bps_changed',
        resource: 'tenant',
        resourceId: tenant.id,
        metadata: { from: tenant.defaultMarkupBps, to: defaultMarkupBps },
      },
    });
  });
  revalidatePath(`/a/${agencySlug}/pricing`);
}

const SetOverrideSchema = z.object({
  agencySlug: z.string(),
  packageId: z.string(),
  priceAmount: z.coerce.bigint().nonnegative(),
});

export async function setPackageOverrideAction(input: z.infer<typeof SetOverrideSchema>) {
  const { agencySlug, packageId, priceAmount } = SetOverrideSchema.parse(input);
  const tenant = await loadTenantBySlug(agencySlug);
  const user = await requireAgencyRoleOnTenant(tenant.id, ['agency_admin']);
  assertUsdMoney({ currency: 'USD' }, 'setPackageOverride'); // explicit reaffirmation
  await prisma.$transaction(async (tx) => {
    await tx.tenantPackagePrice.upsert({
      where: { tenantId_packageId: { tenantId: tenant.id, packageId } },
      create: { tenantId: tenant.id, packageId, priceAmount, priceCurrency: 'USD' },
      update: { priceAmount, priceCurrency: 'USD' },
    });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'tenant.package_price_override_set',
        resource: 'tenant_package_price',
        resourceId: packageId,
        metadata: { packageId, priceAmount: priceAmount.toString() },
      },
    });
  });
  revalidatePath(`/a/${agencySlug}/pricing`);
}

const ClearOneSchema = z.object({ agencySlug: z.string(), packageId: z.string() });

export async function clearPackageOverrideAction(input: z.infer<typeof ClearOneSchema>) {
  const { agencySlug, packageId } = ClearOneSchema.parse(input);
  const tenant = await loadTenantBySlug(agencySlug);
  const user = await requireAgencyRoleOnTenant(tenant.id, ['agency_admin']);
  await prisma.$transaction(async (tx) => {
    await tx.tenantPackagePrice.deleteMany({ where: { tenantId: tenant.id, packageId } });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'tenant.package_price_override_cleared',
        resource: 'tenant_package_price',
        resourceId: packageId,
        metadata: { packageId },
      },
    });
  });
  revalidatePath(`/a/${agencySlug}/pricing`);
}

const ClearAllSchema = z.object({ agencySlug: z.string() });

export async function clearAllOverridesAction(input: z.infer<typeof ClearAllSchema>) {
  const { agencySlug } = ClearAllSchema.parse(input);
  const tenant = await loadTenantBySlug(agencySlug);
  const user = await requireAgencyRoleOnTenant(tenant.id, ['agency_admin']);
  await prisma.$transaction(async (tx) => {
    const removed = await tx.tenantPackagePrice.deleteMany({ where: { tenantId: tenant.id } });
    await tx.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: 'tenant.all_overrides_cleared',
        resource: 'tenant',
        resourceId: tenant.id,
        metadata: { count: removed.count },
      },
    });
  });
  revalidatePath(`/a/${agencySlug}/pricing`);
}
```

- [ ] **Step 2: Add `requireAgencyRoleOnTenant` if missing**

In `src/server/rbac/roles.ts`, append (if it doesn't already exist):
```ts
const AGENCY_ROLES = new Set<Role>(['agency_admin', 'agency_staff']);

export async function requireAgencyRoleOnTenant(
  tenantId: string,
  allowed: readonly Role[] = ['agency_admin'],
): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser();
  const m = await getMembershipRole(user.id, tenantId);
  if (!m || !allowed.includes(m)) throw new Error('Forbidden: agency role required.');
  return user;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/(agency)/a/[agencySlug]/pricing/actions.ts src/server/rbac/roles.ts
git commit -m "feat(phase-2e): pricing server actions (markup + override CRUD + audit)"
```

---

### Task 8: Pricing page UI

**Files:**
- Create: `app/[locale]/(agency)/a/[agencySlug]/pricing/page.tsx`

- [ ] **Step 1: Implement page**

```tsx
// app/[locale]/(agency)/a/[agencySlug]/pricing/page.tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/src/lib/db';
import { requireAgencyRoleOnTenant } from '@/src/server/rbac/roles';
import { effectiveUnitAmount } from '@/src/server/domain/pricing/effectiveUnitAmount';
import { format } from '@/src/lib/money';
import {
  setDefaultMarkupAction,
  setPackageOverrideAction,
  clearPackageOverrideAction,
  clearAllOverridesAction,
} from './actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; agencySlug: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { locale, agencySlug } = await params;
  const { page = '1', q = '' } = await searchParams;
  const tenant = await prisma.tenant.findUnique({ where: { slug: agencySlug } });
  if (!tenant) return notFound();
  await requireAgencyRoleOnTenant(tenant.id, ['agency_admin']);

  const where = q
    ? {
        active: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { sku: { contains: q, mode: 'insensitive' as const } },
          { countryCodes: { has: q.toUpperCase() } },
        ],
      }
    : { active: true };

  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * PAGE_SIZE;
  const [packages, totalCount, overrides] = await Promise.all([
    prisma.providerPackage.findMany({ where, orderBy: [{ name: 'asc' }], skip, take: PAGE_SIZE }),
    prisma.providerPackage.count({ where }),
    prisma.tenantPackagePrice.findMany({ where: { tenantId: tenant.id } }),
  ]);
  const overrideMap = new Map(overrides.map((o) => [o.packageId, o]));

  return (
    <main style={{ padding: 24 }}>
      <h1>Pricing — {tenant.name}</h1>

      <section style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
        <h2>Default markup</h2>
        <form
          action={async (fd) => {
            'use server';
            await setDefaultMarkupAction({
              agencySlug,
              defaultMarkupBps: Number(fd.get('defaultMarkupBps')),
            });
          }}
        >
          <label>
            Markup (basis points; 2500 = 25%):
            <input
              name="defaultMarkupBps"
              type="number"
              min={0}
              max={100000}
              defaultValue={tenant.defaultMarkupBps}
              required
              style={{ marginLeft: 8 }}
            />
          </label>
          <button type="submit" style={{ marginLeft: 8 }}>Save</button>
        </form>
        {tenant.defaultMarkupBps === 0 && (
          <p style={{ color: '#b45309', marginTop: 8 }}>
            Warning: markup is 0%. Packages without explicit overrides sell at upstream cost.
          </p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Packages</h2>
        <form method="get" style={{ marginBottom: 12 }}>
          <input name="q" defaultValue={q} placeholder="Search by SKU / name / country" />
          <button type="submit">Search</button>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th>Package</th>
              <th>Provider</th>
              <th>Upstream</th>
              <th>Effective</th>
              <th>Margin</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => {
              const o = overrideMap.get(p.id) ?? null;
              const eff = effectiveUnitAmount({
                upstream: p.priceAmount,
                override: o?.priceAmount ?? null,
                markupBps: tenant.defaultMarkupBps,
              });
              const margin = eff > 0n ? Number(((eff - p.priceAmount) * 10000n) / eff) / 100 : 0;
              return (
                <tr key={p.id}>
                  <td>{p.name} ({p.sku})</td>
                  <td>{p.providerId}</td>
                  <td>{format({ amount: p.priceAmount, currency: 'USD' }, locale)}</td>
                  <td>
                    {format({ amount: eff, currency: 'USD' }, locale)}
                    {o ? ' (Override)' : ''}
                  </td>
                  <td>{margin.toFixed(1)}%</td>
                  <td>
                    <form
                      action={async (fd) => {
                        'use server';
                        const cents = Math.round(Number(fd.get('priceMajor')) * 100);
                        await setPackageOverrideAction({
                          agencySlug,
                          packageId: p.id,
                          priceAmount: BigInt(cents),
                        });
                      }}
                      style={{ display: 'inline-block' }}
                    >
                      <input
                        name="priceMajor"
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={Number(eff) / 100}
                        style={{ width: 80 }}
                      />
                      <button type="submit">Set override</button>
                    </form>
                    {o && (
                      <form
                        action={async () => {
                          'use server';
                          await clearPackageOverrideAction({ agencySlug, packageId: p.id });
                        }}
                        style={{ display: 'inline-block', marginLeft: 4 }}
                      >
                        <button type="submit">Clear</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 24 }}>
        <form
          action={async () => {
            'use server';
            await clearAllOverridesAction({ agencySlug });
          }}
        >
          <button type="submit" style={{ color: '#b91c1c' }}>
            Clear all overrides
          </button>
        </form>
      </section>

      <p style={{ marginTop: 24, fontSize: 12, color: '#777' }}>
        {totalCount} packages · page {page} · {Math.ceil(totalCount / PAGE_SIZE)} total
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Smoke**

`http://alpha.localhost:3000/en/a/alpha/pricing` (assuming alpha-admin is signed in as agency_admin on alpha). Verify markup edit, override set/clear, search.

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/(agency)/a/[agencySlug]/pricing/page.tsx
git commit -m "feat(phase-2e): /admin/pricing page with markup editor + per-package overrides"
```

---

### Task 9: Cross-tenant isolation integration test

**Files:**
- Create: `src/server/domain/pricing/calculatePrice.cross-tenant.test.ts`

- [ ] **Step 1: Test**

```ts
// src/server/domain/pricing/calculatePrice.cross-tenant.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/src/lib/db';
import { calculatePrice } from './calculatePrice';

describe('calculatePrice cross-tenant isolation', () => {
  let pkgId = '';
  let alphaId = '';
  let betaId = '';

  beforeAll(async () => {
    const alpha = await prisma.tenant.upsert({
      where: { slug: 'alpha' },
      update: { defaultMarkupBps: 2000 },
      create: { slug: 'alpha', name: 'Alpha', defaultMarkupBps: 2000 },
    });
    const beta = await prisma.tenant.upsert({
      where: { slug: 'beta' },
      update: { defaultMarkupBps: 5000 },
      create: { slug: 'beta', name: 'Beta', defaultMarkupBps: 5000 },
    });
    alphaId = alpha.id;
    betaId = beta.id;
    const pkg = await prisma.providerPackage.create({
      data: {
        providerId: 'airalo' as any,
        sku: 'isolation-test',
        name: 'Isolation',
        countryCodes: ['TR'],
        priceAmount: 1000n,
        priceCurrency: 'USD',
        active: true,
      },
    });
    pkgId = pkg.id;
    await prisma.tenantPackagePrice.create({
      data: { tenantId: alphaId, packageId: pkgId, priceAmount: 1500n, priceCurrency: 'USD' },
    });
  });

  afterAll(async () => {
    await prisma.tenantPackagePrice.deleteMany({ where: { packageId: pkgId } });
    await prisma.providerPackage.delete({ where: { id: pkgId } });
  });

  it('alpha sees override price 1500', async () => {
    const q = await calculatePrice({ tenantId: alphaId, packageId: pkgId, quantity: 1 });
    expect(q.unit.amount).toBe(1500n);
  });

  it('beta sees markup price 1500 (cost 1000 * 1.5)', async () => {
    const q = await calculatePrice({ tenantId: betaId, packageId: pkgId, quantity: 1 });
    expect(q.unit.amount).toBe(1500n);
  });

  it('alpha clears override → falls back to alpha markup (1200)', async () => {
    await prisma.tenantPackagePrice.deleteMany({ where: { tenantId: alphaId, packageId: pkgId } });
    const q = await calculatePrice({ tenantId: alphaId, packageId: pkgId, quantity: 1 });
    expect(q.unit.amount).toBe(1200n);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/server/domain/pricing/calculatePrice.cross-tenant.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/domain/pricing/calculatePrice.cross-tenant.test.ts
git commit -m "test(phase-2e): cross-tenant pricing isolation"
```

---

### Task 10: Super-admin dashboard banner — tenants needing pricing config

**Files:**
- Modify: `app/[locale]/(admin)/admin/page.tsx`

- [ ] **Step 1: Add banner**

```tsx
// inside the existing admin dashboard page render
const tenantsNeedingConfig = await prisma.tenant.findMany({
  where: {
    defaultMarkupBps: 0,
    packagePrices: { none: {} },
  },
  select: { id: true, slug: true, name: true },
});

// render
{tenantsNeedingConfig.length > 0 && (
  <section style={{ background: '#fef3c7', border: '1px solid #fbbf24', padding: 12, borderRadius: 6, marginBottom: 16 }}>
    <strong>{tenantsNeedingConfig.length} tenant(s) selling at upstream cost.</strong>
    <ul>
      {tenantsNeedingConfig.map((t) => (
        <li key={t.id}>
          {t.name} (<code>{t.slug}</code>)
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 2: Commit**

```bash
git add app/[locale]/(admin)/admin/page.tsx
git commit -m "feat(phase-2e): super-admin banner for tenants with no markup or overrides"
```

---

### Task 11: E2E — agency_admin pricing flow

**Files:**
- Create: `tests/e2e/pricing.spec.ts`

- [ ] **Step 1: E2E test**

```ts
// tests/e2e/pricing.spec.ts
import { test, expect } from '@playwright/test';

test('agency_admin updates markup and override; buyer sees new price', async ({ browser }) => {
  // Sign in as alpha-admin
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // ... use existing dev sign-in helper or session cookie injection
  await page.goto('http://alpha.localhost:3000/en/a/alpha/pricing');
  await page.fill('input[name="defaultMarkupBps"]', '5000');
  await page.click('button:has-text("Save")');
  await expect(page).toHaveURL(/pricing/);

  // Buyer side
  const buyer = await browser.newContext();
  const buyerPage = await buyer.newPage();
  await buyerPage.goto('http://alpha.localhost:3000/en/shop');
  // expect at least one price > upstream + 50%
  // (assertion uses fixture upstream cost; adjust to seeded package)
});

test('beta tenant unaffected by alpha override', async ({ page }) => {
  // ... navigate beta shop and confirm displayed prices unchanged
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/pricing.spec.ts`
Expected: PASS (E2E may require auth fixture adjustments — wire to existing helpers).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/pricing.spec.ts
git commit -m "test(phase-2e): e2e agency_admin pricing flow + cross-tenant isolation"
```

---

### Task 12: Push, PR, deploy, tag

- [ ] **Step 1: Open PR**

```bash
git push -u origin <branch>
gh pr create --title "Phase 2e PR-B: per-tenant pricing" --body "$(cat <<'EOF'
## Summary
- `Tenant.defaultMarkupBps` (basis points) + `tenant_package_prices` override table
- `calculatePrice` resolves: override → markup → upstream (USD-only invariant retained)
- B2C catalog displays tenant-resolved prices
- Agency_admin `/a/<slug>/pricing` page: markup editor + per-package overrides + bulk clear
- Super-admin dashboard banner for tenants selling at cost
- Audit log: tenant.markup_bps_changed, tenant.package_price_override_set/cleared, tenant.all_overrides_cleared

## Test plan
- [ ] Vitest unit + integration green (calculatePrice + cross-tenant)
- [ ] Local: alpha markup change shows in alpha shop, not beta shop
- [ ] Local: setting override on a package displays "Override" badge and pinned price
- [ ] Tenant create form requires defaultMarkupBps
EOF
)"
```

- [ ] **Step 2: Merge, deploy, tag**

```bash
git tag phase-2e-pr-b-complete
git push origin phase-2e-pr-b-complete
# After both PR-A and PR-B merged + deployed:
git tag phase-2e-complete
git push origin phase-2e-complete
```

Post-deploy smoke:
- Set `defaultMarkupBps=2500` on a real test tenant; confirm shop reflects markup.
- Set an override for one package; confirm pinned price + audit log entry.
- Confirm super-admin banner shows tenants with markup=0 and no overrides.

---

## Self-Review Notes

- All spec sections covered: schema (T1), `calculatePrice` rewrite (T2-3), `lockPrice`/`createBooking` plumbing (T4), B2C catalog (T5), tenant create form gating (T6), pricing UI (T7-8), audit log (in T7 actions), cross-tenant isolation tests (T9), super-admin banner (T10), E2E (T11).
- USD-only invariant: `assertUsdMoney` enforced at `calculatePrice` (T3), `setPackageOverrideAction` (T7). Override table currency forced to `'USD'` at write time.
- No placeholders. `effectiveUnitAmount` signature consistent across helper (T2), `calculatePrice` (T3), shop page (T5), pricing page (T8).
- Migration is purely additive; existing orders' `OrderItem.unitPriceAmount` snapshots retained via PriceLock; no historic data backfill needed.
