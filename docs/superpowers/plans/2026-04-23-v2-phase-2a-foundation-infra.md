# V2 Phase 2a — i18n Migration + Foundation Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the V2 app under `app/[locale]/` for URL-prefix i18n, add the Prisma schema for the domain (Order, Payment, Esim, ProviderPackage, PriceLock) plus infrastructure tables (WebhookEvent, OutboxEvent), wire BullMQ + Redis with a dedicated worker process, add a generic webhook ingestion endpoint, and lay down the pricing service skeleton. No payment/esim provider adapters yet — those belong to Phase 2b.

**Architecture:** The existing Phase 1 tenant context (AsyncLocalStorage + `withTenant`) and scoped repository pattern extend to all new tenant-scoped models. URL routing moves from cookie-only to URL-prefix (`/en/*`, `/tr/*`) via `next-intl` middleware; cookie still participates as fallback. Webhooks follow a **staged ingestion pipeline**: the HTTP endpoint persists the raw payload and enqueues a BullMQ job, returning 200 in <100 ms. A separate worker process (started by `scripts/worker.ts`) drains the `webhooks` queue, verifies signature (via a provider registry populated in Phase 2b), and triggers domain handlers. The **outbox pattern** buffers outbound side effects (emails, external API calls) inside the same DB transaction as the state change; a dedicated outbox worker drains it. Pricing is server-side authoritative — client-supplied prices are never trusted; a `PriceLock` row captures the quote at checkout time.

**Tech Stack:** Next.js 16 App Router (existing), Prisma 7 + Postgres (existing), Auth.js v5 (existing), next-intl v4 (existing — migrating to URL-prefix), BullMQ 5, ioredis 5, Zod v4, Vitest, Playwright.

**Target repo:** `/Users/turgt/Desktop/CODES/datapatch-v2`. V1 repo `/Users/turgt/Desktop/CODES/esim-management-2` MUST NOT be modified.

**Exit criteria:**
1. `/`, `/en`, `/tr` all resolve; unknown locale 404; requests without locale redirect to cookie/Accept-Language match (default `en`).
2. All existing Phase 1 surfaces function after migration: `/en/shop`, `/en/signin`, `/en/admin`, `/en/a/alpha/dashboard`, etc.
3. `prisma migrate dev` applies the new schema cleanly against a fresh DB.
4. `pnpm lint` rejects direct `prisma.order.*`, `prisma.payment.*`, `prisma.esim.*`, `prisma.providerPackage.*`, `prisma.priceLock.*`, `prisma.webhookEvent.*`, `prisma.outboxEvent.*` access outside the designated repository modules.
5. `POST /api/webhooks/paddle` with any JSON body + `x-test-event-id` header returns 200 in <200 ms, and a row is inserted into `webhook_events` (dedupe on `provider + external_event_id`).
6. Worker process started via `pnpm worker` picks up the enqueued webhook job, marks `webhook_events.status = 'received_no_handler'` (Phase 2b will plug in real handlers), and does not crash.
7. `GET /api/health` reports `{ status: 'ok', db: 'ok', redis: 'ok', queues: { pending: N, failed: 0 } }`.
8. `Money.add`, `Money.subtract`, `Money.multiply`, `Money.format` work correctly for TRY and USD; mixing currencies throws.
9. `calculatePrice({ packageId, quantity, currency })` returns a `Money`; passing a client-supplied `amount` is impossible by type.
10. `pnpm test` green (all new unit tests + all existing Phase 1 tests).
11. `pnpm test:e2e` green — including a new locale-routing Playwright test and an existing tenant-isolation test that still passes under the new URL structure.
12. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build` pass locally.
13. CI green on GitHub Actions (`quality` + `e2e` jobs).
14. Railway deploy serves v2.datapatch.net with both app and worker process running; `/en/admin/jobs` (platform_admin gated) renders a read-only queue stats table.
15. Tag `phase-2a-complete` pushed.

---

## File Structure (new or modified in this phase)

```
datapatch-v2/
├── app/
│   ├── [locale]/                              # NEW — wraps everything below
│   │   ├── layout.tsx                         # MOVED from app/layout.tsx
│   │   ├── page.tsx                           # MOVED from app/page.tsx
│   │   ├── dashboard/page.tsx                 # MOVED
│   │   ├── (admin)/admin/                     # MOVED (all admin pages)
│   │   │   └── jobs/page.tsx                  # NEW — queue stats (read-only)
│   │   ├── (agency)/a/[agencySlug]/           # MOVED
│   │   ├── (auth)/                            # MOVED (signin, check-email)
│   │   └── (customer)/shop/page.tsx           # MOVED
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts        # UNCHANGED (locale-less)
│   │   ├── health/route.ts                    # MODIFIED — add redis + queues
│   │   └── webhooks/
│   │       └── [provider]/route.ts            # NEW — generic ingest
│   ├── layout.tsx                             # REMOVED (moved under [locale])
│   └── page.tsx                               # REMOVED
├── middleware.ts                              # NEW — next-intl + auth session gate
├── i18n/
│   ├── routing.ts                             # MODIFIED — add createNavigation
│   ├── request.ts                             # MODIFIED — consume locale from route param
│   └── navigation.ts                          # NEW — typed Link, redirect, usePathname
├── prisma/
│   ├── schema.prisma                          # MODIFIED — add domain + infra tables
│   └── migrations/
│       └── YYYYMMDDHHMMSS_phase_2a_domain/    # NEW
├── src/
│   ├── lib/
│   │   ├── money.ts                           # NEW — Money + Currency
│   │   ├── money.test.ts                      # NEW
│   │   └── env.ts                             # MODIFIED — add BULLMQ_PREFIX
│   └── server/
│       ├── jobs/
│       │   ├── queue.ts                       # NEW — QUEUE_NAMES, getConnection
│       │   ├── queues.ts                      # NEW — Queue instances per name
│       │   ├── workers/
│       │   │   ├── webhook.ts                 # NEW — processor skeleton
│       │   │   ├── outbox.ts                  # NEW — processor skeleton
│       │   │   └── types.ts                   # NEW — job payload types
│       ├── webhooks/
│       │   ├── ingest.ts                      # NEW — persistRawEvent
│       │   └── ingest.test.ts                 # NEW
│       ├── outbox/
│       │   ├── enqueue.ts                     # NEW — enqueueOutbox in tx
│       │   └── enqueue.test.ts                # NEW
│       ├── domain/
│       │   └── pricing/
│       │       ├── calculatePrice.ts          # NEW
│       │       ├── calculatePrice.test.ts     # NEW
│       │       ├── lockPrice.ts               # NEW
│       │       └── lockPrice.test.ts          # NEW
│       └── tenancy/
│           ├── orderRepository.ts             # NEW
│           ├── orderRepository.test.ts        # NEW
│           ├── paymentRepository.ts           # NEW
│           ├── esimRepository.ts              # NEW
│           └── providerPackageRepository.ts   # NEW
├── scripts/
│   ├── worker.ts                              # NEW — worker process entry
│   └── seed.ts                                # MODIFIED — seed 2 ProviderPackages
├── tests/
│   ├── money.test.ts                          # (co-located above; listed here for clarity)
│   ├── pricing-calculate.test.ts              # (co-located above)
│   ├── webhook-ingest.test.ts                 # (co-located above)
│   ├── outbox-enqueue.test.ts                 # (co-located above)
│   └── queue-connection.test.ts               # NEW
├── e2e/
│   ├── locale-routing.spec.ts                 # NEW
│   └── tenant-isolation.spec.ts               # MODIFIED — adjust for /tr/a/...
├── docker-compose.yml                         # MODIFIED — add worker service
├── Dockerfile                                 # MODIFIED — new CMD script for worker
├── railway.json                               # MODIFIED — worker start command hint
├── eslint.config.mjs                          # MODIFIED — extend no-restricted-syntax
├── next.config.mjs                            # UNCHANGED
└── package.json                               # MODIFIED — bullmq, ioredis, concurrently deps + scripts
```

**File size target:** <300 lines per file. Split if exceeded.

---

## Prerequisites (one-time, before Task 1)

Run all of these from `/Users/turgt/Desktop/CODES/datapatch-v2`.

- [ ] **P.1: Create a feature branch and worktree**

```bash
cd /Users/turgt/Desktop/CODES/datapatch-v2
git checkout main
git pull
git checkout -b phase-2a-foundation
```

- [ ] **P.2: Confirm clean working tree and services up**

```bash
git status
docker compose ps
```

Expected: `git status` → clean. `docker compose ps` shows `postgres`, `redis`, `mailpit` healthy. If not, run `docker compose up -d`.

- [ ] **P.3: Confirm Phase 1 baseline is green**

```bash
pnpm test && pnpm lint && pnpm typecheck
```

Expected: all pass. If anything is red, STOP and fix before continuing.

---

## Task 1: Add URL-prefix i18n routing (middleware + restructure)

**Rationale:** Moving now, before any new pages are added, avoids re-migrating them later. Phase 1 used cookie-based locale; Phase 2a moves to path-based per spec Section 6.1.

**Files:**
- Create: `middleware.ts`
- Create: `i18n/navigation.ts`
- Modify: `i18n/routing.ts`
- Modify: `i18n/request.ts`
- Modify: `package.json` (no new dep; next-intl already ≥3.22 has the middleware helper)

- [ ] **Step 1.1: Update `i18n/routing.ts` to define the routing object**

Replace the entire file contents with:

```typescript
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'tr'],
  defaultLocale: 'en',
  localeCookie: { name: 'NEXT_LOCALE' },
  localePrefix: 'always',
});

export const locales = routing.locales;
export type Locale = (typeof routing.locales)[number];
export const defaultLocale: Locale = routing.defaultLocale;
```

- [ ] **Step 1.2: Create `i18n/navigation.ts` with the typed nav helpers**

```typescript
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

- [ ] **Step 1.3: Update `i18n/request.ts` to use the `requestLocale` parameter**

Replace the entire file contents with:

```typescript
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = (await import(`@/messages/${locale}.json`)).default;
  return { locale, messages };
});
```

- [ ] **Step 1.4: Create `middleware.ts` combining next-intl + auth**

```typescript
import NextAuth from 'next-auth';
import createIntlMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { authConfig } from '@/src/auth.config';
import { routing } from '@/i18n/routing';

const intlMiddleware = createIntlMiddleware(routing);
const { auth } = NextAuth(authConfig);

export default async function middleware(req: NextRequest) {
  // Let Auth.js see the request to refresh JWT cookies etc., but the response
  // must come from next-intl so locale prefix handling works for every route.
  const authReq = req as NextRequest & { auth?: unknown };
  await auth(() => undefined as never)(authReq, {} as never).catch(() => undefined);
  return intlMiddleware(req);
}

export const config = {
  // Skip API, Next internals, and static files.
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
```

- [ ] **Step 1.5: Run typecheck to catch any stale imports**

```bash
pnpm typecheck
```

Expected: FAILS because `app/layout.tsx` and pages still reference the old context. That's fine — we fix them in the next task's subtree move. Continue.

- [ ] **Step 1.6: Commit**

```bash
git add middleware.ts i18n/
git commit -m "feat(i18n): add URL-prefix routing + navigation helpers"
```

---

## Task 2: Restructure app tree under `app/[locale]/`

**Rationale:** Next.js App Router requires the dynamic `[locale]` segment at the top level for prefix-based i18n. All existing Phase 1 pages move under it.

**Files:**
- Move: `app/layout.tsx` → `app/[locale]/layout.tsx`
- Move: `app/page.tsx` → `app/[locale]/page.tsx`
- Move: `app/dashboard/page.tsx` → `app/[locale]/dashboard/page.tsx`
- Move: `app/(admin)/**` → `app/[locale]/(admin)/**`
- Move: `app/(agency)/**` → `app/[locale]/(agency)/**`
- Move: `app/(auth)/**` → `app/[locale]/(auth)/**`
- Move: `app/(customer)/**` → `app/[locale]/(customer)/**`
- Keep: `app/api/**` (route handlers are locale-less)
- Modify: moved `app/[locale]/layout.tsx` (signature change)

- [ ] **Step 2.1: Perform the file moves with `git mv` to preserve history**

```bash
mkdir -p app/[locale]
git mv 'app/(admin)' 'app/[locale]/(admin)'
git mv 'app/(agency)' 'app/[locale]/(agency)'
git mv 'app/(auth)' 'app/[locale]/(auth)'
git mv 'app/(customer)' 'app/[locale]/(customer)'
git mv app/dashboard 'app/[locale]/dashboard'
git mv app/layout.tsx 'app/[locale]/layout.tsx'
git mv app/page.tsx 'app/[locale]/page.tsx'
ls app/
```

Expected after `ls app/`: only `api/` and `[locale]/` remain.

- [ ] **Step 2.2: Update `app/[locale]/layout.tsx` to accept + validate the locale param**

Open `app/[locale]/layout.tsx`. At the top of the component signature, change the props type and validate the incoming locale:

```typescript
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
// ...other existing imports stay

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

Preserve any existing `<body className="...">` / font / theme classnames that were previously there. The only structural change is the locale param unwrap + `hasLocale` guard + `setRequestLocale`.

- [ ] **Step 2.3: Update every moved page that imports from `next/link` or `next/navigation` to use the new `i18n/navigation` helpers**

Run this ripgrep to locate callers:

```bash
rg -n "from 'next/link'|from 'next/navigation'" app/
```

For each hit inside `app/[locale]/`:
- Replace `import Link from 'next/link'` with `import { Link } from '@/i18n/navigation'`.
- Replace `import { redirect } from 'next/navigation'` with `import { redirect } from '@/i18n/navigation'`.
- Leave `notFound` and `permanentRedirect` imports from `next/navigation` untouched — they aren't locale-aware but still work.

Only edit files under `app/[locale]/`. Do not touch `app/api/`.

- [ ] **Step 2.4: Add `setRequestLocale` call at the top of each nested segment that sets its own `dynamic`**

For every `page.tsx` under `app/[locale]/` that already exports `dynamic = 'force-dynamic'`, add at the top:

```typescript
import { setRequestLocale } from 'next-intl/server';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // ...existing body
}
```

If a page already accepts `params` with `agencySlug`, merge the types:

```typescript
params: Promise<{ locale: string; agencySlug: string }>
```

This is the Next.js 16 pattern for static-rendered localized segments; skipping it forces dynamic rendering on pages that don't need it.

- [ ] **Step 2.5: Update `app/[locale]/dashboard/page.tsx` to redirect using the locale-aware helper**

Replace the existing `redirect(...)` call with one from `i18n/navigation`:

```typescript
import { redirect } from '@/i18n/navigation';
// ...
redirect({ href: '/admin' });
// or for dynamic:
redirect({ href: { pathname: '/a/[agencySlug]/dashboard', params: { agencySlug: 'alpha' } } });
```

Adjust the exact redirect targets to match what the original dashboard page did (look at the git diff). The key point is that `redirect` is imported from `@/i18n/navigation`, not `next/navigation`.

- [ ] **Step 2.6: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If errors mention missing `params.locale`, that page needs Step 2.4 applied.

- [ ] **Step 2.7: Run dev server manually and smoke test each surface**

```bash
pnpm dev
```

In a browser or with curl:
- `curl -I http://localhost:3002/` → expect `302` → `/en`
- `curl -I http://localhost:3002/en` → expect `200`
- `curl -I http://localhost:3002/tr` → expect `200`
- `curl -I http://localhost:3002/zh` → expect `404`
- `curl -I http://localhost:3002/en/shop` → expect `200`
- `curl -I http://localhost:3002/en/signin` → expect `200`

Stop the dev server (Ctrl+C) after verification.

- [ ] **Step 2.8: Commit**

```bash
git add app/ i18n/
git commit -m "refactor(i18n): restructure app tree under [locale] for URL-prefix routing"
```

---

## Task 3: Update existing E2E tests + add locale routing test

**Files:**
- Modify: `e2e/auth.spec.ts`
- Modify: `e2e/home.spec.ts`
- Modify: `e2e/tenant-isolation.spec.ts`
- Create: `e2e/locale-routing.spec.ts`

- [ ] **Step 3.1: Write the new locale-routing E2E test**

Create `e2e/locale-routing.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('locale routing', () => {
  test('root redirects to default locale prefix', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toMatch(/\/en(\/|$)/);
  });

  test('explicit /en renders in English', async ({ page }) => {
    await page.goto('/en');
    await expect(page).toHaveURL(/\/en(\/|$)/);
    // home should render something (site title, nav) — loose check so the test
    // stays green as copy evolves.
    await expect(page.locator('html[lang="en"]')).toBeVisible();
  });

  test('explicit /tr renders in Turkish', async ({ page }) => {
    await page.goto('/tr');
    await expect(page).toHaveURL(/\/tr(\/|$)/);
    await expect(page.locator('html[lang="tr"]')).toBeVisible();
  });

  test('unknown locale segment 404s', async ({ page }) => {
    const response = await page.goto('/zh');
    expect(response?.status()).toBe(404);
  });
});
```

- [ ] **Step 3.2: Update existing E2E specs to use locale-prefixed paths**

For each existing spec file (`e2e/auth.spec.ts`, `e2e/home.spec.ts`, `e2e/tenant-isolation.spec.ts`):

- Replace any hardcoded URL that starts with `/signin`, `/dashboard`, `/admin`, `/a/`, `/shop` with the `/en` prefix.
- Keep `/api/*` paths unchanged.
- `page.goto('/signin')` → `page.goto('/en/signin')`, etc.

After editing, run:

```bash
rg -n "goto\('\/(signin|dashboard|admin|a\/|shop)" e2e/
```

Expected: no hits (all callers now use `/en/...` or similar).

- [ ] **Step 3.3: Run the E2E suite**

```bash
pnpm test:e2e
```

Expected: all specs green including the 4 new locale tests. If any tenant-isolation assertion fails on URL, update its expected URL to include the locale prefix.

- [ ] **Step 3.4: Commit**

```bash
git add e2e/
git commit -m "test(e2e): update specs for locale-prefixed URLs + add locale routing spec"
```

---

## Task 4: Add `Money` type + currency utilities

**Rationale:** Prevents floating-point money bugs and makes currency a first-class type. Spec Section 6.1 mandates `Money { amount: bigint (minor units), currency: ISO4217 }`.

**Files:**
- Create: `src/lib/money.ts`
- Create: `src/lib/money.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/lib/money.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { Money, add, subtract, multiply, zero, format, parseMajor } from './money';

describe('Money', () => {
  it('constructs with minor units (bigint)', () => {
    const m: Money = { amount: 1250n, currency: 'USD' };
    expect(m.amount).toBe(1250n);
    expect(m.currency).toBe('USD');
  });

  it('zero() returns 0 amount for a given currency', () => {
    expect(zero('TRY')).toEqual({ amount: 0n, currency: 'TRY' });
  });

  it('add() sums two same-currency amounts', () => {
    const a: Money = { amount: 1000n, currency: 'USD' };
    const b: Money = { amount: 2500n, currency: 'USD' };
    expect(add(a, b)).toEqual({ amount: 3500n, currency: 'USD' });
  });

  it('add() throws when currencies differ', () => {
    const a: Money = { amount: 1000n, currency: 'USD' };
    const b: Money = { amount: 2500n, currency: 'TRY' };
    expect(() => add(a, b)).toThrow(/currency mismatch/);
  });

  it('subtract() returns difference', () => {
    const a: Money = { amount: 5000n, currency: 'USD' };
    const b: Money = { amount: 1500n, currency: 'USD' };
    expect(subtract(a, b)).toEqual({ amount: 3500n, currency: 'USD' });
  });

  it('multiply() scales by an integer quantity', () => {
    const a: Money = { amount: 1250n, currency: 'USD' };
    expect(multiply(a, 3)).toEqual({ amount: 3750n, currency: 'USD' });
  });

  it('multiply() rejects non-integer quantity', () => {
    const a: Money = { amount: 1250n, currency: 'USD' };
    expect(() => multiply(a, 1.5)).toThrow(/integer/);
  });

  it('format() produces a locale-aware string with 2 decimals', () => {
    const a: Money = { amount: 1299n, currency: 'USD' };
    expect(format(a, 'en-US')).toBe('$12.99');
    const b: Money = { amount: 199999n, currency: 'TRY' };
    expect(format(b, 'tr-TR')).toMatch(/1\.999,99|1,999\.99/); // locale-dependent decimal sep
  });

  it('parseMajor() converts a major-unit number to minor units', () => {
    expect(parseMajor(12.99, 'USD')).toEqual({ amount: 1299n, currency: 'USD' });
    expect(parseMajor(0, 'USD')).toEqual({ amount: 0n, currency: 'USD' });
  });

  it('parseMajor() rounds to 2 decimal places', () => {
    // Banker's rounding not required; round-half-up acceptable.
    expect(parseMajor(12.995, 'USD').amount).toBe(1300n);
  });
});
```

- [ ] **Step 4.2: Run the test to confirm it fails**

```bash
pnpm test src/lib/money.test.ts
```

Expected: FAILS with "Cannot find module './money'".

- [ ] **Step 4.3: Write the minimal implementation**

Create `src/lib/money.ts`:

```typescript
/**
 * ISO-4217 currencies used by the platform. Extend as new providers come online.
 */
export const CURRENCIES = ['USD', 'EUR', 'TRY', 'GBP'] as const;
export type Currency = (typeof CURRENCIES)[number];

/**
 * A monetary amount expressed as an integer count of the smallest indivisible
 * unit of the currency (e.g. cents for USD, kuruş for TRY). Floats are forbidden.
 */
export interface Money {
  readonly amount: bigint;
  readonly currency: Currency;
}

/** For now all supported currencies are 2-decimal. Generalize if JPY/KWD/etc land later. */
const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  USD: 2,
  EUR: 2,
  TRY: 2,
  GBP: 2,
};

export function zero(currency: Currency): Money {
  return { amount: 0n, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Money currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new Error(`Money.multiply requires an integer quantity, got ${quantity}`);
  }
  return { amount: a.amount * BigInt(quantity), currency: a.currency };
}

export function format(money: Money, locale: string = 'en-US'): string {
  const exponent = MINOR_UNIT_EXPONENT[money.currency];
  const major = Number(money.amount) / 10 ** exponent;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(major);
}

export function parseMajor(major: number, currency: Currency): Money {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  // Round-half-up to the nearest minor unit.
  const scaled = Math.round(major * 10 ** exponent);
  return { amount: BigInt(scaled), currency };
}
```

- [ ] **Step 4.4: Run the test to confirm it passes**

```bash
pnpm test src/lib/money.test.ts
```

Expected: all 10 cases green.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/money.ts src/lib/money.test.ts
git commit -m "feat(money): add Money type + currency utilities"
```

---

## Task 5: Install BullMQ, ioredis, concurrently

**Files:**
- Modify: `package.json` (via pnpm add)

- [ ] **Step 5.1: Install runtime deps**

```bash
pnpm add bullmq ioredis
```

- [ ] **Step 5.2: Install dev deps**

```bash
pnpm add -D concurrently
```

- [ ] **Step 5.3: Verify versions (informational — pin only if flaky)**

```bash
jq '.dependencies | {bullmq, ioredis}' package.json && jq '.devDependencies.concurrently' package.json
```

Expected: `bullmq` ≥5.x, `ioredis` ≥5.x, `concurrently` present.

- [ ] **Step 5.4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add bullmq, ioredis, concurrently"
```

---

## Task 6: Extend Prisma schema with domain + infrastructure tables

**Rationale:** All new models that land in Phase 2b (Payment, Esim, ProviderPackage) or support infra (WebhookEvent, OutboxEvent) have their schema defined now so a single migration captures the shape change.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/YYYYMMDDHHMMSS_phase_2a_domain/migration.sql` (generated)

- [ ] **Step 6.1: Append the new models to `prisma/schema.prisma`**

At the end of the file (after the existing `AuditLog` model), add:

```prisma
// ───────────────────────────────────────────────
// Domain: Provider catalog
// ───────────────────────────────────────────────

enum EsimProviderId {
  airalo
  zendit
}

enum PaymentProviderId {
  paddle
  turinvoice
}

model ProviderPackage {
  id            String          @id @default(cuid())
  providerId    EsimProviderId
  sku           String
  name          String
  countryCodes  String[]        // ISO 3166-1 alpha-2 list (e.g., ["TR", "US"])
  dataMb        Int?
  durationDays  Int?
  priceAmount   BigInt          // Upstream cost (minor units)
  priceCurrency String          // ISO-4217
  rawMetadata   Json?           // Upstream response snapshot, opaque to domain
  active        Boolean         @default(true)
  syncedAt      DateTime        @default(now())
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  esims         Esim[]
  priceLocks    PriceLock[]

  @@unique([providerId, sku])
  @@index([providerId, active])
  @@map("provider_packages")
}

// ───────────────────────────────────────────────
// Domain: Orders, Payments, eSIMs (tenant-scoped)
// ───────────────────────────────────────────────

enum OrderStatus {
  draft
  awaiting_payment
  paid
  provisioning
  provisioned
  active
  expired
  cancelled
  refunded
  failed
}

enum PaymentStatus {
  pending
  authorized
  captured
  failed
  refunded
  cancelled
}

enum EsimStatus {
  pending
  provisioned
  active
  suspended
  expired
  cancelled
  failed
}

model Order {
  id            String       @id @default(cuid())
  tenantId      String
  buyerUserId   String?      // Nullable: B2C guest checkout supported in Phase 2b
  buyerEmail    String
  status        OrderStatus  @default(draft)
  totalAmount   BigInt
  totalCurrency String
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  tenant    Tenant      @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  items     OrderItem[]
  payments  Payment[]
  esims     Esim[]
  priceLock PriceLock?

  @@index([tenantId, status])
  @@index([tenantId, createdAt])
  @@map("orders")
}

model OrderItem {
  id              String   @id @default(cuid())
  orderId         String
  providerPackageId String
  quantity        Int
  unitAmount      BigInt
  unitCurrency    String
  subtotalAmount  BigInt
  subtotalCurrency String

  order           Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  providerPackage ProviderPackage  @relation(fields: [providerPackageId], references: [id], onDelete: Restrict)

  @@index([orderId])
  @@map("order_items")
}

model Payment {
  id                String            @id @default(cuid())
  tenantId          String
  orderId           String
  providerId        PaymentProviderId
  externalPaymentId String?           // Set once the provider returns one
  status            PaymentStatus     @default(pending)
  amount            BigInt
  currency          String
  capturedAt        DateTime?
  refundedAt        DateTime?
  failureReason     String?
  rawMetadata       Json?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  order  Order  @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@unique([providerId, externalPaymentId])
  @@index([tenantId, status])
  @@index([orderId])
  @@map("payments")
}

model Esim {
  id                 String         @id @default(cuid())
  tenantId           String
  orderId            String
  providerPackageId  String
  providerId         EsimProviderId
  iccid              String?        // Assigned at provisioning time
  status             EsimStatus     @default(pending)
  activationCode     String?
  qrPayload          String?        // LPA string e.g. LPA:1$...
  installedAt        DateTime?
  expiresAt          DateTime?
  rawMetadata        Json?
  createdAt          DateTime       @default(now())
  updatedAt          DateTime       @updatedAt

  tenant          Tenant           @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  order           Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  providerPackage ProviderPackage  @relation(fields: [providerPackageId], references: [id], onDelete: Restrict)

  @@unique([providerId, iccid])
  @@index([tenantId, status])
  @@index([orderId])
  @@map("esims")
}

// ───────────────────────────────────────────────
// Pricing authority
// ───────────────────────────────────────────────

model PriceLock {
  id              String   @id @default(cuid())
  orderId         String   @unique
  providerPackageId String
  quantity        Int
  unitAmount      BigInt
  unitCurrency    String
  totalAmount     BigInt
  totalCurrency   String
  lockedAt        DateTime @default(now())
  expiresAt       DateTime

  order           Order            @relation(fields: [orderId], references: [id], onDelete: Cascade)
  providerPackage ProviderPackage  @relation(fields: [providerPackageId], references: [id], onDelete: Restrict)

  @@map("price_locks")
}

// ───────────────────────────────────────────────
// Webhook ingestion + outbox (tenant-less infra)
// ───────────────────────────────────────────────

enum WebhookStatus {
  received
  processing
  processed
  received_no_handler
  failed
  dlq
}

enum OutboxStatus {
  pending
  processing
  sent
  failed
  dlq
}

model WebhookEvent {
  id               String        @id @default(cuid())
  provider         String        // "paddle" | "turinvoice" | "airalo" | "zendit" | "resend"
  externalEventId  String
  signatureHeader  String?       // raw signature as received
  rawHeaders       Json
  rawBody          String        // verbatim body for signature re-verification
  status           WebhookStatus @default(received)
  attempts         Int           @default(0)
  lastError        String?
  receivedAt       DateTime      @default(now())
  processedAt      DateTime?

  @@unique([provider, externalEventId])
  @@index([status, receivedAt])
  @@map("webhook_events")
}

model OutboxEvent {
  id          String       @id @default(cuid())
  tenantId    String?      // Nullable for platform-wide events
  kind        String       // "email.send" | "audit.ship" | ...
  payload     Json
  status      OutboxStatus @default(pending)
  attempts    Int          @default(0)
  lastError   String?
  availableAt DateTime     @default(now())
  sentAt      DateTime?
  createdAt   DateTime     @default(now())

  @@index([status, availableAt])
  @@map("outbox_events")
}
```

Then, inside the existing `Tenant` model, add reverse relations so Prisma generates them:

```prisma
model Tenant {
  // ...existing fields...
  orders      Order[]
  payments    Payment[]
  esims       Esim[]
}
```

- [ ] **Step 6.2: Generate the migration**

```bash
pnpm exec prisma migrate dev --name phase_2a_domain
```

Expected: a new folder under `prisma/migrations/` appears, `pnpm db:generate` runs automatically, and the local DB has the new tables.

- [ ] **Step 6.3: Verify the schema against the DB**

```bash
pnpm exec prisma migrate status
```

Expected: "Database schema is up to date!".

- [ ] **Step 6.4: Run typecheck to ensure generated types compile**

```bash
pnpm typecheck
```

Expected: PASS. If errors reference unknown Prisma enum members, regenerate with `pnpm db:generate`.

- [ ] **Step 6.5: Commit**

```bash
git add prisma/
git commit -m "feat(db): add orders, payments, esims, provider_packages, price_locks, webhook_events, outbox_events"
```

---

## Task 7: Extend ESLint no-restricted-syntax to cover new tenant-scoped models

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 7.1: Update the `no-restricted-syntax` rule to include the new models**

Open `eslint.config.mjs` and extend the `selector` regex + the `ignores` list:

```javascript
// ...existing top of file unchanged...
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: [
      'src/server/tenancy/repository.ts',
      'src/server/tenancy/orderRepository.ts',
      'src/server/tenancy/paymentRepository.ts',
      'src/server/tenancy/esimRepository.ts',
      'src/server/tenancy/providerPackageRepository.ts',
      'src/server/audit/log.ts',
      'src/server/rbac/roles.ts',
      'src/server/webhooks/ingest.ts',
      'src/server/outbox/enqueue.ts',
      'src/server/domain/pricing/calculatePrice.ts',
      'src/server/domain/pricing/lockPrice.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='prisma'][property.name=/^(userTenantMembership|auditLog|order|orderItem|payment|esim|providerPackage|priceLock|webhookEvent|outboxEvent)$/]",
          message:
            'Tenant-scoped or gated models must be accessed via their repository/service helpers in src/server/*, not directly on `prisma`.',
        },
      ],
    },
  },
```

- [ ] **Step 7.2: Run lint — should pass because the forbidden files don't exist yet**

```bash
pnpm lint
```

Expected: no errors. (When Tasks 8–11 add files, the ESLint guard kicks in.)

- [ ] **Step 7.3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(eslint): restrict new domain + infra models to repository helpers"
```

---

## Task 8: Build scoped repositories for Order / Payment / Esim / ProviderPackage

**Files:**
- Create: `src/server/tenancy/orderRepository.ts`
- Create: `src/server/tenancy/orderRepository.test.ts`
- Create: `src/server/tenancy/paymentRepository.ts`
- Create: `src/server/tenancy/esimRepository.ts`
- Create: `src/server/tenancy/providerPackageRepository.ts`

- [ ] **Step 8.1: Write the failing test for `orderRepository`**

Create `src/server/tenancy/orderRepository.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { runInTenant } from './context';
import {
  listOrders,
  getOrder,
  createDraftOrder,
  updateOrderStatus,
} from './orderRepository';

async function setupTenants() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE orders, tenants, user_tenant_memberships RESTART IDENTITY CASCADE`,
  );
  const alpha = await prisma.tenant.create({ data: { slug: 'alpha', name: 'Alpha' } });
  const beta = await prisma.tenant.create({ data: { slug: 'beta', name: 'Beta' } });
  return { alpha, beta };
}

describe('orderRepository', () => {
  beforeEach(async () => {
    await setupTenants();
  });

  it('createDraftOrder creates a draft under the active tenant', async () => {
    const { alpha } = await setupTenants();
    const order = await runInTenant(
      { tenantId: alpha.id, tenantSlug: alpha.slug },
      async () => createDraftOrder({ buyerEmail: 'buyer@example.com' }),
    );
    expect(order.tenantId).toBe(alpha.id);
    expect(order.status).toBe('draft');
    expect(order.totalAmount).toBe(0n);
  });

  it('listOrders only returns the active tenant rows', async () => {
    const { alpha, beta } = await setupTenants();
    await runInTenant({ tenantId: alpha.id, tenantSlug: alpha.slug }, () =>
      createDraftOrder({ buyerEmail: 'a@example.com' }),
    );
    await runInTenant({ tenantId: beta.id, tenantSlug: beta.slug }, () =>
      createDraftOrder({ buyerEmail: 'b@example.com' }),
    );
    const alphaOrders = await runInTenant(
      { tenantId: alpha.id, tenantSlug: alpha.slug },
      () => listOrders(),
    );
    expect(alphaOrders).toHaveLength(1);
    expect(alphaOrders[0]!.buyerEmail).toBe('a@example.com');
  });

  it('getOrder returns null for an order belonging to another tenant', async () => {
    const { alpha, beta } = await setupTenants();
    const betaOrder = await runInTenant(
      { tenantId: beta.id, tenantSlug: beta.slug },
      () => createDraftOrder({ buyerEmail: 'b@example.com' }),
    );
    const fromAlpha = await runInTenant(
      { tenantId: alpha.id, tenantSlug: alpha.slug },
      () => getOrder(betaOrder.id),
    );
    expect(fromAlpha).toBeNull();
  });

  it('updateOrderStatus only mutates the active tenant row', async () => {
    const { alpha } = await setupTenants();
    const order = await runInTenant(
      { tenantId: alpha.id, tenantSlug: alpha.slug },
      () => createDraftOrder({ buyerEmail: 'a@example.com' }),
    );
    const updated = await runInTenant(
      { tenantId: alpha.id, tenantSlug: alpha.slug },
      () => updateOrderStatus(order.id, 'awaiting_payment'),
    );
    expect(updated.status).toBe('awaiting_payment');
  });

  it('createDraftOrder without a tenant context throws', async () => {
    await expect(createDraftOrder({ buyerEmail: 'x@example.com' })).rejects.toThrow(
      /tenant context/,
    );
  });
});
```

- [ ] **Step 8.2: Run the test to confirm it fails**

```bash
pnpm test src/server/tenancy/orderRepository.test.ts
```

Expected: FAILS with "Cannot find module './orderRepository'".

- [ ] **Step 8.3: Implement `orderRepository.ts`**

Create `src/server/tenancy/orderRepository.ts`:

```typescript
import type { Order, OrderStatus } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { requireTenant } from './context';

/**
 * Tenant-scoped data access for orders. All functions in this module automatically
 * inject `tenantId` from the active tenant context. Call sites outside this module
 * MUST NOT access `prisma.order.*` directly (enforced by ESLint).
 */

export interface CreateDraftOrderInput {
  buyerEmail: string;
  buyerUserId?: string;
  currency?: string;
}

export async function createDraftOrder(input: CreateDraftOrderInput): Promise<Order> {
  const { tenantId } = requireTenant();
  return prisma.order.create({
    data: {
      tenantId,
      buyerEmail: input.buyerEmail,
      buyerUserId: input.buyerUserId ?? null,
      status: 'draft',
      totalAmount: 0n,
      totalCurrency: input.currency ?? 'USD',
    },
  });
}

export async function listOrders(limit: number = 50): Promise<Order[]> {
  const { tenantId } = requireTenant();
  return prisma.order.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getOrder(id: string): Promise<Order | null> {
  const { tenantId } = requireTenant();
  return prisma.order.findFirst({
    where: { id, tenantId },
  });
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
): Promise<Order> {
  const { tenantId } = requireTenant();
  const result = await prisma.order.updateMany({
    where: { id, tenantId },
    data: { status },
  });
  if (result.count === 0) {
    throw new Error(`Order ${id} not found in active tenant`);
  }
  const updated = await prisma.order.findUniqueOrThrow({ where: { id } });
  return updated;
}
```

- [ ] **Step 8.4: Run the test to confirm it passes**

```bash
pnpm test src/server/tenancy/orderRepository.test.ts
```

Expected: all 5 cases green.

- [ ] **Step 8.5: Implement `paymentRepository.ts` (no test yet — pattern is identical; full test arrives in Phase 2b)**

Create `src/server/tenancy/paymentRepository.ts`:

```typescript
import type { Payment, PaymentStatus, PaymentProviderId, Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { requireTenant } from './context';

export interface CreatePaymentInput {
  orderId: string;
  providerId: PaymentProviderId;
  amount: bigint;
  currency: string;
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const { tenantId } = requireTenant();
  return prisma.payment.create({
    data: {
      tenantId,
      orderId: input.orderId,
      providerId: input.providerId,
      status: 'pending',
      amount: input.amount,
      currency: input.currency,
    },
  });
}

export async function listPaymentsByOrder(orderId: string): Promise<Payment[]> {
  const { tenantId } = requireTenant();
  return prisma.payment.findMany({
    where: { tenantId, orderId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  extra: Partial<Pick<Payment, 'externalPaymentId' | 'capturedAt' | 'refundedAt' | 'failureReason'>> = {},
  metadata?: Prisma.InputJsonValue,
): Promise<Payment> {
  const { tenantId } = requireTenant();
  const result = await prisma.payment.updateMany({
    where: { id, tenantId },
    data: { status, ...extra, ...(metadata !== undefined ? { rawMetadata: metadata } : {}) },
  });
  if (result.count === 0) {
    throw new Error(`Payment ${id} not found in active tenant`);
  }
  return prisma.payment.findUniqueOrThrow({ where: { id } });
}
```

- [ ] **Step 8.6: Implement `esimRepository.ts`**

Create `src/server/tenancy/esimRepository.ts`:

```typescript
import type { Esim, EsimStatus, EsimProviderId } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { requireTenant } from './context';

export interface CreateEsimInput {
  orderId: string;
  providerPackageId: string;
  providerId: EsimProviderId;
}

export async function createEsim(input: CreateEsimInput): Promise<Esim> {
  const { tenantId } = requireTenant();
  return prisma.esim.create({
    data: {
      tenantId,
      orderId: input.orderId,
      providerPackageId: input.providerPackageId,
      providerId: input.providerId,
      status: 'pending',
    },
  });
}

export async function updateEsimStatus(
  id: string,
  status: EsimStatus,
  extra: Partial<Pick<Esim, 'iccid' | 'activationCode' | 'qrPayload' | 'installedAt' | 'expiresAt'>> = {},
): Promise<Esim> {
  const { tenantId } = requireTenant();
  const result = await prisma.esim.updateMany({
    where: { id, tenantId },
    data: { status, ...extra },
  });
  if (result.count === 0) {
    throw new Error(`Esim ${id} not found in active tenant`);
  }
  return prisma.esim.findUniqueOrThrow({ where: { id } });
}

export async function listEsimsByOrder(orderId: string): Promise<Esim[]> {
  const { tenantId } = requireTenant();
  return prisma.esim.findMany({
    where: { tenantId, orderId },
    orderBy: { createdAt: 'asc' },
  });
}
```

- [ ] **Step 8.7: Implement `providerPackageRepository.ts` (platform-level — no tenant scope)**

ProviderPackage is a shared catalog across tenants (same Airalo SKU for everyone). Tenant scoping happens when an order line references a package, not at the catalog level.

Create `src/server/tenancy/providerPackageRepository.ts`:

```typescript
import type { EsimProviderId, ProviderPackage } from '@prisma/client';
import { prisma } from '@/src/lib/db';

/**
 * Platform-level (tenant-less) access to the shared provider package catalog.
 * Lives under `tenancy/` for ESLint-guard colocation only; functions here do NOT
 * take a tenant context.
 */

export async function listActivePackages(providerId?: EsimProviderId): Promise<ProviderPackage[]> {
  return prisma.providerPackage.findMany({
    where: { active: true, ...(providerId ? { providerId } : {}) },
    orderBy: [{ providerId: 'asc' }, { name: 'asc' }],
  });
}

export async function getPackageById(id: string): Promise<ProviderPackage | null> {
  return prisma.providerPackage.findUnique({ where: { id } });
}

export async function upsertPackage(params: {
  providerId: EsimProviderId;
  sku: string;
  name: string;
  countryCodes: string[];
  dataMb?: number | null;
  durationDays?: number | null;
  priceAmount: bigint;
  priceCurrency: string;
  rawMetadata?: unknown;
}): Promise<ProviderPackage> {
  const { providerId, sku, ...rest } = params;
  return prisma.providerPackage.upsert({
    where: { providerId_sku: { providerId, sku } },
    update: {
      name: rest.name,
      countryCodes: rest.countryCodes,
      dataMb: rest.dataMb ?? null,
      durationDays: rest.durationDays ?? null,
      priceAmount: rest.priceAmount,
      priceCurrency: rest.priceCurrency,
      rawMetadata: (rest.rawMetadata ?? null) as import('@prisma/client').Prisma.InputJsonValue,
      syncedAt: new Date(),
      active: true,
    },
    create: {
      providerId,
      sku,
      name: rest.name,
      countryCodes: rest.countryCodes,
      dataMb: rest.dataMb ?? null,
      durationDays: rest.durationDays ?? null,
      priceAmount: rest.priceAmount,
      priceCurrency: rest.priceCurrency,
      rawMetadata: (rest.rawMetadata ?? null) as import('@prisma/client').Prisma.InputJsonValue,
    },
  });
}
```

- [ ] **Step 8.8: Run lint + typecheck + tests**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green. Any ESLint error about `prisma.order.*` / `prisma.payment.*` / etc. from other files means those files need updating (they shouldn't exist yet at this point — the rule fires only when a forbidden property access appears outside the ignore list).

- [ ] **Step 8.9: Commit**

```bash
git add src/server/tenancy/
git commit -m "feat(tenancy): add scoped repositories for Order, Payment, Esim, ProviderPackage"
```

---

## Task 9: Seed provider packages

**Rationale:** Pricing tests + E2E smoke tests need catalog rows.

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 9.1: Add provider package seeding to `scripts/seed.ts`**

Open `scripts/seed.ts`. After the existing tenant + user seeding block, append:

```typescript
// Provider packages — small mock catalog for dev + E2E.
const packages = [
  {
    providerId: 'airalo' as const,
    sku: 'TR-10GB-30D',
    name: 'Turkey 10 GB / 30 days',
    countryCodes: ['TR'],
    dataMb: 10240,
    durationDays: 30,
    priceAmount: 1499n, // $14.99
    priceCurrency: 'USD',
  },
  {
    providerId: 'airalo' as const,
    sku: 'EU-5GB-15D',
    name: 'Europe 5 GB / 15 days',
    countryCodes: ['DE', 'FR', 'ES', 'IT'],
    dataMb: 5120,
    durationDays: 15,
    priceAmount: 999n,
    priceCurrency: 'USD',
  },
  {
    providerId: 'zendit' as const,
    sku: 'GLOBAL-3GB-7D',
    name: 'Global 3 GB / 7 days',
    countryCodes: ['GLOBAL'],
    dataMb: 3072,
    durationDays: 7,
    priceAmount: 799n,
    priceCurrency: 'USD',
  },
];

for (const p of packages) {
  await prisma.providerPackage.upsert({
    where: { providerId_sku: { providerId: p.providerId, sku: p.sku } },
    update: { ...p, syncedAt: new Date() },
    create: p,
  });
}
console.log(`Seeded ${packages.length} provider packages.`);
```

Make sure `prisma` is imported at the top of the file (it already is — reuse the existing import).

- [ ] **Step 9.2: Run the seed script**

```bash
pnpm seed
```

Expected: runs without error and prints "Seeded 3 provider packages."

- [ ] **Step 9.3: Commit**

```bash
git add scripts/seed.ts
git commit -m "chore(seed): add provider package fixtures"
```

---

## Task 10: Build the pricing service (server-side authoritative)

**Rationale:** Spec Section 5.6 — "Pricing is server-side authoritative — client-supplied prices never trusted". V1 security fix #847 propagated structurally here.

**Files:**
- Create: `src/server/domain/pricing/calculatePrice.ts`
- Create: `src/server/domain/pricing/calculatePrice.test.ts`
- Create: `src/server/domain/pricing/lockPrice.ts`
- Create: `src/server/domain/pricing/lockPrice.test.ts`

- [ ] **Step 10.1: Write the failing test for `calculatePrice`**

Create `src/server/domain/pricing/calculatePrice.test.ts`:

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { prisma } from '@/src/lib/db';
import { calculatePrice } from './calculatePrice';

let packageId: string;

beforeAll(async () => {
  await prisma.providerPackage.deleteMany();
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo',
      sku: 'TEST-1GB-7D',
      name: 'Test package',
      countryCodes: ['TR'],
      priceAmount: 500n,
      priceCurrency: 'USD',
    },
  });
  packageId = pkg.id;
});

describe('calculatePrice', () => {
  it('returns total Money for quantity=1', async () => {
    const result = await calculatePrice({ packageId, quantity: 1 });
    expect(result.unit).toEqual({ amount: 500n, currency: 'USD' });
    expect(result.total).toEqual({ amount: 500n, currency: 'USD' });
    expect(result.quantity).toBe(1);
  });

  it('multiplies by quantity', async () => {
    const result = await calculatePrice({ packageId, quantity: 3 });
    expect(result.total).toEqual({ amount: 1500n, currency: 'USD' });
  });

  it('throws when package is unknown', async () => {
    await expect(calculatePrice({ packageId: 'bogus', quantity: 1 })).rejects.toThrow(
      /package not found/i,
    );
  });

  it('throws when quantity < 1', async () => {
    await expect(calculatePrice({ packageId, quantity: 0 })).rejects.toThrow(/quantity/);
  });

  it('throws when quantity is not an integer', async () => {
    await expect(calculatePrice({ packageId, quantity: 1.5 })).rejects.toThrow(/integer/);
  });
});
```

- [ ] **Step 10.2: Run the test to confirm it fails**

```bash
pnpm test src/server/domain/pricing/calculatePrice.test.ts
```

Expected: FAILS with "Cannot find module './calculatePrice'".

- [ ] **Step 10.3: Implement `calculatePrice.ts`**

Create `src/server/domain/pricing/calculatePrice.ts`:

```typescript
import { prisma } from '@/src/lib/db';
import type { Currency, Money } from '@/src/lib/money';
import { CURRENCIES, multiply } from '@/src/lib/money';

export interface PriceQuote {
  packageId: string;
  quantity: number;
  unit: Money;
  total: Money;
  currency: Currency;
}

export interface CalculatePriceInput {
  packageId: string;
  quantity: number;
}

export async function calculatePrice(input: CalculatePriceInput): Promise<PriceQuote> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`calculatePrice: quantity must be a positive integer, got ${input.quantity}`);
  }
  const pkg = await prisma.providerPackage.findUnique({ where: { id: input.packageId } });
  if (!pkg) {
    throw new Error(`calculatePrice: package not found (${input.packageId})`);
  }
  if (!(CURRENCIES as readonly string[]).includes(pkg.priceCurrency)) {
    throw new Error(`calculatePrice: unsupported currency ${pkg.priceCurrency}`);
  }
  const currency = pkg.priceCurrency as Currency;
  const unit: Money = { amount: pkg.priceAmount, currency };
  const total = multiply(unit, input.quantity);
  return { packageId: pkg.id, quantity: input.quantity, unit, total, currency };
}
```

- [ ] **Step 10.4: Run the test to confirm it passes**

```bash
pnpm test src/server/domain/pricing/calculatePrice.test.ts
```

Expected: 5/5 green.

- [ ] **Step 10.5: Write the failing test for `lockPrice`**

Create `src/server/domain/pricing/lockPrice.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { runInTenant } from '@/src/server/tenancy/context';
import { createDraftOrder } from '@/src/server/tenancy/orderRepository';
import { lockPrice, PRICE_LOCK_TTL_MINUTES } from './lockPrice';

async function fixtures() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE price_locks, orders, provider_packages, tenants RESTART IDENTITY CASCADE`,
  );
  const tenant = await prisma.tenant.create({ data: { slug: 'alpha', name: 'Alpha' } });
  const pkg = await prisma.providerPackage.create({
    data: {
      providerId: 'airalo',
      sku: 'TEST-1GB-7D',
      name: 'Test package',
      countryCodes: ['TR'],
      priceAmount: 500n,
      priceCurrency: 'USD',
    },
  });
  const order = await runInTenant({ tenantId: tenant.id, tenantSlug: tenant.slug }, () =>
    createDraftOrder({ buyerEmail: 'b@example.com' }),
  );
  return { tenant, pkg, order };
}

describe('lockPrice', () => {
  beforeEach(async () => {
    await fixtures();
  });

  it('creates a PriceLock row with quote snapshot + expiresAt in the future', async () => {
    const { pkg, order } = await fixtures();
    const lock = await lockPrice({ orderId: order.id, packageId: pkg.id, quantity: 2 });
    expect(lock.orderId).toBe(order.id);
    expect(lock.providerPackageId).toBe(pkg.id);
    expect(lock.quantity).toBe(2);
    expect(lock.totalAmount).toBe(1000n);
    expect(lock.totalCurrency).toBe('USD');
    const ttlMs = lock.expiresAt.getTime() - lock.lockedAt.getTime();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(PRICE_LOCK_TTL_MINUTES * 60 * 1000 + 1000);
  });

  it('updates the Order total to match the locked total', async () => {
    const { pkg, order } = await fixtures();
    await lockPrice({ orderId: order.id, packageId: pkg.id, quantity: 3 });
    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.totalAmount).toBe(1500n);
    expect(refreshed.totalCurrency).toBe('USD');
  });

  it('replaces an existing lock for the same order', async () => {
    const { pkg, order } = await fixtures();
    await lockPrice({ orderId: order.id, packageId: pkg.id, quantity: 1 });
    await lockPrice({ orderId: order.id, packageId: pkg.id, quantity: 4 });
    const locks = await prisma.priceLock.findMany({ where: { orderId: order.id } });
    expect(locks).toHaveLength(1);
    expect(locks[0]!.quantity).toBe(4);
    expect(locks[0]!.totalAmount).toBe(2000n);
  });
});
```

- [ ] **Step 10.6: Run to confirm it fails**

```bash
pnpm test src/server/domain/pricing/lockPrice.test.ts
```

Expected: FAILS with module resolution error.

- [ ] **Step 10.7: Implement `lockPrice.ts`**

Create `src/server/domain/pricing/lockPrice.ts`:

```typescript
import type { PriceLock } from '@prisma/client';
import { prisma } from '@/src/lib/db';
import { calculatePrice } from './calculatePrice';

export const PRICE_LOCK_TTL_MINUTES = 15;

export interface LockPriceInput {
  orderId: string;
  packageId: string;
  quantity: number;
}

/**
 * Computes the authoritative quote for a package + quantity, persists it as a
 * PriceLock, and writes the resulting total onto the Order. Replaces any prior
 * lock for the same order (an order always has at most one active lock).
 *
 * Client-supplied amounts are never accepted — the price is always recomputed
 * from the catalog.
 */
export async function lockPrice(input: LockPriceInput): Promise<PriceLock> {
  const quote = await calculatePrice({
    packageId: input.packageId,
    quantity: input.quantity,
  });
  const lockedAt = new Date();
  const expiresAt = new Date(lockedAt.getTime() + PRICE_LOCK_TTL_MINUTES * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    await tx.priceLock.deleteMany({ where: { orderId: input.orderId } });
    const lock = await tx.priceLock.create({
      data: {
        orderId: input.orderId,
        providerPackageId: input.packageId,
        quantity: input.quantity,
        unitAmount: quote.unit.amount,
        unitCurrency: quote.unit.currency,
        totalAmount: quote.total.amount,
        totalCurrency: quote.total.currency,
        lockedAt,
        expiresAt,
      },
    });
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        totalAmount: quote.total.amount,
        totalCurrency: quote.total.currency,
      },
    });
    return lock;
  });
}
```

Note: this file uses raw `prisma.$transaction` with `tx.priceLock.*` and `tx.order.*`. Because the ESLint rule matches only on `object.name === 'prisma'`, `tx.priceLock` is not caught — so the ignore list doesn't need updating for this file.

- [ ] **Step 10.8: Run both pricing tests**

```bash
pnpm test src/server/domain/pricing/
```

Expected: 8/8 green.

- [ ] **Step 10.9: Commit**

```bash
git add src/server/domain/pricing/
git commit -m "feat(pricing): add calculatePrice + lockPrice (server-side authoritative)"
```

---

## Task 11: BullMQ connection + queue registry

**Files:**
- Create: `src/server/jobs/queue.ts`
- Create: `src/server/jobs/queues.ts`
- Create: `src/server/jobs/workers/types.ts`
- Create: `tests/queue-connection.test.ts`
- Modify: `src/lib/env.ts` (optional `BULLMQ_PREFIX`)

- [ ] **Step 11.1: Add optional `BULLMQ_PREFIX` to env schema**

Open `src/lib/env.ts` and add inside the `envSchema.object({...})`:

```typescript
BULLMQ_PREFIX: z.string().default('datapatch'),
```

- [ ] **Step 11.2: Create the shared BullMQ connection + queue-name enum**

Create `src/server/jobs/queue.ts`:

```typescript
import { Redis } from 'ioredis';
import { env } from '@/src/lib/env';

/**
 * Named queues used by the platform. Keep this enum in sync with the worker
 * dispatch in scripts/worker.ts.
 */
export const QUEUE_NAMES = {
  webhooks: 'webhooks',
  outbox: 'outbox',
  esimSync: 'esim-sync',
  emails: 'emails',
  scheduled: 'scheduled',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Single shared ioredis client for BullMQ. BullMQ requires `maxRetriesPerRequest`
 * to be null on the connection used by blocking commands.
 */
let _connection: Redis | undefined;

export function getConnection(): Redis {
  if (_connection) return _connection;
  _connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return _connection;
}

export async function closeConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = undefined;
  }
}

export const BULLMQ_PREFIX = env.BULLMQ_PREFIX;
```

- [ ] **Step 11.3: Create the Queue instances module**

Create `src/server/jobs/queues.ts`:

```typescript
import { Queue } from 'bullmq';
import { BULLMQ_PREFIX, QUEUE_NAMES, getConnection } from './queue';

const connection = getConnection();

export const webhooksQueue = new Queue(QUEUE_NAMES.webhooks, {
  connection,
  prefix: BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 86_400, count: 5000 }, // 1 day or 5k
    removeOnFail: false, // keep failed jobs for DLQ inspection
  },
});

export const outboxQueue = new Queue(QUEUE_NAMES.outbox, {
  connection,
  prefix: BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { age: 86_400, count: 5000 },
    removeOnFail: false,
  },
});

export const emailsQueue = new Queue(QUEUE_NAMES.emails, {
  connection,
  prefix: BULLMQ_PREFIX,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
  },
});

export const esimSyncQueue = new Queue(QUEUE_NAMES.esimSync, {
  connection,
  prefix: BULLMQ_PREFIX,
});

export const scheduledQueue = new Queue(QUEUE_NAMES.scheduled, {
  connection,
  prefix: BULLMQ_PREFIX,
});

export function allQueues() {
  return [webhooksQueue, outboxQueue, emailsQueue, esimSyncQueue, scheduledQueue];
}
```

- [ ] **Step 11.4: Create worker payload types**

Create `src/server/jobs/workers/types.ts`:

```typescript
export interface WebhookJobPayload {
  webhookEventId: string;
}

export interface OutboxJobPayload {
  outboxEventId: string;
}
```

- [ ] **Step 11.5: Write a connection test**

Create `tests/queue-connection.test.ts`:

```typescript
import { afterAll, describe, expect, it } from 'vitest';
import { getConnection, closeConnection } from '@/src/server/jobs/queue';
import { webhooksQueue, allQueues } from '@/src/server/jobs/queues';

describe('BullMQ connection', () => {
  afterAll(async () => {
    for (const q of allQueues()) await q.close();
    await closeConnection();
  });

  it('connects to Redis and responds to PING', async () => {
    const conn = getConnection();
    const res = await conn.ping();
    expect(res).toBe('PONG');
  });

  it('enqueues a job and reports its state as "waiting"', async () => {
    const job = await webhooksQueue.add('test-event', { webhookEventId: 'smoke' });
    const state = await job.getState();
    expect(['waiting', 'delayed', 'active']).toContain(state);
    await job.remove();
  });
});
```

- [ ] **Step 11.6: Run tests**

```bash
pnpm test tests/queue-connection.test.ts
```

Expected: 2/2 green. If the test hangs or fails on connection, confirm `docker compose ps` shows redis healthy and `REDIS_URL` in `.env.local` points at `redis://localhost:6380`.

- [ ] **Step 11.7: Commit**

```bash
git add src/server/jobs/ src/lib/env.ts tests/queue-connection.test.ts
git commit -m "feat(jobs): add BullMQ connection + queue registry"
```

---

## Task 12: Webhook ingestion endpoint + raw event persistence

**Files:**
- Create: `src/server/webhooks/ingest.ts`
- Create: `src/server/webhooks/ingest.test.ts`
- Create: `app/api/webhooks/[provider]/route.ts`

- [ ] **Step 12.1: Write the failing test for `persistRawEvent`**

Create `src/server/webhooks/ingest.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { persistRawEvent } from './ingest';

beforeEach(async () => {
  await prisma.webhookEvent.deleteMany();
});

describe('persistRawEvent', () => {
  it('inserts a webhook_events row and returns the id', async () => {
    const result = await persistRawEvent({
      provider: 'paddle',
      externalEventId: 'evt_123',
      signatureHeader: 'sha256=abc',
      rawHeaders: { 'content-type': 'application/json' },
      rawBody: '{"type":"payment.completed"}',
    });
    expect(result.status).toBe('inserted');
    expect(result.webhookEventId).toBeTruthy();
    const row = await prisma.webhookEvent.findUniqueOrThrow({
      where: { id: result.webhookEventId },
    });
    expect(row.provider).toBe('paddle');
    expect(row.externalEventId).toBe('evt_123');
    expect(row.status).toBe('received');
    expect(row.rawBody).toBe('{"type":"payment.completed"}');
  });

  it('is idempotent on (provider, externalEventId) — returns existing row', async () => {
    const first = await persistRawEvent({
      provider: 'paddle',
      externalEventId: 'evt_dup',
      signatureHeader: null,
      rawHeaders: {},
      rawBody: '{}',
    });
    const second = await persistRawEvent({
      provider: 'paddle',
      externalEventId: 'evt_dup',
      signatureHeader: null,
      rawHeaders: {},
      rawBody: '{}',
    });
    expect(second.status).toBe('duplicate');
    expect(second.webhookEventId).toBe(first.webhookEventId);
    const rows = await prisma.webhookEvent.findMany({
      where: { provider: 'paddle', externalEventId: 'evt_dup' },
    });
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 12.2: Run to confirm it fails**

```bash
pnpm test src/server/webhooks/ingest.test.ts
```

Expected: FAILS with module resolution error.

- [ ] **Step 12.3: Implement `persistRawEvent`**

Create `src/server/webhooks/ingest.ts`:

```typescript
import type { Prisma } from '@prisma/client';
import { prisma } from '@/src/lib/db';

export interface PersistRawEventInput {
  provider: string;
  externalEventId: string;
  signatureHeader: string | null;
  rawHeaders: Record<string, string>;
  rawBody: string;
}

export type PersistRawEventResult =
  | { status: 'inserted'; webhookEventId: string }
  | { status: 'duplicate'; webhookEventId: string };

/**
 * Persist a raw webhook payload idempotently. Dedupe key: (provider, externalEventId).
 * Returns the existing row's id if the tuple already exists — callers should then skip
 * re-enqueuing the job.
 */
export async function persistRawEvent(
  input: PersistRawEventInput,
): Promise<PersistRawEventResult> {
  try {
    const row = await prisma.webhookEvent.create({
      data: {
        provider: input.provider,
        externalEventId: input.externalEventId,
        signatureHeader: input.signatureHeader ?? null,
        rawHeaders: input.rawHeaders as Prisma.InputJsonValue,
        rawBody: input.rawBody,
        status: 'received',
      },
    });
    return { status: 'inserted', webhookEventId: row.id };
  } catch (err) {
    // Prisma throws P2002 on unique constraint violation.
    if ((err as { code?: string }).code === 'P2002') {
      const existing = await prisma.webhookEvent.findUniqueOrThrow({
        where: {
          provider_externalEventId: {
            provider: input.provider,
            externalEventId: input.externalEventId,
          },
        },
      });
      return { status: 'duplicate', webhookEventId: existing.id };
    }
    throw err;
  }
}
```

- [ ] **Step 12.4: Run the test — expect green**

```bash
pnpm test src/server/webhooks/ingest.test.ts
```

Expected: 2/2 green.

- [ ] **Step 12.5: Create the generic webhook ingest route handler**

Create `app/api/webhooks/[provider]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { persistRawEvent } from '@/src/server/webhooks/ingest';
import { webhooksQueue } from '@/src/server/jobs/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_PROVIDERS = new Set(['paddle', 'turinvoice', 'airalo', 'zendit', 'resend']);

/**
 * Extract the externalEventId from provider-specific headers. Phase 2b will
 * refine this per provider once signature verification lands; for Phase 2a
 * we read a common set of headers with a fallback to a random id.
 */
function readExternalId(provider: string, req: NextRequest): string {
  const candidates = [
    'x-event-id',
    'x-test-event-id',
    'paddle-signature',
    'x-airalo-event-id',
    'svix-id',
  ];
  for (const h of candidates) {
    const v = req.headers.get(h);
    if (v) return `${provider}:${v}`;
  }
  // Fallback — prevents multiple identical signature-less test events from collapsing.
  return `${provider}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function collectHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider } = await context.params;
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  }
  const rawBody = await req.text();
  const externalEventId = readExternalId(provider, req);
  const signatureHeader =
    req.headers.get('paddle-signature') ??
    req.headers.get('svix-signature') ??
    req.headers.get('x-airalo-signature') ??
    null;

  const result = await persistRawEvent({
    provider,
    externalEventId,
    signatureHeader,
    rawHeaders: collectHeaders(req),
    rawBody,
  });

  if (result.status === 'inserted') {
    await webhooksQueue.add(
      `${provider}:${externalEventId}`,
      { webhookEventId: result.webhookEventId },
      { jobId: result.webhookEventId }, // dedupe in Redis too
    );
  }

  return NextResponse.json(
    { ok: true, webhookEventId: result.webhookEventId, deduped: result.status === 'duplicate' },
    { status: 200 },
  );
}
```

- [ ] **Step 12.6: Manually smoke test the endpoint**

Start the dev app:

```bash
pnpm dev
```

In another terminal:

```bash
curl -s -X POST http://localhost:3002/api/webhooks/paddle \
  -H 'content-type: application/json' \
  -H 'x-test-event-id: local-smoke-1' \
  -d '{"type":"payment.completed","id":"abc"}' | jq
```

Expected: `{ ok: true, webhookEventId: "<cuid>", deduped: false }`.

Repeat the exact same curl:

```bash
curl -s -X POST http://localhost:3002/api/webhooks/paddle \
  -H 'content-type: application/json' \
  -H 'x-test-event-id: local-smoke-1' \
  -d '{"type":"payment.completed","id":"abc"}' | jq
```

Expected: `{ ok: true, webhookEventId: "<same cuid>", deduped: true }`.

Stop the dev server.

- [ ] **Step 12.7: Commit**

```bash
git add src/server/webhooks/ app/api/webhooks/
git commit -m "feat(webhooks): add generic ingest endpoint + persistRawEvent"
```

---

## Task 13: Outbox write helper

**Files:**
- Create: `src/server/outbox/enqueue.ts`
- Create: `src/server/outbox/enqueue.test.ts`

- [ ] **Step 13.1: Write the failing test**

Create `src/server/outbox/enqueue.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/src/lib/db';
import { enqueueOutboxInTx } from './enqueue';

beforeEach(async () => {
  await prisma.outboxEvent.deleteMany();
});

describe('enqueueOutboxInTx', () => {
  it('writes an outbox row inside a transaction alongside another mutation', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { slug: 'ob-a', name: 'OB A' } });
      const event = await enqueueOutboxInTx(tx, {
        tenantId: tenant.id,
        kind: 'email.send',
        payload: { to: 'x@example.com', template: 'welcome' },
      });
      return { tenant, event };
    });
    expect(result.event.status).toBe('pending');
    expect(result.event.tenantId).toBe(result.tenant.id);
    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { id: result.event.id },
    });
    expect((row.payload as { template: string }).template).toBe('welcome');
  });

  it('supports tenantId=null for platform-level events', async () => {
    const event = await prisma.$transaction((tx) =>
      enqueueOutboxInTx(tx, { tenantId: null, kind: 'audit.ship', payload: { count: 1 } }),
    );
    expect(event.tenantId).toBeNull();
  });
});
```

- [ ] **Step 13.2: Run to confirm it fails**

```bash
pnpm test src/server/outbox/enqueue.test.ts
```

Expected: FAILS.

- [ ] **Step 13.3: Implement `enqueueOutboxInTx`**

Create `src/server/outbox/enqueue.ts`:

```typescript
import type { OutboxEvent, Prisma } from '@prisma/client';

export interface EnqueueOutboxInput {
  tenantId: string | null;
  kind: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
}

/**
 * Write an outbox event *within an existing Prisma transaction*. Callers MUST
 * pass the transaction handle so the outbox row commits with the domain change
 * (prevents DB-committed-but-side-effect-never-sent inconsistencies).
 *
 * Usage:
 *   await prisma.$transaction(async (tx) => {
 *     await tx.order.update({ ... });
 *     await enqueueOutboxInTx(tx, { tenantId, kind: 'email.send', payload });
 *   });
 */
export async function enqueueOutboxInTx(
  tx: Prisma.TransactionClient,
  input: EnqueueOutboxInput,
): Promise<OutboxEvent> {
  return tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      payload: input.payload,
      status: 'pending',
      availableAt: input.availableAt ?? new Date(),
    },
  });
}
```

Note: this file uses `tx.outboxEvent.*`, not `prisma.outboxEvent.*`, so the ESLint rule does not trigger. The file name is still included in the ignore list for future flexibility.

- [ ] **Step 13.4: Run to confirm it passes**

```bash
pnpm test src/server/outbox/enqueue.test.ts
```

Expected: 2/2 green.

- [ ] **Step 13.5: Commit**

```bash
git add src/server/outbox/
git commit -m "feat(outbox): add enqueueOutboxInTx helper for transactional side effects"
```

---

## Task 14: Worker process — webhook + outbox skeletons

**Files:**
- Create: `src/server/jobs/workers/webhook.ts`
- Create: `src/server/jobs/workers/outbox.ts`
- Create: `scripts/worker.ts`
- Modify: `package.json` (scripts + deps)

- [ ] **Step 14.1: Implement the webhook worker skeleton**

Create `src/server/jobs/workers/webhook.ts`:

```typescript
import { Worker, type Job } from 'bullmq';
import { prisma } from '@/src/lib/db';
import { BULLMQ_PREFIX, QUEUE_NAMES, getConnection } from '../queue';
import type { WebhookJobPayload } from './types';

async function processWebhookJob(job: Job<WebhookJobPayload>): Promise<void> {
  const { webhookEventId } = job.data;
  const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!event) {
    // Nothing to do — the ingest row was deleted (replay scrub? test?)
    return;
  }
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      status: 'processing',
      attempts: { increment: 1 },
    },
  });

  // Phase 2a: no provider handlers yet. Phase 2b wires a registry here:
  //   const handler = providerRegistry.get(event.provider);
  //   await handler.verify(event); await handler.normalize(event); ...
  await prisma.webhookEvent.update({
    where: { id: webhookEventId },
    data: {
      status: 'received_no_handler',
      processedAt: new Date(),
    },
  });
}

export function startWebhookWorker(): Worker<WebhookJobPayload> {
  const worker = new Worker<WebhookJobPayload>(
    QUEUE_NAMES.webhooks,
    processWebhookJob,
    {
      connection: getConnection(),
      prefix: BULLMQ_PREFIX,
      concurrency: 4,
    },
  );
  worker.on('failed', async (job, err) => {
    if (!job) return;
    await prisma.webhookEvent
      .update({
        where: { id: job.data.webhookEventId },
        data: {
          status: job.attemptsMade >= (job.opts.attempts ?? 5) ? 'dlq' : 'failed',
          lastError: err.message,
        },
      })
      .catch(() => undefined);
  });
  return worker;
}
```

- [ ] **Step 14.2: Implement the outbox worker skeleton**

Create `src/server/jobs/workers/outbox.ts`:

```typescript
import { Worker, type Job } from 'bullmq';
import { prisma } from '@/src/lib/db';
import { BULLMQ_PREFIX, QUEUE_NAMES, getConnection } from '../queue';
import type { OutboxJobPayload } from './types';

async function processOutboxJob(job: Job<OutboxJobPayload>): Promise<void> {
  const { outboxEventId } = job.data;
  const event = await prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
  if (!event || event.status === 'sent') return;

  await prisma.outboxEvent.update({
    where: { id: outboxEventId },
    data: { status: 'processing', attempts: { increment: 1 } },
  });

  // Phase 2a: no handlers yet. Phase 2b plugs in email/audit/etc. dispatch based on `event.kind`.
  // For now we mark as sent so the test path works; Phase 2b replaces this with a real handler.
  await prisma.outboxEvent.update({
    where: { id: outboxEventId },
    data: { status: 'sent', sentAt: new Date() },
  });
}

export function startOutboxWorker(): Worker<OutboxJobPayload> {
  const worker = new Worker<OutboxJobPayload>(
    QUEUE_NAMES.outbox,
    processOutboxJob,
    {
      connection: getConnection(),
      prefix: BULLMQ_PREFIX,
      concurrency: 2,
    },
  );
  worker.on('failed', async (job, err) => {
    if (!job) return;
    await prisma.outboxEvent
      .update({
        where: { id: job.data.outboxEventId },
        data: {
          status: job.attemptsMade >= (job.opts.attempts ?? 5) ? 'dlq' : 'failed',
          lastError: err.message,
        },
      })
      .catch(() => undefined);
  });
  return worker;
}
```

- [ ] **Step 14.3: Create the worker entrypoint**

Create `scripts/worker.ts`:

```typescript
import { startWebhookWorker } from '@/src/server/jobs/workers/webhook';
import { startOutboxWorker } from '@/src/server/jobs/workers/outbox';
import { closeConnection } from '@/src/server/jobs/queue';
import { prisma } from '@/src/lib/db';

async function main() {
  console.log('[worker] booting…');
  const workers = [startWebhookWorker(), startOutboxWorker()];
  console.log(`[worker] ${workers.length} workers ready`);

  const shutdown = async (sig: string) => {
    console.log(`[worker] received ${sig}, shutting down`);
    await Promise.all(workers.map((w) => w.close()));
    await closeConnection();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal', err);
  process.exit(1);
});
```

- [ ] **Step 14.4: Add package.json scripts**

Open `package.json` and in `"scripts"` add:

```json
"worker": "tsx scripts/worker.ts",
"dev:worker": "tsx watch scripts/worker.ts",
"dev:all": "concurrently -k -n web,worker -c cyan,magenta \"pnpm dev\" \"pnpm dev:worker\"",
```

Keep the existing entries untouched.

- [ ] **Step 14.5: Smoke test — start worker, post webhook, verify status transitions**

Terminal 1:

```bash
pnpm dev
```

Terminal 2:

```bash
pnpm worker
```

Terminal 3:

```bash
curl -s -X POST http://localhost:3002/api/webhooks/paddle \
  -H 'content-type: application/json' \
  -H 'x-test-event-id: worker-smoke-1' \
  -d '{"id":"w1"}' | jq
# Wait 2 seconds, then:
pnpm exec prisma studio
```

In Prisma Studio, open `webhook_events`. Expected: row with `provider=paddle`, `externalEventId=paddle:worker-smoke-1`, `status=received_no_handler`, `processedAt` set.

Stop all three terminals.

- [ ] **Step 14.6: Commit**

```bash
git add src/server/jobs/workers/ scripts/worker.ts package.json
git commit -m "feat(worker): webhook + outbox processor skeletons + scripts/worker.ts"
```

---

## Task 15: Health endpoint — add redis + queues

**Files:**
- Modify: `app/api/health/route.ts`
- Modify: `tests/health.test.ts`

- [ ] **Step 15.1: Update the health test**

Open `tests/health.test.ts` and adjust/extend so it asserts the richer response:

```typescript
import { describe, expect, it, afterAll } from 'vitest';
import { GET } from '@/app/api/health/route';
import { allQueues } from '@/src/server/jobs/queues';
import { closeConnection } from '@/src/server/jobs/queue';

afterAll(async () => {
  for (const q of allQueues()) await q.close();
  await closeConnection();
});

describe('GET /api/health', () => {
  it('returns { status, db, redis, queues }', async () => {
    const res = await GET();
    const body = (await res.json()) as {
      status: string;
      db: string;
      redis: string;
      queues: { pending: number; failed: number };
    };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
    expect(typeof body.queues.pending).toBe('number');
    expect(typeof body.queues.failed).toBe('number');
  });
});
```

- [ ] **Step 15.2: Implement the enhanced health route**

Replace `app/api/health/route.ts` contents with:

```typescript
import { NextResponse } from 'next/server';
import { prisma } from '@/src/lib/db';
import { getConnection } from '@/src/server/jobs/queue';
import { allQueues } from '@/src/server/jobs/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  let db: 'ok' | 'error' = 'ok';
  let redis: 'ok' | 'error' = 'ok';
  let pending = 0;
  let failed = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  try {
    const conn = getConnection();
    await conn.ping();
  } catch {
    redis = 'error';
  }
  try {
    const counts = await Promise.all(allQueues().map((q) => q.getJobCounts('waiting', 'delayed', 'failed')));
    for (const c of counts) {
      pending += (c.waiting ?? 0) + (c.delayed ?? 0);
      failed += c.failed ?? 0;
    }
  } catch {
    redis = 'error';
  }

  const overall = db === 'ok' && redis === 'ok' ? 'ok' : 'degraded';
  return NextResponse.json({
    status: overall,
    db,
    redis,
    queues: { pending, failed },
  });
}
```

- [ ] **Step 15.3: Run the test**

```bash
pnpm test tests/health.test.ts
```

Expected: green.

- [ ] **Step 15.4: Commit**

```bash
git add app/api/health/route.ts tests/health.test.ts
git commit -m "feat(health): report redis + queue state alongside db"
```

---

## Task 16: Queue stats admin page (platform_admin gated)

**Rationale:** Spec calls for "Bull Board at `/admin/jobs`". Mounting Bull Board's Express middleware inside Next.js's App Router requires a brittle request-bridging shim — not worth the complexity at Phase 2a scope. Phase 2b will revisit when provider handlers + DLQ replay UI need real queue inspection. For Phase 2a, ship a minimal server-rendered queue stats page that reads `getJobCounts()` directly. Gating uses the existing `requirePlatformRole()` helper (same pattern the admin layout uses).

**Files:**
- Create: `app/[locale]/(admin)/admin/jobs/page.tsx`

- [ ] **Step 16.1: Create the queue stats page**

Create `app/[locale]/(admin)/admin/jobs/page.tsx`:

```typescript
import { setRequestLocale } from 'next-intl/server';
import { requirePlatformRole } from '@/src/server/rbac/roles';
import { redirect } from '@/i18n/navigation';
import { allQueues } from '@/src/server/jobs/queues';

export const dynamic = 'force-dynamic';

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

async function getStats(): Promise<QueueStats[]> {
  const queues = allQueues();
  return Promise.all(
    queues.map(async (q) => {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      return {
        name: q.name,
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        delayed: c.delayed ?? 0,
        failed: c.failed ?? 0,
        completed: c.completed ?? 0,
      };
    }),
  );
}

export default async function JobsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  try {
    await requirePlatformRole();
  } catch {
    redirect({ href: '/signin' });
  }

  const stats = await getStats();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Background job queues</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Read-only view. Full Bull Board UI lands in Phase 2b with handler registry + DLQ replay.
      </p>
      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-muted">
            <th className="text-left px-3 py-2 border">Queue</th>
            <th className="text-right px-3 py-2 border">Waiting</th>
            <th className="text-right px-3 py-2 border">Active</th>
            <th className="text-right px-3 py-2 border">Delayed</th>
            <th className="text-right px-3 py-2 border">Failed</th>
            <th className="text-right px-3 py-2 border">Completed</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 border font-mono">{row.name}</td>
              <td className="px-3 py-2 border text-right">{row.waiting}</td>
              <td className="px-3 py-2 border text-right">{row.active}</td>
              <td className="px-3 py-2 border text-right">{row.delayed}</td>
              <td className="px-3 py-2 border text-right">{row.failed}</td>
              <td className="px-3 py-2 border text-right">{row.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 16.2: Manually verify**

Start the dev server and worker (`pnpm dev:all`). Sign in as `turgutsimarmaz@gmail.com` (platform_admin on alpha per seed). Navigate to `http://localhost:3002/en/admin/jobs`. Expected: page renders with 5 rows — `webhooks`, `outbox`, `emails`, `esim-sync`, `scheduled` — each showing 0 values on a fresh DB.

Post a webhook (from Task 12.6 curl). Reload the page. Expected: `webhooks.completed` increments by 1 (worker processed it to `received_no_handler`).

Try as `staff@beta.local` (agency_staff only): expected redirect to signin.

- [ ] **Step 16.3: Commit**

```bash
git add app/\[locale\]/\(admin\)/admin/jobs/
git commit -m "feat(admin): queue stats page at /admin/jobs (defer Bull Board to Phase 2b)"
```

---

## Task 17: Docker + Railway configuration for the worker process

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`
- Modify: `railway.json`

- [ ] **Step 17.1: Add a worker service to docker-compose for prod-shape local testing**

Append to `docker-compose.yml`:

```yaml
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: datapatch-v2-worker
    profiles: ['prod-like'] # opt-in; plain `docker compose up` still runs app via pnpm dev
    command: ['node', '--enable-source-maps', 'scripts/worker.js']
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/datapatch_v2
      REDIS_URL: redis://redis:6379
      NEXTAUTH_SECRET: prod-like-local-secret-xxxxxxxxxxxxxxxx
      NEXTAUTH_URL: http://localhost:3002
      EMAIL_FROM: noreply@localhost
      EMAIL_SERVER_HOST: mailpit
      EMAIL_SERVER_PORT: 1025
      EMAIL_SERVER_USER: ''
      EMAIL_SERVER_PASSWORD: ''
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

- [ ] **Step 17.2: Update Dockerfile to produce a worker-runnable image**

The worker uses TSX in dev but for production we compile to a single JS bundle that Node can run. Add a build step to the Dockerfile's `builder` stage that produces `scripts/worker.js`:

Open `Dockerfile`. After the `RUN pnpm build` line (~line 37) and before the `# ---------- runner ----------` marker, insert:

```dockerfile
# Compile the worker entrypoint into plain JS so the runner image doesn't need tsx.
RUN pnpm exec tsc --project tsconfig.worker.json
```

Also update the runner stage `COPY` lines to include the compiled worker. After the existing COPY for `scripts/`, add:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/dist-worker ./
```

- [ ] **Step 17.3: Create `tsconfig.worker.json`**

Create `tsconfig.worker.json` at the repo root:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-worker",
    "rootDir": ".",
    "noEmit": false,
    "declaration": false,
    "incremental": false,
    "jsx": "preserve",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["scripts/worker.ts", "src/**/*.ts", "i18n/**/*.ts"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts", "node_modules", ".next"]
}
```

Add `dist-worker` to `.gitignore`:

```bash
echo "dist-worker" >> .gitignore
```

- [ ] **Step 17.4: Update railway.json — hint at the worker process**

Open `railway.json`. Railway uses its own Procfile-like config; we add a second service hint via `services`. If the existing config is a single-service definition, add:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js",
    "healthcheckPath": "/api/health"
  }
}
```

**Note:** Railway does not spawn two processes per service. The worker runs as a **separate Railway service** pointing at the same repo with `startCommand: "node scripts/worker.js"`. Creating that service is a Railway dashboard / CLI action, not a file change — see Task 20.

- [ ] **Step 17.5: Build the Docker image locally to verify nothing broke**

```bash
docker build -t datapatch-v2:phase-2a .
```

Expected: green build. If `tsc --project tsconfig.worker.json` fails on type errors, fix them — they're real bugs.

- [ ] **Step 17.6: Commit**

```bash
git add docker-compose.yml Dockerfile railway.json tsconfig.worker.json .gitignore
git commit -m "chore(deploy): build worker bundle + prod-like docker compose profile"
```

---

## Task 18: Run the full test + lint + typecheck + build suite

- [ ] **Step 18.1: Clean DB + re-seed**

```bash
pnpm db:reset && pnpm seed
```

Expected: clean run.

- [ ] **Step 18.2: Run all Vitest suites**

```bash
pnpm test
```

Expected: all green. Phase 1 tests + new Phase 2a tests (money, pricing, order repo, webhook ingest, outbox enqueue, queue connection, health).

- [ ] **Step 18.3: Run Playwright E2E**

```bash
pnpm test:e2e
```

Expected: all green including new `locale-routing.spec.ts`.

- [ ] **Step 18.4: Run lint + typecheck + format + build**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm build
```

Expected: all four succeed. If `pnpm build` fails due to missing runtime env vars in `next build`, confirm the Dockerfile placeholder env vars are also reflected in `.env.local` for local build parity.

- [ ] **Step 18.5: Commit any last fixups**

```bash
git status
# if there are uncommitted tweaks:
git add -A
git commit -m "chore: fixups from pre-deploy verification"
```

---

## Task 19: Push branch + CI verification

- [ ] **Step 19.1: Push the branch**

```bash
git push -u origin phase-2a-foundation
```

- [ ] **Step 19.2: Open the draft PR**

```bash
gh pr create --draft --title "Phase 2a: i18n prefix + foundation infra" --body "$(cat <<'EOF'
## Summary
- URL-prefix i18n (`/en/*`, `/tr/*`) via next-intl routing
- Prisma schema: Order, OrderItem, Payment, Esim, ProviderPackage, PriceLock, WebhookEvent, OutboxEvent
- Money type + server-side pricing authority (calculatePrice, lockPrice)
- Scoped repositories for new tenant-scoped models + ESLint guard extension
- BullMQ + Redis + worker process (scripts/worker.ts)
- Generic webhook ingest endpoint with idempotent dedupe
- Outbox write helper (enqueueOutboxInTx)
- Read-only queue stats page at /{locale}/admin/jobs (platform_admin gated) — full Bull Board deferred to Phase 2b
- Enhanced /api/health (redis + queues)

Phase 2b (not in this PR): PaymentProvider + EsimProvider interfaces + adapters, booking flow, email templates, webhook-to-domain handlers.

## Test plan
- [ ] `pnpm test` green
- [ ] `pnpm test:e2e` green
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build` green
- [ ] CI green on GitHub Actions
- [ ] Manual: `/en/`, `/tr/`, `/en/shop`, `/en/admin`, `/en/a/alpha/dashboard` all render
- [ ] Manual: curl POST /api/webhooks/paddle inserts row + worker transitions status
- [ ] Manual: `/en/admin/jobs` shows queue stats table as platform_admin; redirects to /signin as agency_staff
EOF
)"
```

- [ ] **Step 19.3: Wait for CI and confirm both jobs pass**

```bash
gh pr checks --watch
```

Expected: `quality` and `e2e` green. Investigate + fix any failures — do NOT merge red.

---

## Task 20: Provision Railway worker service + deploy

- [ ] **Step 20.1: In the Railway dashboard for project `datapatch-v2`, create a second service named `worker`**

Using the CLI (run locally):

```bash
railway login
railway link --project d61ebd38-4b09-437f-a029-f07905aff9c7
```

Then in the Railway dashboard (UI only — CLI cannot create arbitrary services from a repo):
1. Add a new service to the `datapatch-v2` project from the same GitHub repo.
2. Name it `worker`.
3. Set the custom start command: `node scripts/worker.js`
4. Copy every env var from the `app` service to the `worker` service (or mark them as "shared"). Both need `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXTAUTH_URL`.
5. Disable the public URL for this service (worker does not serve HTTP).

- [ ] **Step 20.2: Merge the PR**

```bash
gh pr merge --squash --delete-branch
```

Railway auto-deploys both `app` and `worker` services from main.

- [ ] **Step 20.3: Smoke test prod**

```bash
curl -s https://v2.datapatch.net/api/health | jq
```

Expected: `{ "status": "ok", "db": "ok", "redis": "ok", "queues": { "pending": 0, "failed": 0 } }`.

```bash
curl -s -X POST https://v2.datapatch.net/api/webhooks/paddle \
  -H 'content-type: application/json' \
  -H 'x-test-event-id: prod-smoke-phase-2a' \
  -d '{"id":"prod-smoke"}' | jq
```

Expected: `{ "ok": true, "webhookEventId": "...", "deduped": false }`.

In the Railway dashboard, open the `worker` service logs. Expected: log line showing the job was picked up and processed within ~10 seconds of the curl.

Manually sign in at https://v2.datapatch.net/en/signin as `turgutsimarmaz@gmail.com`, visit `/en/admin/jobs`. Expected: queue stats table renders with 5 rows.

- [ ] **Step 20.4: Tag the release**

```bash
git checkout main
git pull
git tag phase-2a-complete
git push origin phase-2a-complete
```

---

## Verification Checklist (mirrors Exit Criteria)

After Task 20, walk through each exit criterion:

- [ ] `/` redirects to `/en` in prod ✔
- [ ] `/zh` returns 404 ✔
- [ ] All Phase 1 surfaces still work under `/en/*` and `/tr/*` ✔
- [ ] `prisma migrate status` clean on prod DB ✔
- [ ] `pnpm lint` rejects raw `prisma.order.*` etc. from an arbitrary file (manually test by adding a dummy page and running lint, then reverting) ✔
- [ ] `curl POST /api/webhooks/paddle` returns in <200 ms and inserts a row ✔
- [ ] Worker picks up the job, status transitions to `received_no_handler`, worker does not crash ✔
- [ ] `/api/health` reports the richer shape ✔
- [ ] Money + calculatePrice unit tests green ✔
- [ ] All unit + E2E tests green locally and in CI ✔
- [ ] `format:check && lint && typecheck && build` green ✔
- [ ] Queue stats page renders for platform_admin, redirects for agency_staff ✔
- [ ] Tag `phase-2a-complete` pushed ✔

If any item fails, STOP and fix before declaring Phase 2a complete. Do not proceed to Phase 2b with red exit criteria.

---

## Known follow-ups for Phase 2b (explicitly out of scope here)

- PaymentProvider + EsimProvider interfaces + registries.
- Paddle, TurInvoice, Airalo, Zendit adapter implementations.
- Webhook signature verification (per-provider; replaces the generic ingest's header sniff).
- Webhook handler registry wired into `processWebhookJob` (replaces `status = 'received_no_handler'`).
- Outbox handler registry for `email.send`, `audit.ship`, etc.
- Order state machine (`transition(order, event)` pure functions + audit writes).
- Booking flow: B2C checkout pipeline (shop → price lock → payment → confirmation).
- Agency booking flow.
- Package catalog sync job.
- Email template port (order confirmation, provisioning complete, magic link variants).
- Scheduled repeatable jobs via BullMQ (`esim.syncStatuses`, `packages.syncCatalog`, `fx.syncRates`, `order.expireStale`).
- Webhook DLQ replay UI in admin.
