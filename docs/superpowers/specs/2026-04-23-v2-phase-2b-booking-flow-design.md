# V2 Phase 2b — Domain & Booking Flow Design

**Date:** 2026-04-23
**Status:** Approved (brainstorm phase complete)
**Author:** turgt (solo, AI-assisted)
**Scope:** First half of Phase 2 domain work — order state machine, single payment provider (Paddle), single eSIM provider (Airalo), end-to-end booking flow for B2C self-pay and agency invoice paths, webhook + outbox handler registries, and the two emails required for the spec exit criterion. Second wave (TurInvoice, Zendit, scheduled jobs, Bull Board DLQ replay) is deferred to Phase 2c.

**Target repo:** `/Users/turgt/Desktop/CODES/datapatch-v2`. V1 repo `/Users/turgt/Desktop/CODES/esim-management-2` MUST NOT be modified.

---

## 1. Context

Phase 2a delivered the foundation: URL-prefix i18n, the domain Prisma schema (`Order`, `OrderItem`, `Payment`, `Esim`, `ProviderPackage`, `PriceLock`, `WebhookEvent`, `OutboxEvent`), `Money`, server-side pricing authority (`calculatePrice`, `lockPrice`), scoped repositories for all new tenant-scoped models, the generic `POST /api/webhooks/[provider]` ingest endpoint, the `enqueueOutbox` tx-aware helper, the BullMQ worker process, and a read-only queue stats admin page. No state machine, no provider adapters, no real handlers, no booking flow.

Phase 2b plugs domain logic on top of that foundation. The exit criterion is the literal Section 7 acceptance line from the V2 target spec: a real tenant on `v2.datapatch.net` completes a Paddle sandbox purchase, the system provisions an Airalo eSIM, and the QR code is delivered by email.

## 2. Goals & Non-Goals

### Goals
1. Order state machine with explicit transitions, audit log per transition, and dual `paymentMode` (self_pay via Paddle, agency_pay via manual invoice mark).
2. `PaymentProvider` interface + Paddle adapter (checkout creation + webhook signature verification).
3. `EsimProvider` interface + Airalo adapter (purchase, getStatus, syncPackages, webhook verification).
4. Booking flow end-to-end:
   - **B2C self_pay** at `/[locale]/shop` → Paddle checkout → webhook → Airalo provisioning → email.
   - **Agency_pay** at `/[locale]/a/[slug]/bookings/new` → manual invoice path → admin marks paid → Airalo provisioning → email.
5. Webhook handler registry — Phase 2a's worker stub now resolves a `provider:eventType` key to a domain handler.
6. Outbox handler registry — Phase 2a's `enqueueOutbox` writes are now actually drained (`email.send`, `esim.provision`).
7. Email templates: `order_confirmation`, `provisioning_complete` (with QR), `magic_link` branded override of Auth.js default.
8. Run-once Airalo catalog sync script + a deterministic seed of ~5–10 packages for tests/dev.
9. Self_pay test exit criterion verified manually on `v2.datapatch.net`. Agency_pay path implemented + UI + tests, but exit criterion verification is self_pay only.

### Non-Goals (deferred to Phase 2c)
- TurInvoice payment adapter.
- Zendit eSIM adapter.
- Scheduled repeatable jobs (`esim.syncStatuses`, `packages.syncCatalog`, `fx.syncRates`, `order.expireStale`, `email.digestAdmin`).
- Bull Board UI (interactive DLQ replay). Phase 2a's read-only stats page remains.
- Per-tenant Paddle vendor accounts. Phase 2b uses a single platform Paddle account.
- Paddle refund automation. Phase 2b implements `mark refund_pending` (state-only) — admin completes refund via Paddle dashboard.
- Subdomain-based tenant resolution (still path-based).
- Agency-branded traveler storefront.

## 3. Architectural Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Order state machine as pure functions, not a library** | Spec Section 5.5 already specified this. Pure functions are trivial to test, AI-friendly, and invalid transitions become loud errors. xstate would add a dep + DSL for no benefit at this scale. |
| 2 | **Dual `paymentMode` per Order, default from Tenant** | User picked option C in brainstorm — both self_pay and agency_pay must coexist. Default lives on Tenant; per-order override allowed via booking input. Tenants config-as-code; no admin UI for default in 2b. |
| 3 | **Agency_pay = pure manual invoice (no Paddle)** | Brainstorm Q3 → option C. Agency_pay state path bypasses Paddle entirely. Order enters `awaiting_invoice`; an `agency_admin` or `platform_admin` clicks "Mark Paid" → state advances to `paid` → provisioning kicks in. Refund path same as self_pay. |
| 3a | **B2C self_pay belongs to a `platform` tenant, not null** | Spec Section 4.1: every tenant-scoped row has NOT NULL `tenantId`. Phase 2b seed creates a `platform` tenant (slug `platform`) that owns all B2C orders. The agency portal will not see this tenant in its membership list. `PLATFORM_TENANT_ID` is exported from `src/server/tenancy/constants.ts` and resolved at boot from `slug='platform'`. |
| 4 | **Email recipients vary by mode** | Brainstorm Q4 → option C. Self_pay sends to traveler only. Agency_pay sends to traveler with BCC to `Tenant.agencyContactEmail`. Magic link is unrelated to booking flow but gets a branded template here. |
| 5 | **Magic link template override** | Brainstorm bonus → yes. Auth.js v5's `sendVerificationRequest` is replaced with a Resend send using a React Email template. Same rendering pipeline as booking emails, so we don't maintain two stacks. |
| 6 | **Catalog seed AND run-once sync script** | Brainstorm Q5 → option C. Seed ensures deterministic test data and CI parity. Run-once `pnpm sync:packages` script proves the Airalo integration works against real upstream and is the foundation for Phase 2c's scheduled job. |
| 7 | **Provisioning failure → auto-retry → DLQ → manual refund mark** | Brainstorm Q6 → option A. BullMQ exponential backoff (5 retries: 1m / 5m / 30m / 2h / 12h). Final failure → `provisioning_failed` state. Admin "Issue Refund" button writes `refund_pending` state — Paddle refund itself is not called from code in 2b. |
| 8 | **Webhook handler registry as a flat `provider:eventType → handler` map** | The Phase 2a worker stub already loads `WebhookEvent` rows and dispatches. The registry is the only missing piece. Flat map keeps it AI-readable; nested registries or class hierarchies are overkill for the 4–6 handlers in 2b. |
| 9 | **Outbox handler registry mirrors webhook registry** | `kind` field on `OutboxEvent` (already in 2a) is the dispatch key. Two handlers in 2b: `email.send`, `esim.provision`. |
| 10 | **Provisioning runs as an outbox-driven job, not inline in the webhook handler** | Webhook handler must be fast + idempotent + tx-bounded. Calling Airalo from inside a Paddle webhook handler ties Airalo failure to webhook retry, which double-counts. Pattern: webhook → mark `paid` + enqueue outbox `esim.provision` (same tx) → outbox worker → Airalo. Failure of provisioning is then a clean `provisioning_failed` transition, not a webhook retry storm. |
| 11 | **Paddle webhook signature verification re-runs in the worker, not just at HTTP ingest** | Defense in depth — even though Phase 2a's ingest endpoint stores the raw body, the worker re-verifies before dispatching. Catches a future bug where ingest accidentally trusts a payload. |
| 12 | **Airalo OAuth token cached in Redis** | `client_credentials` flow returns tokens with a 24h TTL. Redis cache with key `airalo:token` and 23h expiry. Refresh-on-401 fallback covers token rotation edge cases. Avoids hitting Airalo's `/token` endpoint on every API call. |
| 13 | **`Order.locale` captured at booking time** | Email templates need a locale to render. The booking input includes the request's locale (already URL-prefixed from Phase 2a). Stored on Order so async emails (provisioning_complete fires hours later) render correctly. |
| 14 | **`force-dynamic` on every Prisma-touching page** | Architectural decision #5 from Phase 0 carries forward — every new booking, order, my-esims, agency bookings page must `export const dynamic = 'force-dynamic';` or Railway build fails. |
| 15 | **`PaymentProvider.id` and `EsimProvider.id` are `'paddle'` / `'airalo'` literals in 2b — not unions** | TS literal types now; widen to a union when Phase 2c adds providers. Forces a deliberate diff per provider addition rather than silent drift. |

## 4. Module Map

```
src/server/domain/
├── orders/
│   ├── orderMachine.ts          # pure transitions; throws on invalid
│   ├── orderMachine.test.ts
│   ├── createBooking.ts         # orchestrator: lockPrice → Order → checkout|invoice
│   ├── createBooking.test.ts
│   ├── markPaid.ts              # agency_pay invoice mark; self_pay path goes via webhook
│   └── markPaid.test.ts
├── pricing/                      # Phase 2a — extended only by callers
├── provisioning/
│   ├── provisionEsim.ts         # outbox handler body: Airalo purchase + state transition
│   └── provisionEsim.test.ts
└── refunds/
    ├── markRefundPending.ts     # state-only; admin completes refund externally in 2b
    └── markRefundPending.test.ts

src/server/providers/
├── payment/
│   ├── types.ts                 # PaymentProvider, NormalizedPaymentEvent
│   ├── registry.ts              # id → adapter
│   ├── paddle/
│   │   ├── createCheckout.ts
│   │   ├── verifyWebhook.ts     # HMAC-SHA256 of raw body
│   │   ├── normalize.ts         # Paddle payload → NormalizedPaymentEvent
│   │   ├── client.ts            # fetch wrapper + auth header
│   │   └── paddle.test.ts       # contract tests (recorded fixtures)
└── esim/
    ├── types.ts                 # EsimProvider, NormalizedEsimEvent
    ├── registry.ts
    └── airalo/
        ├── purchase.ts
        ├── getStatus.ts
        ├── syncPackages.ts      # used by seed AND run-once script
        ├── verifyWebhook.ts     # bearer + HMAC
        ├── normalize.ts
        ├── client.ts            # OAuth client_credentials + Redis token cache
        └── airalo.test.ts

src/server/webhooks/
├── handlerRegistry.ts           # Record<`${provider}:${eventType}`, WebhookHandler>
├── handlers/
│   ├── paddleHandlers.ts        # checkout.completed → markPaid; refunded → cancel
│   ├── airaloHandlers.ts        # esim.installed → markActive; esim.expired → markExpired
│   └── handlers.test.ts
├── processor.ts                 # called by webhooks BullMQ worker; replaces 2a stub
└── processor.test.ts

src/server/outbox/
├── handlerRegistry.ts           # Record<OutboxKind, OutboxHandler>
├── handlers/
│   ├── emailSend.ts
│   ├── esimProvision.ts         # delegates to domain/provisioning/provisionEsim
│   └── handlers.test.ts
└── processor.ts                 # called by outbox BullMQ worker

src/server/email/
├── client.ts                    # Resend wrapper (already exists for magic link)
├── render.tsx                   # React Email render → HTML string
├── templates/
│   ├── orderConfirmation.tsx
│   ├── provisioningComplete.tsx # QR PNG inlined as data: URL
│   └── magicLink.tsx            # branded override
└── send.ts                      # send({to, bcc?, template, locale, data})

scripts/
└── sync-packages.ts             # one-shot Airalo catalog sync; manual: pnpm sync:packages

app/
├── [locale]/
│   ├── (customer)/shop/
│   │   ├── page.tsx                                         # MODIFIED — use real ProviderPackages
│   │   ├── checkout/page.tsx                                # NEW — review + traveler info form
│   │   └── orders/[orderId]/
│   │       └── page.tsx                                     # NEW — order status (post-checkout)
│   ├── (agency)/a/[agencySlug]/
│   │   ├── bookings/page.tsx                                # NEW — list
│   │   ├── bookings/new/page.tsx                            # NEW — create booking form
│   │   └── bookings/[orderId]/page.tsx                      # NEW — detail + Mark Paid
│   ├── (admin)/admin/
│   │   ├── orders/page.tsx                                  # NEW — list
│   │   └── orders/[orderId]/page.tsx                        # NEW — detail + Issue Refund button
│   └── (customer)/my-esims/page.tsx                         # NEW (small) — show traveler's eSIMs
├── api/
│   ├── booking/route.ts                                     # NEW — POST self_pay create
│   ├── agency/[slug]/booking/route.ts                       # NEW — POST agency_pay create
│   ├── orders/[orderId]/mark-paid/route.ts                  # NEW — agency invoice mark
│   └── orders/[orderId]/refund/route.ts                     # NEW — admin Issue Refund
└── api/auth/[...nextauth]/route.ts                          # MODIFIED — sendVerificationRequest

prisma/
└── migrations/YYYYMMDDHHMMSS_phase_2b_booking/              # NEW
```

**File size target:** <300 lines per file. Split if exceeded.

## 5. Order State Machine

```
         ┌── self_pay ──→ awaiting_payment ──┐
draft ───┤                                    ├──→ paid ──→ provisioning ──┬──→ provisioned ──→ active ──→ expired
         └── agency_pay → awaiting_invoice ──┘                              │
                                                                            └──→ provisioning_failed ──→ refund_pending ──→ cancelled
                                                                                                       └──→ cancelled (no refund)
```

Note: `Order.state` is initialised to `DRAFT` at row insert. The `START_CHECKOUT` / `AWAIT_INVOICE` event fires synchronously inside the same transaction, so an Order is observable in `DRAFT` only mid-transaction (never to readers).

States as TS enum on the Order model:
```
DRAFT, AWAITING_PAYMENT, AWAITING_INVOICE, PAID, PROVISIONING,
PROVISIONED, ACTIVE, EXPIRED, PROVISIONING_FAILED, REFUND_PENDING, CANCELLED
```

Events:
```ts
type OrderEvent =
  | { type: 'START_CHECKOUT' }                                    // draft → awaiting_payment (self_pay)
  | { type: 'AWAIT_INVOICE' }                                     // draft → awaiting_invoice (agency_pay)
  | { type: 'PAYMENT_RECEIVED'; externalPaymentId: string }       // awaiting_payment → paid
  | { type: 'INVOICE_MARKED_PAID'; actorUserId: string }          // awaiting_invoice → paid
  | { type: 'PROVISION_STARTED' }                                 // paid → provisioning
  | { type: 'PROVISION_SUCCEEDED'; iccid: string; qr: string }    // provisioning → provisioned
  | { type: 'PROVISION_FAILED'; reason: string }                  // provisioning → provisioning_failed
  | { type: 'ACTIVATE' }                                          // provisioned → active
  | { type: 'EXPIRE' }                                            // active → expired
  | { type: 'REQUEST_REFUND'; actorUserId: string }               // provisioning_failed | paid → refund_pending
  | { type: 'CANCEL'; actorUserId: string; reason: string };      // refund_pending | provisioning_failed → cancelled
```

Signature:
```ts
function transition(order: Order, event: OrderEvent): {
  order: Order;                       // new immutable instance
  audit: AuditLogInput;               // caller persists in same tx
};
```

Invalid transitions throw `InvalidTransitionError`. Guard clauses enforce preconditions (e.g. `PAYMENT_RECEIVED` only from `AWAITING_PAYMENT`).

Caller pattern (always):
```ts
await prisma.$transaction(async (tx) => {
  const fresh = await orderRepo(tx).findById(orderId);
  const { order, audit } = transition(fresh, event);
  await orderRepo(tx).update(order);
  await auditLog(tx).write(audit);
  if (sideEffects) await enqueueOutbox(tx, sideEffects);
});
```

## 6. Provider Interfaces

### 6.1 PaymentProvider
```ts
// src/server/providers/payment/types.ts
export interface PaymentProvider {
  readonly id: 'paddle';                   // widens to union in 2c
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  verifyWebhook(req: NextRequest, rawBody: string): Promise<NormalizedPaymentEvent>;
}

export interface CreateCheckoutInput {
  orderId: string;
  customerEmail: string;
  lineItems: Array<{ priceId: string; quantity: number }>;
  successUrl: string;
  cancelUrl: string;
  locale: string;
  metadata: { tenantId: string; orderId: string };
}

export interface CheckoutSession { url: string; externalSessionId: string; }

export type NormalizedPaymentEvent =
  | { kind: 'payment.completed'; orderId: string; externalId: string; amount: Money; eventId: string }
  | { kind: 'payment.failed';    orderId: string; externalId: string; reason: string;  eventId: string }
  | { kind: 'payment.refunded';  orderId: string; externalId: string; amount: Money; eventId: string };
```

### 6.2 EsimProvider
```ts
// src/server/providers/esim/types.ts
export interface EsimProvider {
  readonly id: 'airalo';
  purchase(input: PurchaseInput): Promise<ProvisionedEsim>;
  getStatus(iccid: string): Promise<EsimRemoteStatus>;
  syncPackages(): Promise<ProviderPackageSeed[]>;
  verifyWebhook(req: NextRequest, rawBody: string): Promise<NormalizedEsimEvent>;
}

export interface PurchaseInput {
  orderId: string;
  providerSku: string;     // ProviderPackage.providerSku
  quantity: number;
  travelerEmail: string;
}

export interface ProvisionedEsim {
  iccid: string;
  qrCode: string;          // PNG data URL or activation code; stored as-is on Esim row
  activationCode: string;
  expiresAt: Date;
}

export type NormalizedEsimEvent =
  | { kind: 'esim.installed'; iccid: string; eventId: string }
  | { kind: 'esim.expired';   iccid: string; eventId: string }
  | { kind: 'esim.exhausted'; iccid: string; eventId: string };
```

### 6.3 Registries
```ts
// src/server/providers/payment/registry.ts
const providers: Record<PaymentProviderId, PaymentProvider> = {
  paddle: paddleProvider,
};
export function getPaymentProvider(id: PaymentProviderId): PaymentProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown payment provider: ${id}`);
  return p;
}
```

Same shape for `esim/registry.ts`.

## 7. Booking Flow

### 7.1 Self_pay (B2C)

```
1. GET /[locale]/shop                     → list ProviderPackages (where active=true)
2. User clicks Buy → /shop/checkout?packageId=X
3. Form: traveler email + name; submit → POST /api/booking
4. createBooking({tenantId: PLATFORM_TENANT_ID, packageId, qty, traveler, paymentMode:'self_pay', locale}):
   tx {
     priceLock = lockPrice({packageId, qty, currency: package.currency})
     order = create Order(state=DRAFT, paymentMode=self_pay, locale, traveler*, tenantId)
     orderItem = create OrderItem(orderId, packageId, qty, priceLock.unitPrice)
     ({order, audit}) = transition(order, {type:'START_CHECKOUT'}) → state=AWAITING_PAYMENT
     update + audit
   }
5. session = paddle.createCheckout({orderId, customerEmail, lineItems:[{priceId: package.providerPriceId, quantity}]})
   create Payment(orderId, externalSessionId=session.externalSessionId, status=pending)
6. Return {orderId, checkoutUrl: session.url} → client redirects to Paddle
7. (Paddle hosted checkout) → user pays → Paddle POSTs to /api/webhooks/paddle
8. Phase 2a ingest: persist WebhookEvent (dedupe on provider+externalEventId), enqueue webhooks job, return 200
9. Webhook BullMQ worker → processor → handlerRegistry['paddle:payment.completed'](evt, tx):
   tx {
     ({order, audit}) = transition(order, {type:'PAYMENT_RECEIVED', externalPaymentId})
     update Payment.status=succeeded
     update Order
     audit
     enqueueOutbox(tx, {kind:'esim.provision', payload:{orderId}})
     enqueueOutbox(tx, {kind:'email.send', payload:{template:'order_confirmation', orderId}})
   }
10. Outbox worker (email.send) → render orderConfirmation(order, locale) → resend.send(to: traveler) → mark sent
11. Outbox worker (esim.provision) → provisionEsim({orderId}):
    tx { transition(order, PROVISION_STARTED) → state=PROVISIONING; update; audit }
    airalo.purchase({orderId, providerSku, qty, travelerEmail})
    on success:
      tx {
        create Esim(orderId, iccid, qrCode, activationCode, expiresAt, tenantId)
        ({order, audit}) = transition(order, {type:'PROVISION_SUCCEEDED', iccid, qr})
        update; audit
        ({order, audit}) = transition(order, {type:'ACTIVATE'}) → state=ACTIVE
        update; audit
        enqueueOutbox(tx, {kind:'email.send', payload:{template:'provisioning_complete', orderId}})
      }
    on permanent failure (BullMQ exhausted retries):
      tx { transition(order, {type:'PROVISION_FAILED', reason}) → state=PROVISIONING_FAILED; update; audit }
12. Outbox worker (email.send provisioning_complete) → resend.send(traveler email with QR)
```

### 7.2 Agency_pay

```
1. GET /[locale]/a/[slug]/bookings/new (auth: agency_staff or higher on this tenant)
2. Form: package select + qty + traveler email/name + paymentMode (default from Tenant)
3. POST /api/agency/[slug]/booking → createBooking(...paymentMode:'agency_pay', agencyActorId: session.user.id):
   tx {
     priceLock + Order(state=DRAFT) + OrderItem
     ({order, audit}) = transition(order, {type:'AWAIT_INVOICE'}) → state=AWAITING_INVOICE
     update; audit
     enqueueOutbox(tx, {kind:'email.send', payload:{template:'order_confirmation', orderId, bccTenantContact:true}})
   }
4. Order detail page shows "Awaiting Invoice"
5. Admin or agency_admin clicks "Mark Paid" → POST /api/orders/:orderId/mark-paid
6. markPaid handler:
   tx {
     ({order, audit}) = transition(order, {type:'INVOICE_MARKED_PAID', actorUserId})
     create Payment(method='manual_invoice', status=succeeded, amount=order.total)
     update; audit
     enqueueOutbox(tx, {kind:'esim.provision', payload:{orderId}})
   }
7. Provisioning + email path identical to 7.1 step 11 onward, EXCEPT:
   - email.send handler reads order.paymentMode and order.tenantId
   - if agency_pay: bcc = tenant.agencyContactEmail
```

### 7.3 Refund (admin-initiated)

```
1. Admin clicks "Issue Refund" on order detail
2. POST /api/orders/:id/refund:
   tx {
     ({order, audit}) = transition(order, {type:'REQUEST_REFUND', actorUserId})
        // valid from PROVISIONING_FAILED or PAID
     update; audit
   }
3. Order shows "Refund Pending" — admin completes refund out-of-band (Paddle dashboard / bank transfer for agency_pay)
4. Admin clicks "Mark Cancelled" once refund issued externally:
   tx { transition(order, {type:'CANCEL', actorUserId, reason}) → state=CANCELLED; update; audit }
```

## 8. Webhook Handler Registry

```ts
// src/server/webhooks/handlerRegistry.ts
export type WebhookHandler = (
  event: NormalizedPaymentEvent | NormalizedEsimEvent,
  ctx: { tx: PrismaTx; tenantId: string | null; webhookEventId: string }
) => Promise<void>;

export const webhookHandlers: Record<string, WebhookHandler> = {
  'paddle:payment.completed': paddleHandlers.completed,
  'paddle:payment.refunded':  paddleHandlers.refunded,
  'paddle:payment.failed':    paddleHandlers.failed,
  'airalo:esim.installed':    airaloHandlers.installed,
  'airalo:esim.expired':      airaloHandlers.expired,
  'airalo:esim.exhausted':    airaloHandlers.exhausted,
};
```

Worker flow (`processor.ts`, replaces Phase 2a's `received_no_handler` stub):
```
1. job.data = { webhookEventId }
2. Load WebhookEvent (raw body, provider, headers)
3. provider.verifyWebhook(syntheticReq, rawBody) → NormalizedEvent
   on signature mismatch → mark webhook_events.status='signature_failed'; do NOT throw (prevents retry)
4. Look up handler[`${provider}:${event.kind}`]
   if not found → mark status='no_handler'; log + alert; do not throw
5. tx { handler(event, ctx); mark status='processed' }
   on throw → mark status='failed' + increment attempt; throw to BullMQ for retry
```

## 9. Outbox Handler Registry

```ts
// src/server/outbox/handlerRegistry.ts
export type OutboxHandler = (
  payload: unknown,
  ctx: { outboxEventId: string; tenantId: string | null }
) => Promise<void>;

export const outboxHandlers: Record<OutboxKind, OutboxHandler> = {
  'email.send':     emailSendHandler,
  'esim.provision': esimProvisionHandler,
};
```

Worker flow (`processor.ts`):
```
1. job.data = { outboxEventId }
2. Load OutboxEvent
3. handler = outboxHandlers[event.kind]
   if missing → mark 'no_handler'; alert
4. handler(event.payload, ctx)
   on success → mark 'sent'
   on throw → mark 'failed' + increment; throw for BullMQ retry (5 attempts, exp backoff)
   on final retry exhaustion → BullMQ moves to DLQ; cron in Phase 2c notifies admin
```

## 10. Email Templates

React Email components — server-rendered to HTML string at send time.

- `orderConfirmation.tsx` props: `{ order, items, tenant?, locale }`. Subject: "Sipariş Alındı / Order Received #ORD-XYZ".
- `provisioningComplete.tsx` props: `{ order, esim, locale }`. Subject: "eSIM'iniz Hazır / Your eSIM is Ready". QR rendered as `<img src="data:image/png;base64,...">`.
- `magicLink.tsx` props: `{ url, locale }`. Subject: "Datapatch Login Link".

i18n via `next-intl`'s server-side `getTranslations(locale, namespace)`. Translation files: `messages/{en,tr}.json` extended with `email.orderConfirmation.*`, `email.provisioningComplete.*`, `email.magicLink.*` namespaces.

`send({to, bcc?, template, locale, data})`:
```ts
const html = await renderEmail(template, locale, data);
const subject = await getEmailSubject(template, locale, data);
return resend.emails.send({ from: env.EMAIL_FROM, to, bcc, subject, html });
```

Auth.js v5 override:
```ts
// app/api/auth/[...nextauth]/route.ts (or auth config file)
export const authConfig = {
  providers: [
    Email({
      sendVerificationRequest: async ({ identifier: to, url }) => {
        await sendEmail({ to, template: 'magicLink', locale: getCurrentLocale(), data: { url } });
      },
    }),
  ],
};
```

## 11. Tenant + Order Schema Δ

```prisma
enum PaymentMode { SELF_PAY AGENCY_PAY }

model Tenant {
  // ... existing
  defaultPaymentMode  PaymentMode @default(SELF_PAY)
  agencyContactEmail  String?
  // paddleVendorId — NOT added in 2b; single platform Paddle account
}

enum OrderState {
  DRAFT
  AWAITING_PAYMENT
  AWAITING_INVOICE
  PAID
  PROVISIONING
  PROVISIONED
  ACTIVE
  EXPIRED
  PROVISIONING_FAILED
  REFUND_PENDING
  CANCELLED
}

model Order {
  // ... existing from 2a (id, tenantId, totalAmount, totalCurrency, locale, ...)
  state          OrderState  @default(DRAFT)
  paymentMode    PaymentMode
  travelerEmail  String
  travelerName   String
  agencyActorId  String?     // Set when paymentMode=AGENCY_PAY; FK → User.id
  // existing relations: items OrderItem[], payments Payment[], esims Esim[]
}
```

`Order.state` may already exist as a String in 2a — if so, the migration converts to enum + adds new states. ESLint `no-restricted-syntax` selector still covers `prisma.order.*` from 2a; no extension needed.

## 12. Test Strategy

| Layer | What | How |
|---|---|---|
| `orderMachine` | Every transition (happy + invalid) | Pure unit tests; table-driven |
| `createBooking` | self_pay + agency_pay × happy + bad input | Unit with prisma testcontainer |
| `markPaid` | Valid (awaiting_invoice) + invalid states | Unit |
| `provisionEsim` | success + Airalo error → state | Unit with mocked airaloProvider |
| `markRefundPending` | Valid from PAID and PROVISIONING_FAILED | Unit |
| Paddle adapter | `verifyWebhook` accepts golden fixture, rejects bad sig; `createCheckout` builds expected request | Recorded fixtures; `nock` for client |
| Airalo adapter | Same as Paddle; plus `syncPackages` returns expected shape | Recorded fixtures |
| Webhook processor | Each registry entry: synth WebhookEvent → run processor → DB state | Integration with testcontainer |
| Outbox processor | `email.send` calls Resend mock; `esim.provision` runs full provisionEsim flow | Integration |
| Email templates | Render snapshots for EN + TR | Vitest snapshot |
| Magic link send | Trigger Auth.js sign-in → mailpit captures branded HTML | E2E |
| **E2E #1 self_pay** | Shop → checkout → POST simulated Paddle webhook → wait for outbox drain → assert order=ACTIVE + email in mailpit | Playwright |
| **E2E #2 agency_pay** | Agency staff creates booking → Mark Paid → wait for drain → assert ACTIVE + traveler+BCC email in mailpit | Playwright |
| **E2E #3 provisioning failure** | Inject airalo mock that throws → assert state=PROVISIONING_FAILED after retries | Playwright (or integration if too slow) |
| **Real Paddle sandbox smoke** | Manual on `v2.datapatch.net` with sandbox card | Exit criterion verification, NOT in CI |

Coverage gates per spec Section 6.4:
- Critical paths (state machine, booking, pricing, webhook handlers): **90%+ mandatory**.
- Provider adapters: contract tests, no % gate.
- Overall floor: 60%.

## 13. Environment Variables

New (must be in `.env`, `docker-compose.yml`, Dockerfile builder placeholder, `src/lib/env.ts` Zod schema, Railway production):

```
PADDLE_API_KEY                 # server-side API key
PADDLE_WEBHOOK_SECRET          # for HMAC verification
PADDLE_ENVIRONMENT             # 'sandbox' | 'production'
PADDLE_DEFAULT_PRICE_ID_*      # optional — only if seed maps SKU→Paddle priceId
AIRALO_CLIENT_ID
AIRALO_CLIENT_SECRET
AIRALO_BASE_URL                # 'https://sandbox-partners-api.airalo.com/v2' | prod
AIRALO_WEBHOOK_SECRET          # bearer + HMAC
EMAIL_FROM                     # already used for magic link; reaffirm
EMAIL_REPLY_TO                 # optional
PUBLIC_APP_URL                 # for checkout success/cancel URLs (already exists)
```

`src/lib/env.ts` extended Zod schema validates all of these at boot. Missing in production = fail fast.

## 14. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Paddle webhook double-delivery | Phase 2a `WebhookEvent` unique `(provider, externalEventId)` constraint catches dedupe; processor is idempotent. |
| Webhook handler runs but outbox enqueue fails post-tx | Both must be in same `prisma.$transaction` — `enqueueOutbox(tx, ...)` already supports this from Phase 2a. |
| Airalo OAuth token expires mid-flight | Redis cache + 401 retry-with-fresh-token in `client.ts`. |
| Airalo returns success but no QR (corrupt response) | Adapter validates response shape with Zod; throws on missing fields → BullMQ retries → DLQ if persistent. |
| Provisioning succeeds but state transition crashes | Whole step is in tx; either both happen or neither. |
| Agency staff marks paid by mistake | `INVOICE_MARKED_PAID` writes `actorUserId` to audit; admin can refund. No "unmark paid" — by design (audit clarity). |
| Email delivery failure | Outbox retries 5×, then DLQ. No "best effort fire and forget" anywhere. |
| Locale missing on Order (legacy data) | NOT NULL with default 'en' on the column. |
| Tenant with no agencyContactEmail attempts agency_pay | Validation in `createBooking` rejects with 400; UI surfaces error. |
| `force-dynamic` forgotten on a new page | Railway build fails immediately with prerender error — caught at PR time. |
| Real Paddle sandbox webhook needs public URL | Phase 2b plan includes `pnpm tunnel` (cloudflared) instructions for local manual smoke; CI doesn't need real Paddle. |
| Magic link branded template breaks magic link delivery | Phase 2b plan gates this behind Task 9; full sign-in E2E re-runs to verify. |
| Catalog seed drifts from real Airalo SKUs | Run-once `pnpm sync:packages` before exit-criterion smoke. |
| `Order.state` enum migration from existing 2a String column | Migration explicitly: add enum type → cast column with `USING state::"OrderState"` → drop default → add new default. Test: roll forward + back on a copy of the dev DB. |

## 15. Exit Criteria

1. `pnpm test` green: every layer in Section 12.
2. `pnpm test:e2e` green: 3 E2E scenarios.
3. `pnpm lint && pnpm typecheck && pnpm build` green.
4. CI green on GitHub Actions.
5. `prisma migrate dev` clean from a fresh DB; `prisma migrate deploy` clean on Railway.
6. `pnpm sync:packages` populates ≥5 ProviderPackage rows from Airalo sandbox.
7. Magic link sign-in delivers branded email (verified in mailpit dev + Resend prod test).
8. Manual self_pay smoke on `v2.datapatch.net`: real Paddle sandbox card → checkout completes → Airalo sandbox provisions → `provisioning_complete` email arrives at a real inbox with QR. **This is the spec Section 7 exit criterion.**
9. Manual agency_pay smoke: agency_staff creates → admin marks paid → provisioning + traveler+BCC email.
10. Tag `phase-2b-complete` pushed.

## 16. Out-of-Scope Reminders for Phase 2c

- TurInvoice + Zendit adapters
- Scheduled jobs: `esim.syncStatuses`, `packages.syncCatalog`, `fx.syncRates`, `order.expireStale`, `email.digestAdmin`
- Bull Board interactive UI (DLQ replay, retry, ignore)
- Paddle refund automation
- Per-tenant Paddle Connect / merchant-of-record
- Admin "edit tenant" UI for `defaultPaymentMode` and `agencyContactEmail` (config-as-code via seed in 2b)
- Brochure generator port from V1
- Subdomain tenant resolution
