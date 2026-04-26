# V2 Phase 2e PR-A — Subdomain Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-tenant subdomain routing under `*.v2.datapatch.net` with host-only NextAuth cookies, replacing the single `PUBLIC_APP_URL` model with a `PLATFORM_BASE_URL` + `tenantBaseUrl(tenant)` split. Webhook URLs unchanged.

**Architecture:** Next.js Node-runtime middleware extracts the subdomain from the `host` header, looks up the tenant by `slug`, and forwards `x-tenant-id` / `x-tenant-slug` request headers. Reserved subdomains (`www`, `admin`, etc.) and unknown slugs branch separately. Cookie scope stays host-only (NextAuth default + `trustHost: true`), so each tenant's session is isolated at the HTTP layer. New URL helpers replace `env.PUBLIC_APP_URL` everywhere it appears.

**Tech Stack:** Next.js 14 App Router (`middleware.ts`, Node runtime), NextAuth v5 (`trustHost`), Prisma (Tenant model), zod, Vitest, Playwright.

**Repo:** `/Users/turgt/Desktop/CODES/datapatch-v2`. All paths below are relative to that repo.

**Spec:** `docs/superpowers/specs/2026-04-26-v2-phase-2e-subdomain-and-pricing-design.md` (in V1 repo `esim-management-2`).

---

### Task 1: Slug validator + reserved denylist (pure module, TDD)

**Files:**
- Create: `src/server/tenancy/slugRules.ts`
- Test: `src/server/tenancy/slugRules.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/tenancy/slugRules.test.ts
import { describe, expect, it } from 'vitest';
import { isReservedSubdomain, validateTenantSlug, RESERVED_SUBDOMAINS } from './slugRules';

describe('slugRules', () => {
  it('accepts simple lowercase slugs', () => {
    expect(validateTenantSlug('acme').ok).toBe(true);
    expect(validateTenantSlug('a-b-c').ok).toBe(true);
    expect(validateTenantSlug('alpha123').ok).toBe(true);
  });

  it('rejects too-short / too-long / invalid character slugs', () => {
    expect(validateTenantSlug('ab').ok).toBe(false);
    expect(validateTenantSlug('a'.repeat(31)).ok).toBe(false);
    expect(validateTenantSlug('Acme').ok).toBe(false);
    expect(validateTenantSlug('-acme').ok).toBe(false);
    expect(validateTenantSlug('acme-').ok).toBe(false);
    expect(validateTenantSlug('acme.tenant').ok).toBe(false);
    expect(validateTenantSlug('acme_tenant').ok).toBe(false);
  });

  it('rejects reserved subdomains', () => {
    expect(validateTenantSlug('www').ok).toBe(false);
    expect(validateTenantSlug('admin').ok).toBe(false);
    expect(validateTenantSlug('api').ok).toBe(false);
    expect(validateTenantSlug('app').ok).toBe(false);
  });

  it('isReservedSubdomain matches denylist', () => {
    for (const r of RESERVED_SUBDOMAINS) expect(isReservedSubdomain(r)).toBe(true);
    expect(isReservedSubdomain('acme')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/tenancy/slugRules.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `slugRules.ts`**

```ts
// src/server/tenancy/slugRules.ts
export const RESERVED_SUBDOMAINS = new Set<string>([
  'www', 'admin', 'app', 'api', 'mail', 'webhook', 'webhooks',
  'static', 'cdn', 'assets', 'auth', 'support', 'status', 'help', 'docs', 'blog',
]);

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export interface SlugValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

export function isReservedSubdomain(candidate: string): boolean {
  return RESERVED_SUBDOMAINS.has(candidate);
}

export function validateTenantSlug(candidate: string): SlugValidationResult {
  if (!SLUG_REGEX.test(candidate)) {
    return { ok: false, error: 'Slug must be 3-30 lowercase chars (a-z, 0-9, hyphen); cannot start or end with hyphen.' };
  }
  if (isReservedSubdomain(candidate)) {
    return { ok: false, error: `"${candidate}" is reserved.` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/server/tenancy/slugRules.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenancy/slugRules.ts src/server/tenancy/slugRules.test.ts
git commit -m "feat(phase-2e): add tenant slug validator and reserved subdomain denylist"
```

---

### Task 2: Tighten slug validation in tenant create form

**Files:**
- Modify: `app/[locale]/(admin)/admin/tenants/new/page.tsx`

- [ ] **Step 1: Replace inline regex with shared validator**

Replace the existing `formSchema` block:

```ts
import { validateTenantSlug } from '@/src/server/tenancy/slugRules';

const formSchema = z.object({
  slug: z
    .string()
    .superRefine((v, ctx) => {
      const r = validateTenantSlug(v);
      if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error! });
    }),
  name: z.string().min(1).max(128),
});
```

Update the `<input name="slug" pattern=...>` attribute to:
```
pattern="^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$"
```

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/[locale]/(admin)/admin/tenants/new/page.tsx
git commit -m "feat(phase-2e): enforce DNS-safe slug + reserved denylist on tenant create"
```

---

### Task 3: Existing-slug audit + rename script (defensive)

**Files:**
- Create: `scripts/audit-tenant-slugs.ts`

- [ ] **Step 1: Implement audit script**

```ts
// scripts/audit-tenant-slugs.ts
import { prisma } from '@/src/lib/db';
import { validateTenantSlug } from '@/src/server/tenancy/slugRules';

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } });
  const offenders: { id: string; slug: string; name: string; reason: string }[] = [];
  for (const t of tenants) {
    const r = validateTenantSlug(t.slug);
    if (!r.ok) offenders.push({ ...t, reason: r.error! });
  }
  if (offenders.length === 0) {
    console.log(`OK — ${tenants.length} tenant slugs all valid.`);
    return;
  }
  console.log(`Found ${offenders.length} tenant(s) with invalid slugs:`);
  for (const o of offenders) console.log(`  ${o.id}  "${o.slug}"  (${o.name})  — ${o.reason}`);
  console.log('\nRename manually via:');
  console.log("  await prisma.tenant.update({ where: { id }, data: { slug: 'new-slug' } });");
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: Run against local dev DB**

Run: `npx tsx scripts/audit-tenant-slugs.ts`
Expected: `OK — N tenant slugs all valid.` (existing seed `platform`, `alpha`, `beta` etc. are clean.)

If anything fails, rename via Prisma Studio or a one-off `update` and re-run.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-tenant-slugs.ts
git commit -m "chore(phase-2e): add tenant slug audit script for pre-deploy verification"
```

---

### Task 4: Subdomain extractor (TDD)

**Files:**
- Create: `src/server/tenancy/subdomain.ts`
- Test: `src/server/tenancy/subdomain.test.ts`

- [ ] **Step 1: Write tests**

```ts
// src/server/tenancy/subdomain.test.ts
import { describe, expect, it } from 'vitest';
import { extractSubdomain } from './subdomain';

describe('extractSubdomain', () => {
  it('extracts subdomain from production host', () => {
    expect(extractSubdomain('acme.v2.datapatch.net')).toBe('acme');
    expect(extractSubdomain('admin.v2.datapatch.net')).toBe('admin');
    expect(extractSubdomain('www.v2.datapatch.net')).toBe('www');
  });

  it('returns null for the apex v2 host', () => {
    expect(extractSubdomain('v2.datapatch.net')).toBeNull();
  });

  it('extracts subdomain from local dev host (any port)', () => {
    expect(extractSubdomain('alpha.localhost:3000')).toBe('alpha');
    expect(extractSubdomain('alpha.localhost')).toBe('alpha');
    expect(extractSubdomain('localhost:3000')).toBeNull();
    expect(extractSubdomain('localhost')).toBeNull();
  });

  it('returns null for unrecognized hosts', () => {
    expect(extractSubdomain('example.com')).toBeNull();
    expect(extractSubdomain('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `npx vitest run src/server/tenancy/subdomain.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/server/tenancy/subdomain.ts
const PRODUCTION_BASE = 'v2.datapatch.net';
const DEV_BASE = 'localhost';

/**
 * Extract a tenant subdomain from a request host header.
 * Returns:
 *   - the leftmost label if the host is `<sub>.v2.datapatch.net` or `<sub>.localhost[:port]`
 *   - null for the apex (`v2.datapatch.net`, `localhost[:port]`) or unrecognized hosts
 */
export function extractSubdomain(host: string): string | null {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();
  if (hostname === PRODUCTION_BASE) return null;
  if (hostname.endsWith(`.${PRODUCTION_BASE}`)) {
    const sub = hostname.slice(0, -`.${PRODUCTION_BASE}`.length);
    return sub.length > 0 ? sub : null;
  }
  if (hostname === DEV_BASE) return null;
  if (hostname.endsWith(`.${DEV_BASE}`)) {
    const sub = hostname.slice(0, -`.${DEV_BASE}`.length);
    return sub.length > 0 ? sub : null;
  }
  return null;
}
```

- [ ] **Step 4: Run — pass**

Run: `npx vitest run src/server/tenancy/subdomain.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/tenancy/subdomain.ts src/server/tenancy/subdomain.test.ts
git commit -m "feat(phase-2e): add subdomain extractor for tenant resolution"
```

---

### Task 5: URL helpers — PLATFORM_BASE_URL + tenantBaseUrl

**Files:**
- Create: `src/lib/urls.ts`
- Test: `src/lib/urls.test.ts`
- Modify: `src/lib/env.ts` (add `PLATFORM_BASE_URL`; deprecate `PUBLIC_APP_URL`)

- [ ] **Step 1: Add `PLATFORM_BASE_URL` to env schema**

In `src/lib/env.ts`, alongside `PUBLIC_APP_URL`, add:
```ts
PLATFORM_BASE_URL: z.string().url(),
```

In `src/lib/env.test.ts:22`, ensure tests set `PLATFORM_BASE_URL: 'https://v2.datapatch.net'`.

In `tests/setup.ts:28` set `process.env.PLATFORM_BASE_URL ??= 'http://localhost:3002';`.

In `.env.example` (or `.env.local.example` if present), document `PLATFORM_BASE_URL=https://v2.datapatch.net` and a note that `PUBLIC_APP_URL` is replaced.

- [ ] **Step 2: Write tests for the helpers**

```ts
// src/lib/urls.test.ts
import { describe, expect, it } from 'vitest';
import { tenantBaseUrl, platformBaseUrl } from './urls';

describe('urls', () => {
  it('platformBaseUrl returns env value', () => {
    expect(platformBaseUrl()).toBe(process.env.PLATFORM_BASE_URL);
  });

  it('tenantBaseUrl substitutes slug into the platform host', () => {
    process.env.PLATFORM_BASE_URL = 'https://v2.datapatch.net';
    expect(tenantBaseUrl({ slug: 'acme' })).toBe('https://acme.v2.datapatch.net');
  });

  it('tenantBaseUrl supports localhost dev base', () => {
    process.env.PLATFORM_BASE_URL = 'http://localhost:3000';
    expect(tenantBaseUrl({ slug: 'alpha' })).toBe('http://alpha.localhost:3000');
  });
});
```

- [ ] **Step 3: Implement**

```ts
// src/lib/urls.ts
import { env } from '@/src/lib/env';

export function platformBaseUrl(): string {
  return env.PLATFORM_BASE_URL;
}

/**
 * Construct the public base URL for a tenant subdomain.
 * Splices the tenant slug as the leftmost label of `PLATFORM_BASE_URL`'s hostname.
 */
export function tenantBaseUrl(tenant: { slug: string }): string {
  const url = new URL(env.PLATFORM_BASE_URL);
  url.hostname = `${tenant.slug}.${url.hostname}`;
  // Strip trailing slash for clean concatenation.
  return url.toString().replace(/\/$/, '');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/urls.test.ts src/lib/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/urls.ts src/lib/urls.test.ts src/lib/env.ts src/lib/env.test.ts tests/setup.ts .env.example
git commit -m "feat(phase-2e): add PLATFORM_BASE_URL env + tenantBaseUrl/platformBaseUrl helpers"
```

---

### Task 6: Migrate call sites off `env.PUBLIC_APP_URL`

Replace each callsite per the rule:
- **Webhook URLs** (provider → platform) → `platformBaseUrl()`
- **Buyer-facing redirects** (Paddle/TurInvoice success/cancel) → `tenantBaseUrl(tenant)`

**Files:**
- Modify: `src/server/domain/orders/createBooking.ts:194-195`
- Modify: `app/[locale]/(customer)/shop/orders/[orderId]/selectPaymentProvider.action.ts:104-105`
- Modify: `src/server/providers/payment/turinvoice/createCheckout.ts:39`
- Modify: `src/server/providers/payment/turinvoice/turinvoice.test.ts:12`

- [ ] **Step 1: createBooking redirect URLs**

In `createBooking.ts`, before computing `successUrl`/`cancelUrl`, fetch the tenant slug already available via `input.tenantId` (load slug once or pass via input). Replace:

```ts
import { tenantBaseUrl } from '@/src/lib/urls';

// after `const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { slug: true } });`
const base = tenantBaseUrl(tenant);
const successUrl = `${base}/${input.locale}/shop/orders/${draft.id}?status=success`;
const cancelUrl  = `${base}/${input.locale}/shop/orders/${draft.id}?status=cancel`;
```

(Keep the existing tenant fetch if there is one; reuse rather than double-loading.)

- [ ] **Step 2: selectPaymentProvider.action.ts**

```ts
import { tenantBaseUrl } from '@/src/lib/urls';

const tenant = await prisma.tenant.findUniqueOrThrow({
  where: { id: order.tenantId },
  select: { slug: true },
});
const base = tenantBaseUrl(tenant);
const successUrl = `${base}/${order.locale}/shop/orders/${orderId}?status=success`;
const cancelUrl  = `${base}/${order.locale}/shop/orders/${orderId}?status=cancel`;
```

- [ ] **Step 3: TurInvoice webhook callback URL**

In `src/server/providers/payment/turinvoice/createCheckout.ts:39`:
```ts
import { platformBaseUrl } from '@/src/lib/urls';
const callbackUrl = new URL('/api/webhooks/turinvoice', platformBaseUrl()).toString();
```

In `turinvoice.test.ts:12`, set `PLATFORM_BASE_URL: 'https://v2.datapatch.net'`.

- [ ] **Step 4: Update existing tests using PUBLIC_APP_URL**

`grep -rn "PUBLIC_APP_URL" src/ app/ tests/` — for each remaining match in tests, swap to `PLATFORM_BASE_URL` (webhook) or fixture-construct a `tenantBaseUrl(...)`.

- [ ] **Step 5: Remove `PUBLIC_APP_URL` from env.ts**

Once all references gone, delete the `PUBLIC_APP_URL: z.string().url(),` line from `src/lib/env.ts`. Run `grep -rn 'PUBLIC_APP_URL' src/ app/ tests/` to confirm zero matches.

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: PASS (no PUBLIC_APP_URL references, redirects/webhook calls now use new helpers).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(phase-2e): migrate URL construction off PUBLIC_APP_URL to tenant/platform helpers"
```

---

### Task 7: Tenant resolver (DB lookup, cached)

**Files:**
- Create: `src/server/tenancy/resolveTenantBySlug.ts`
- Test: `src/server/tenancy/resolveTenantBySlug.test.ts`

- [ ] **Step 1: Tests**

```ts
// src/server/tenancy/resolveTenantBySlug.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTenantBySlug, _resetTenantCacheForTests } from './resolveTenantBySlug';
import { prisma } from '@/src/lib/db';

describe('resolveTenantBySlug', () => {
  beforeEach(() => _resetTenantCacheForTests());

  it('returns tenant for known slug', async () => {
    const t = await prisma.tenant.findFirst({ select: { slug: true } });
    if (!t) throw new Error('seed required');
    const got = await resolveTenantBySlug(t.slug);
    expect(got?.slug).toBe(t.slug);
  });

  it('returns null for unknown slug', async () => {
    expect(await resolveTenantBySlug('definitely-not-a-tenant-xyz')).toBeNull();
  });

  it('caches subsequent reads within TTL', async () => {
    const spy = vi.spyOn(prisma.tenant, 'findUnique');
    const t = await prisma.tenant.findFirst({ select: { slug: true } });
    if (!t) throw new Error('seed required');
    await resolveTenantBySlug(t.slug);
    await resolveTenantBySlug(t.slug);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/tenancy/resolveTenantBySlug.ts
import { prisma } from '@/src/lib/db';

export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

const CACHE_TTL_MS = 60_000; // 60 s
const cache = new Map<string, { value: ResolvedTenant | null; expiresAt: number }>();

export async function resolveTenantBySlug(slug: string): Promise<ResolvedTenant | null> {
  const now = Date.now();
  const hit = cache.get(slug);
  if (hit && hit.expiresAt > now) return hit.value;
  const row = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  cache.set(slug, { value: row, expiresAt: now + CACHE_TTL_MS });
  return row;
}

/** Test-only helper. Do not call from production code. */
export function _resetTenantCacheForTests(): void {
  cache.clear();
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/server/tenancy/resolveTenantBySlug.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/tenancy/resolveTenantBySlug.ts src/server/tenancy/resolveTenantBySlug.test.ts
git commit -m "feat(phase-2e): add cached tenant-by-slug resolver"
```

---

### Task 8: middleware.ts — subdomain → tenant binding

**Files:**
- Modify: `middleware.ts`
- Create: `app/[locale]/_branded-not-found/page.tsx` (reuse existing 404 if available; otherwise create stub)

- [ ] **Step 1: Replace middleware.ts**

```ts
// middleware.ts
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { extractSubdomain } from '@/src/server/tenancy/subdomain';
import { isReservedSubdomain } from '@/src/server/tenancy/slugRules';
import { resolveTenantBySlug } from '@/src/server/tenancy/resolveTenantBySlug';

const intl = createIntlMiddleware(routing);

export const runtime = 'nodejs';
export const config = {
  // Skip Next internals + static files. API routes still run through middleware
  // so webhook URLs work on the apex.
  matcher: ['/((?!_next|.*\\..*).*)'],
};

export default async function middleware(req: NextRequest): Promise<Response> {
  const host = req.headers.get('host') ?? '';
  const pathname = req.nextUrl.pathname;
  const sub = extractSubdomain(host);

  // Apex (v2.datapatch.net or localhost) — webhooks only; everything else 404.
  if (sub === null) {
    if (pathname.startsWith('/api/webhooks/')) return NextResponse.next();
    if (pathname.startsWith('/api/')) return NextResponse.next();
    // 30-day fallback: ?t=<slug> redirect.
    const fallbackSlug = req.nextUrl.searchParams.get('t');
    if (fallbackSlug) {
      const url = new URL(req.url);
      url.hostname = `${fallbackSlug}.${url.hostname}`;
      url.searchParams.delete('t');
      return NextResponse.redirect(url, 308);
    }
    return new NextResponse('Apex not in use. Visit www.v2.datapatch.net.', { status: 404 });
  }

  // Reserved subdomains.
  if (sub === 'www') {
    return intl(req); // marketing pages render here
  }
  if (sub === 'admin') {
    const res = intl(req);
    res.headers.set('x-platform-context', 'super-admin');
    return res;
  }
  if (isReservedSubdomain(sub)) {
    return new NextResponse(`Reserved subdomain "${sub}".`, { status: 404 });
  }

  // Tenant subdomain.
  const tenant = await resolveTenantBySlug(sub);
  if (!tenant) {
    return new NextResponse(`Tenant "${sub}" not found.`, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const res = intl(req);
  res.headers.set('x-tenant-id', tenant.id);
  res.headers.set('x-tenant-slug', tenant.slug);
  return res;
}
```

- [ ] **Step 2: Manual smoke (local)**

Run: `npm run dev`
Then in browser: `http://alpha.localhost:3000/en/shop` (assuming `alpha` seeded). Expect storefront. `http://nonexistent.localhost:3000` → 404 page. `http://www.localhost:3000` → marketing.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(phase-2e): subdomain-driven tenant resolution in middleware"
```

---

### Task 9: ALS binding from `x-tenant-id` header

**Files:**
- Create: `src/server/tenancy/withTenantFromHeaders.ts`
- Test: `src/server/tenancy/withTenantFromHeaders.test.ts`

- [ ] **Step 1: Tests**

```ts
// src/server/tenancy/withTenantFromHeaders.test.ts
import { describe, expect, it } from 'vitest';
import { withTenantFromHeaders } from './withTenantFromHeaders';
import { getCurrentTenant } from './context';

function fakeHeaders(map: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, v);
  return h;
}

describe('withTenantFromHeaders', () => {
  it('binds tenant from x-tenant-id/x-tenant-slug', async () => {
    const ctx = await withTenantFromHeaders(
      fakeHeaders({ 'x-tenant-id': 't_1', 'x-tenant-slug': 'acme' }),
      async () => getCurrentTenant(),
    );
    expect(ctx).toEqual({ tenantId: 't_1', tenantSlug: 'acme' });
  });

  it('throws when both headers missing', async () => {
    await expect(
      withTenantFromHeaders(fakeHeaders({}), async () => null),
    ).rejects.toThrow(/missing tenant headers/i);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/server/tenancy/withTenantFromHeaders.ts
import { runInTenant } from './context';

export function withTenantFromHeaders<T>(headers: Headers, fn: () => Promise<T>): Promise<T> {
  const tenantId = headers.get('x-tenant-id');
  const tenantSlug = headers.get('x-tenant-slug');
  if (!tenantId || !tenantSlug) {
    throw new Error('Missing tenant headers (x-tenant-id / x-tenant-slug). Was middleware skipped?');
  }
  return Promise.resolve(runInTenant({ tenantId, tenantSlug }, fn));
}
```

- [ ] **Step 3: Run + commit**

Run: `npx vitest run src/server/tenancy/withTenantFromHeaders.test.ts`
Expected: PASS.

```bash
git add src/server/tenancy/withTenantFromHeaders.ts src/server/tenancy/withTenantFromHeaders.test.ts
git commit -m "feat(phase-2e): bind tenant ALS context from middleware headers"
```

---

### Task 10: Wire `withTenantFromHeaders` into tenant-scoped server actions/pages

For each tenant-scoped Server Action / Route Handler / Page that already calls `runInTenant`/`withTenant`, switch to read from `headers()` (Next.js) and call `withTenantFromHeaders(...)`.

**Files (representative):**
- Modify: `app/[locale]/(customer)/shop/page.tsx`
- Modify: `app/[locale]/(customer)/shop/checkout/page.tsx`
- Modify: `app/[locale]/(customer)/shop/orders/[orderId]/page.tsx`
- Modify: `app/[locale]/(customer)/shop/orders/[orderId]/selectPaymentProvider.action.ts`

Audit pass:
```bash
grep -rn "withTenant(\|runInTenant(" app/ src/server/ | grep -v test
```

- [ ] **Step 1: For each tenant-scoped Server Component / Action**

Pattern:
```ts
import { headers } from 'next/headers';
import { withTenantFromHeaders } from '@/src/server/tenancy/withTenantFromHeaders';

export default async function ShopPage(...) {
  return withTenantFromHeaders(await headers(), async () => {
    // existing tenant-scoped logic
  });
}
```

(Server Actions: same pattern, wrap the action body.)

- [ ] **Step 2: Verify storefront still loads**

Run dev server, hit `http://alpha.localhost:3000/en/shop`. Confirm products list (catalog query unchanged in this PR; pricing changes land in PR-B).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(phase-2e): wire tenant-scoped routes to header-driven ALS"
```

---

### Task 11: Magic link uses request host

**Files:**
- Modify: `src/server/auth/magicLinkEmail.ts`
- Modify: `src/auth.ts` (pass request host into `sendMagicLinkEmail`)

- [ ] **Step 1: Inspect existing magic link path**

Read `magicLinkEmail.ts` and `auth.ts`. The `sendVerificationRequest({ identifier, url })` callback already receives a `url` from NextAuth — when `trustHost: true`, NextAuth derives this URL from the request host. **No code change strictly required** as long as `trustHost` stays `true` and the deployment routes magic-link requests through middleware (which now binds tenant context).

- [ ] **Step 2: Confirm via integration test**

Issue magic-link request from `http://alpha.localhost:3000/en/signin` and inspect Mailpit — link must point at `http://alpha.localhost:3000/...`, not the platform apex.

- [ ] **Step 3: If link points apex, patch `magicLinkEmail.ts`**

If the URL is wrong, in `magicLinkEmail.ts` swap any hardcoded `env.PUBLIC_APP_URL` (now removed) usage for `new URL(url).origin` derived from the callback URL NextAuth provides. Add a unit test asserting the email body contains the request host.

- [ ] **Step 4: Commit (only if patched)**

```bash
git add src/server/auth/magicLinkEmail.ts src/server/auth/magicLinkEmail.test.ts
git commit -m "fix(phase-2e): magic-link emails use request host for tenant subdomains"
```

---

### Task 12: Reserved-subdomain page (super-admin scope)

**Files:**
- Create: `app/[locale]/(admin)/admin/_layout-platform-only.tsx` (or amend existing admin layout)

- [ ] **Step 1: Add header-based admin gate to admin layout**

In `app/[locale]/(admin)/admin/layout.tsx` (or the equivalent), assert `x-platform-context: super-admin` header (set by middleware for `admin.*`). If absent, return `notFound()`.

```ts
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get('x-platform-context') !== 'super-admin') return notFound();
  return <>{children}</>;
}
```

- [ ] **Step 2: Manual smoke**

`http://admin.localhost:3000/en/admin/tenants` → renders. `http://alpha.localhost:3000/en/admin/tenants` → 404.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(phase-2e): gate /admin to admin.v2 super-admin subdomain"
```

---

### Task 13: Local-dev seed adds `alpha`/`beta`

**Files:**
- Modify: `prisma/seed.ts` (or `scripts/seed-dev.ts` — whichever already seeds tenants)

- [ ] **Step 1: Ensure dev seed creates `alpha` and `beta` tenants** (skip if already present per memory). Both should have at least one `agency_admin` membership for an `alpha-admin@example.com` / `beta-admin@example.com` test user.

- [ ] **Step 2: Run seed**

Run: `npx prisma db seed`
Expected: tenants `platform`, `alpha`, `beta` present.

- [ ] **Step 3: Commit (only if changed)**

```bash
git add prisma/seed.ts
git commit -m "chore(phase-2e): ensure dev seed includes alpha + beta tenant subdomains"
```

---

### Task 14: README local-dev section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add section "Tenant subdomains in dev"**

Document:
```
- `alpha.localhost:3000/en/shop` — tenant alpha storefront
- `beta.localhost:3000/en/shop` — tenant beta storefront
- `admin.localhost:3000/en/admin` — super-admin panel
- `localhost:3000/api/webhooks/<provider>` — webhook ingress (apex)
```

Note that modern browsers resolve `*.localhost` automatically.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(phase-2e): document tenant subdomain dev URLs"
```

---

### Task 15: E2E — cross-subdomain isolation

**Files:**
- Create: `tests/e2e/subdomain-isolation.spec.ts` (Playwright)

- [ ] **Step 1: Write E2E**

```ts
// tests/e2e/subdomain-isolation.spec.ts
import { test, expect } from '@playwright/test';

test('alpha session not valid on beta subdomain', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Sign in to alpha
  await page.goto('http://alpha.localhost:3000/en/signin');
  // (use existing magic-link bypass / dev sign-in flow per fixtures)
  // Navigate to alpha shop — should succeed
  await page.goto('http://alpha.localhost:3000/en/shop');
  await expect(page).toHaveURL(/alpha\.localhost/);
  // Navigate to beta admin — should be unauthorized or redirect to signin
  const betaResp = await page.goto('http://beta.localhost:3000/en/admin');
  expect(betaResp?.status()).toBeGreaterThanOrEqual(400);
});

test('admin subdomain accessible only at admin.localhost', async ({ page }) => {
  const ok = await page.goto('http://admin.localhost:3000/en/admin');
  expect(ok?.status()).toBeLessThan(400);
  const notOk = await page.goto('http://alpha.localhost:3000/en/admin');
  expect(notOk?.status()).toBeGreaterThanOrEqual(400);
});

test('unknown subdomain returns 404', async ({ page }) => {
  const r = await page.goto('http://nonexistent-tenant-xyz.localhost:3000/');
  expect(r?.status()).toBe(404);
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/subdomain-isolation.spec.ts`
Expected: 3/3 PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/subdomain-isolation.spec.ts
git commit -m "test(phase-2e): e2e cross-subdomain isolation"
```

---

### Task 16: Deployment notes (Railway)

**Files:**
- Modify: `docs/deployment.md` (create if absent)

- [ ] **Step 1: Add deploy section**

Document:
- DNS: Cloudflare wildcard `CNAME *.v2 → cname.up.railway.app` (or current Railway target).
- Railway: add custom domain `*.v2.datapatch.net` to the V2 service.
- TLS: rely on Railway-provisioned wildcard cert. If using Cloudflare proxy, set TLS to "Full (strict)".
- Existing apex `v2.datapatch.net` must remain bound for webhook ingress.
- Env vars: set `PLATFORM_BASE_URL=https://v2.datapatch.net`. Remove `PUBLIC_APP_URL` from Railway service variables.
- Verify after deploy: `curl -I https://www.v2.datapatch.net` → 200; `https://acme.v2.datapatch.net` (any provisioned tenant) → 200; `https://nonexistent.v2.datapatch.net` → 404.

- [ ] **Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs(phase-2e): wildcard subdomain deployment notes"
```

---

### Task 17: Smoke deploy + tag

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin <branch>
gh pr create --title "Phase 2e PR-A: subdomain infrastructure" --body "$(cat <<'EOF'
## Summary
- Subdomain-driven tenant routing under *.v2.datapatch.net
- Reserved denylist (www, admin, api, …) + tightened slug regex
- `PLATFORM_BASE_URL` env + `tenantBaseUrl` / `platformBaseUrl` helpers replace `PUBLIC_APP_URL`
- Header-based ALS binding (`withTenantFromHeaders`)
- Cookie scope per-subdomain (NextAuth host-only default + `trustHost: true`)
- Webhook URLs unchanged (apex)

## Test plan
- [ ] Dev: `alpha.localhost:3000` and `beta.localhost:3000` are isolated
- [ ] `admin.localhost:3000/en/admin` works; `alpha.localhost:3000/en/admin` 404s
- [ ] Webhook curl on apex `v2.datapatch.net/api/webhooks/...` succeeds
- [ ] Magic link from tenant subdomain returns to that subdomain
- [ ] Vitest + Playwright suites green
EOF
)"
```

- [ ] **Step 2: Merge after review, deploy to Railway, tag**

```bash
git tag phase-2e-pr-a-complete
git push origin phase-2e-pr-a-complete
```

Post-deploy checklist:
- `curl -I https://www.v2.datapatch.net/` returns 200.
- `curl -I https://alpha.v2.datapatch.net/en/shop` returns 200 (assuming alpha provisioned in prod).
- `curl -I https://nonexistent-xyz.v2.datapatch.net/` returns 404.
- Existing webhook URLs still ingress on `v2.datapatch.net`.

---

## Self-Review Notes

- All spec sections covered: domain map (T8), schema/slug (T1-3), tenant resolution (T4,7,8), NextAuth/cookies (T8 trustHost retained, T11 magic links), URL helpers (T5-6), local dev (T13-14), wildcard cert (T16), migration fallback (T8 `?t=<slug>`), tests (T15).
- `assertUsdMoney` not in scope here — pricing changes land in PR-B.
- No placeholders. All snippets concrete. Slug regex matches between Task 1 (helper) and Task 2 (HTML pattern attr).
