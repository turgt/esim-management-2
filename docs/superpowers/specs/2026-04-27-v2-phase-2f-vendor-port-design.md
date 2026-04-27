# V2 Phase 2f — Vendor Port Design

**Date:** 2026-04-27
**Repo:** `datapatch-v2`
**Depends on:** Phase 2e PR-A (subdomain), Phase 2e PR-B (per-tenant pricing)
**Status:** Approved (awaiting implementation plan)

## Goal

Port V1's vendor / referral feature from `esim-management-2` into the V2 multi-tenant architecture. Vendors are tenant-scoped; one vendor belongs to exactly one tenant (the `platform` tenant is the default for "tenantless" cases). Referrals flow through subdomain QR codes, attribute on signup, and earn commission on net (refund-adjusted) revenue.

Feature parity with V1: vendor CRUD, referral cookie capture, signup attribution, A4/A5/A6 brochure with QR, vendor self-service dashboard with 30-day chart, commission reporting, multi-manager support.

## Non-goals (deferred or excluded)

- **Esim provider field port** — V1's `Esim.vendor='zendit'` column is *not* ported. V2 uses `Esim.providerId` (`EsimProviderId` enum) for that. The word "vendor" in V2 refers strictly to the referral entity.
- **Self-service vendor signup** — vendors are admin-created only.
- **Tenant-specific brochure branding** — DataPatch logo and copy stay static. A `tenant.brochureLogoUrl?` override is YAGNI for now.
- **PDF generation** — `html2canvas` PNG export is sufficient (V1 parity).
- **Cross-tenant referral attribution** — explicitly excluded (see "Approach" below).
- **Vendor self-service profile editing** — vendor managers see read-only profile; platform_admin / agency_admin edit.

(Note: throughout this spec, "platform admin" / "platform_admin" refers to the V2 `platform_admin` Role enum value, equivalent to V1's super-admin.)

## Approach

**Tenant scoping (key choice):** `Vendor.tenantId String NOT NULL`. "Tenantless" vendor === vendor bound to the `platform` tenant. Cross-tenant attribution is not supported: if a user signs up via `alpha`'s vendor QR but later orders on `beta`, the order does not earn commission. This avoids ambiguity over which tenant's pricing the commission base should use, and keeps RBAC clean (`vendor_manager` role lives on `UserTenantMembership` for the vendor's tenant).

**Multi-manager:** `VendorManager(vendorId, userId)` join table. A vendor can have multiple managers; a user can manage multiple vendors.

**Commission:** integer basis points (`commissionBps`), USD-only invariant, snapshotted on the Order at booking time so vendor rate changes don't retroactively alter past commission. Net revenue (gross paid − refunded) drives the calculation.

**Referral persistence:** browser cookie scoped to `.v2.datapatch.net`, set when `?ref=CODE` is visited and consumed by Auth.js's `events.createUser` callback. Survives the magic-link round trip because the cookie is in the user's browser, not the email scanner.

## Data Model

```prisma
model Vendor {
  id               String          @id @default(cuid())
  tenantId         String
  tenant           Tenant          @relation(fields: [tenantId], references: [id], onDelete: Restrict)

  name             String
  code             String          @unique     // 8-char hex, immutable after create
  commissionBps    Int             @default(0) // basis points (0..10000); 100 = 1.00%
  isActive         Boolean         @default(true)
  contactInfo      String?
  notes            String?

  managers         VendorManager[]
  referredUsers    User[]          @relation("VendorReferredUsers")
  referredOrders   Order[]         @relation("VendorReferredOrders")

  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([tenantId])
  @@index([code])
  @@map("vendors")
}

model VendorManager {
  vendorId   String
  userId     String
  vendor     Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@id([vendorId, userId])
  @@index([userId])
  @@map("vendor_managers")
}

// User additions
model User {
  // ... existing fields
  referredByVendorId  String?
  referredByVendor    Vendor?         @relation("VendorReferredUsers", fields: [referredByVendorId], references: [id], onDelete: SetNull)
  referredAt          DateTime?
  vendorManagerOf     VendorManager[]

  @@index([referredByVendorId])
}

// Order additions
model Order {
  // ... existing fields
  referredByVendorId       String?
  referredByVendor         Vendor?  @relation("VendorReferredOrders", fields: [referredByVendorId], references: [id], onDelete: SetNull)
  commissionBpsSnapshot    Int?     // snapshot of vendor.commissionBps at booking; null if no referral

  @@index([referredByVendorId])
}

enum Role {
  customer
  agency_staff
  agency_admin
  vendor_manager   // NEW
  platform_staff
  platform_admin
}
```

**Migration:** single migration `phase_2f_vendor_port` adds `vendors`, `vendor_managers`, the new columns on `users` and `orders`, and the `vendor_manager` enum value.

**Constraints / invariants:**
- `Vendor.code` is application-immutable after create (basílmış brochure / paylaşılmış QR'lar invalidate olmasın). Enforced in actions, not at DB.
- `Vendor.tenantId` is `Restrict` on tenant delete; tenant deletion (rare) requires vendors be removed first.
- `User.referredByVendorId` is `SetNull` on vendor delete; referred users keep their account, lose attribution.
- `Order.referredByVendorId` is `SetNull` on vendor delete; commission becomes 0 (snapshot bps still present but vendor link gone — surface in audit).

## Referral Capture Flow

1. **QR scanned / link clicked:** `https://<slug>.v2.datapatch.net/?ref=CODE` (platform vendor uses slug `platform`, e.g. `platform.v2.datapatch.net/?ref=...`). Apex does not host vendor pages.
2. **Middleware** matches `?ref=` query on **non-API paths only** (`/api/*` skipped to avoid colliding with Auth.js callback query strings):
   - Sanitize `code` against `^[a-f0-9]{8}$`. Invalid → silently strip and 302 without setting cookie.
   - Set `Set-Cookie: dp_ref=CODE; Domain=.v2.datapatch.net; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`.
   - In dev (host ends in `.localhost` or equals `localhost`), drop `Domain` and `Secure`. The cookie becomes host-only, which means cross-subdomain referrals don't work in dev — devs test on a single subdomain (acceptable trade-off; alternatives like `Domain=.localhost` are inconsistent across browsers).
   - 302 redirect to same URL with `ref` query param stripped (so users sharing the link don't transfer their attribution).
3. **User browses:** cookie persists across pages and subdomains.
4. **Signup tetiklenir** (Auth.js Resend provider). Magic-link gönderilir.
5. **Magic-link tıklanır → Auth.js callback completes → user yaratılır:**
6. **`events.createUser` (Auth.js v5):**
   ```ts
   events: {
     createUser: async ({ user }) => {
       const ref = (await cookies()).get('dp_ref')?.value;
       if (!/^[a-f0-9]{8}$/.test(ref ?? '')) return;
       // x-tenant-id is set by middleware on tenant subdomains (including /api/* paths).
       // Apex / www / admin do NOT set this header; signups there can't be attributed to a vendor.
       const tenantId = (await headers()).get('x-tenant-id');
       if (!tenantId) return;
       const vendor = await prisma.vendor.findFirst({
         where: { code: ref, tenantId, isActive: true }
       });
       if (vendor) {
         await prisma.user.update({
           where: { id: user.id },
           data: { referredByVendorId: vendor.id, referredAt: new Date() }
         });
       }
       (await cookies()).set('dp_ref', '', { maxAge: 0, path: '/' });
     }
   }
   ```
   **Note:** The platform tenant is reached at `platform.v2.datapatch.net` (a normal tenant subdomain), not on apex. Apex serves only `/api/*` routes — no signup happens there. The cookie domain `.v2.datapatch.net` carries across all subdomains, so a `?ref=` set on one tenant subdomain is visible to the magic-link callback on the same tenant.
7. **Existing users (re-login):** `events.createUser` does NOT fire; cookie remains until expiry but is ignored. Attribution can only happen at signup.

**Edge cases:**

| Scenario | Behavior |
|---|---|
| Invalid ref code | No cookie; signup proceeds normal |
| Vendor inactive | Cookie set; lookup filter excludes inactive → no attribution |
| Vendor in different tenant than signup tenant | Lookup `where: { tenantId: signupTenantId }` excludes → no attribution |
| Cookie set on `alpha`, signup on `beta` | Same as above (cross-tenant guard) |
| Signup on `admin.v2…` (platform-admin) | `x-tenant-id` not set → no attribution (platform-admins are not referred) |
| Two `?ref=` visits | Last wins (cookie overwrite) |
| Email scanner pre-fetches magic link | Scanner has no cookie → callback runs but `events.createUser` may or may not fire (depends on `useVerificationToken` semantics, see Phase 2e fix #18). User's later click does not create a new user → no attribution. **This is a known limitation.** |
| User signs up on inactive cookie | No attribution; vendor reactivation does not retroactively attribute |

## Commission Calculation

**Pure helper:** `computeCommissionForOrder({ payment, refunds, commissionBpsSnapshot }) → bigint` — returns USD cents.

```ts
function computeCommissionForOrder(o: {
  payment: { amount: bigint; status: 'succeeded' | string };
  refunds: { amount: bigint; status: 'succeeded' | string }[];
  commissionBpsSnapshot: number | null;
}): bigint {
  if (o.payment.status !== 'succeeded') return 0n;
  if (o.commissionBpsSnapshot == null) return 0n;
  const refunded = o.refunds
    .filter(r => r.status === 'succeeded')
    .reduce((s, r) => s + r.amount, 0n);
  const net = o.payment.amount - refunded;
  if (net <= 0n) return 0n;
  return (net * BigInt(o.commissionBpsSnapshot)) / 10000n; // BigInt floor
}
```

**Aggregate (for reports):** sum `computeCommissionForOrder` over all orders where `referredByVendorId === vendor.id`.

**Order creation extension** (in `createBooking` / equivalent server action):
```ts
const referredByUser = await tx.user.findUnique({
  where: { id: userId },
  select: { referredByVendorId: true }
});
let referredByVendorId: string | null = null;
let commissionBpsSnapshot: number | null = null;
if (referredByUser?.referredByVendorId) {
  const v = await tx.vendor.findUnique({
    where: { id: referredByUser.referredByVendorId },
    select: { tenantId: true, isActive: true, commissionBps: true }
  });
  if (v && v.isActive && v.tenantId === order.tenantId) {
    referredByVendorId = referredByUser.referredByVendorId;
    commissionBpsSnapshot = v.commissionBps;
  }
}
// pass into order.create({...})
```

**Currency invariant:** `assertUsdMoney` is called on `payment.amount`, `refund.amount`, and the commission output. Same pattern as Phase 2d createBooking USD assertion.

**Test invariants:**
- Cross-tenant attribution test — vendor in tenant A, order in tenant B → commission = 0.
- Partial refund test — order $100 paid, $30 refunded, bps=500 → commission = floor(7000 × 500 / 10000) = 350 cents = $3.50.
- Rate-change test — order created with bps=500, vendor later updated to bps=1000 → past order commission stays at 500 (snapshot).
- Inactive vendor test — vendor deactivated mid-flow → past orders with snapshot still earn; new orders no longer attributed.
- Failed payment test — `payment.status='failed'` → commission = 0 regardless of snapshot.

## RBAC

**Source of truth:** `VendorManager(vendorId, userId)` row existence is the gate for "this user manages this vendor." The `Role.vendor_manager` enum value is a **display category** (drives sidebar visibility, "My Vendors" menu) — not the access decision. This way, an `agency_staff` user added as a manager can access the vendor without losing their staff role, and an `agency_admin` already has access via tenant role without needing a `VendorManager` row.

**Helper:** `requireVendorRoleOnVendor(vendorId, options) → { user, vendor }`. Follows the existing V2 RBAC pattern (see `src/server/rbac/roles.ts` — `requireAuthenticatedUser`, `requirePlatformRole`, `requireAgencyRoleOnTenant`).

```ts
// src/server/rbac/vendor.ts (new)
import type { Vendor, Role } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { requireAuthenticatedUser, isPlatformRole, getMembershipRole } from './roles';

export async function requireVendorRoleOnVendor(
  vendorId: string,
  { allowManagers = true }: { allowManagers?: boolean } = {},
): Promise<{ user: { id: string; email: string }; vendor: Vendor }> {
  const user = await requireAuthenticatedUser();

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { managers: { where: { userId: user.id }, select: { userId: true } } },
  });
  if (!vendor) throw new Error('NotFound: vendor not found.');

  // 1. Platform roles (cross-tenant)
  const anyPlatform = await prisma.userTenantMembership.findFirst({
    where: { userId: user.id, role: { in: ['platform_admin', 'platform_staff'] } },
    select: { role: true },
  });
  if (anyPlatform) return { user, vendor };

  // 2. agency_admin on the vendor's tenant
  const role = await getMembershipRole(user.id, vendor.tenantId);
  if (role === 'agency_admin') return { user, vendor };

  // 3. VendorManager row (gate for vendor self-service)
  if (allowManagers && vendor.managers.length > 0) return { user, vendor };

  throw new Error('Forbidden: vendor role required.');
}
```

For mutation actions (create, edit, delete, manager add/remove), callers pass `{ allowManagers: false }` — managers cannot mutate. View routes (dashboard, brochure) use the default.

**Cross-tenant guard for `agency_admin`:** `getMembershipRole(user.id, vendor.tenantId)` — if the agency_admin is on tenant A and the vendor is on tenant B, lookup returns null, falling through to manager check (likely also fails) → Forbidden.

**Note on platform_staff:** read-only platform support role. Treated like `platform_admin` for vendor RBAC because the matrix doesn't distinguish (V2 currently uses `isPlatformRole` for that). If we want platform_staff to be view-only on vendors later, refine the helper at that point.

| Action | platform_admin / platform_staff | agency_admin (own tenant) | VendorManager row (own vendor) | agency_staff / customer |
|---|---|---|---|---|
| Vendor list cross-tenant | ✅ | ❌ | ❌ | ❌ |
| Vendor list own tenant | ✅ | ✅ | ❌ | ❌ |
| Create vendor (any tenant) | ✅ | ❌ | ❌ | ❌ |
| Create vendor (own tenant) | ✅ | ✅ | ❌ | ❌ |
| Edit / activate / deactivate / delete | ✅ | ✅ (own tenant) | ❌ | ❌ |
| Add / remove manager | ✅ | ✅ (own tenant) | ❌ | ❌ |
| QR / brochure view | ✅ | ✅ (own tenant) | ✅ (own vendor) | ❌ |
| Vendor dashboard / reports | ✅ | ✅ (own tenant) | ✅ (own vendor) | ❌ |

**Manager add transaction:** create the `VendorManager` row, optionally upgrade `UserTenantMembership.role` to `vendor_manager` so the sidebar shows the right entries. Never downgrade higher roles.

```ts
await prisma.$transaction(async (tx) => {
  await tx.vendorManager.create({ data: { vendorId, userId } });
  const existing = await tx.userTenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId: vendor.tenantId } }
  });
  // Upgrade for category display only:
  // - missing membership → create with vendor_manager
  // - existing customer → upgrade to vendor_manager
  // - higher role (agency_staff / agency_admin / platform_*) → leave alone
  if (!existing) {
    await tx.userTenantMembership.create({
      data: { userId, tenantId: vendor.tenantId, role: 'vendor_manager' }
    });
  } else if (existing.role === 'customer') {
    await tx.userTenantMembership.update({
      where: { userId_tenantId: { userId, tenantId: vendor.tenantId } },
      data: { role: 'vendor_manager' }
    });
  }
  // RBAC access is enforced by VendorManager row, not by role enum value.
});
```

**Manager remove transaction:** delete the row, optionally downgrade `vendor_manager` → `customer` when the user is no longer a manager on any vendor in this tenant. Higher roles are untouched.

```ts
await prisma.$transaction(async (tx) => {
  await tx.vendorManager.delete({ where: { vendorId_userId: { vendorId, userId } } });
  const otherCount = await tx.vendorManager.count({
    where: { userId, vendor: { tenantId } }
  });
  if (otherCount === 0) {
    const m = await tx.userTenantMembership.findUnique({
      where: { userId_tenantId: { userId, tenantId } }
    });
    if (m?.role === 'vendor_manager') {
      await tx.userTenantMembership.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: { role: 'customer' }
      });
    }
  }
});
```

**Audit events:** `vendor.create`, `vendor.update`, `vendor.delete`, `vendor.activate`, `vendor.deactivate`, `vendor.manager.add`, `vendor.manager.remove`. All include `tenantId`, `vendorId`, `actorUserId` in `details`.

## Routes

| Path | Layout | Allowed roles |
|---|---|---|
| `admin.v2…/[locale]/admin/vendors` | platform-admin | platform_admin / platform_staff |
| `admin.v2…/[locale]/admin/vendors/new` | platform-admin | platform_admin |
| `admin.v2…/[locale]/admin/vendors/[id]` | platform-admin | platform_admin / platform_staff |
| `admin.v2…/[locale]/admin/vendors/[id]/edit` | platform-admin | platform_admin |
| `<slug>.v2…/[locale]/a/[agencySlug]/vendors` | agency | agency_admin |
| `<slug>.v2…/[locale]/a/[agencySlug]/vendors/new` | agency | agency_admin |
| `<slug>.v2…/[locale]/a/[agencySlug]/vendors/[id]` | agency | agency_admin |
| `<slug>.v2…/[locale]/a/[agencySlug]/vendors/[id]/edit` | agency | agency_admin |
| `<slug>.v2…/[locale]/v` | vendor | VendorManager row OR agency_admin OR platform_* (routes based on managed-vendor count) |
| `<slug>.v2…/[locale]/v/[vendorId]/dashboard` | vendor | same |
| `<slug>.v2…/[locale]/v/[vendorId]/brochure` | vendor | same |

`/v` index route lists vendors managed by the current user **on the current tenant** (filter by both `VendorManager.userId` AND `vendor.tenantId === currentTenantId`). A user who manages vendors on multiple tenants must visit each tenant's subdomain to see those.

- 0 vendors managed on this tenant → 404
- 1 vendor → 308 redirect to `/v/[id]/dashboard`
- 2+ vendors → vendor selector list page

**Subdomain enforcement:** `/v/[vendorId]/...` checks `vendor.tenantId === currentTenantId` (via `x-tenant-id` header). Mismatch → 404. Prevents an `alpha` vendor from being viewed at `beta.v2.datapatch.net/v/...`.

## Vendor Self-Service Dashboard

**Layout sections (top to bottom):**
1. **Stats grid (4 cards):** Total Referred Users, Total Paid Orders, Net Revenue (USD), Total Commission (USD).
2. **Referral block:** QR (300×300, server-rendered as data URL), copyable referral URL `tenantBaseUrl({slug})/?ref=CODE`, "Download QR PNG" button, "Open Brochure" link.
3. **30-day chart (Recharts):** registrations + purchases + revenue, three series, daily granularity.
4. **Two side-by-side tables:** Recent Referred Users (last 10, masked email like `u***@gmail.com`, displayName, signup date), Recent Sales (last 10: date, plan name from Esim metadata, amount USD, refund status badge "paid"/"partially refunded"/"refunded", commission earned).

**Privacy:** Vendor managers do NOT see full email addresses of referred users. They see displayName (if set) or masked email (`u***@domain.com`). Agency admins and platform roles see full info.

**Settings tab (read-only for vendor_manager):** vendor name, code, commissionBps, isActive, manager list, contactInfo, notes. Edit lives in admin layouts only.

**Caching:** stats and chart use `unstable_cache` with 60s TTL keyed by `vendorId`. `revalidatePath('/v/[vendorId]/dashboard')` after admin actions (manager add/remove, vendor edit/activate).

**i18n:** All vendor-facing strings in `messages/{en,tr}.json` under `vendor.dashboard.*`. Brochure copy under `vendor.brochure.*`.

## Brochure Generator

**Path:** `<slug>.v2.datapatch.net/[locale]/v/[vendorId]/brochure`

**Implementation:** port V1's `src/views/vendor/brochure.ejs` to a React server component:
- Inline `<style>` block kept verbatim (Tailwind conversion is YAGNI).
- `qrDataUrl` generated server-side via `qrcode` package targeting `tenantBaseUrl({slug})/?ref=${code}`.
- Toolbar (download + size toggle) is a `'use client'` component; html2canvas dynamically imported (`next/dynamic`) and triggered on button click.
- A4/A5/A6 toggle uses V1's `data-size` attribute pattern verbatim.
- Print CSS preserved (V1's `@media print` rules).

**Logo and copy:** static DataPatch branding (V1 parity). Translation keys for visible text only.

**Download mechanism:** html2canvas → `canvas.toDataURL('image/png')` → `<a download>` click. No server-side rendering needed.

## PR Split

**PR-A — Vendor Foundation + Referral + Admin (~1500-2000 LOC, ~1 week):**
- Prisma migration + schema additions (Vendor, VendorManager, User.referredBy*, Order.referredBy*+snapshot, Role.vendor_manager).
- `computeCommissionForOrder` pure helper + unit tests.
- `requireVendorRoleOnVendor` RBAC helper + tests.
- Referral middleware: `?ref=` cookie set + strip + 302.
- Auth.js `events.createUser` cookie consume + attribution.
- `createBooking` (or equivalent) extension: vendor lookup, cross-tenant guard, snapshot bps onto Order.
- Super-admin views: list/create/edit/detail/delete, manager add/remove UI.
- Agency-admin views: list/create/edit/detail/delete, manager add/remove UI (scoped to own tenant).
- Server actions for all mutations + audit logging.
- Cross-tenant + cross-subdomain isolation tests (unit + integration).
- E2E `e2e/vendor-referral.spec.ts`: QR scan → cookie set → signup → order → assertion that commission row exists with correct snapshot.

**PR-B — Vendor Dashboard + Brochure (~800-1200 LOC, ~3-4 days):**
- `(vendor)` route group + layout.
- `/v` index route (router for managed-vendor count).
- `/v/[vendorId]/dashboard` page + Recharts chart + stats queries (`getVendorStats`, `getVendorChartData`).
- `/v/[vendorId]/brochure` page (port of V1 EJS to React server component + client toolbar).
- i18n message files (TR + EN) for `vendor.*` namespace.
- E2E `e2e/vendor-dashboard.spec.ts`: login as manager → see only own vendor stats → cross-vendor URL access denied.

PR-B depends on PR-A merge (model + RBAC + helpers).

## Open Questions / Future Work

- **Tenant logo on brochure:** if a tenant wants their own brand on the brochure (instead of DataPatch), add `tenant.brochureLogoUrl?` and a config in admin. Out of scope for 2f.
- **Cross-tenant vendor (global scope):** if there's ever a use case for a vendor that earns from multiple tenants, add `Vendor.scope: 'tenant' | 'global'` enum. Out of scope.
- **Verification token cleanup:** unrelated housekeeping; tracked separately.
- **Commission payout / payable status:** this design tracks *earned* commission only. Actual payout to vendors (invoicing, payment) is out of scope; platform-admin can export totals.
- **Vendor self-service profile editing:** if vendors want to update their own contact info / notes, expose a limited edit form in the vendor dashboard. Out of scope.

## Risks

| Risk | Mitigation |
|---|---|
| Email scanner pre-fetches magic link, attribution lost | Documented limitation. Phase 2e fix #18 (`useVerificationToken` non-destructive) means the user's later click still works for *signup* — but cookie has to survive too, which it does (cookie is on user's browser). The risk window is narrow: scanner + user click happen on different browsers entirely. |
| Cookie blocked by browser (Safari ITP, third-party cookie restrictions) | Cookie is first-party to `.v2.datapatch.net`, not third-party — no ITP issue. Acceptable. |
| User clears cookies before signup | Attribution lost. Same trade-off as any cookie-based attribution; acceptable. |
| Vendor code collision (8-char hex, ~4B space) | UNIQUE constraint at DB; insert retry on collision (rare; ~0.0001% at 10k vendors). Application generates with `crypto.randomBytes(4)`. |
| Manager downgrade on remove drops their access elsewhere | Transaction guards: only downgrades from `vendor_manager → customer`. Higher roles untouched. Test coverage required. |
| Cross-tenant vendor lookup leaks via `findFirst` | Always `where: { tenantId, code }` (composite). Audit a code review on every place vendor is fetched by code. |
| Brochure html2canvas perf on A4 (large) | V1 already runs this in production at A4; acceptable. Loading state on button. |

## Files (rough estimate)

PR-A:
```
prisma/schema.prisma                                              # +Vendor, VendorManager, User.*, Order.*, Role enum
prisma/migrations/<timestamp>_phase_2f_vendor_port/migration.sql  # generated
src/server/lib/commission.ts                                       # computeCommissionForOrder
src/server/lib/commission.test.ts                                  # unit tests
src/server/auth/vendor-rbac.ts                                     # requireVendorRoleOnVendor
src/server/auth/vendor-rbac.test.ts
src/server/auth/events-create-user.ts                              # cookie consume helper (called from auth config)
src/auth.ts                                                        # add events.createUser
middleware.ts                                                      # add ?ref= cookie set + strip
src/server/booking/create-booking.ts                               # extend with vendor attribution
app/[locale]/(admin)/admin/vendors/page.tsx                        # list (platform-admin)
app/[locale]/(admin)/admin/vendors/new/page.tsx
app/[locale]/(admin)/admin/vendors/[id]/page.tsx
app/[locale]/(admin)/admin/vendors/[id]/edit/page.tsx
app/[locale]/(admin)/admin/vendors/actions.ts                      # server actions
app/[locale]/(agency)/a/[agencySlug]/vendors/                      # mirror for agency_admin
src/components/admin/vendor-form.tsx
src/components/admin/vendor-manager-list.tsx
e2e/vendor-referral.spec.ts
src/server/audit/events.ts                                          # add new event keys
```

PR-B:
```
app/[locale]/(vendor)/layout.tsx
app/[locale]/(vendor)/v/page.tsx                                    # index router
app/[locale]/(vendor)/v/[vendorId]/dashboard/page.tsx
app/[locale]/(vendor)/v/[vendorId]/brochure/page.tsx
src/components/vendor/dashboard-chart.tsx                            # Recharts (client)
src/components/vendor/brochure-toolbar.tsx                           # html2canvas (client)
src/server/queries/vendor-stats.ts                                   # getVendorStats, getVendorChartData
messages/en.json                                                     # vendor.* keys
messages/tr.json                                                     # vendor.* keys
e2e/vendor-dashboard.spec.ts
```

## Acceptance criteria

PR-A merged when:
- [ ] Migration applies cleanly to local + test DB.
- [ ] Vendor CRUD works for platform_admin (cross-tenant) and agency_admin (own tenant).
- [ ] `?ref=CODE` middleware sets cookie + strips param + redirects.
- [ ] Magic-link signup with cookie sets `User.referredByVendorId`.
- [ ] `createBooking` snapshots `commissionBpsSnapshot` onto Order when user is referred.
- [ ] Cross-tenant attribution test passes (vendor A's user signs up on tenant B → no attribution).
- [ ] Manager add/remove transactions correctly upgrade/downgrade `UserTenantMembership.role`.
- [ ] Audit events emitted for all mutations.
- [ ] Unit tests: `computeCommissionForOrder` covers all invariants listed above.
- [ ] E2E `vendor-referral.spec.ts` green.
- [ ] No new lint / type / prettier warnings.

PR-B merged when:
- [ ] Vendor dashboard renders for vendor_manager / agency_admin / platform_admin.
- [ ] 30-day chart shows correct registration / purchase / revenue series.
- [ ] Brochure renders A4/A5/A6 toggle works, html2canvas PNG downloads.
- [ ] QR points at correct subdomain (`tenantBaseUrl({slug})/?ref=CODE`).
- [ ] i18n: all vendor-facing strings translated EN + TR.
- [ ] Cross-vendor URL access denied (vendor manager of A can't view dashboard of B).
- [ ] E2E `vendor-dashboard.spec.ts` green.

## Phase 2g (next, not in this spec)

- Multi-item partial refunds (carryover from 2c).
- TurInvoice / Zendit refund capability (carryover from 2c).
- Bull Board custom audit on retry / remove (carryover from 2d).
- TurInvoice payment-method preselect (`Order.paymentMethodHint` already in schema).
- FX / multi-currency.
- Scheduled `verification_tokens` cleanup.
- `middleware.ts` → `proxy.ts` migration (Next.js 16 deprecation).
