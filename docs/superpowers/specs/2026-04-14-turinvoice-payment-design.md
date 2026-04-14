# TurInvoice Payment Integration — Design Spec

**Date:** 2026-04-14
**Status:** Approved
**Author:** DataPatch team

---

## 1. Overview & Architecture

### Purpose

Add TurInvoice as a second payment provider alongside Paddle, enabling Russian card (MIR) and SBP QR code payments for eSIM purchases.

### Positioning

- **Paddle** — International cards (Visa, Mastercard, Apple Pay)
- **TurInvoice** — Russian cards (MIR, SBP QR, Russian bank cards)
- User selects payment method on the existing `/payment` page before checkout
- Feature flag `TURINVOICE_ENABLED` controls visibility

### TurInvoice API Summary

Session-based REST API with cookie authentication. 7-step flow:

| Step | Method | Endpoint | Purpose |
|------|--------|----------|---------|
| 1 | POST | `/api/v1/auth/login` | Authenticate, receive session cookie |
| 2 | PUT | `/api/v1/tsp/order` | Create payment order |
| 3 | GET | `/api/v1/tsp/order?idOrder=X` | Get order details + paymentUrl |
| 4 | GET | `/api/v1/tsp/order/payment/qr?idOrder=X` | Get QR code image |
| 5 | GET | `/api/v1/tsp/order?idOrder=X` | Poll order status |
| 6 | — | Callback to callbackUrl | Payment success notification |
| 7 | PUT | `/api/v1/tsp/refund` | Refund payment |

**Order states:** `new` → `paying` → `paid`

### New Service: `turInvoiceClient.js`

API wrapper following the `airaloClient.js` pattern:
- Session-based auth (cookie management)
- Auto re-login on 401 response
- Exports: `login()`, `createOrder()`, `getOrder()`, `getQrCode()`, `refund()`
- Module-level session cookie (singleton pattern, same as `airaloClient.js`)

### Payment Service Extension

`paymentService.js` extended with:
- `createTurInvoiceCheckout(userId, packageId, amount, currency)` — creates TurInvoice order, returns `{ idOrder, paymentUrl, merchantOid }`
- `handleTurInvoiceCallback(payload)` — processes callback, triggers eSIM purchase
- Existing `purchaseEsimAfterPayment()` reused (no changes)

### Database

No schema changes. Existing Payment model fields used:
- `provider: 'turinvoice'`
- `providerTransactionId`: TurInvoice `idOrder`
- `metadata` (JSONB): `{ paymentUrl, qrRequested, turInvoiceState, idTSP }`

---

## 2. User Flow & UI

### Payment Method Selection (Radio Cards)

On `/payment` page, before checkout begins, user sees:

```
┌─────────────────────────────────────────┐
│  Siparis Ozeti                          │
│  [icon] Europe 10GB — 10 Gun    $24.99  │
├─────────────────────────────────────────┤
│  Odeme Yontemi                          │
│                                         │
│  ○ 💳 Uluslararasi Kart                │
│    Visa, Mastercard, Apple Pay          │
│                                         │
│  ● 🇷🇺 Rus Karti / MIR                 │
│    MIR, SBP, Banka karti               │
│                                         │
│  [$24.99 Ode →]                         │
│  🔒 256-bit SSL ile guvenli odeme       │
└─────────────────────────────────────────┘
```

- Radio button pattern (Baymard best practice — not tabs, not dropdowns)
- Default selection: Paddle (international card)
- Payment logos for visual recognition (Visa/MC badges, MIR badge)
- Single "Pay" button triggers the selected provider's flow

### QR Payment Screen (TurInvoice — Primary)

When user selects "Rus Karti / MIR" and clicks Pay:

```
┌─────────────────────────────────────────┐
│  ← Yontemi Degistir                    │
│  Europe 10GB — 10 Gun          $24.99   │
├─────────────────────────────────────────┤
│                                         │
│         ┌───────────────┐               │
│         │               │               │
│         │   [QR CODE]   │               │
│         │               │               │
│         └───────────────┘               │
│                                         │
│    Banka Uygulamani Ac                  │
│    QR kodu tarayarak odemeyi tamamla    │
│                                         │
│  ● Odeme bekleniyor... (pulse anim)     │
│                                         │
│  ──────── veya ────────                 │
│                                         │
│    Kart bilgileri ile ode →             │
│    TurInvoice sayfasina yonlendirilir   │
└─────────────────────────────────────────┘
```

- QR code displayed prominently (aligns with 66.5% Russian SBP preference)
- Live polling indicator with orange pulse animation
- "Card payment" as a text link below (fallback, not primary)
- Clicking card link → redirects to TurInvoice payment page (`paymentUrl`)
- 30-second auto-refresh polling on frontend (2-second interval)

### Card Redirect Screen (Fallback)

When "Kart bilgileri ile ode" is clicked:

```
┌─────────────────────────────────────────┐
│         🔄                              │
│  Odeme Sayfasina Yonlendiriliyor...     │
│  TurInvoice guvenli odeme sayfasinda    │
│  kart bilgilerini gireceksin.           │
│  [loading bar animation]                │
└─────────────────────────────────────────┘
```

- User redirected to `paymentUrl` from TurInvoice API
- After payment, TurInvoice redirects to `redirectUrl` (our `/payment/result/:merchantOid`)
- Same result page polling as Paddle flow

### Result Screen (Shared)

Both QR and card redirect flows converge on the same result:

- **Success:** Green checkmark, "Odeme Basarili!", "eSIM'lerimi Gor" button
- **Failure:** Red X, "Odeme Basarisiz", "Tekrar Dene" button
- Same `/payment/result/:merchantOid` page, same polling mechanism as Paddle

---

## 3. Complete Payment Flow

### Paddle Flow (Unchanged)

```
User clicks "Buy" → POST /payment/create {provider: 'paddle'}
→ Existing Paddle checkout (no changes)
```

### TurInvoice QR Flow

```
User selects "Rus Karti" + clicks "Ode"
  → POST /payment/create { packageId, amount, provider: 'turinvoice', paymentType: 'qr' }

Backend:
  1. turInvoiceClient.login() (if no active session)
  2. turInvoiceClient.createOrder({ idTSP, amount, currency: 'USD', callbackUrl, redirectUrl })
  3. Payment.create({ status: 'pending', provider: 'turinvoice', providerTransactionId: idOrder })
  4. turInvoiceClient.getQrCode(idOrder) → QR image
  5. Render payment page in QR mode (QR image + polling)

Frontend:
  6. Poll GET /payment/status/:merchantOid every 2 seconds
  7. Backend checks turInvoiceClient.getOrder(idOrder) → state
  
  state === 'paid':
    → purchaseEsimAfterPayment() (same as Paddle)
    → Poll returns { status: 'completed' }
    → Frontend redirects to success screen

  OR callback arrives:
    → POST /payment/turinvoice/callback
    → Verify secret_key
    → purchaseEsimAfterPayment()
    → Next poll returns { status: 'completed' }
```

### TurInvoice Card Redirect Flow

```
User clicks "Kart bilgileri ile ode"
  → POST /payment/create { packageId, amount, provider: 'turinvoice', paymentType: 'card' }

Backend:
  1-3. Same as QR flow (create order, save Payment)
  4. Get paymentUrl from order details
  5. Redirect user to paymentUrl

User completes payment on TurInvoice page
  → TurInvoice redirects to redirectUrl (/payment/result/:merchantOid)
  → Same polling + callback mechanism as QR flow
```

### Callback Handler

**Route:** `POST /payment/turinvoice/callback` (before CSRF, public)

```
1. Parse payload
2. Verify: crypto.timingSafeEqual(payload.secret_key, TURINVOICE_CALLBACK_SECRET)
3. Find Payment by providerTransactionId === payload.id
4. Idempotency: if Payment.status already 'completed', skip
5. If payload.state === 'paid':
   - Payment.update({ status: 'completed' })
   - purchaseEsimAfterPayment(payment)
   - Send success email
6. Return 200 OK
```

---

## 4. Error Handling

| Scenario | Behavior |
|----------|----------|
| TurInvoice login fails (service down) | "Rus Karti" option shown as disabled on payment page, only Paddle available |
| createOrder fails | User sees "Odeme baslatilamadi, lutfen tekrar deneyin" + error logged |
| getQrCode fails (500) | Automatic fallback to card redirect: "QR yuklenemedi, kart sayfasina yonlendiriliyorsun" |
| Polling 5-minute timeout | "Odeme henuz onaylanmadi. Banka uygulamanizi kontrol edin." + "Tekrar Kontrol Et" button |
| Callback received but Payment not found | Log as orphan, skip processing |
| Callback received, Payment already completed | Idempotent skip |
| Payment successful but eSIM purchase fails | Same as Paddle: Payment marked completed, `metadata.esimPurchaseFailed: true`, user gets email, admin sees it |
| User leaves QR page (browser back) | Payment stays pending. On next `/payment/status` poll (if user returns) or on next TurInvoice `getOrder()` check, if TurInvoice state is still `new` after 30 minutes from creation, mark Payment as `failed` with metadata `{ reason: 'timeout' }` |
| 401 during any API call | Auto re-login + retry the failed request once |
| TurInvoice refund needed | Admin triggers manually via admin panel → `PUT /api/v1/tsp/refund` called |

---

## 5. Security

### Callback Verification

TurInvoice sends `secret_key` in callback payload. Verification uses `crypto.timingSafeEqual()` to prevent timing attacks:

```javascript
const expected = Buffer.from(process.env.TURINVOICE_CALLBACK_SECRET);
const received = Buffer.from(payload.secret_key);
if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
  // reject
}
```

### Session Security

- TurInvoice credentials stored as environment variables (never in code)
- Session cookie stored in memory only (not persisted to DB)
- Re-login happens server-side; credentials never sent to frontend
- `TURINVOICE_ENABLED=false` completely hides the option

### Rate Limiting

- Frontend polling: 2-second intervals, 5-minute max (150 requests per payment)
- `/payment/turinvoice/callback` has no rate limit (server-to-server, but secret_key required)

---

## 6. Environment Variables

| Variable | Description | Test Value |
|----------|-------------|------------|
| `TURINVOICE_HOST` | API base URL | `https://hesap.dev.turinvoice.com` |
| `TURINVOICE_LOGIN` | Auth login (phone) | `+908457123032` |
| `TURINVOICE_PASSWORD` | Auth password | `Qwerty56` |
| `TURINVOICE_IDTSP` | Merchant/TSP ID | `248` |
| `TURINVOICE_CALLBACK_SECRET` | Callback verification key | `23961e91-573c-48e1-b317-02b433dc37ec` |
| `TURINVOICE_ENABLED` | Feature flag (`true`/`false`) | `true` |

---

## 7. MVP Scope

### In MVP

- Payment method selection UI (radio cards: Paddle / TurInvoice)
- TurInvoice order creation + QR code display
- TurInvoice card redirect payment
- Frontend polling (2s interval, 5min max)
- Callback handler with secret_key verification
- Auto re-login on 401
- QR load failure → automatic card redirect fallback
- `TURINVOICE_ENABLED` feature flag
- Existing eSIM purchase flow reused (no changes)
- Admin payment history shows TurInvoice payments (existing `provider` filter)

### Not in MVP (V2)

- TurInvoice topup payments (MVP: first purchase only)
- Dedicated refund UI (admin triggers via code/API)
- RUB currency support (MVP: USD only)
- TurInvoice payment detail page
- SBP push notifications

### File Map

**New files:**

| File | Responsibility |
|------|---------------|
| `src/services/turInvoiceClient.js` | TurInvoice API wrapper (login, createOrder, getOrder, getQrCode, refund) |
| `src/controllers/turInvoiceController.js` | Callback handler + QR image endpoint |

**Modified files:**

| File | Change |
|------|--------|
| `src/services/paymentService.js` | Add `createTurInvoiceCheckout()`, `handleTurInvoiceCallback()` |
| `src/routes/payment.js` | Add callback route + QR endpoint |
| `src/views/payment.ejs` | Add method selector + QR payment mode |
| `src/server.js` | Mount callback route before CSRF, TurInvoice login on startup |
| `docker-compose.yml` | Add 6 new env vars |

### Rollout (4 steps)

1. **TurInvoice client** — API wrapper + session management
2. **Payment service + callback** — Order creation, callback processing, DB integration
3. **UI** — Method selector, QR screen, polling, redirect flow
4. **Integration test** — End-to-end with test credentials

---

## References

- [TurInvoice API Documentation](/Users/turgt/Desktop/OPEN-API%20TURINVOICE%20V1.2509.%20EN.pdf)
- [Payment Method UX Best Practices — Baymard](https://baymard.com/blog/payment-method-selection)
- [Russia Payments 2025 — MIR, SBP QR](https://paymentspedia.com/payment-methods-of-the-world-2025/russia-payments-2025-mir-sbp-wallets/)
- [QR Code Payments Guide — Stripe](https://stripe.com/resources/more/qr-code-payments)
