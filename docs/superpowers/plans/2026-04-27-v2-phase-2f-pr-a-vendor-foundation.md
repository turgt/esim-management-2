# V2 Phase 2f PR-A — Vendor Foundation + Referral + Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the V2 Vendor model, RBAC, referral capture flow, commission attribution, and admin CRUD UIs (platform-admin + agency-admin), with full TDD coverage.

**Architecture:** Tenant-scoped `Vendor` + M2M `VendorManager` join. `?ref=CODE` middleware sets a `.v2.datapatch.net`-scoped HttpOnly cookie; Auth.js v5 `events.createUser` consumes the cookie at signup and writes `User.referredByVendorId`. `createBooking` snapshots `commissionBpsSnapshot` onto the Order. Pure helpers `computeCommissionForOrder` and `requireVendorRoleOnVendor` are tested in isolation. Server actions are guarded with the existing `requireAuthenticatedUser` / `isPlatformRole` / `getMembershipRole` family from `src/server/rbac/roles.ts`.

**Tech Stack:** Next.js 16 (app router, standalone), Auth.js v5 beta, Prisma 5, PostgreSQL 16, next-intl, Zod, Vitest, Playwright.

**Spec:** `/Users/turgt/Desktop/CODES/esim-management-2/docs/superpowers/specs/2026-04-27-v2-phase-2f-vendor-port-design.md`

**Repo:** `datapatch-v2` (https://github.com/turgt/datapatch-v2)

---

## File Structure

**New files:**
- `prisma/schema.prisma` — additions (modify)
- `prisma/migrations/<timestamp>_phase_2f_vendor_port/migration.sql` — generated
- `src/server/lib/commission.ts` — `computeCommissionForOrder` pure helper
- `src/server/lib/commission.test.ts` — unit tests
- `src/server/rbac/vendor.ts` — `requireVendorRoleOnVendor`
- `src/server/rbac/vendor.test.ts`
- `src/server/referral/cookie.ts` — sanitize + cookie name + helpers
- `src/server/referral/cookie.test.ts`
- `src/server/auth/onCreateUser.ts` — consume cookie, write attribution
- `src/server/auth/onCreateUser.test.ts`
- `src/server/domain/vendors/createVendor.ts` + `updateVendor.ts` + `deleteVendor.ts` + `toggleVendorActive.ts` + `addManager.ts` + `removeManager.ts` (each with `.test.ts`)
- `src/server/domain/vendors/genCode.ts` — 8-char hex code generator
- `src/server/queries/vendor-list.ts` — list + search + pagination
- `src/server/queries/vendor-detail.ts` — single vendor + stats
- `app/[locale]/(admin)/admin/vendors/page.tsx`
- `app/[locale]/(admin)/admin/vendors/new/page.tsx`
- `app/[locale]/(admin)/admin/vendors/[vendorId]/page.tsx`
- `app/[locale]/(admin)/admin/vendors/[vendorId]/edit/page.tsx`
- `app/[locale]/(admin)/admin/vendors/actions.ts`
- `app/[locale]/(agency)/a/[agencySlug]/vendors/page.tsx`
- `app/[locale]/(agency)/a/[agencySlug]/vendors/new/page.tsx`
- `app/[locale]/(agency)/a/[agencySlug]/vendors/[vendorId]/page.tsx`
- `app/[locale]/(agency)/a/[agencySlug]/vendors/[vendorId]/edit/page.tsx`
- `app/[locale]/(agency)/a/[agencySlug]/vendors/actions.ts`
- `src/components/vendors/VendorForm.tsx`
- `src/components/vendors/VendorList.tsx`
- `src/components/vendors/VendorDetail.tsx`
- `src/components/vendors/ManagerList.tsx`
- `e2e/vendor-referral.spec.ts`

**Modified files:**
- `prisma/schema.prisma` — add Vendor, VendorManager, User.*, Order.*, Role enum value
- `middleware.ts` — wire `?ref=` cookie set + strip + 302 (non-API paths only)
- `src/auth.ts` — wire `events.createUser`
- `src/server/domain/orders/createBooking.ts` — extend with vendor attribution
- `src/server/audit/eventKeys.ts` (or equivalent constants file) — add `vendor.*` keys
- `messages/en.json`, `messages/tr.json` — admin UI strings under `admin.vendors.*` and `agency.vendors.*`

---

## Task 1: Branch + worktree setup

**Files:** none

- [ ] **Step 1: Create the worktree branch off main**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
git fetch origin
git checkout main
git pull --ff-only origin main
git worktree add -b feature/phase-2f-pr-a-vendor-foundation ../datapatch-v2-pr-a main
cd ../datapatch-v2-pr-a
```

- [ ] **Step 2: Symlink node_modules and .env from main checkout**

```bash
ln -s /Users/turgt/Desktop/CODES/datapatch-v2/node_modules node_modules
ln -s /Users/turgt/Desktop/CODES/datapatch-v2/.env .env
```

- [ ] **Step 3: Verify dev DB connection and tests run green on main**

```bash
npm run typecheck
npm run lint
npm test -- --run
```

Expected: all pass (no Phase 2f code yet).

---

## Task 2: Prisma schema — Vendor + VendorManager models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `vendor_manager` to the Role enum**

Locate the `enum Role { ... }` block. Add `vendor_manager` between `agency_admin` and `platform_staff` to keep the enum ordered by privilege:

```prisma
enum Role {
  customer
  agency_staff
  agency_admin
  vendor_manager
  platform_staff
  platform_admin
}
```

- [ ] **Step 2: Add `Vendor` and `VendorManager` models at the end of the file**

```prisma
model Vendor {
  id             String          @id @default(cuid())
  tenantId       String
  tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  name           String
  code           String          @unique
  commissionBps  Int             @default(0)
  isActive       Boolean         @default(true)
  contactInfo    String?
  notes          String?

  managers       VendorManager[]
  referredUsers  User[]          @relation("VendorReferredUsers")
  referredOrders Order[]         @relation("VendorReferredOrders")

  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  @@index([tenantId])
  @@index([code])
  @@map("vendors")
}

model VendorManager {
  vendorId  String
  userId    String
  vendor    Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([vendorId, userId])
  @@index([userId])
  @@map("vendor_managers")
}
```

- [ ] **Step 3: Add the inverse relation on `Tenant`**

Locate `model Tenant { ... }` and add inside the model body:

```prisma
  vendors        Vendor[]
```

- [ ] **Step 4: Add the new fields and inverse relations on `User`**

Locate `model User { ... }` and add:

```prisma
  referredByVendorId String?
  referredByVendor   Vendor?         @relation("VendorReferredUsers", fields: [referredByVendorId], references: [id], onDelete: SetNull)
  referredAt         DateTime?
  vendorManagerOf    VendorManager[]

  @@index([referredByVendorId])
```

(The `@@index` line goes alongside the model's other index declarations.)

- [ ] **Step 5: Add the new fields and inverse relations on `Order`**

Locate `model Order { ... }` and add:

```prisma
  referredByVendorId    String?
  referredByVendor      Vendor?  @relation("VendorReferredOrders", fields: [referredByVendorId], references: [id], onDelete: SetNull)
  commissionBpsSnapshot Int?

  @@index([referredByVendorId])
```

- [ ] **Step 6: Format and validate the schema**

```bash
npx prisma format
npx prisma validate
```

Expected: both succeed with no errors.

- [ ] **Step 7: Generate the Prisma client (sanity check before migration)**

```bash
npx prisma generate
```

Expected: types regenerate with no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(2f): add Vendor, VendorManager schema + Role.vendor_manager"
```

---

## Task 3: Generate and apply migration

**Files:**
- Create: `prisma/migrations/<timestamp>_phase_2f_vendor_port/migration.sql`

- [ ] **Step 1: Create the migration**

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-) \
  npx prisma migrate dev --name phase_2f_vendor_port --create-only
```

Expected: a new directory `prisma/migrations/<timestamp>_phase_2f_vendor_port/` with `migration.sql` containing `CREATE TABLE "vendors"`, `CREATE TABLE "vendor_managers"`, `ALTER TABLE "users" ADD COLUMN`, `ALTER TABLE "orders" ADD COLUMN`, and `ALTER TYPE "Role" ADD VALUE`.

- [ ] **Step 2: Inspect the generated SQL**

```bash
cat prisma/migrations/*_phase_2f_vendor_port/migration.sql
```

Verify:
- `ALTER TYPE "Role" ADD VALUE 'vendor_manager';` is present (Postgres requires this in its own statement; Prisma should emit it, possibly inside a separate `BEGIN; ... COMMIT;` block).
- `CREATE TABLE "vendors"` has the `tenantId` FK with `ON DELETE RESTRICT`.
- `CREATE TABLE "vendor_managers"` has FKs with `ON DELETE CASCADE`.
- `users.referredByVendorId` and `orders.referredByVendorId` FKs with `ON DELETE SET NULL`.

- [ ] **Step 3: Apply the migration to dev DB**

```bash
DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-) npx prisma migrate dev
```

Expected: "Database schema is in sync".

- [ ] **Step 4: Apply the migration to test DB**

```bash
DATABASE_URL=$(grep '^DATABASE_URL_TEST=' .env | cut -d= -f2-) npx prisma migrate deploy
```

Expected: applied cleanly.

- [ ] **Step 5: Smoke-check via Prisma Studio (optional)**

```bash
npx prisma studio
```

Click into `vendors` and `vendor_managers` to confirm the tables exist with empty rows.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/
git commit -m "feat(2f): migration for Vendor + VendorManager + Role.vendor_manager"
```

---

## Task 4: `computeCommissionForOrder` pure helper

**Files:**
- Create: `src/server/lib/commission.ts`
- Test: `src/server/lib/commission.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/lib/commission.test.ts
import { describe, expect, it } from 'vitest';
import { computeCommissionForOrder } from './commission';

describe('computeCommissionForOrder', () => {
  it('returns 0 when payment is not succeeded', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'pending' },
        refunds: [],
        commissionBpsSnapshot: 500,
      }),
    ).toBe(0n);
  });

  it('returns 0 when commissionBpsSnapshot is null', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [],
        commissionBpsSnapshot: null,
      }),
    ).toBe(0n);
  });

  it('computes commission on full paid amount when no refunds', () => {
    // $100 paid (10000 cents), 5% bps=500 → 500 cents
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [],
        commissionBpsSnapshot: 500,
      }),
    ).toBe(500n);
  });

  it('subtracts succeeded refunds before applying bps', () => {
    // $100 paid, $30 refunded, 5% → floor(7000 * 500 / 10000) = 350
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [{ amount: 3000n, status: 'succeeded' }],
        commissionBpsSnapshot: 500,
      }),
    ).toBe(350n);
  });

  it('ignores non-succeeded refunds', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [
          { amount: 3000n, status: 'pending' },
          { amount: 1000n, status: 'failed' },
        ],
        commissionBpsSnapshot: 500,
      }),
    ).toBe(500n);
  });

  it('returns 0 when net is zero after refunds', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [{ amount: 10000n, status: 'succeeded' }],
        commissionBpsSnapshot: 500,
      }),
    ).toBe(0n);
  });

  it('floors fractional cents (BigInt division)', () => {
    // $1.23 paid, 1% bps=100 → floor(123 * 100 / 10000) = 1 (1.23 cents → 1)
    expect(
      computeCommissionForOrder({
        payment: { amount: 123n, status: 'succeeded' },
        refunds: [],
        commissionBpsSnapshot: 100,
      }),
    ).toBe(1n);
  });

  it('handles 100% commission (10000 bps)', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [],
        commissionBpsSnapshot: 10000,
      }),
    ).toBe(10000n);
  });

  it('handles 0% commission (0 bps)', () => {
    expect(
      computeCommissionForOrder({
        payment: { amount: 10000n, status: 'succeeded' },
        refunds: [],
        commissionBpsSnapshot: 0,
      }),
    ).toBe(0n);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/server/lib/commission.test.ts
```

Expected: FAIL — module not found / function not defined.

- [ ] **Step 3: Implement the helper**

```ts
// src/server/lib/commission.ts
/**
 * Computes commission (in USD cents) for a single order, using the bps value
 * snapshotted on the Order at booking time. Returns BigInt (USD cents).
 *
 * Net = paid − succeeded refunds. Floor division.
 */
export interface CommissionInput {
  payment: { amount: bigint; status: string };
  refunds: { amount: bigint; status: string }[];
  commissionBpsSnapshot: number | null;
}

export function computeCommissionForOrder(input: CommissionInput): bigint {
  if (input.payment.status !== 'succeeded') return 0n;
  if (input.commissionBpsSnapshot == null) return 0n;
  const refunded = input.refunds
    .filter((r) => r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amount, 0n);
  const net = input.payment.amount - refunded;
  if (net <= 0n) return 0n;
  return (net * BigInt(input.commissionBpsSnapshot)) / 10000n;
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npx vitest run src/server/lib/commission.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/commission.ts src/server/lib/commission.test.ts
git commit -m "feat(2f): computeCommissionForOrder pure helper + tests"
```

---

## Task 5: `requireVendorRoleOnVendor` RBAC helper

**Files:**
- Create: `src/server/rbac/vendor.ts`
- Test: `src/server/rbac/vendor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/rbac/vendor.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { requireVendorRoleOnVendor } from './vendor';
import * as roles from './roles';

describe('requireVendorRoleOnVendor', () => {
  let tenantA: { id: string };
  let tenantB: { id: string };
  let vendorA: { id: string };
  let platformAdminUser: { id: string; email: string };
  let agencyAdminTenantA: { id: string; email: string };
  let agencyAdminTenantB: { id: string; email: string };
  let managerOfA: { id: string; email: string };
  let randomCustomer: { id: string; email: string };

  beforeEach(async () => {
    // Seed two tenants, one vendor on tenant A, and four users with various roles.
    tenantA = await prisma.tenant.create({
      data: { slug: `t-a-${Date.now()}`, name: 'A', defaultMarkupBps: 0 },
    });
    tenantB = await prisma.tenant.create({
      data: { slug: `t-b-${Date.now()}`, name: 'B', defaultMarkupBps: 0 },
    });
    vendorA = await prisma.vendor.create({
      data: { tenantId: tenantA.id, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 500 },
    });
    platformAdminUser = await prisma.user.create({
      data: { email: `pa-${Date.now()}@x.com` },
    });
    await prisma.userTenantMembership.create({
      data: { userId: platformAdminUser.id, tenantId: tenantA.id, role: 'platform_admin' },
    });
    agencyAdminTenantA = await prisma.user.create({
      data: { email: `aaa-${Date.now()}@x.com` },
    });
    await prisma.userTenantMembership.create({
      data: { userId: agencyAdminTenantA.id, tenantId: tenantA.id, role: 'agency_admin' },
    });
    agencyAdminTenantB = await prisma.user.create({
      data: { email: `aab-${Date.now()}@x.com` },
    });
    await prisma.userTenantMembership.create({
      data: { userId: agencyAdminTenantB.id, tenantId: tenantB.id, role: 'agency_admin' },
    });
    managerOfA = await prisma.user.create({
      data: { email: `m-${Date.now()}@x.com` },
    });
    await prisma.vendorManager.create({
      data: { vendorId: vendorA.id, userId: managerOfA.id },
    });
    randomCustomer = await prisma.user.create({
      data: { email: `c-${Date.now()}@x.com` },
    });
  });

  afterEach(async () => {
    await prisma.vendorManager.deleteMany({ where: { vendor: { tenantId: { in: [tenantA.id, tenantB.id] } } } });
    await prisma.vendor.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.userTenantMembership.deleteMany({ where: { tenantId: { in: [tenantA.id, tenantB.id] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [platformAdminUser.id, agencyAdminTenantA.id, agencyAdminTenantB.id, managerOfA.id, randomCustomer.id] } },
    });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  });

  function mockAuth(user: { id: string; email: string }) {
    vi.spyOn(roles, 'requireAuthenticatedUser').mockResolvedValue({ id: user.id, email: user.email });
  }

  it('allows platform_admin from any tenant', async () => {
    mockAuth(platformAdminUser);
    const r = await requireVendorRoleOnVendor(vendorA.id);
    expect(r.vendor.id).toBe(vendorA.id);
  });

  it('allows agency_admin on the vendor's tenant', async () => {
    mockAuth(agencyAdminTenantA);
    const r = await requireVendorRoleOnVendor(vendorA.id);
    expect(r.vendor.id).toBe(vendorA.id);
  });

  it('rejects agency_admin on a different tenant', async () => {
    mockAuth(agencyAdminTenantB);
    await expect(requireVendorRoleOnVendor(vendorA.id)).rejects.toThrow(/Forbidden/);
  });

  it('allows VendorManager row holder when allowManagers=true', async () => {
    mockAuth(managerOfA);
    const r = await requireVendorRoleOnVendor(vendorA.id);
    expect(r.vendor.id).toBe(vendorA.id);
  });

  it('rejects VendorManager when allowManagers=false (mutation paths)', async () => {
    mockAuth(managerOfA);
    await expect(
      requireVendorRoleOnVendor(vendorA.id, { allowManagers: false }),
    ).rejects.toThrow(/Forbidden/);
  });

  it('rejects random customer with no relation', async () => {
    mockAuth(randomCustomer);
    await expect(requireVendorRoleOnVendor(vendorA.id)).rejects.toThrow(/Forbidden/);
  });

  it('throws NotFound for missing vendor', async () => {
    mockAuth(platformAdminUser);
    await expect(requireVendorRoleOnVendor('does-not-exist')).rejects.toThrow(/NotFound/);
  });
});
```

(Note: `vi` is from `vitest` — add `import { vi } from 'vitest';` to the imports.)

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/server/rbac/vendor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/server/rbac/vendor.ts
import type { Vendor } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { requireAuthenticatedUser, getMembershipRole } from './roles';

export interface VendorRoleResult {
  user: { id: string; email: string };
  vendor: Vendor;
}

export async function requireVendorRoleOnVendor(
  vendorId: string,
  { allowManagers = true }: { allowManagers?: boolean } = {},
): Promise<VendorRoleResult> {
  const user = await requireAuthenticatedUser();

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { managers: { where: { userId: user.id }, select: { userId: true } } },
  });
  if (!vendor) throw new Error('NotFound: vendor not found.');

  // 1. Platform roles (cross-tenant authority)
  const anyPlatform = await prisma.userTenantMembership.findFirst({
    where: { userId: user.id, role: { in: ['platform_admin', 'platform_staff'] } },
    select: { role: true },
  });
  if (anyPlatform) {
    const { managers: _ignored, ...rest } = vendor;
    return { user, vendor: rest as Vendor };
  }

  // 2. agency_admin on the vendor's tenant
  const role = await getMembershipRole(user.id, vendor.tenantId);
  if (role === 'agency_admin') {
    const { managers: _ignored, ...rest } = vendor;
    return { user, vendor: rest as Vendor };
  }

  // 3. VendorManager row (gate for vendor self-service)
  if (allowManagers && vendor.managers.length > 0) {
    const { managers: _ignored, ...rest } = vendor;
    return { user, vendor: rest as Vendor };
  }

  throw new Error('Forbidden: vendor role required.');
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run src/server/rbac/vendor.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/rbac/vendor.ts src/server/rbac/vendor.test.ts
git commit -m "feat(2f): requireVendorRoleOnVendor helper + tests"
```

---

## Task 6: Referral cookie sanitize + helpers

**Files:**
- Create: `src/server/referral/cookie.ts`
- Test: `src/server/referral/cookie.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/referral/cookie.test.ts
import { describe, expect, it } from 'vitest';
import { isValidVendorCode, REF_COOKIE_NAME, refCookieOptions } from './cookie';

describe('isValidVendorCode', () => {
  it('accepts an 8-char lowercase hex string', () => {
    expect(isValidVendorCode('abcdef01')).toBe(true);
    expect(isValidVendorCode('00000000')).toBe(true);
    expect(isValidVendorCode('ffffffff')).toBe(true);
  });

  it('rejects uppercase hex', () => {
    expect(isValidVendorCode('ABCDEF01')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isValidVendorCode('abcdefgh')).toBe(false);
  });

  it('rejects strings of wrong length', () => {
    expect(isValidVendorCode('abc')).toBe(false);
    expect(isValidVendorCode('abcdef012')).toBe(false);
    expect(isValidVendorCode('')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidVendorCode(null)).toBe(false);
    expect(isValidVendorCode(undefined)).toBe(false);
  });
});

describe('refCookieOptions', () => {
  it('returns prod options with Domain and Secure when host is v2.datapatch.net', () => {
    const opts = refCookieOptions('alpha.v2.datapatch.net');
    expect(opts.domain).toBe('.v2.datapatch.net');
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/');
    expect(opts.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it('returns dev options without Domain/Secure for localhost', () => {
    const opts = refCookieOptions('alpha.localhost:3000');
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it('returns dev options for plain localhost', () => {
    const opts = refCookieOptions('localhost:3000');
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });
});

describe('REF_COOKIE_NAME', () => {
  it('exports the cookie name constant', () => {
    expect(REF_COOKIE_NAME).toBe('dp_ref');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/server/referral/cookie.test.ts
```

- [ ] **Step 3: Implement the helpers**

```ts
// src/server/referral/cookie.ts

export const REF_COOKIE_NAME = 'dp_ref';
export const REF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const VENDOR_CODE_RE = /^[a-f0-9]{8}$/;

export function isValidVendorCode(value: string | null | undefined): value is string {
  if (!value) return false;
  return VENDOR_CODE_RE.test(value);
}

export interface RefCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
  domain?: string;
}

/**
 * Cookie options scoped to `.v2.datapatch.net` in production so the cookie
 * is visible across all tenant subdomains. In dev, the cookie is host-only
 * (no Domain attribute) — cross-subdomain referrals don't work in dev.
 */
export function refCookieOptions(host: string): RefCookieOptions {
  const isDev = host.endsWith('.localhost') || host === 'localhost' || host.startsWith('localhost:');
  if (isDev) {
    return {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    };
  }
  // Strip port if present, then peel everything except the apex domain.
  // For host=alpha.v2.datapatch.net, Domain=.v2.datapatch.net.
  const noPort = host.split(':')[0];
  const apex = noPort.split('.').slice(-3).join('.'); // v2.datapatch.net
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    domain: `.${apex}`,
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run src/server/referral/cookie.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/referral/cookie.ts src/server/referral/cookie.test.ts
git commit -m "feat(2f): referral cookie helpers (sanitize + options)"
```

---

## Task 7: Wire `?ref=` handling into middleware

**Files:**
- Modify: `middleware.ts`

- [ ] **Step 1: Read the current middleware to find the right insertion point**

```bash
sed -n '1,90p' middleware.ts
```

The handler runs after subdomain extraction. We want `?ref=` handling to run only on tenant subdomains (sub is set, not www/admin), and only on non-API paths.

- [ ] **Step 2: Add the ref-handling block before the final `return res;` for the tenant branch**

Locate the section starting with `// Tenant subdomain.` near the bottom. After `res.headers.set('x-tenant-slug', tenant.slug);` and before `return res;`, insert:

```ts
  // Phase 2f — capture vendor referral code from `?ref=`.
  const refRaw = req.nextUrl.searchParams.get('ref');
  if (refRaw && !pathname.startsWith('/api/')) {
    const isValid = /^[a-f0-9]{8}$/.test(refRaw);
    const url = new URL(req.url);
    url.searchParams.delete('ref');
    const redirect = NextResponse.redirect(url, 302);
    // Carry forward tenant headers on the redirect response.
    redirect.headers.set('x-tenant-id', tenant.id);
    redirect.headers.set('x-tenant-slug', tenant.slug);
    if (isValid) {
      const opts = refCookieOptions(host);
      redirect.cookies.set('dp_ref', refRaw, {
        httpOnly: opts.httpOnly,
        secure: opts.secure,
        sameSite: opts.sameSite,
        path: opts.path,
        maxAge: opts.maxAge,
        ...(opts.domain ? { domain: opts.domain } : {}),
      });
    }
    return redirect;
  }
```

- [ ] **Step 3: Add the import at the top of middleware.ts**

After the existing imports, add:

```ts
import { refCookieOptions } from '@/src/server/referral/cookie';
```

- [ ] **Step 4: Add a smoke test against a running dev server**

In a separate terminal:

```bash
npm run dev
```

Then in another:

```bash
curl -i -L --resolve alpha.localhost:3000:127.0.0.1 \
  'http://alpha.localhost:3000/?ref=abcdef01' 2>&1 | head -40
```

Expected: HTTP/1.1 302 with `Location:` header to the same URL minus `?ref=`. `Set-Cookie: dp_ref=abcdef01; Path=/; HttpOnly; SameSite=Lax`.

(Replace `alpha` with a real seeded tenant slug if `alpha` doesn't exist locally — `platform` is a safe fallback.)

- [ ] **Step 5: Verify invalid ref produces 302 with NO cookie**

```bash
curl -i --resolve platform.localhost:3000:127.0.0.1 \
  'http://platform.localhost:3000/?ref=BADBADBA' 2>&1 | head -20
```

Expected: 302 with `Location:` to URL minus `?ref=`. NO `Set-Cookie: dp_ref=`.

- [ ] **Step 6: Verify `/api/*` paths skip ref handling**

```bash
curl -i --resolve platform.localhost:3000:127.0.0.1 \
  'http://platform.localhost:3000/api/health?ref=abcdef01' 2>&1 | head -10
```

Expected: 200 OK (no redirect, no cookie set).

- [ ] **Step 7: Commit**

```bash
git add middleware.ts
git commit -m "feat(2f): middleware sets dp_ref cookie + strips ?ref= on tenant subdomains"
```

---

## Task 8: Auth.js `events.createUser` — consume cookie + write attribution

**Files:**
- Create: `src/server/auth/onCreateUser.ts`
- Test: `src/server/auth/onCreateUser.test.ts`
- Modify: `src/auth.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/auth/onCreateUser.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { onCreateUser } from './onCreateUser';
import { prisma } from '@/src/lib/db';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
    set: (name: string, value: string) => cookieStore.set(name, value),
  }),
  headers: async () => ({
    get: (name: string) => (mockHeaders[name] ?? null),
  }),
}));

let mockHeaders: Record<string, string | undefined> = {};

describe('onCreateUser', () => {
  let tenant: { id: string };
  let vendor: { id: string };
  let inactiveVendor: { id: string };
  let otherTenantVendor: { id: string };
  let user: { id: string };

  beforeEach(async () => {
    cookieStore.clear();
    mockHeaders = {};
    tenant = await prisma.tenant.create({
      data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 },
    });
    const otherTenant = await prisma.tenant.create({
      data: { slug: `o-${Date.now()}`, name: 'O', defaultMarkupBps: 0 },
    });
    vendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'V', code: 'aaaaaaaa', commissionBps: 500 },
    });
    inactiveVendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'I', code: 'bbbbbbbb', commissionBps: 500, isActive: false },
    });
    otherTenantVendor = await prisma.vendor.create({
      data: { tenantId: otherTenant.id, name: 'X', code: 'cccccccc', commissionBps: 500 },
    });
    user = await prisma.user.create({ data: { email: `u-${Date.now()}@x.com` } });
  });

  afterEach(async () => {
    await prisma.vendor.deleteMany({ where: { id: { in: [vendor.id, inactiveVendor.id, otherTenantVendor.id] } } });
    await prisma.tenant.deleteMany({ where: { id: tenant.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it('does nothing when no cookie is set', async () => {
    mockHeaders = { 'x-tenant-id': tenant.id };
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBeNull();
  });

  it('does nothing when cookie has invalid format', async () => {
    cookieStore.set('dp_ref', 'BAD');
    mockHeaders = { 'x-tenant-id': tenant.id };
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBeNull();
  });

  it('does nothing when x-tenant-id header is missing (admin/www signup)', async () => {
    cookieStore.set('dp_ref', vendor.code);
    mockHeaders = {};
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBeNull();
  });

  it('does nothing when vendor is in a different tenant', async () => {
    cookieStore.set('dp_ref', otherTenantVendor.code);
    mockHeaders = { 'x-tenant-id': tenant.id };
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBeNull();
  });

  it('does nothing when vendor is inactive', async () => {
    cookieStore.set('dp_ref', inactiveVendor.code);
    mockHeaders = { 'x-tenant-id': tenant.id };
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBeNull();
  });

  it('writes attribution and clears cookie on successful match', async () => {
    cookieStore.set('dp_ref', vendor.code);
    mockHeaders = { 'x-tenant-id': tenant.id };
    await onCreateUser(user.id);
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.referredByVendorId).toBe(vendor.id);
    expect(u?.referredAt).toBeInstanceOf(Date);
    expect(cookieStore.get('dp_ref')).toBe(''); // cleared
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/server/auth/onCreateUser.test.ts
```

- [ ] **Step 3: Implement onCreateUser**

```ts
// src/server/auth/onCreateUser.ts
import { cookies, headers } from 'next/headers';
import { prisma } from '@/src/lib/db';
import { isValidVendorCode, REF_COOKIE_NAME } from '@/src/server/referral/cookie';

/**
 * Wired into Auth.js v5 `events.createUser`. Reads the `dp_ref` cookie set by
 * the tenant-subdomain middleware, looks up an active vendor in the same
 * tenant, and writes attribution on the new user. Cross-tenant referrals are
 * silently dropped.
 */
export async function onCreateUser(userId: string): Promise<void> {
  const ref = (await cookies()).get(REF_COOKIE_NAME)?.value;
  if (!isValidVendorCode(ref)) return;

  const tenantId = (await headers()).get('x-tenant-id');
  if (!tenantId) return;

  const vendor = await prisma.vendor.findFirst({
    where: { code: ref, tenantId, isActive: true },
    select: { id: true },
  });

  if (vendor) {
    await prisma.user.update({
      where: { id: userId },
      data: { referredByVendorId: vendor.id, referredAt: new Date() },
    });
  }

  // Clear cookie either way (don't leak on signup completion).
  (await cookies()).set(REF_COOKIE_NAME, '', { maxAge: 0, path: '/' });
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx vitest run src/server/auth/onCreateUser.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Wire `events.createUser` into Auth.js config**

Open `src/auth.ts`. Locate the `NextAuth({ ... })` call block. After the `callbacks: { ... }` block (and before the closing `})`), add:

```ts
  events: {
    createUser: async ({ user }) => {
      const { onCreateUser } = await import('@/src/server/auth/onCreateUser');
      if (user.id) await onCreateUser(user.id);
    },
  },
```

(Dynamic import keeps the auth config module load-time light; `onCreateUser` pulls Prisma + `next/headers` which Auth.js doesn't need at module init.)

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth/onCreateUser.ts src/server/auth/onCreateUser.test.ts src/auth.ts
git commit -m "feat(2f): Auth.js events.createUser consumes dp_ref cookie + attributes signup"
```

---

## Task 9: Extend `createBooking` with vendor attribution

**Files:**
- Modify: `src/server/domain/orders/createBooking.ts`
- Test: `src/server/domain/orders/createBooking.test.ts` (extend)

- [ ] **Step 1: Read the current createBooking flow**

```bash
sed -n '80,250p' src/server/domain/orders/createBooking.ts
```

Find where the Order is created (`prisma.order.create({...})` or the equivalent inside the orchestrator). The new attribution fields need to be set there.

- [ ] **Step 2: Add a unit test verifying vendor attribution**

Append to `src/server/domain/orders/createBooking.test.ts`:

```ts
describe('createBooking — vendor attribution (Phase 2f)', () => {
  it('snapshots commissionBpsSnapshot when user is referred by an active same-tenant vendor', async () => {
    const tenant = await seedTenant();
    const pkg = await seedActivePackage(tenant.id);
    const vendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'V', code: 'vatest01', commissionBps: 750 },
    });
    const referredUser = await prisma.user.create({
      data: { email: `r-${Date.now()}@x.com`, referredByVendorId: vendor.id, referredAt: new Date() },
    });

    const result = await createBooking({
      tenantId: tenant.id,
      packageId: pkg.id,
      quantity: 1,
      traveler: { email: referredUser.email, name: 'R' },
      paymentMode: PaymentMode.SELF_PAY,
      locale: 'en',
    });

    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order?.referredByVendorId).toBe(vendor.id);
    expect(order?.commissionBpsSnapshot).toBe(750);
  });

  it('does not snapshot when vendor is in a different tenant (cross-tenant guard)', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const pkg = await seedActivePackage(tenantA.id);
    const vendorB = await prisma.vendor.create({
      data: { tenantId: tenantB.id, name: 'V', code: 'vbtest01', commissionBps: 750 },
    });
    const referredUser = await prisma.user.create({
      data: { email: `r-${Date.now()}@x.com`, referredByVendorId: vendorB.id, referredAt: new Date() },
    });

    const result = await createBooking({
      tenantId: tenantA.id,
      packageId: pkg.id,
      quantity: 1,
      traveler: { email: referredUser.email, name: 'R' },
      paymentMode: PaymentMode.SELF_PAY,
      locale: 'en',
    });

    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order?.referredByVendorId).toBeNull();
    expect(order?.commissionBpsSnapshot).toBeNull();
  });

  it('does not snapshot when vendor is inactive', async () => {
    const tenant = await seedTenant();
    const pkg = await seedActivePackage(tenant.id);
    const vendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'V', code: 'vctest01', commissionBps: 750, isActive: false },
    });
    const referredUser = await prisma.user.create({
      data: { email: `r-${Date.now()}@x.com`, referredByVendorId: vendor.id, referredAt: new Date() },
    });

    const result = await createBooking({
      tenantId: tenant.id,
      packageId: pkg.id,
      quantity: 1,
      traveler: { email: referredUser.email, name: 'R' },
      paymentMode: PaymentMode.SELF_PAY,
      locale: 'en',
    });

    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    expect(order?.referredByVendorId).toBeNull();
    expect(order?.commissionBpsSnapshot).toBeNull();
  });
});
```

(Reuse the `seedTenant` / `seedActivePackage` helpers already in this test file. If they don't exist, model them after the existing seeding pattern.)

- [ ] **Step 3: Run — expect failure**

```bash
npx vitest run src/server/domain/orders/createBooking.test.ts
```

Expected: 3 new tests FAIL (referredByVendorId is null because attribution code isn't there yet).

- [ ] **Step 4: Add a `resolveVendorAttribution` helper inside or near createBooking**

```ts
// src/server/domain/orders/createBooking.ts (add near the top, below imports)

async function resolveVendorAttribution(
  tx: Prisma.TransactionClient,
  travelerEmail: string,
  orderTenantId: string,
): Promise<{ referredByVendorId: string | null; commissionBpsSnapshot: number | null }> {
  const userRow = await tx.user.findUnique({
    where: { email: travelerEmail },
    select: { referredByVendorId: true },
  });
  if (!userRow?.referredByVendorId) return { referredByVendorId: null, commissionBpsSnapshot: null };

  const vendor = await tx.vendor.findUnique({
    where: { id: userRow.referredByVendorId },
    select: { tenantId: true, isActive: true, commissionBps: true },
  });
  if (!vendor || !vendor.isActive || vendor.tenantId !== orderTenantId) {
    return { referredByVendorId: null, commissionBpsSnapshot: null };
  }
  return { referredByVendorId: userRow.referredByVendorId, commissionBpsSnapshot: vendor.commissionBps };
}
```

- [ ] **Step 5: Wire it into the Order creation path**

Find the `prisma.order.create({ data: { ... } })` call inside `createBooking`. Just before the call, fetch the attribution. Pass through whichever transaction client is in scope (`tx` or `prisma`).

```ts
const attribution = await resolveVendorAttribution(tx, input.traveler.email, input.tenantId);

const order = await tx.order.create({
  data: {
    // ... existing fields ...
    referredByVendorId: attribution.referredByVendorId,
    commissionBpsSnapshot: attribution.commissionBpsSnapshot,
  },
});
```

If the existing transaction client is named differently or `prisma` is used directly outside a tx, adapt the call to pass `prisma` as the first argument. The function signature accepts `Prisma.TransactionClient` which `PrismaClient` is structurally compatible with for these read methods.

- [ ] **Step 6: Run — expect pass**

```bash
npx vitest run src/server/domain/orders/createBooking.test.ts
```

Expected: all tests PASS, including the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add src/server/domain/orders/createBooking.ts src/server/domain/orders/createBooking.test.ts
git commit -m "feat(2f): createBooking snapshots vendor commission with cross-tenant guard"
```

---

## Task 10: Audit event keys

**Files:**
- Modify: `src/server/audit/events.ts` (or wherever AuditAction constants live — verify path)

- [ ] **Step 1: Locate the audit event constants file**

```bash
grep -rn "tenant.create\|order.create" src/server/audit/ 2>/dev/null | head
# OR
grep -rn "AuditAction\b" src/ 2>/dev/null | head
```

The constants typically live in a single file as a string-literal union or const object. Use that file.

- [ ] **Step 2: Add vendor event keys**

Insert these into the same constants list (alphabetical or grouped):

```ts
'vendor.create',
'vendor.update',
'vendor.delete',
'vendor.activate',
'vendor.deactivate',
'vendor.manager.add',
'vendor.manager.remove',
```

(If the constants are an enum or `as const` object, mirror that style.)

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/server/audit/events.ts
git commit -m "feat(2f): add vendor.* audit event keys"
```

---

## Task 11: 8-char hex code generator

**Files:**
- Create: `src/server/domain/vendors/genCode.ts`
- Test: `src/server/domain/vendors/genCode.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/domain/vendors/genCode.test.ts
import { describe, expect, it } from 'vitest';
import { generateVendorCode } from './genCode';

describe('generateVendorCode', () => {
  it('returns an 8-char lowercase hex string', () => {
    const code = generateVendorCode();
    expect(code).toMatch(/^[a-f0-9]{8}$/);
    expect(code).toHaveLength(8);
  });

  it('returns different codes on subsequent calls (statistically)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) codes.add(generateVendorCode());
    expect(codes.size).toBeGreaterThan(95); // collisions should be vanishingly rare
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
npx vitest run src/server/domain/vendors/genCode.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/server/domain/vendors/genCode.ts
import { randomBytes } from 'node:crypto';

/** 8-character lowercase hex string from 32 random bits. */
export function generateVendorCode(): string {
  return randomBytes(4).toString('hex');
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/vendors/genCode.ts src/server/domain/vendors/genCode.test.ts
git commit -m "feat(2f): vendor code generator (8-char hex)"
```

---

## Task 12: `createVendor` server-side action

**Files:**
- Create: `src/server/domain/vendors/createVendor.ts`
- Test: `src/server/domain/vendors/createVendor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/domain/vendors/createVendor.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { createVendor } from './createVendor';

describe('createVendor', () => {
  let tenant: { id: string };

  beforeEach(async () => {
    tenant = await prisma.tenant.create({
      data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 },
    });
  });

  afterEach(async () => {
    await prisma.vendor.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('creates a vendor with a generated 8-char hex code', async () => {
    const v = await createVendor({
      tenantId: tenant.id,
      name: 'Acme Vendor',
      commissionBps: 250,
      contactInfo: 'acme@example.com',
      notes: null,
    });
    expect(v.code).toMatch(/^[a-f0-9]{8}$/);
    expect(v.name).toBe('Acme Vendor');
    expect(v.commissionBps).toBe(250);
    expect(v.isActive).toBe(true);
  });

  it('rejects empty name', async () => {
    await expect(
      createVendor({
        tenantId: tenant.id,
        name: '   ',
        commissionBps: 0,
        contactInfo: null,
        notes: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects negative commissionBps', async () => {
    await expect(
      createVendor({
        tenantId: tenant.id,
        name: 'V',
        commissionBps: -1,
        contactInfo: null,
        notes: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects commissionBps above 10000', async () => {
    await expect(
      createVendor({
        tenantId: tenant.id,
        name: 'V',
        commissionBps: 10001,
        contactInfo: null,
        notes: null,
      }),
    ).rejects.toThrow();
  });

  it('rejects unknown tenantId', async () => {
    await expect(
      createVendor({
        tenantId: 'not-a-real-id',
        name: 'V',
        commissionBps: 0,
        contactInfo: null,
        notes: null,
      }),
    ).rejects.toThrow();
  });

  it('retries on code collision', async () => {
    // We can't easily force a collision without monkey-patching crypto, so
    // we just verify two calls produce two distinct vendors.
    const v1 = await createVendor({ tenantId: tenant.id, name: 'A', commissionBps: 0, contactInfo: null, notes: null });
    const v2 = await createVendor({ tenantId: tenant.id, name: 'B', commissionBps: 0, contactInfo: null, notes: null });
    expect(v1.code).not.toBe(v2.code);
  });
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement**

```ts
// src/server/domain/vendors/createVendor.ts
import { z } from 'zod';
import { prisma } from '@/src/lib/db';
import { generateVendorCode } from './genCode';

const Schema = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(1),
  commissionBps: z.number().int().min(0).max(10000),
  contactInfo: z.string().nullable(),
  notes: z.string().nullable(),
});

export type CreateVendorInput = z.input<typeof Schema>;

export async function createVendor(raw: CreateVendorInput) {
  const input = Schema.parse(raw);

  // Verify tenant exists (FK error is opaque otherwise).
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant not found: ${input.tenantId}`);

  // Retry up to 3 times on UNIQUE collision (vanishingly rare).
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateVendorCode();
    try {
      return await prisma.vendor.create({
        data: {
          tenantId: input.tenantId,
          name: input.name,
          code,
          commissionBps: input.commissionBps,
          contactInfo: input.contactInfo,
          notes: input.notes,
        },
      });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'P2002' && attempt < 2) continue; // unique violation, retry
      throw err;
    }
  }
  throw new Error('Failed to allocate unique vendor code after 3 attempts');
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/domain/vendors/createVendor.ts src/server/domain/vendors/createVendor.test.ts
git commit -m "feat(2f): createVendor domain action + tests"
```

---

## Task 13: `updateVendor` and `toggleVendorActive`

**Files:**
- Create: `src/server/domain/vendors/updateVendor.ts`
- Create: `src/server/domain/vendors/toggleVendorActive.ts`
- Tests: matching `.test.ts` files

- [ ] **Step 1: Write tests for `updateVendor`**

```ts
// src/server/domain/vendors/updateVendor.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { updateVendor } from './updateVendor';

describe('updateVendor', () => {
  let vendorId: string;

  beforeEach(async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    const v = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 0 },
    });
    vendorId = v.id;
  });

  afterEach(async () => {
    await prisma.vendor.findUnique({ where: { id: vendorId } }).then((v) => {
      if (v) return prisma.vendor.delete({ where: { id: vendorId } });
    });
  });

  it('updates editable fields', async () => {
    const v = await updateVendor(vendorId, {
      name: 'New Name',
      commissionBps: 500,
      contactInfo: 'a@b.com',
      notes: 'note',
    });
    expect(v.name).toBe('New Name');
    expect(v.commissionBps).toBe(500);
    expect(v.contactInfo).toBe('a@b.com');
    expect(v.notes).toBe('note');
  });

  it('does not allow updating the code', async () => {
    // updateVendor's input schema has no `code` field — TypeScript prevents it.
    // Verify the runtime DB code is unchanged after an update.
    const before = await prisma.vendor.findUnique({ where: { id: vendorId } });
    await updateVendor(vendorId, { name: 'X', commissionBps: 0, contactInfo: null, notes: null });
    const after = await prisma.vendor.findUnique({ where: { id: vendorId } });
    expect(after?.code).toBe(before?.code);
  });

  it('rejects unknown vendorId', async () => {
    await expect(
      updateVendor('not-real', { name: 'X', commissionBps: 0, contactInfo: null, notes: null }),
    ).rejects.toThrow();
  });

  it('does not allow updating tenantId', async () => {
    const otherTenant = await prisma.tenant.create({ data: { slug: `o-${Date.now()}`, name: 'O', defaultMarkupBps: 0 } });
    const before = await prisma.vendor.findUnique({ where: { id: vendorId } });
    await updateVendor(vendorId, { name: 'X', commissionBps: 0, contactInfo: null, notes: null });
    const after = await prisma.vendor.findUnique({ where: { id: vendorId } });
    expect(after?.tenantId).toBe(before?.tenantId);
    await prisma.tenant.delete({ where: { id: otherTenant.id } });
  });
});
```

- [ ] **Step 2: Implement `updateVendor`**

```ts
// src/server/domain/vendors/updateVendor.ts
import { z } from 'zod';
import { prisma } from '@/src/lib/db';

const Schema = z.object({
  name: z.string().trim().min(1),
  commissionBps: z.number().int().min(0).max(10000),
  contactInfo: z.string().nullable(),
  notes: z.string().nullable(),
});

export type UpdateVendorInput = z.input<typeof Schema>;

export async function updateVendor(vendorId: string, raw: UpdateVendorInput) {
  const input = Schema.parse(raw);
  return prisma.vendor.update({
    where: { id: vendorId },
    data: {
      name: input.name,
      commissionBps: input.commissionBps,
      contactInfo: input.contactInfo,
      notes: input.notes,
    },
  });
}
```

- [ ] **Step 3: Write tests for `toggleVendorActive`**

```ts
// src/server/domain/vendors/toggleVendorActive.test.ts
import { describe, expect, it } from 'vitest';
import { prisma } from '@/src/lib/db';
import { toggleVendorActive } from './toggleVendorActive';

describe('toggleVendorActive', () => {
  it('flips isActive', async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    const v = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 0, isActive: true },
    });
    const off = await toggleVendorActive(v.id);
    expect(off.isActive).toBe(false);
    const on = await toggleVendorActive(v.id);
    expect(on.isActive).toBe(true);
    await prisma.vendor.delete({ where: { id: v.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});
```

- [ ] **Step 4: Implement `toggleVendorActive`**

```ts
// src/server/domain/vendors/toggleVendorActive.ts
import { prisma } from '@/src/lib/db';

export async function toggleVendorActive(vendorId: string) {
  const current = await prisma.vendor.findUniqueOrThrow({
    where: { id: vendorId },
    select: { isActive: true },
  });
  return prisma.vendor.update({
    where: { id: vendorId },
    data: { isActive: !current.isActive },
  });
}
```

- [ ] **Step 5: Run all tests**

```bash
npx vitest run src/server/domain/vendors/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/domain/vendors/updateVendor.ts src/server/domain/vendors/updateVendor.test.ts \
        src/server/domain/vendors/toggleVendorActive.ts src/server/domain/vendors/toggleVendorActive.test.ts
git commit -m "feat(2f): updateVendor + toggleVendorActive domain actions + tests"
```

---

## Task 14: `deleteVendor`

**Files:**
- Create: `src/server/domain/vendors/deleteVendor.ts`
- Test: `src/server/domain/vendors/deleteVendor.test.ts`

- [ ] **Step 1: Write tests**

```ts
// src/server/domain/vendors/deleteVendor.test.ts
import { describe, expect, it } from 'vitest';
import { prisma } from '@/src/lib/db';
import { deleteVendor } from './deleteVendor';

describe('deleteVendor', () => {
  it('deletes the vendor and SetNull cascades to referred users / orders', async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    const v = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 500 },
    });
    const u = await prisma.user.create({
      data: { email: `u-${Date.now()}@x.com`, referredByVendorId: v.id, referredAt: new Date() },
    });

    await deleteVendor(v.id);

    expect(await prisma.vendor.findUnique({ where: { id: v.id } })).toBeNull();
    const userAfter = await prisma.user.findUnique({ where: { id: u.id } });
    expect(userAfter?.referredByVendorId).toBeNull(); // SetNull worked

    await prisma.user.delete({ where: { id: u.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/domain/vendors/deleteVendor.ts
import { prisma } from '@/src/lib/db';

export async function deleteVendor(vendorId: string): Promise<void> {
  // Cascades:
  // - VendorManager rows (Cascade)
  // - User.referredByVendorId (SetNull)
  // - Order.referredByVendorId (SetNull, snapshot bps stays)
  await prisma.vendor.delete({ where: { id: vendorId } });
}
```

- [ ] **Step 3: Run + commit**

```bash
npx vitest run src/server/domain/vendors/deleteVendor.test.ts
git add src/server/domain/vendors/deleteVendor.ts src/server/domain/vendors/deleteVendor.test.ts
git commit -m "feat(2f): deleteVendor domain action + cascade test"
```

---

## Task 15: `addManager` and `removeManager`

**Files:**
- Create: `src/server/domain/vendors/addManager.ts`
- Create: `src/server/domain/vendors/removeManager.ts`
- Tests: matching `.test.ts` files

- [ ] **Step 1: Tests for `addManager`**

```ts
// src/server/domain/vendors/addManager.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { addManager } from './addManager';

describe('addManager', () => {
  let tenant: { id: string };
  let vendor: { id: string };

  beforeEach(async () => {
    tenant = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    vendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'V', code: `${Date.now()}`.slice(-8), commissionBps: 0 },
    });
  });

  afterEach(async () => {
    await prisma.vendorManager.deleteMany({ where: { vendorId: vendor.id } });
    await prisma.userTenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'm-' } } });
    await prisma.vendor.delete({ where: { id: vendor.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('creates VendorManager row + new vendor_manager membership for a brand-new user', async () => {
    const user = await prisma.user.create({ data: { email: `m-1-${Date.now()}@x.com` } });
    await addManager(vendor.id, user.id);
    const vm = await prisma.vendorManager.findUnique({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    });
    expect(vm).toBeTruthy();
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('vendor_manager');
  });

  it('upgrades a customer to vendor_manager', async () => {
    const user = await prisma.user.create({ data: { email: `m-2-${Date.now()}@x.com` } });
    await prisma.userTenantMembership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'customer' } });
    await addManager(vendor.id, user.id);
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('vendor_manager');
  });

  it('does NOT downgrade an agency_admin', async () => {
    const user = await prisma.user.create({ data: { email: `m-3-${Date.now()}@x.com` } });
    await prisma.userTenantMembership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'agency_admin' } });
    await addManager(vendor.id, user.id);
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('agency_admin'); // unchanged
    const vm = await prisma.vendorManager.findUnique({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    });
    expect(vm).toBeTruthy(); // VendorManager row still added
  });

  it('throws on duplicate add (UNIQUE constraint on composite PK)', async () => {
    const user = await prisma.user.create({ data: { email: `m-4-${Date.now()}@x.com` } });
    await addManager(vendor.id, user.id);
    await expect(addManager(vendor.id, user.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement `addManager`**

```ts
// src/server/domain/vendors/addManager.ts
import { prisma } from '@/src/lib/db';

export async function addManager(vendorId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUniqueOrThrow({
      where: { id: vendorId },
      select: { tenantId: true },
    });
    await tx.vendorManager.create({ data: { vendorId, userId } });
    const existing = await tx.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId: vendor.tenantId } },
    });
    if (!existing) {
      await tx.userTenantMembership.create({
        data: { userId, tenantId: vendor.tenantId, role: 'vendor_manager' },
      });
    } else if (existing.role === 'customer') {
      await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId: vendor.tenantId } },
        data: { role: 'vendor_manager' },
      });
    }
    // Higher roles (agency_staff / agency_admin / platform_*) are left as-is.
  });
}
```

- [ ] **Step 3: Tests for `removeManager`**

```ts
// src/server/domain/vendors/removeManager.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { removeManager } from './removeManager';
import { addManager } from './addManager';

describe('removeManager', () => {
  let tenant: { id: string };
  let vendorA: { id: string };
  let vendorB: { id: string };

  beforeEach(async () => {
    tenant = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    vendorA = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'A', code: `${Date.now()}`.slice(-8), commissionBps: 0 },
    });
    vendorB = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'B', code: `${Date.now()+1}`.slice(-8), commissionBps: 0 },
    });
  });

  afterEach(async () => {
    await prisma.vendorManager.deleteMany({ where: { vendorId: { in: [vendorA.id, vendorB.id] } } });
    await prisma.userTenantMembership.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'rm-' } } });
    await prisma.vendor.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });

  it('removes the row and downgrades vendor_manager → customer when no other vendor', async () => {
    const u = await prisma.user.create({ data: { email: `rm-1-${Date.now()}@x.com` } });
    await addManager(vendorA.id, u.id);
    await removeManager(vendorA.id, u.id);
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: u.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('customer');
    const vm = await prisma.vendorManager.findUnique({
      where: { vendorId_userId: { vendorId: vendorA.id, userId: u.id } },
    });
    expect(vm).toBeNull();
  });

  it('does NOT downgrade when user still manages another vendor on the same tenant', async () => {
    const u = await prisma.user.create({ data: { email: `rm-2-${Date.now()}@x.com` } });
    await addManager(vendorA.id, u.id);
    await addManager(vendorB.id, u.id);
    await removeManager(vendorA.id, u.id);
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: u.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('vendor_manager'); // still managing B
  });

  it('does NOT downgrade an agency_admin', async () => {
    const u = await prisma.user.create({ data: { email: `rm-3-${Date.now()}@x.com` } });
    await prisma.userTenantMembership.create({ data: { userId: u.id, tenantId: tenant.id, role: 'agency_admin' } });
    await addManager(vendorA.id, u.id);
    await removeManager(vendorA.id, u.id);
    const m = await prisma.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId: u.id, tenantId: tenant.id } },
    });
    expect(m?.role).toBe('agency_admin');
  });
});
```

- [ ] **Step 4: Implement `removeManager`**

```ts
// src/server/domain/vendors/removeManager.ts
import { prisma } from '@/src/lib/db';

export async function removeManager(vendorId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUniqueOrThrow({
      where: { id: vendorId },
      select: { tenantId: true },
    });
    await tx.vendorManager.delete({
      where: { vendorId_userId: { vendorId, userId } },
    });
    const otherCount = await tx.vendorManager.count({
      where: { userId, vendor: { tenantId: vendor.tenantId } },
    });
    if (otherCount === 0) {
      const m = await tx.userTenantMembership.findUnique({
        where: { userId_tenantId: { userId, tenantId: vendor.tenantId } },
      });
      if (m?.role === 'vendor_manager') {
        await tx.userTenantMembership.update({
          where: { userId_tenantId: { userId, tenantId: vendor.tenantId } },
          data: { role: 'customer' },
        });
      }
    }
  });
}
```

- [ ] **Step 5: Run all tests + commit**

```bash
npx vitest run src/server/domain/vendors/
git add src/server/domain/vendors/addManager.ts src/server/domain/vendors/addManager.test.ts \
        src/server/domain/vendors/removeManager.ts src/server/domain/vendors/removeManager.test.ts
git commit -m "feat(2f): addManager + removeManager with role upgrade/downgrade rules"
```

---

## Task 16: List + detail queries

**Files:**
- Create: `src/server/queries/vendor-list.ts`
- Create: `src/server/queries/vendor-detail.ts`
- Test: `src/server/queries/vendor-list.test.ts`
- Test: `src/server/queries/vendor-detail.test.ts`

- [ ] **Step 1: Implement `listVendors`**

```ts
// src/server/queries/vendor-list.ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';

export interface ListVendorsParams {
  tenantId?: string;        // omit for cross-tenant (platform_admin only)
  search?: string;
  page?: number;
  limit?: number;
}

export async function listVendors(params: ListVendorsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.max(1, Math.min(100, params.limit ?? 20));
  const where: Prisma.VendorWhereInput = {};
  if (params.tenantId) where.tenantId = params.tenantId;
  if (params.search?.trim()) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { code: { contains: params.search, mode: 'insensitive' } },
      { contactInfo: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tenant: { select: { id: true, slug: true, name: true } },
        _count: { select: { managers: true, referredUsers: true } },
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  return { rows, total, page, limit };
}
```

- [ ] **Step 2: Implement `getVendorDetail`** (queries used by detail page; lighter than the dashboard stats which live in PR-B)

```ts
// src/server/queries/vendor-detail.ts
import { prisma } from '@/src/lib/db';
import { computeCommissionForOrder } from '@/src/server/lib/commission';

export async function getVendorDetail(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      tenant: { select: { id: true, slug: true, name: true } },
      managers: {
        select: {
          userId: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });
  if (!vendor) return null;

  const referredUserCount = await prisma.user.count({ where: { referredByVendorId: vendorId } });

  const orders = await prisma.order.findMany({
    where: { referredByVendorId: vendorId },
    select: {
      id: true,
      commissionBpsSnapshot: true,
      payments: { select: { amount: true, status: true } },
      refunds: { select: { amount: true, status: true } },
    },
  });

  let grossUsd = 0n;
  let refundedUsd = 0n;
  let commissionUsd = 0n;
  let paidOrders = 0;

  for (const o of orders) {
    const succeededPayment = o.payments.find((p) => p.status === 'succeeded');
    if (!succeededPayment) continue;
    paidOrders++;
    grossUsd += succeededPayment.amount;
    const succeededRefunds = o.refunds.filter((r) => r.status === 'succeeded');
    refundedUsd += succeededRefunds.reduce((s, r) => s + r.amount, 0n);
    commissionUsd += computeCommissionForOrder({
      payment: succeededPayment,
      refunds: o.refunds,
      commissionBpsSnapshot: o.commissionBpsSnapshot,
    });
  }

  return {
    vendor,
    stats: {
      referredUserCount,
      paidOrders,
      grossUsd,
      refundedUsd,
      netUsd: grossUsd - refundedUsd,
      commissionUsd,
    },
  };
}
```

- [ ] **Step 3: Smoke tests**

```ts
// src/server/queries/vendor-list.test.ts
import { describe, expect, it } from 'vitest';
import { prisma } from '@/src/lib/db';
import { listVendors } from './vendor-list';

describe('listVendors', () => {
  it('paginates and filters by search', async () => {
    const t = await prisma.tenant.create({ data: { slug: `t-${Date.now()}`, name: 'T', defaultMarkupBps: 0 } });
    const v1 = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'Acme Travel', code: `${Date.now()}`.slice(-8), commissionBps: 0 },
    });
    const v2 = await prisma.vendor.create({
      data: { tenantId: t.id, name: 'Beta Rentals', code: `${Date.now()+1}`.slice(-8), commissionBps: 0 },
    });

    const all = await listVendors({ tenantId: t.id });
    expect(all.total).toBe(2);

    const filtered = await listVendors({ tenantId: t.id, search: 'acme' });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0].id).toBe(v1.id);

    await prisma.vendor.delete({ where: { id: v1.id } });
    await prisma.vendor.delete({ where: { id: v2.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  });
});
```

(Add a similar smoke test for `getVendorDetail` covering paid + refunded scenarios; mirror the pattern from `commission.test.ts` to drive aggregation.)

- [ ] **Step 4: Run + commit**

```bash
npx vitest run src/server/queries/
git add src/server/queries/vendor-list.ts src/server/queries/vendor-detail.ts \
        src/server/queries/vendor-list.test.ts src/server/queries/vendor-detail.test.ts
git commit -m "feat(2f): vendor list + detail queries with commission aggregation"
```

---

## Task 17: Platform-admin server actions

**Files:**
- Create: `app/[locale]/(admin)/admin/vendors/actions.ts`

- [ ] **Step 1: Implement actions wired to RBAC + audit**

```ts
// app/[locale]/(admin)/admin/vendors/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePlatformRole } from '@/src/server/rbac/roles';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { createVendor } from '@/src/server/domain/vendors/createVendor';
import { updateVendor } from '@/src/server/domain/vendors/updateVendor';
import { deleteVendor } from '@/src/server/domain/vendors/deleteVendor';
import { toggleVendorActive } from '@/src/server/domain/vendors/toggleVendorActive';
import { addManager } from '@/src/server/domain/vendors/addManager';
import { removeManager } from '@/src/server/domain/vendors/removeManager';
import { writeAudit } from '@/src/server/audit/write';

const CreateSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(1),
  commissionBps: z.coerce.number().int().min(0).max(10000),
  contactInfo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function createVendorAction(formData: FormData) {
  const actor = await requirePlatformRole();
  const parsed = CreateSchema.parse({
    tenantId: formData.get('tenantId'),
    name: formData.get('name'),
    commissionBps: formData.get('commissionBps'),
    contactInfo: formData.get('contactInfo') || null,
    notes: formData.get('notes') || null,
  });
  const v = await createVendor({
    tenantId: parsed.tenantId,
    name: parsed.name,
    commissionBps: parsed.commissionBps,
    contactInfo: parsed.contactInfo ?? null,
    notes: parsed.notes ?? null,
  });
  await writeAudit({
    actorUserId: actor.id,
    tenantId: v.tenantId,
    action: 'vendor.create',
    entityId: v.id,
    details: { name: v.name, code: v.code },
  });
  revalidatePath('/admin/vendors');
  redirect(`/admin/vendors/${v.id}`);
}

const UpdateSchema = z.object({
  name: z.string().trim().min(1),
  commissionBps: z.coerce.number().int().min(0).max(10000),
  contactInfo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function updateVendorAction(vendorId: string, formData: FormData) {
  const { user, vendor } = await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  const parsed = UpdateSchema.parse({
    name: formData.get('name'),
    commissionBps: formData.get('commissionBps'),
    contactInfo: formData.get('contactInfo') || null,
    notes: formData.get('notes') || null,
  });
  const updated = await updateVendor(vendorId, {
    name: parsed.name,
    commissionBps: parsed.commissionBps,
    contactInfo: parsed.contactInfo ?? null,
    notes: parsed.notes ?? null,
  });
  await writeAudit({
    actorUserId: user.id,
    tenantId: vendor.tenantId,
    action: 'vendor.update',
    entityId: updated.id,
    details: { name: updated.name, commissionBps: updated.commissionBps },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  revalidatePath('/admin/vendors');
}

export async function toggleVendorActiveAction(vendorId: string) {
  const { user, vendor } = await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  const v = await toggleVendorActive(vendorId);
  await writeAudit({
    actorUserId: user.id,
    tenantId: vendor.tenantId,
    action: v.isActive ? 'vendor.activate' : 'vendor.deactivate',
    entityId: v.id,
    details: { isActive: v.isActive },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
  revalidatePath('/admin/vendors');
}

export async function deleteVendorAction(vendorId: string) {
  const { user, vendor } = await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  await deleteVendor(vendorId);
  await writeAudit({
    actorUserId: user.id,
    tenantId: vendor.tenantId,
    action: 'vendor.delete',
    entityId: vendor.id,
    details: { name: vendor.name, code: vendor.code },
  });
  revalidatePath('/admin/vendors');
  redirect('/admin/vendors');
}

export async function addManagerAction(vendorId: string, formData: FormData) {
  const { user, vendor } = await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  const userId = String(formData.get('userId') ?? '');
  if (!userId) throw new Error('userId required');
  await addManager(vendorId, userId);
  await writeAudit({
    actorUserId: user.id,
    tenantId: vendor.tenantId,
    action: 'vendor.manager.add',
    entityId: vendor.id,
    details: { managerUserId: userId },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
}

export async function removeManagerAction(vendorId: string, userId: string) {
  const { user, vendor } = await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  await removeManager(vendorId, userId);
  await writeAudit({
    actorUserId: user.id,
    tenantId: vendor.tenantId,
    action: 'vendor.manager.remove',
    entityId: vendor.id,
    details: { managerUserId: userId },
  });
  revalidatePath(`/admin/vendors/${vendorId}`);
}
```

- [ ] **Step 2: Confirm `writeAudit` import path is correct**

```bash
grep -rn "export .* writeAudit" src/server/audit/ | head
```

If the export name or path differs (e.g., `auditLog`, `recordAudit`), adjust the import. Also confirm the `action` type accepts the new string literals — if it's a strict union you may need to cast or extend the union (Task 10's commit should have done this already).

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(admin\)/admin/vendors/actions.ts
git commit -m "feat(2f): platform-admin vendor server actions + audit"
```

---

## Task 18: Platform-admin pages (list / new / detail / edit)

**Files:**
- Create: `app/[locale]/(admin)/admin/vendors/page.tsx`
- Create: `app/[locale]/(admin)/admin/vendors/new/page.tsx`
- Create: `app/[locale]/(admin)/admin/vendors/[vendorId]/page.tsx`
- Create: `app/[locale]/(admin)/admin/vendors/[vendorId]/edit/page.tsx`
- Create: `src/components/vendors/VendorForm.tsx`
- Create: `src/components/vendors/VendorList.tsx`
- Create: `src/components/vendors/VendorDetail.tsx`
- Create: `src/components/vendors/ManagerList.tsx`

- [ ] **Step 1: List page (`page.tsx`)**

```tsx
// app/[locale]/(admin)/admin/vendors/page.tsx
import Link from 'next/link';
import { requirePlatformRole } from '@/src/server/rbac/roles';
import { listVendors } from '@/src/server/queries/vendor-list';
import { VendorList } from '@/src/components/vendors/VendorList';

interface Props {
  searchParams: Promise<{ search?: string; page?: string }>;
}

export default async function AdminVendorsPage({ searchParams }: Props) {
  await requirePlatformRole();
  const { search, page } = await searchParams;
  const data = await listVendors({
    search: search || undefined,
    page: page ? parseInt(page, 10) : 1,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <Link href="/admin/vendors/new" className="btn btn-primary">+ New Vendor</Link>
      </div>
      <VendorList data={data} showTenant />
    </div>
  );
}
```

- [ ] **Step 2: New page**

```tsx
// app/[locale]/(admin)/admin/vendors/new/page.tsx
import { requirePlatformRole } from '@/src/server/rbac/roles';
import { prisma } from '@/src/lib/db';
import { VendorForm } from '@/src/components/vendors/VendorForm';
import { createVendorAction } from '../actions';

export default async function NewVendorPage() {
  await requirePlatformRole();
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: 'asc' },
  });
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New Vendor</h1>
      <VendorForm tenants={tenants} action={createVendorAction} mode="create" />
    </div>
  );
}
```

- [ ] **Step 3: Detail page**

```tsx
// app/[locale]/(admin)/admin/vendors/[vendorId]/page.tsx
import { notFound } from 'next/navigation';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { getVendorDetail } from '@/src/server/queries/vendor-detail';
import { VendorDetail } from '@/src/components/vendors/VendorDetail';

interface Props {
  params: Promise<{ vendorId: string }>;
}

export default async function VendorDetailPage({ params }: Props) {
  const { vendorId } = await params;
  await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  const detail = await getVendorDetail(vendorId);
  if (!detail) notFound();
  return <VendorDetail detail={detail} basePath={`/admin/vendors/${vendorId}`} />;
}
```

- [ ] **Step 4: Edit page**

```tsx
// app/[locale]/(admin)/admin/vendors/[vendorId]/edit/page.tsx
import { notFound } from 'next/navigation';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { prisma } from '@/src/lib/db';
import { VendorForm } from '@/src/components/vendors/VendorForm';
import { updateVendorAction } from '../../actions';

interface Props {
  params: Promise<{ vendorId: string }>;
}

export default async function EditVendorPage({ params }: Props) {
  const { vendorId } = await params;
  await requireVendorRoleOnVendor(vendorId, { allowManagers: false });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) notFound();
  const action = updateVendorAction.bind(null, vendorId);
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Edit {vendor.name}</h1>
      <VendorForm vendor={vendor} action={action} mode="edit" />
    </div>
  );
}
```

- [ ] **Step 5: `VendorForm` component**

```tsx
// src/components/vendors/VendorForm.tsx
import type { Vendor } from '@prisma/client';

interface VendorFormProps {
  mode: 'create' | 'edit';
  vendor?: Vendor;
  tenants?: { id: string; slug: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}

export function VendorForm({ mode, vendor, tenants, action }: VendorFormProps) {
  return (
    <form action={action} className="space-y-4 max-w-xl">
      {mode === 'create' && tenants && (
        <label className="block">
          <span className="block text-sm font-medium mb-1">Tenant</span>
          <select name="tenantId" required className="input w-full" defaultValue={tenants[0]?.id}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="block text-sm font-medium mb-1">Name</span>
        <input
          name="name"
          required
          className="input w-full"
          defaultValue={vendor?.name ?? ''}
          autoFocus
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Commission (basis points)</span>
        <input
          type="number"
          name="commissionBps"
          required
          min={0}
          max={10000}
          step={1}
          className="input w-full"
          defaultValue={vendor?.commissionBps ?? 0}
        />
        <p className="text-xs text-gray-500 mt-1">250 = 2.50%, 10000 = 100%</p>
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Contact info</span>
        <input
          name="contactInfo"
          className="input w-full"
          defaultValue={vendor?.contactInfo ?? ''}
        />
      </label>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Notes</span>
        <textarea
          name="notes"
          rows={3}
          className="input w-full"
          defaultValue={vendor?.notes ?? ''}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary">
          {mode === 'create' ? 'Create vendor' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: `VendorList` component**

```tsx
// src/components/vendors/VendorList.tsx
import Link from 'next/link';

interface Row {
  id: string;
  name: string;
  code: string;
  commissionBps: number;
  isActive: boolean;
  tenant: { slug: string; name: string };
  _count: { managers: number; referredUsers: number };
}

interface VendorListProps {
  data: { rows: Row[]; total: number; page: number; limit: number };
  showTenant?: boolean;
  basePath?: string;
}

export function VendorList({ data, showTenant, basePath = '/admin/vendors' }: VendorListProps) {
  if (data.rows.length === 0) {
    return <p className="text-gray-500">No vendors yet.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr className="text-left">
          <th className="py-2">Name</th>
          <th>Code</th>
          {showTenant && <th>Tenant</th>}
          <th>Commission</th>
          <th>Active</th>
          <th>Managers</th>
          <th>Referred</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((v) => (
          <tr key={v.id} className="border-b">
            <td className="py-2">{v.name}</td>
            <td><code>{v.code}</code></td>
            {showTenant && <td>{v.tenant.slug}</td>}
            <td>{(v.commissionBps / 100).toFixed(2)}%</td>
            <td>{v.isActive ? '✓' : '✗'}</td>
            <td>{v._count.managers}</td>
            <td>{v._count.referredUsers}</td>
            <td><Link href={`${basePath}/${v.id}`} className="text-indigo-600 hover:underline">Open →</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 7: `VendorDetail` and `ManagerList` components**

```tsx
// src/components/vendors/VendorDetail.tsx
import Link from 'next/link';
import { ManagerList } from './ManagerList';

interface DetailProps {
  detail: {
    vendor: {
      id: string;
      name: string;
      code: string;
      commissionBps: number;
      isActive: boolean;
      contactInfo: string | null;
      notes: string | null;
      tenant: { id: string; slug: string; name: string };
      managers: { userId: string; createdAt: Date; user: { id: string; email: string; name: string | null } }[];
    };
    stats: {
      referredUserCount: number;
      paidOrders: number;
      grossUsd: bigint;
      refundedUsd: bigint;
      netUsd: bigint;
      commissionUsd: bigint;
    };
  };
  basePath: string;
}

function fmtUsd(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  return `${sign}$${dollars}.${remainder.toString().padStart(2, '0')}`;
}

export function VendorDetail({ detail, basePath }: DetailProps) {
  const { vendor, stats } = detail;
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{vendor.name}</h1>
        <Link href={`${basePath}/edit`} className="btn">Edit</Link>
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-gray-500">Code</dt><dd><code>{vendor.code}</code></dd></div>
        <div><dt className="text-gray-500">Tenant</dt><dd>{vendor.tenant.name} ({vendor.tenant.slug})</dd></div>
        <div><dt className="text-gray-500">Commission</dt><dd>{(vendor.commissionBps / 100).toFixed(2)}%</dd></div>
        <div><dt className="text-gray-500">Status</dt><dd>{vendor.isActive ? 'Active' : 'Inactive'}</dd></div>
        <div><dt className="text-gray-500">Contact</dt><dd>{vendor.contactInfo ?? '—'}</dd></div>
        <div><dt className="text-gray-500">Notes</dt><dd>{vendor.notes ?? '—'}</dd></div>
      </dl>
      <section>
        <h2 className="text-lg font-medium mb-2">Stats</h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div><dt className="text-gray-500">Referred users</dt><dd>{stats.referredUserCount}</dd></div>
          <div><dt className="text-gray-500">Paid orders</dt><dd>{stats.paidOrders}</dd></div>
          <div><dt className="text-gray-500">Gross</dt><dd>{fmtUsd(stats.grossUsd)}</dd></div>
          <div><dt className="text-gray-500">Refunded</dt><dd>{fmtUsd(stats.refundedUsd)}</dd></div>
          <div><dt className="text-gray-500">Net</dt><dd>{fmtUsd(stats.netUsd)}</dd></div>
          <div><dt className="text-gray-500">Commission</dt><dd>{fmtUsd(stats.commissionUsd)}</dd></div>
        </dl>
      </section>
      <ManagerList vendorId={vendor.id} managers={vendor.managers} />
    </div>
  );
}
```

```tsx
// src/components/vendors/ManagerList.tsx
import { addManagerAction, removeManagerAction } from '@/app/[locale]/(admin)/admin/vendors/actions';

interface ManagerListProps {
  vendorId: string;
  managers: { userId: string; createdAt: Date; user: { id: string; email: string; name: string | null } }[];
}

export function ManagerList({ vendorId, managers }: ManagerListProps) {
  const addAction = addManagerAction.bind(null, vendorId);
  return (
    <section>
      <h2 className="text-lg font-medium mb-2">Managers</h2>
      <ul className="space-y-1">
        {managers.map((m) => (
          <li key={m.userId} className="flex items-center justify-between border-b py-1">
            <span>{m.user.name ?? m.user.email}</span>
            <form action={removeManagerAction.bind(null, vendorId, m.userId)}>
              <button type="submit" className="text-red-600 text-sm hover:underline">Remove</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={addAction} className="flex gap-2 mt-3">
        <input name="userId" placeholder="User ID" className="input flex-1" required />
        <button type="submit" className="btn btn-secondary">Add manager</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 8: Typecheck + lint + manual smoke**

```bash
npm run typecheck
npm run lint
npm run dev
```

Visit `http://admin.localhost:3000/en/admin/vendors`. Sign in as a `platform_admin` (you'll need a seeded user). Click "+ New Vendor", fill form, submit. Verify redirect to detail page.

- [ ] **Step 9: Commit**

```bash
git add app/[locale]/\(admin\)/admin/vendors/ src/components/vendors/
git commit -m "feat(2f): platform-admin vendor list/new/detail/edit pages + components"
```

---

## Task 19: Agency-admin mirror under `/a/[agencySlug]/vendors`

**Files:**
- Create: `app/[locale]/(agency)/a/[agencySlug]/vendors/page.tsx`
- Create: `app/[locale]/(agency)/a/[agencySlug]/vendors/new/page.tsx`
- Create: `app/[locale]/(agency)/a/[agencySlug]/vendors/[vendorId]/page.tsx`
- Create: `app/[locale]/(agency)/a/[agencySlug]/vendors/[vendorId]/edit/page.tsx`
- Create: `app/[locale]/(agency)/a/[agencySlug]/vendors/actions.ts`

These mirror the platform-admin pages from Task 18 but:
1. Resolve `tenantId` from the URL slug (`a/[agencySlug]`).
2. Use `requireAgencyRoleOnTenant(tenantId, ['agency_admin'])` for list/create/edit/delete.
3. Re-use `requireVendorRoleOnVendor(vendorId, { allowManagers: false })` for detail/edit/delete since the helper already handles agency_admin → tenant cross-check.
4. The "Tenant" dropdown in the form is hidden — the tenantId is fixed from the URL.
5. After mutations, redirect to `/a/[agencySlug]/vendors/...` paths.

- [ ] **Step 1: Create the agency `actions.ts`** (parallels Task 17, with tenant guard from slug)

```ts
// app/[locale]/(agency)/a/[agencySlug]/vendors/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/src/lib/db';
import { requireAgencyRoleOnTenant } from '@/src/server/rbac/roles';
import { requireVendorRoleOnVendor } from '@/src/server/rbac/vendor';
import { createVendor } from '@/src/server/domain/vendors/createVendor';
import { updateVendor } from '@/src/server/domain/vendors/updateVendor';
import { deleteVendor } from '@/src/server/domain/vendors/deleteVendor';
import { toggleVendorActive } from '@/src/server/domain/vendors/toggleVendorActive';
import { addManager } from '@/src/server/domain/vendors/addManager';
import { removeManager } from '@/src/server/domain/vendors/removeManager';
import { writeAudit } from '@/src/server/audit/write';

async function tenantIdBySlug(slug: string): Promise<string> {
  const t = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!t) throw new Error(`Tenant not found: ${slug}`);
  return t.id;
}

const CreateSchema = z.object({
  name: z.string().trim().min(1),
  commissionBps: z.coerce.number().int().min(0).max(10000),
  contactInfo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function createVendorAction(agencySlug: string, formData: FormData) {
  const tenantId = await tenantIdBySlug(agencySlug);
  const actor = await requireAgencyRoleOnTenant(tenantId, ['agency_admin']);
  const parsed = CreateSchema.parse({
    name: formData.get('name'),
    commissionBps: formData.get('commissionBps'),
    contactInfo: formData.get('contactInfo') || null,
    notes: formData.get('notes') || null,
  });
  const v = await createVendor({
    tenantId,
    name: parsed.name,
    commissionBps: parsed.commissionBps,
    contactInfo: parsed.contactInfo ?? null,
    notes: parsed.notes ?? null,
  });
  await writeAudit({
    actorUserId: actor.id, tenantId, action: 'vendor.create', entityId: v.id,
    details: { name: v.name, code: v.code },
  });
  revalidatePath(`/a/${agencySlug}/vendors`);
  redirect(`/a/${agencySlug}/vendors/${v.id}`);
}

// updateVendorAction, toggleVendorActiveAction, deleteVendorAction,
// addManagerAction, removeManagerAction follow the same pattern as the
// platform-admin file (Task 17) but use:
//   - the agencySlug-derived tenantId
//   - revalidatePath/redirect paths under `/a/${agencySlug}/vendors`
// All five share the agencySlug as their first arg.
```

(Implement the remaining five actions analogously. Each takes `agencySlug` first, then the existing args.)

- [ ] **Step 2: Pages mirror Task 18 structure**

The list/new/detail/edit pages do `await requireAgencyRoleOnTenant(tenantId, ['agency_admin'])` first. The list page passes `showTenant={false}` to `VendorList`. The new page omits the tenants dropdown and binds `agencySlug` into `createVendorAction`. The detail page reuses `VendorDetail` with `basePath={`/a/${agencySlug}/vendors/${vendorId}`}`.

(Code is structurally identical to Task 18 — copy the four page files, add `params: Promise<{ agencySlug: string }>`, await it, look up tenantId via `tenantIdBySlug`, bind `agencySlug` into actions. Commit when done.)

- [ ] **Step 3: Typecheck + manual smoke**

```bash
npm run typecheck
npm run dev
```

Sign in as agency_admin on `<slug>.localhost:3000/en/a/<slug>/vendors`.

- [ ] **Step 4: Commit**

```bash
git add app/[locale]/\(agency\)/a/\[agencySlug\]/vendors/
git commit -m "feat(2f): agency-admin vendor pages + actions (own tenant scoped)"
```

---

## Task 20: i18n message keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/tr.json`

- [ ] **Step 1: Add admin vendor keys to `en.json`**

Insert under the existing top-level structure:

```json
{
  "admin": {
    "vendors": {
      "title": "Vendors",
      "newButton": "+ New Vendor",
      "table": {
        "name": "Name",
        "code": "Code",
        "tenant": "Tenant",
        "commission": "Commission",
        "active": "Active",
        "managers": "Managers",
        "referred": "Referred users"
      },
      "form": {
        "tenantLabel": "Tenant",
        "nameLabel": "Name",
        "commissionLabel": "Commission (basis points)",
        "commissionHint": "250 = 2.50%, 10000 = 100%",
        "contactLabel": "Contact info",
        "notesLabel": "Notes",
        "createSubmit": "Create vendor",
        "saveSubmit": "Save changes"
      },
      "detail": {
        "stats": "Stats",
        "managers": "Managers",
        "addManager": "Add manager",
        "remove": "Remove",
        "edit": "Edit"
      }
    }
  }
}
```

- [ ] **Step 2: Add the same keys with TR translations to `tr.json`**

```json
{
  "admin": {
    "vendors": {
      "title": "Vendor'lar",
      "newButton": "+ Yeni Vendor",
      "table": {
        "name": "Ad",
        "code": "Kod",
        "tenant": "Tenant",
        "commission": "Komisyon",
        "active": "Aktif",
        "managers": "Yöneticiler",
        "referred": "Referans kullanıcıları"
      },
      "form": {
        "tenantLabel": "Tenant",
        "nameLabel": "Ad",
        "commissionLabel": "Komisyon (basis point)",
        "commissionHint": "250 = %2.50, 10000 = %100",
        "contactLabel": "İletişim",
        "notesLabel": "Notlar",
        "createSubmit": "Vendor oluştur",
        "saveSubmit": "Kaydet"
      },
      "detail": {
        "stats": "İstatistikler",
        "managers": "Yöneticiler",
        "addManager": "Yönetici ekle",
        "remove": "Kaldır",
        "edit": "Düzenle"
      }
    }
  }
}
```

- [ ] **Step 3: Wire `useTranslations` into the components**

Update `VendorForm`, `VendorList`, `VendorDetail`, and `ManagerList` to use `useTranslations('admin.vendors')` (or pass message strings as props from the page). For server components, `getTranslations` from `next-intl/server`.

(The exact wiring depends on the V2 next-intl pattern. See `app/[locale]/(admin)/admin/tenants/page.tsx` for the established pattern — mirror it.)

- [ ] **Step 4: Commit**

```bash
git add messages/ src/components/vendors/
git commit -m "feat(2f): i18n message keys for vendor admin (en + tr)"
```

---

## Task 21: E2E test — referral flow

**Files:**
- Create: `e2e/vendor-referral.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// e2e/vendor-referral.spec.ts
import { expect, test } from '@playwright/test';
import { prisma } from '@/src/lib/db';

test.describe('Phase 2f vendor referral', () => {
  let vendor: { id: string; code: string };
  let tenantSlug: string;

  test.beforeAll(async () => {
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'platform' }, select: { id: true, slug: true } });
    tenantSlug = tenant.slug;
    vendor = await prisma.vendor.create({
      data: { tenantId: tenant.id, name: 'E2E Vendor', code: 'e2etest1', commissionBps: 500 },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-ref-' } } });
    await prisma.vendor.delete({ where: { id: vendor.id } });
  });

  test('?ref= sets cookie, strips param, persists through magic-link signup', async ({ page, context, baseURL }) => {
    const url = new URL(`/en?ref=${vendor.code}`, baseURL!.replace('://', `://${tenantSlug}.`));
    const response = await page.goto(url.toString());
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain('ref=');

    const cookies = await context.cookies();
    const refCookie = cookies.find((c) => c.name === 'dp_ref');
    expect(refCookie?.value).toBe(vendor.code);

    // Sign up via magic link (Mailpit captures locally).
    const newEmail = `e2e-ref-${Date.now()}@example.com`;
    await page.goto(url.origin + '/en/signin');
    await page.fill('input[name="email"]', newEmail);
    await page.click('button[type="submit"]');
    await page.waitForURL(/check-email/);

    // Fetch the captured magic link from Mailpit's HTTP API.
    const mailpitUrl = process.env.MAILPIT_URL ?? 'http://localhost:8025';
    const messages = await fetch(`${mailpitUrl}/api/v1/search?query=to:${newEmail}`).then((r) => r.json());
    const id = messages.messages[0].ID;
    const detail = await fetch(`${mailpitUrl}/api/v1/message/${id}`).then((r) => r.json());
    const link = detail.HTML.match(/href="([^"]+\/api\/auth\/callback\/[^"]+)"/)![1];

    await page.goto(link);
    await page.waitForURL(/(?<!signin)/); // any non-signin page

    // Verify attribution
    const user = await prisma.user.findUniqueOrThrow({ where: { email: newEmail } });
    expect(user.referredByVendorId).toBe(vendor.id);
    expect(user.referredAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npm run e2e -- --grep "Phase 2f vendor referral"
```

Expected: PASS in dev (Mailpit running on :8025).

- [ ] **Step 3: Commit**

```bash
git add e2e/vendor-referral.spec.ts
git commit -m "test(2f): e2e vendor referral cookie + magic-link attribution"
```

---

## Task 22: Final verification + push + open PR

- [ ] **Step 1: Run the full test suite**

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run e2e
```

Expected: all green.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/phase-2f-pr-a-vendor-foundation
```

- [ ] **Step 3: Open PR (with explicit user approval)**

Stop and ask the user before opening the PR. When approved:

```bash
gh pr create --title "Phase 2f PR-A: Vendor Foundation + Referral + Admin" --body "$(cat <<'EOF'
## Summary
- Adds Vendor + VendorManager schema (tenant-scoped, multi-manager M2M)
- Adds User.referredBy* and Order.referredBy* + commissionBpsSnapshot
- Adds Role.vendor_manager enum value
- Pure helper computeCommissionForOrder + RBAC helper requireVendorRoleOnVendor
- ?ref= cookie capture in middleware (tenant subdomains, non-API only)
- Auth.js events.createUser consumes cookie + writes attribution
- createBooking extension: snapshot bps with cross-tenant guard
- Platform-admin and agency-admin CRUD UIs with manager add/remove
- Audit events (vendor.create/update/delete/activate/deactivate/manager.add/remove)
- Full TDD coverage + e2e referral flow

## Test plan
- [ ] Migration applies cleanly to dev + test DB
- [ ] All unit tests green (`npm test`)
- [ ] E2E vendor-referral.spec.ts green
- [ ] Manual smoke: create vendor on platform tenant, scan QR, sign up, verify attribution
- [ ] Cross-tenant attribution test passes (vendor on A, signup on B → no attribution)
- [ ] Manager add/remove transactions: customer→vendor_manager upgrade, agency_admin untouched

Spec: docs/superpowers/specs/2026-04-27-v2-phase-2f-vendor-port-design.md
EOF
)"
```

- [ ] **Step 4: Wait for CI + manual prod-smoke per Phase 2e pattern**

Address any CI failures in follow-up commits on this branch.

---

## Self-Review Checklist (run before opening PR)

- [ ] Spec coverage: Vendor model ✓ (Task 2), VendorManager ✓ (Task 2), referral capture ✓ (Tasks 6-7), events.createUser ✓ (Task 8), createBooking attribution ✓ (Task 9), commission helper ✓ (Task 4), RBAC helper ✓ (Task 5), CRUD actions ✓ (Tasks 12-15), platform-admin pages ✓ (Task 18), agency-admin pages ✓ (Task 19), audit events ✓ (Task 10), i18n ✓ (Task 20), E2E ✓ (Task 21).
- [ ] No placeholders.
- [ ] Type consistency: `commissionBps` (Int, 0-10000) used everywhere; `bigint` for amounts; `commissionBpsSnapshot` matches between schema (Int?) and helper input (number | null).
- [ ] Cross-tenant guard in three places: middleware (cookie scoped), events.createUser (tenant lookup), createBooking (snapshot guard).
