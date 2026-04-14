# Future-Dated B2B eSIM Sales — Design Spec

**Date:** 2026-04-13
**Status:** Approved
**Author:** DataPatch team

---

## 1. Scope & Top-Level Flow

### Scope Decision

- **MVP scope = B2B:** DataPatch -> Travel Agency -> Traveler. Agency signs a bulk contract, distributes tokens to individual travelers.
- **End-user direct purchase** (someone buying a future-dated eSIM from datapatch.app for themselves) = **deferred to V2**. MVP architecture supports adding this later.
- **Admin direct assignment** (DataPatch admin assigning an eSIM directly to a traveler) = can stay in MVP as a minor extension of the existing flow, but low priority.

### Top-Level Flow — 3 Actors

```
  +--------------+        +---------------+        +-----------+
  |  DataPatch   |        |    Agency     |        |  Traveler |
  |   (admin)    |        |  (B2B panel)  |        |   (web)   |
  +------+-------+        +-------+-------+        +-----+-----+
         |                        |                       |
   (1) Contract approval          |                       |
   (package x qty x price)       |                       |
         |----------------------->                       |
         |  (NO Airalo call)                             |
         |                        |                       |
         |                  (2) Booking                   |
         |              (traveler name, trip date)        |
         |                        |                       |
         |         +-Airalo-------+                       |
         |         | createFutureOrder(due_date)          |
         |         +-request_id-->                        |
         |                        |                       |
         |                  (3) Generate token            |
         |                  datapatch.app/e/abc           |
         |                        |---------------------->|
         |                        |  (email / PNR / PDF)  |
         |                        |                       |
         |                        |                 (4) Early scan
         |                        |                 "date not reached"
         |                        |                       |
         |         +--Airalo------+-- webhook ----------->|
         |         | (due_date reached, LPA ready)        |
         |         +-DB update                            |
         |                        |                       |
         |                        |                 (5) Install
         |                        |                 (iOS deep link / QR)
         |                        |                       |
         |                        |                 (6) At destination
         |                        |                 connect to network
         |                        |                 -> plan starts
```

### Approved Decisions Summary

- **Model I2'** — Per-booking Future Order, JIT inventory (Airalo called at booking time, not at contract time)
- **Unit P3** — Agency contracts per-SKU (e.g. Europe-10d-10GB x 500)
- **Delivery D** — DataPatch white-label proxy portal (for traveler) + REST API (for large agencies)
- **QR model: Proxy URL** — `datapatch.app/e/:token`, date gate on our side, real LPA served after webhook
- **Change policy A1 + B3** — agency-only, 72h cutoff before due_date, date-only (no package change)

---

## 2. Data Model

### New Tables

#### `agencies` (travel agency)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | varchar | |
| slug | varchar unique | datapatch.app/a/:slug (co-branding) |
| logo_url | varchar nullable | white-label option |
| contact_email | varchar | |
| contact_name | varchar | |
| phone | varchar nullable | |
| status | enum(active, suspended) | |
| settings | jsonb | `{notify_via: email\|sms, copy_to_agency_email: true}` |
| created_at | timestamptz | |

#### `agency_contracts` (P3: per-SKU contract pool)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agency_id | fk -> agencies | |
| airalo_package_id | fk -> airalo_packages | specific SKU like "europe-10d-10gb" |
| quantity | int | contracted quantity |
| used_quantity | int default 0 | reserved counter |
| unit_price_amount | decimal | price charged to agency |
| unit_price_currency | char(3) | |
| contract_end_at | timestamptz | price lock expires after this |
| status | enum(active, exhausted, expired, terminated) | |
| created_at | timestamptz | |

#### `traveler_bookings` (one row per traveler — the heart of proxy QR)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agency_id | fk -> agencies | |
| agency_contract_id | fk -> agency_contracts | which pool it draws from |
| traveler_name | varchar | |
| traveler_email | varchar nullable | |
| traveler_phone | varchar nullable | |
| agency_booking_ref | varchar nullable | agency's own PNR |
| token | varchar unique indexed | datapatch.app/e/:token |
| due_date | timestamptz | UTC, sent to Airalo |
| original_due_date | timestamptz | for change tracking |
| change_count | int default 0 | |
| status | enum(pending_provisioning, provisioned, installed, cancelled, failed, expired) | |
| airalo_request_id | varchar nullable | for cancelFutureOrder / update |
| esim_id | fk -> esims nullable | linked when webhook arrives |
| cancelled_at | timestamptz nullable | |
| cancel_reason | varchar nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Status machine:**

```
pending_provisioning --(webhook ok)--> provisioned --(traveler install)--> installed
        |                                  |
        +--(agency cancel)--> cancelled    +--(30 days no install)--> expired
        |                                  |
        +--(Airalo fail / webhook error)--> failed
```

#### Users table extension (no separate agency_users table)

Added columns to existing `users` table:
- `agency_id` fk nullable — null = DataPatch user, set = agency user
- `role` enum(datapatch_admin, datapatch_user, agency_owner, agency_staff)

#### `agency_api_keys` (V2 preparation — schema in MVP, UI in V2)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agency_id | fk -> agencies | |
| key_hash | varchar | SHA256 of the full key |
| key_prefix | varchar | first 8 chars for display |
| label | varchar | |
| last_used_at | timestamptz nullable | |
| status | enum(active, revoked) | |
| created_at | timestamptz | |
| revoked_at | timestamptz nullable | |

#### `airalo_webhook_logs` (audit & replay)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| webhook_type | varchar | future_order_fulfilled, order_failed, etc. |
| airalo_request_id | varchar indexed | |
| payload | jsonb | raw Airalo payload |
| traveler_booking_id | fk nullable | resolved lookup |
| processed_at | timestamptz nullable | |
| process_status | enum(pending, success, failed, retrying) | |
| error | text nullable | |
| received_at | timestamptz | |

Rationale: If webhook processing fails, the payload stays in DB for manual replay — no data loss.

### Existing Table Changes

#### `esims` table

- Add `traveler_booking_id` fk nullable — links B2B-originated eSIMs
- No new status enum values needed (esim record is only created when webhook delivers LPA, with status='completed')

### Key Design Decisions

1. **Token generation:** 22 characters, URL-safe random (nanoid). Must be unpredictable since it's the sole security layer.
2. **`used_quantity` vs booking count:** Atomic counter on contract pool — DB-level constraint (`used_quantity <= quantity`) + transaction to prevent race conditions. Each booking: `UPDATE ... SET used_quantity = used_quantity + 1 WHERE used_quantity < quantity`.
3. **On cancellation:** Booking cancelled -> `used_quantity -= 1` (returns to pool). Airalo `cancelFutureOrder` called.
4. **Expired detection:** Background cron scans `provisioned` bookings where LPA was delivered (i.e., `updated_at` when status changed to `provisioned`) 25+ days ago -> sends "running out of time" warning to traveler + marks `expired` at 30 days from provisioning date.
5. **Webhook idempotency:** Same Airalo webhook arrives twice -> check `airalo_request_id` -> second one is no-op.

### Migration Strategy

6 separate migration files (`.cjs` convention, existing pattern):
1. `agencies` table
2. `agency_contracts` table
3. `users` table: add `agency_id` + `role`
4. `traveler_bookings` table
5. `esims` table: add `traveler_booking_id`
6. `airalo_webhook_logs` + `agency_api_keys`

---

## 3. Backend Flows & Airalo Integration

### 3.1 Contract Creation (DataPatch admin -> for Agency)

**Route:** `POST /admin/agencies/:id/contracts` (DataPatch admin only)

```
input: { airalo_package_id, quantity, unit_price, contract_end_at }

action:
  1. Validate AiraloPackage exists
  2. Insert into agency_contracts (status='active', used_quantity=0)
  3. AuditLog (type='contract_created')
  4. Email to agency: "Your 500x Europe-10d-10GB contract is active"

[NO Airalo API call — zero inventory risk]
```

### 3.2 Booking Creation (Agency -> for Traveler) -- main flow

**Route:** `POST /agency/bookings` (auth: agency_owner or agency_staff)

```
input:
  { contract_id, traveler_name, traveler_email, traveler_phone?,
    agency_booking_ref?, due_date }
  // due_date e.g. "2026-07-10 00:00 UTC" — agency converts local to UTC

action (within transaction):
  1. Validate contract:
       - agency_id matches caller
       - status='active'
       - contract_end_at not passed
       - quantity > used_quantity (SELECT FOR UPDATE)
     
  2. due_date bounds:
       - due_date > now + 24h (too soon not allowed)
       - due_date < now + 12 months (reasonable upper limit for Airalo)
  
  3. Airalo call:
       req_id = airalo.createFutureOrder(
         package_id = contract.airalo_package_id,
         quantity = 1,
         due_date = due_date_str_utc,
         webhook_url = "https://datapatch.app/api/webhooks/airalo",
         description = `DataPatch-${agency.slug}-${booking.id}`
       )
  
  4. On success:
       - Insert traveler_bookings (status='pending_provisioning',
         airalo_request_id=req_id, token=nanoid(22),
         original_due_date=due_date)
       - UPDATE agency_contracts SET used_quantity += 1
       - AuditLog (booking_created)
       - Email to traveler (optional, if agency setting enabled):
         "Your eSIM will be ready on July 10 -> {token_url}"
     On error:
       - If Airalo returns error, rollback, 502 to agency
       - Log audit

output:
  { booking_id, token_url: "https://datapatch.app/e/abc123xyz",
    status: "pending_provisioning", due_date }
```

**Race condition protection:** `SELECT FOR UPDATE` + transaction -> even 50 simultaneous bookings on the same contract count `used_quantity` atomically.

### 3.3 Date Change (A1 + B3)

**Route:** `PATCH /agency/bookings/:id` (agency only, date only)

```
input: { due_date: new_date }

checks:
  - booking.agency_id === caller.agency_id
  - booking.status === 'pending_provisioning' (cannot change after provisioned)
  - booking.due_date - now() > 72 hours (B3 cutoff)
  - new_date > now + 24h and < now + 12 months

action (within transaction):
  1. Airalo: cancelFutureOrder(booking.airalo_request_id)
     -> if error, abort (likely due_date too close, Airalo already started)
  2. Airalo: new_req_id = createFutureOrder(...package, new_date...)
     -> if error: don't block contract pool, retry/alert, tell agency "try again"
  3. UPDATE traveler_bookings
       SET due_date = new_date,
           airalo_request_id = new_req_id,
           change_count += 1,
           updated_at = now()
  4. AuditLog (booking_date_changed, {old, new})
  5. Email to traveler with new date (if configured)
```

**Race risk:** If due_date is reached between cancel and create, webhook could fire incorrectly. B3 cutoff (72 hours) practically eliminates this risk.

### 3.4 Webhook — Airalo -> DataPatch (critical)

**Route:** `POST /api/webhooks/airalo` (public, validated by signature)

```
middleware:
  - Verify Airalo signature header with HMAC (per Airalo docs)
  - If signature invalid: 401 + log

handler:
  1. IMMEDIATELY write raw payload to airalo_webhook_logs (process_status='pending')
  2. Return 200 OK (prevent Airalo retry)
  3. Async processing (within same request, async):
     
     a. Process by payload.type:
        - "future_order_fulfilled": 
            booking = find by airalo_request_id
            esim = insert into esims (status='completed', iccid, lpa, qrcode_url, vendorData)
            UPDATE traveler_bookings SET status='provisioned', esim_id=esim.id
            Notify traveler "Your eSIM is ready" (email + push if available)
        
        - "future_order_failed":
            booking -> status='failed'
            Alert email to agency + return 1 to contract pool
            AuditLog
        
        - "esim_activated" / "first_connection" (if Airalo supports):
            booking -> status='installed'
     
     b. On success: airalo_webhook_logs.process_status='success'
     c. On exception: 'failed' + error message (ready for manual replay)
```

**Idempotency:** same payload arrives twice -> lookup by `airalo_request_id + webhook_type` -> if already processed, skip.

**Replay tool:** Admin panel "Show failed webhooks -> Reprocess" button.

### 3.5 Proxy Page (Traveler -> QR scan) -- UX critical

**Route:** `GET /e/:token` (public, no auth)

```
handler:
  1. booking = traveler_bookings WHERE token=:token
     -> if not found: 404 "Invalid link"
  
  2. Render different views by status:
     
     pending_provisioning:
       Render "Your plan is being prepared" page
       - Countdown to due_date
       - Agency branding (logo if slug exists)
       - "You'll receive an email when the date arrives" note
     
     provisioned:
       Render "Your eSIM is ready - install now!" page
       - Two buttons:
         [Install eSIM] -> iOS 17.4+ Universal Link
           OR Android deep link (manufacturer-specific)
         [Show QR Code] -> desktop/older device LPA QR
       - Manual install instructions (SM-DP+ address, matching ID)
       - 30-day install deadline warning
     
     installed:
       Render "Welcome - eSIM installed" + troubleshooting links
     
     cancelled / failed / expired:
       Render explanatory message + agency contact info
  
  3. Audit log every view (IP, user-agent) for suspicious access detection
```

### 3.6 Background Jobs

New dependency: `node-cron` (lightweight, ~50KB). Currently no cron in project (only `setInterval`).

| Job | Frequency | Action |
|-----|-----------|--------|
| `webhook-retry-failed` | Every 10 min | Retry `airalo_webhook_logs.process_status='failed'` (max 3 attempts) |
| `provision-stuck-watchdog` | Hourly | `pending_provisioning` + due_date passed + 2h no webhook -> poll Airalo order status |
| `expiry-reminder` | Daily | `provisioned` bookings 25+ days old -> email traveler "Install within 5 days" |
| `expiry-marker` | Daily | `provisioned` bookings 30+ days old + not `installed` -> status='expired' |

### 3.7 Airalo Client Wrapper Extension

`src/services/airaloClient.js` currently has `initialize`, `createOrder`, `sync`. New additions:

```js
// New exports:
async function createFutureOrder({ packageId, dueDate, webhookUrl, description })
async function cancelFutureOrder(requestId)
async function getFutureOrder(requestId)   // for polling
async function verifyWebhookSignature(rawBody, headers)
```

All are wrappers around existing SDK methods — approximately 100 lines of additional code.

### End-to-End Booking Lifecycle

```
Agency creates booking (March 15)
  -> POST /agency/bookings
  -> airalo.createFutureOrder -> req_id
  -> token generated, pool decremented by 1
  -> email to traveler

Traveler opens URL (April 1 — 99 days before)
  -> GET /e/abc -> "being prepared" page + countdown

[Optional] Agency changes date (April 20 -> moved to July 12)
  -> cancelFutureOrder + new createFutureOrder
  -> change_count=1

Due date arrives (July 10 00:00)
  -> Airalo webhook -> LPA received
  -> booking status=provisioned, esim record created
  -> push/email to traveler

Traveler installs (July 10 08:15)
  -> GET /e/abc -> "install" screen -> clicks Install eSIM -> iOS universal link
  -> (optional) Airalo "activated" webhook -> status=installed

Traveler connects in Rome (July 11 14:00)
  -> Airalo plan starts, 10-day validity clock begins
  -> No additional DataPatch action, only status polling for reports
```

---

## 4. UI Surfaces

The project uses EJS + Tailwind v4 (Slate + Indigo). New pages follow the **same design tokens + existing topbar+tabbar pattern**.

### A. Agency Panel (`/agency/*`)

For logged-in `agency_owner` or `agency_staff`.

#### `/agency` (Dashboard)

```
+------------------------------------------------------+
| DataPatch                    [Bodrum Tatil] [avatar]  | topbar
+------------------------------------------------------+
|  +----------+ +----------+ +----------+ +----------+  |
|  |  1,250   | |   47     | |  420     | |  8       |  |
|  | Total    | | This wk  | | Ready    | | This mo  |  |
|  | contract | | bookings | | soon     | | cancel   |  |
|  +----------+ +----------+ +----------+ +----------+  | stat-cards
|                                                       |
|  Active Contracts                          [All ->]   |
|  +---------------------------------------------------+|
|  | EU Europe 10d 10GB    325 / 500  ====--  65%  ->  ||
|  | US USA 14d 20GB       180 / 300  ===---  60%  ->  ||
|  | TR Turkey 7d 5GB       95 / 200  ==----  48%  ->  ||
|  +---------------------------------------------------+|
|                                                       |
|  Upcoming Activations (next 7 days)                   |
|  +---------------------------------------------------+|
|  | Ayse Yilmaz    Jul 10  EU Europe     view ->      ||
|  | Mehmet Kaya    Jul 12  US USA        view ->      ||
|  +---------------------------------------------------+|
+-------------------------------------------------------+
[Bookings] [Contracts] [Team] [Settings]       tabbar
```

#### `/agency/bookings` (list)
- Filters: status (all/pending/provisioned/installed/cancelled), date range, contract
- Search: traveler_name / agency_booking_ref / email
- Each row: Traveler name, package, due_date, status badge, copy token link button
- CTA: `[+ New Booking]`

#### `/agency/bookings/new` (form) -- main form

```
New Booking
+------------------------------------------+
| Contract / Package *                      |
| [Europe 10d 10GB  (325 remaining)  v]    |
|                                           |
| Traveler Name *       Booking Ref         |
| [Ayse Yilmaz    ]     [PNR-12345 ]       |
|                                           |
| Email                  Phone              |
| [ayse@...     ]       [+90 ...  ]         |
|                                           |
| Travel Date (UTC) *                       |
| [Jul 10 2026, 00:00 v]                   |
|   i Traveler must install within 30 days  |
|     of this date. Setting 1-2 days before |
|     the flight is recommended.            |
|                                           |
| [ ] Send automatic email to traveler      |
|                                           |
|              [Cancel]  [Create Booking]    |
+------------------------------------------+
```

#### `/agency/bookings/:id` (detail)
- Full info + timeline (created -> webhooks -> install)
- Token URL (large, copy/show QR buttons)
- `[Change Date]` — active if 72h rule allows
- `[Cancel]` — confirmation modal with refund policy explanation
- Resend email

#### `/agency/contracts` — contract list (read-only, management in DataPatch admin)
- Per contract: package, pool status (doughnut chart), unit price, contract_end_at, active booking count

#### `/agency/team` — agency user management (owner only)

#### `/agency/settings` — branding, notification preferences, co-branding settings

### B. Traveler Proxy Page (`/e/:token`) -- the product's storefront

Public, no auth, mobile-first. Single page, renders four different states.

#### State 1: `pending_provisioning` — date not reached

```
+-------------------------------------+
|  Bodrum Tatil             [TR/EN]   | <- agency logo (co-branding)
+-------------------------------------+
|                                     |
|         DataPatch eSIM              |
|                                     |
|    Europe 10 days, 10GB             |
|                                     |
|    +-------------------------+      |
|    |        88 days          |      |
|    |    4 hours 12 minutes   |      |
|    +-------------------------+      |
|                                     |
|    Your eSIM will be automatically  |
|    prepared on July 10, 2026.       |
|                                     |
|    We'll send you an email when     |
|    the date arrives. This page      |
|    will update automatically.       |
|                                     |
|  +-----------------------------+    |
|  | Notify me via email         |    |
|  +-----------------------------+    |
|                                     |
|  [FAQ v]                            |
+-------------------------------------+
```

#### State 2: `provisioned` — date arrived, install!

```
+-------------------------------------+
|  Bodrum Tatil                       |
+-------------------------------------+
|         eSIM is ready!              |
|                                     |
|    Europe 10 days, 10GB             |
|                                     |
|  +-----------------------------+    |
|  |  Install eSIM Now           | <- iOS Universal Link / Android
|  +-----------------------------+    |
|                                     |
|     or install manually via QR:     |
|  +-----------------------------+    |
|  |                             |    |
|  |      [LPA QR CODE]         |    |
|  |                             |    |
|  +-----------------------------+    |
|                                     |
|  [Manual install details v]         |
|    SM-DP+: rsp.airalo.com           |
|    Matching ID: QR-G-5F-123456      |
|    [Copy]                           |
|                                     |
|  Warning: eSIM expires if not       |
|  installed within 30 days of        |
|  becoming ready.                    |
|                                     |
|  Installation guide                 |
|  Support - Bodrum Tatil             |
+-------------------------------------+
```

#### State 3: `installed` — confirmation screen
Congratulations + troubleshooting links, connection tips.

#### State 4: `cancelled / failed / expired`
Explanation + agency contact info.

**UX Notes:**
- Agency logo visible in top bar on every state (white-label)
- Desktop: QR first; Mobile: Install button first
- Page does silent refresh every 30 seconds (checks if status changed) — catches pending -> provisioned transition in real time

### C. DataPatch Admin Extensions (`/admin/*`)

Added to existing admin panel:

#### `/admin/agencies` — agency list
- CRUD (add, edit, suspend agencies)
- Per agency: contract count, total bookings, MRR (monthly average revenue)

#### `/admin/agencies/:id` — agency detail
- Manage contracts (add, edit, terminate)
- Manage users (agency_users)
- Airalo cost vs sale price margin report
- Webhook logs (for that agency)

#### `/admin/webhook-logs` — global webhook monitor
- Failed webhooks -> `[Reprocess]` button
- Last 7 days success rate chart
- Filters: webhook_type, process_status, date

### D. General UI Decisions

1. **Mobile-first:** Agency panel will often be used on tablets (operator + tourist at same table). Preserve existing topbar+tabbar pattern.
2. **i18n:** Traveler page **TR + EN required**. Agency panel MVP: TR only (EN in V2).
3. **Dark mode:** Existing `.dark` class support extends to new pages.
4. **Icons:** Lucide (existing CDN) used throughout.
5. **Offline:** Traveler page cached via service worker -> shows "connect to internet" when offline (airport scenarios).

---

## 5. REST API (V2 Preparation)

MVP has **schema + skeleton endpoints + API key table** ready. UI and documentation deferred to V2. Ensures large agencies can integrate their own systems when the time comes.

### Endpoints (skeleton)

```
POST   /api/v1/bookings              # createBooking — same flow as Section 3
GET    /api/v1/bookings              # list
GET    /api/v1/bookings/:id          # detail
PATCH  /api/v1/bookings/:id          # date change (A1+B3 rules)
DELETE /api/v1/bookings/:id          # cancel
GET    /api/v1/contracts             # read-only contract list
POST   /api/v1/webhooks/test         # for agency to test their own webhook
```

### Auth

`Authorization: Bearer dp_live_<key>` — SHA256 check against `agency_api_keys.key_hash`.

### Rate Limiting

100 req/min per key (existing `express-rate-limit` pattern — currently disabled but force-enabled for these endpoints).

### Outbound Webhook (V2)

Agency webhook URL (`agency_webhook_url` field on `agencies` table) for pushing `booking.provisioned`, `booking.failed`, `booking.installed` events to agency's own system — activated in V2.

---

## 6. Error Scenarios & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Airalo createFutureOrder 5xx | 3 retries (exponential backoff); if all fail, return 502 to agency + do NOT decrement pool |
| Airalo webhook delayed 30 min | `provision-stuck-watchdog` job starts polling at due_date+2h; when webhook arrives, idempotent skip |
| Webhook arrives but processing throws exception | `airalo_webhook_logs.status='failed'`, return 200 OK (prevent Airalo retry), admin manual replay |
| Agency double-clicks booking creation | `agency_booking_ref` unique per agency -> 409 Conflict; if empty, `idempotency-key` header support |
| Traveler forwards QR to someone else | Token is public; security relies on token entropy (nanoid 22 char = ~131 bits) and single eSIM binding. In practice QR sharing is acceptable — same as any activation code |
| Due date arrived but Airalo spot price doubled | Agency contract price is locked -> margin shrinks/disappears. **Alert:** if contract vs spot price diverges > 20% (admin-configurable threshold), warn admin. New price on contract renewal. |
| Contract expired with 100 unused units | Pool frozen (no new bookings); existing bookings proceed normally. Admin action: "extend" or "refund" |
| Agency cancels but traveler already installed | Airalo cancelFutureOrder won't work (due_date passed) -> cancel rejected, status shown as "already provisioned" |
| Traveler opens expired link | Proxy page: "Your period has ended, contact your agency" + agency phone/email |
| Token brute-force attack | nanoid entropy + rate limit per IP (`/e/:token`: 30 req/min) |

---

## 7. Payment & Billing Model

### MVP Decision

Agency payment/billing managed manually outside DataPatch — bank transfer / invoice. System only tracks **usage records**; no automatic collection.

### Tables

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agency_id | fk -> agencies | |
| period_start | date | billing period start |
| period_end | date | billing period end |
| total_bookings | int | bookings in this period |
| total_amount | decimal | unit_price x bookings |
| currency | char(3) | |
| payment_status | enum(pending, paid, overdue) | |
| notes | text nullable | admin notes |
| created_at | timestamptz | |

MVP: report generation only; automatic calculation, manual collection.

### Margin Report

`contract_price - airalo_actual_cost` per column (for admin).

### V2 Additions

- Stripe / Iyzico integration for automatic monthly collection
- Agency "balance top-up" model (pre-pay)
- Invoice PDF generation

**Note:** Existing `feature/paytr-payment` branch is set up for B2C end-user payment — does not affect this B2B flow.

---

## 8. MVP Scope Boundary & Rollout

### In MVP

- Agencies CRUD (admin)
- Contracts CRUD (admin) — per single SKU
- Agency user login + role (owner/staff)
- Booking creation + date change + cancel (agency portal)
- Airalo FutureOrder + Webhook + Cancel integration
- Proxy page (4 states: pending/provisioned/installed/cancelled)
- Install eSIM (iOS 17.4+ universal link + QR fallback)
- Background jobs: webhook-retry, provision-stuck, expiry-reminder, expiry-marker
- Email notifications (agency + traveler)
- Webhook log viewer (admin)
- TR + EN i18n (traveler page); TR (agency portal)
- Audit log
- Rate limiting (token endpoint + API endpoint)

### Not in MVP (V2+)

- REST API public documentation and active usage
- Outbound webhook (event push to agency)
- SMS notifications
- Automatic collection (Stripe/Iyzico)
- Agency balance top-up model
- End-user direct future-dated purchase (from datapatch.app)
- Multi-SKU pool selection (P2/P4 model)
- Package change (only date changes, no package swap)
- Mobile app (PWA sufficient)
- Agency co-branding custom domain (only logo + slug)
- Analytics dashboard (CSV export report sufficient)

### Rollout Strategy (sequential, each step is deployable)

1. **Migration + models** — DB structure ready, no application code
2. **Airalo client wrapper** — createFutureOrder/cancel/verify_webhook additions, unit tests
3. **Webhook endpoint + log** — test with fake Airalo payload
4. **Admin: agency + contract CRUD** — agencies exist but no bookings yet (dry-run)
5. **Booking create + cancel + proxy page (state: pending)** — real Airalo future order placed, test with short due_date
6. **Proxy page (state: provisioned + install flow)** — webhook arrives, end-to-end works
7. **Date change flow (A1+B3)** — cancel+recreate
8. **Background jobs** — cron-scheduled tasks
9. **Agency panel** — login, dashboard, bookings CRUD
10. **i18n + email templates + polish**
11. **Soft launch** — 1 pilot agency, 30-day test
12. **GA**

Each step gets its **own PR** — easy rollback, minimal side effects.

---

## Critical Risks

1. **Airalo FutureOrder payment timing** — Does Airalo charge at submit time or at due_date? Affects margin calculations, does not affect architecture. Must clarify with Airalo account representative.
2. **iOS Universal Link setup** — Apple App Site Association setup + TLS cert validation must be tested. Without this, "Install" button won't work; only QR fallback. Not a blocker but degrades UX.
3. **Contract price lock** — If Airalo spot price increases > X% during contract period, margin strategy is needed (alert + manual intervention).
4. **Airalo webhook reliability** — If webhooks are delayed or lost, `provision-stuck-watchdog` job handles it via polling. Manual replay available in admin panel.
