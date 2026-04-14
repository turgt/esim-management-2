# TurInvoice Payment Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TurInvoice as a second payment provider alongside Paddle, enabling Russian MIR card and SBP QR code payments for eSIM purchases.

**Architecture:** New `turInvoiceClient.js` service wraps the TurInvoice session-based API. Existing `paymentService.js` extended with TurInvoice checkout/callback methods. Payment method selection UI added to existing `payment.ejs`. QR code displayed inline; card payment redirects to TurInvoice page. Same `purchaseEsimAfterPayment()` reused after payment confirmation.

**Tech Stack:** Express.js, Sequelize 6, EJS + Tailwind v4, TurInvoice REST API, axios (HTTP client)

**Spec:** `docs/superpowers/specs/2026-04-14-turinvoice-payment-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/services/turInvoiceClient.js` | TurInvoice API wrapper (login, createOrder, getOrder, getQrCode, refund) |
| `src/controllers/turInvoiceController.js` | Callback handler + QR image proxy endpoint |

### Modified files

| File | Change |
|------|--------|
| `src/services/paymentService.js` | Add `createTurInvoiceCheckout()`, `handleTurInvoiceCallback()`, `getTurInvoiceStatus()` |
| `src/routes/payment.js` | Add TurInvoice callback route, QR proxy, modified create route |
| `src/views/payment.ejs` | Add payment method selector + QR payment mode |
| `src/server.js` | Mount TurInvoice callback before CSRF, call login on startup |
| `docker-compose.yml` | Add 6 TurInvoice env vars |

---

## Task 1: Environment Variables

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add TurInvoice env vars to docker-compose.yml**

Find the `environment:` section under the `app` service (where PADDLE vars are). Add after the PADDLE block:

```yaml
      # TurInvoice — Russian card payments (MIR, SBP QR)
      TURINVOICE_HOST: "https://hesap.dev.turinvoice.com"
      TURINVOICE_LOGIN: ""
      TURINVOICE_PASSWORD: ""
      TURINVOICE_IDTSP: "248"
      TURINVOICE_CALLBACK_SECRET: ""
      TURINVOICE_ENABLED: "false"
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add TurInvoice environment variables"
```

---

## Task 2: TurInvoice API Client

**Files:**
- Create: `src/services/turInvoiceClient.js`

- [ ] **Step 1: Create the TurInvoice client service**

Create `src/services/turInvoiceClient.js`. This follows the same singleton pattern as `airaloClient.js` — module-level state, initialize once, auto re-login on 401:

```javascript
import axios from 'axios';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'turInvoice' });

let sessionCookie = null;
let apiBase = null;

export async function initialize() {
  apiBase = process.env.TURINVOICE_HOST;
  const login = process.env.TURINVOICE_LOGIN;
  const password = process.env.TURINVOICE_PASSWORD;

  if (!apiBase || !login || !password) {
    log.warn('TurInvoice credentials not configured, skipping initialization');
    return false;
  }

  try {
    await doLogin(login, password);
    log.info('TurInvoice client initialized');
    return true;
  } catch (err) {
    log.error({ err }, 'Failed to initialize TurInvoice client');
    return false;
  }
}

async function doLogin(login, password) {
  const res = await axios.post(`${apiBase}/api/v1/auth/login`, {
    login: login || process.env.TURINVOICE_LOGIN,
    password: password || process.env.TURINVOICE_PASSWORD
  }, {
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true
  });

  const cookies = res.headers['set-cookie'];
  if (cookies) {
    const sessionMatch = cookies.join(';').match(/sessionid=([^;]+)/);
    if (sessionMatch) {
      sessionCookie = sessionMatch[1];
    }
  }

  if (res.data?.code !== 'OK') {
    throw new Error(`TurInvoice login failed: ${JSON.stringify(res.data)}`);
  }

  log.info('TurInvoice login successful');
}

function api() {
  return axios.create({
    baseURL: apiBase,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionCookie ? { Cookie: `sessionid=${sessionCookie}` } : {})
    },
    timeout: 15000
  });
}

async function withAutoRelogin(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 401) {
      log.info('TurInvoice session expired, re-logging in');
      await doLogin();
      return await fn();
    }
    throw err;
  }
}

export async function createOrder({ amount, currency, name, callbackUrl, redirectUrl }) {
  const idTSP = Number(process.env.TURINVOICE_IDTSP);
  return withAutoRelogin(async () => {
    const res = await api().put('/api/v1/tsp/order', {
      idTSP,
      amount,
      currency: currency || 'USD',
      name: name || 'eSIM purchase',
      quantity: 1,
      ...(callbackUrl ? { callbackUrl } : {}),
      ...(redirectUrl ? { redirectUrl } : {})
    });
    log.info({ idOrder: res.data?.idOrder, amount, currency }, 'TurInvoice order created');
    return res.data;
  });
}

export async function getOrder(idOrder) {
  return withAutoRelogin(async () => {
    const res = await api().get('/api/v1/tsp/order', { params: { idOrder } });
    return res.data;
  });
}

export async function getQrCode(idOrder) {
  return withAutoRelogin(async () => {
    const res = await api().get('/api/v1/tsp/order/payment/qr', {
      params: { idOrder },
      responseType: 'arraybuffer'
    });
    return {
      data: res.data,
      contentType: res.headers['content-type'] || 'image/png'
    };
  });
}

export async function refund({ idOrder, amount, description }) {
  return withAutoRelogin(async () => {
    const res = await api().put('/api/v1/tsp/refund', {
      idOrder,
      ...(amount != null ? { amount } : {}),
      ...(description ? { description } : {})
    });
    log.info({ idOrder, amount }, 'TurInvoice refund requested');
    return res.data;
  });
}

export function isInitialized() {
  return sessionCookie !== null;
}

export function isEnabled() {
  return process.env.TURINVOICE_ENABLED === 'true';
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/turInvoiceClient.js
git commit -m "feat: add TurInvoice API client with session management"
```

---

## Task 3: Payment Service Extensions

**Files:**
- Modify: `src/services/paymentService.js`

- [ ] **Step 1: Add TurInvoice import at the top of paymentService.js**

Read the file first. Find the imports section at the top. Add:

```javascript
import * as turInvoice from './turInvoiceClient.js';
```

- [ ] **Step 2: Add createTurInvoiceCheckout function**

Add this function after the existing `createPaddleCheckout()` function:

```javascript
export async function createTurInvoiceCheckout({ payment, paymentType }) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const callbackUrl = `${appUrl}/payment/turinvoice/callback`;
  const redirectUrl = `${appUrl}/payment/result/${payment.merchantOid}`;

  const orderResult = await turInvoice.createOrder({
    amount: Number(payment.amount),
    currency: payment.currency || 'USD',
    name: `eSIM ${payment.merchantOid}`,
    callbackUrl,
    redirectUrl
  });

  const idOrder = orderResult.idOrder;
  if (!idOrder) {
    throw new Error('TurInvoice createOrder returned no idOrder');
  }

  const orderDetails = await turInvoice.getOrder(idOrder);

  await payment.update({
    providerTransactionId: String(idOrder),
    metadata: {
      ...payment.metadata,
      turInvoiceIdOrder: idOrder,
      paymentUrl: orderDetails.paymentUrl,
      paymentType,
      turInvoiceState: orderDetails.state
    }
  });

  return {
    idOrder,
    paymentUrl: orderDetails.paymentUrl,
    merchantOid: payment.merchantOid
  };
}
```

- [ ] **Step 3: Add handleTurInvoiceCallback function**

Add after `createTurInvoiceCheckout`:

```javascript
export async function handleTurInvoiceCallback(payload) {
  const cbLog = logger.child({ module: 'turInvoice-callback' });

  const idOrder = payload.id;
  if (!idOrder) {
    cbLog.warn({ payload }, 'TurInvoice callback missing id');
    return;
  }

  const payment = await db.Payment.findOne({
    where: { provider: 'turinvoice', providerTransactionId: String(idOrder) }
  });

  if (!payment) {
    cbLog.warn({ idOrder }, 'TurInvoice callback: no matching payment');
    return;
  }

  if (payment.status === 'completed') {
    cbLog.info({ idOrder, merchantOid: payment.merchantOid }, 'TurInvoice callback: already completed, skipping');
    return;
  }

  if (payload.state === 'paid') {
    cbLog.info({ idOrder, merchantOid: payment.merchantOid }, 'TurInvoice payment confirmed');

    await payment.update({
      status: 'completed',
      metadata: {
        ...payment.metadata,
        turInvoiceState: 'paid',
        datePay: payload.datePay,
        linkReceipt: payload.linkReceipt
      }
    });

    try {
      await purchaseEsimAfterPayment(payment);
      await sendPaymentSuccessEmail(payment);
    } catch (err) {
      cbLog.error({ err, merchantOid: payment.merchantOid }, 'eSIM purchase after TurInvoice payment failed');
      await payment.update({
        metadata: { ...payment.metadata, esimPurchaseFailed: true, esimError: err.message }
      });
      await sendEsimActivationFailedEmail(payment);
    }
  } else if (payload.state === 'failed' || payload.state === 'cancelled') {
    cbLog.warn({ idOrder, state: payload.state }, 'TurInvoice payment failed/cancelled');
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, turInvoiceState: payload.state }
    });
    await sendPaymentFailedEmail(payment);
  }
}
```

- [ ] **Step 4: Add getTurInvoiceStatus function for polling**

Add after `handleTurInvoiceCallback`:

```javascript
export async function getTurInvoiceStatus(payment) {
  if (!payment.providerTransactionId) return null;

  const idOrder = Number(payment.providerTransactionId);
  const orderDetails = await turInvoice.getOrder(idOrder);

  const createdAt = new Date(payment.createdAt);
  const now = new Date();
  const minutesElapsed = (now - createdAt) / 60000;

  if (orderDetails.state === 'new' && minutesElapsed > 30) {
    await payment.update({
      status: 'failed',
      metadata: { ...payment.metadata, turInvoiceState: 'timeout', reason: 'timeout' }
    });
    return 'failed';
  }

  if (orderDetails.state === 'paid' && payment.status !== 'completed') {
    await handleTurInvoiceCallback({ ...orderDetails, id: idOrder, state: 'paid' });
    return 'completed';
  }

  if (orderDetails.state !== payment.metadata?.turInvoiceState) {
    await payment.update({
      metadata: { ...payment.metadata, turInvoiceState: orderDetails.state }
    });
  }

  return orderDetails.state === 'paid' ? 'completed' : 'pending';
}
```

- [ ] **Step 5: Commit**

```bash
git add src/services/paymentService.js
git commit -m "feat: add TurInvoice checkout, callback, and status polling to payment service"
```

---

## Task 4: TurInvoice Controller + Routes

**Files:**
- Create: `src/controllers/turInvoiceController.js`
- Modify: `src/routes/payment.js`
- Modify: `src/server.js`

- [ ] **Step 1: Create the callback controller**

Create `src/controllers/turInvoiceController.js`:

```javascript
import crypto from 'crypto';
import * as turInvoice from '../services/turInvoiceClient.js';
import { handleTurInvoiceCallback } from '../services/paymentService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'turInvoice-controller' });

export async function handleCallback(req, res) {
  const payload = req.body;

  const expectedSecret = process.env.TURINVOICE_CALLBACK_SECRET;
  if (expectedSecret && payload.secret_key) {
    const expected = Buffer.from(expectedSecret);
    const received = Buffer.from(String(payload.secret_key));
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      log.warn({ id: payload.id }, 'TurInvoice callback: invalid secret_key');
      return res.status(401).json({ error: 'Invalid secret_key' });
    }
  }

  log.info({ id: payload.id, state: payload.state }, 'TurInvoice callback received');
  res.json({ received: true });

  try {
    await handleTurInvoiceCallback(payload);
  } catch (err) {
    log.error({ err, id: payload.id }, 'TurInvoice callback processing failed');
  }
}

export async function serveQrCode(req, res) {
  const { idOrder } = req.params;

  try {
    const { data, contentType } = await turInvoice.getQrCode(Number(idOrder));
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(data));
  } catch (err) {
    log.error({ err, idOrder }, 'Failed to fetch TurInvoice QR code');
    res.status(502).json({ error: 'QR code unavailable' });
  }
}
```

- [ ] **Step 2: Mount callback route in server.js BEFORE CSRF**

Read `src/server.js`. Find the Paddle webhook section (around line 165-189, where `app.post('/payment/webhook', ...)` is).

Add import at the top:

```javascript
import { handleCallback as handleTurInvoiceCallback } from './controllers/turInvoiceController.js';
```

Add after the Paddle webhook block, still before CSRF:

```javascript
// TurInvoice callback — MUST be before CSRF middleware (server-to-server)
app.post('/payment/turinvoice/callback', handleTurInvoiceCallback);
```

- [ ] **Step 3: Add TurInvoice startup login to server.js**

Add import at the top:

```javascript
import { initialize as initTurInvoice, isEnabled as turInvoiceEnabled } from './services/turInvoiceClient.js';
```

Find where server startup happens (after `app.listen` or `startJobs()`). Add:

```javascript
if (turInvoiceEnabled()) {
  initTurInvoice().catch(err => logger.error({ err }, 'TurInvoice init failed'));
}
```

- [ ] **Step 4: Add QR endpoint and modify payment routes**

Read `src/routes/payment.js`. Add imports at the top:

```javascript
import { serveQrCode } from '../controllers/turInvoiceController.js';
import { createTurInvoiceCheckout, getTurInvoiceStatus } from '../services/paymentService.js';
import { isEnabled as turInvoiceEnabled, isInitialized as turInvoiceReady } from '../services/turInvoiceClient.js';
```

Add QR route (authenticated):

```javascript
router.get('/turinvoice/qr/:idOrder', ensureAuth, serveQrCode);
```

Modify the `POST /payment/create` handler. Find where Payment is created and `createPaddleCheckout()` is called. Add provider branching after the Payment record creation:

```javascript
    const provider = req.body.provider || 'paddle';
    const paymentType = req.body.paymentType || 'qr';
```

Override `provider` in the `createPayment()` call, then add this block before the existing Paddle checkout:

```javascript
    if (provider === 'turinvoice') {
      try {
        const turResult = await createTurInvoiceCheckout({ payment, paymentType });

        if (paymentType === 'card') {
          return res.redirect(turResult.paymentUrl);
        }

        return res.render('payment', {
          title: 'Payment',
          user: req.session.user,
          payment,
          paymentMode: 'turinvoice-qr',
          turInvoiceIdOrder: turResult.idOrder,
          turInvoicePaymentUrl: turResult.paymentUrl,
          offerId: packageId || offerId,
          amount,
          currency,
          turInvoiceEnabled: true,
          turInvoiceReady: true
        });
      } catch (err) {
        log.error({ err }, 'TurInvoice checkout failed');
        return res.render('error', {
          title: 'Payment Error',
          user: req.session.user,
          message: 'Odeme baslatilamadi. Lutfen tekrar deneyin.'
        });
      }
    }

    // Existing Paddle flow continues below...
```

In the existing Paddle render call, add TurInvoice availability flags:

```javascript
    turInvoiceEnabled: turInvoiceEnabled() && turInvoiceReady(),
    turInvoiceReady: turInvoiceReady()
```

Modify the `GET /payment/status/:merchantOid` handler. After finding the payment record, add TurInvoice status polling before returning:

```javascript
    if (payment.provider === 'turinvoice' && payment.status === 'pending') {
      try {
        const turStatus = await getTurInvoiceStatus(payment);
        await payment.reload();
      } catch (err) {
        log.error({ err, merchantOid }, 'TurInvoice status poll failed');
      }
    }
```

- [ ] **Step 5: Commit**

```bash
git add src/controllers/turInvoiceController.js src/routes/payment.js src/server.js
git commit -m "feat: add TurInvoice callback controller, QR endpoint, and payment route integration"
```

---

## Task 5: Payment UI — Method Selector + QR Mode

**Files:**
- Modify: `src/views/payment.ejs`

- [ ] **Step 1: Read the existing payment.ejs fully**

Read the complete file to understand the structure. The key sections are:
- Order Summary card (shows plan name, price breakdown)
- Payment status area (loading, ready, error states)
- JavaScript section (Paddle SDK init, checkout open, event handlers)

- [ ] **Step 2: Add TurInvoice QR mode section**

At the top of the content area (after header include), add a conditional block for QR mode. When `paymentMode === 'turinvoice-qr'`, render the QR payment screen instead of the Paddle checkout:

```ejs
<% const isTurInvoiceQr = (typeof paymentMode !== 'undefined' && paymentMode === 'turinvoice-qr'); %>
<% const showMethodSelector = !isTurInvoiceQr && (typeof turInvoiceEnabled !== 'undefined' && turInvoiceEnabled); %>

<% if (isTurInvoiceQr) { %>
  <!-- TurInvoice QR Payment Mode -->
  <div class="max-w-lg mx-auto px-4 py-8">
    <div class="mb-4">
      <a href="javascript:history.back()" class="text-sm text-[var(--brand-primary)] hover:underline">← Yontemi Degistir</a>
    </div>

    <div class="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border-primary)]">
      <span class="text-sm text-[var(--text-secondary)]"><%= payment.metadata?.planName || 'eSIM' %></span>
      <span class="text-lg font-bold"><%= currency %> <%= Number(amount).toFixed(2) %></span>
    </div>

    <div class="card p-6 text-center mb-4">
      <div id="qrContainer" style="width:200px;height:200px;margin:0 auto 16px;position:relative;">
        <img id="qrImage" src="/payment/turinvoice/qr/<%= turInvoiceIdOrder %>"
             alt="QR Code" style="width:100%;height:100%;object-fit:contain;border-radius:8px;"
             onerror="document.getElementById('qrError').style.display='block';this.style.display='none';">
        <div id="qrError" style="display:none;" class="text-sm text-red-500 mt-4">
          QR kodu yuklenemedi.
          <a href="<%= turInvoicePaymentUrl %>" class="text-[var(--brand-primary)] underline block mt-2">Kart ile ode →</a>
        </div>
      </div>
      <p class="font-semibold text-[var(--text-primary)]">Banka Uygulamani Ac</p>
      <p class="text-sm text-[var(--text-secondary)]">QR kodu tarayarak odemeyi tamamla</p>
    </div>

    <div id="turPaymentStatus" class="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-3 mb-4">
      <div style="width:8px;height:8px;border-radius:50%;background:#f97316;" class="animate-pulse"></div>
      <span class="text-sm text-amber-800" id="turStatusText">Odeme bekleniyor... Otomatik onaylanacak.</span>
    </div>

    <div class="flex items-center gap-3 my-4">
      <div class="flex-1 h-px bg-[var(--border-primary)]"></div>
      <span class="text-xs text-[var(--text-secondary)]">veya</span>
      <div class="flex-1 h-px bg-[var(--border-primary)]"></div>
    </div>

    <div class="text-center">
      <a href="<%= turInvoicePaymentUrl %>" class="text-sm text-[var(--brand-primary)] hover:underline">Kart bilgileri ile ode →</a>
      <p class="text-xs text-[var(--text-secondary)] mt-1">TurInvoice guvenli odeme sayfasina yonlendirileceksin</p>
    </div>

    <script>
      (function() {
        var merchantOid = '<%= payment.merchantOid %>';
        var statusEl = document.getElementById('turStatusText');
        var containerEl = document.getElementById('turPaymentStatus');
        var pollInterval = setInterval(function() {
          fetch('/payment/status/' + merchantOid)
            .then(function(r) { return r.json(); })
            .then(function(d) {
              if (d.status === 'completed') {
                clearInterval(pollInterval);
                window.location.href = '/payment/result/' + merchantOid;
              } else if (d.status === 'failed') {
                clearInterval(pollInterval);
                statusEl.textContent = 'Odeme basarisiz oldu.';
                containerEl.className = 'bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3 mb-4';
              }
            })
            .catch(function() {});
        }, 2000);

        setTimeout(function() {
          clearInterval(pollInterval);
          statusEl.textContent = 'Odeme henuz onaylanmadi. Sayfayi yenileyerek tekrar kontrol edebilirsin.';
        }, 5 * 60 * 1000);
      })();
    </script>
  </div>
<% } else { %>
```

- [ ] **Step 3: Add method selector inside the else block (normal Paddle flow)**

Inside the else block, before the existing Order Summary card, add:

```ejs
    <% if (showMethodSelector) { %>
    <form id="paymentMethodForm" method="post" action="/payment/create" class="mb-6">
      <input type="hidden" name="_csrf" value="<%= typeof csrfToken !== 'undefined' ? csrfToken : '' %>">
      <input type="hidden" name="packageId" value="<%= offerId %>">
      <input type="hidden" name="amount" value="<%= amount %>">
      <input type="hidden" name="currency" value="<%= currency %>">
      <input type="hidden" name="planName" value="<%= payment.metadata?.planName || '' %>">
      <input type="hidden" name="provider" id="selectedProvider" value="paddle">
      <input type="hidden" name="paymentType" id="selectedPaymentType" value="qr">

      <p class="text-sm font-semibold text-[var(--text-primary)] mb-3">Odeme Yontemi</p>

      <label class="block border-2 rounded-xl p-4 mb-2 cursor-pointer border-[var(--brand-primary)] bg-indigo-50"
             id="optPaddle" onclick="selectProvider('paddle')">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 rounded-full border-2 border-[var(--brand-primary)] flex items-center justify-center" id="rdPaddle">
            <div class="w-2.5 h-2.5 rounded-full bg-[var(--brand-primary)]"></div>
          </div>
          <div class="flex-1">
            <span class="font-semibold text-sm">💳 Uluslararasi Kart</span>
            <span class="text-xs text-[var(--text-secondary)] block">Visa, Mastercard, Apple Pay</span>
          </div>
        </div>
      </label>

      <label class="block border-2 rounded-xl p-4 cursor-pointer border-[var(--border-primary)]"
             id="optTur" onclick="selectProvider('turinvoice')">
        <div class="flex items-center gap-3">
          <div class="w-5 h-5 rounded-full border-2 border-[var(--border-primary)]" id="rdTur"></div>
          <div class="flex-1">
            <span class="font-semibold text-sm">🇷🇺 Rus Karti / MIR</span>
            <span class="text-xs text-[var(--text-secondary)] block">MIR, SBP, Banka karti</span>
          </div>
        </div>
      </label>

      <button type="submit" id="turSubmitBtn" style="display:none;"
              class="w-full btn btn-primary py-3 text-base font-bold mt-4">
        <%= currency %> <%= Number(amount).toFixed(2) %> Ode →
      </button>
    </form>

    <script>
      function selectProvider(method) {
        document.getElementById('selectedProvider').value = method;
        var optP = document.getElementById('optPaddle');
        var optT = document.getElementById('optTur');
        var rdP = document.getElementById('rdPaddle');
        var rdT = document.getElementById('rdTur');
        var turBtn = document.getElementById('turSubmitBtn');

        if (method === 'paddle') {
          optP.className = 'block border-2 rounded-xl p-4 mb-2 cursor-pointer border-[var(--brand-primary)] bg-indigo-50';
          optT.className = 'block border-2 rounded-xl p-4 cursor-pointer border-[var(--border-primary)]';
          rdP.className = 'w-5 h-5 rounded-full border-2 border-[var(--brand-primary)] flex items-center justify-center';
          rdP.textContent = '';
          var dot = document.createElement('div');
          dot.className = 'w-2.5 h-2.5 rounded-full bg-[var(--brand-primary)]';
          rdP.appendChild(dot);
          rdT.className = 'w-5 h-5 rounded-full border-2 border-[var(--border-primary)]';
          rdT.textContent = '';
          turBtn.style.display = 'none';
        } else {
          optT.className = 'block border-2 rounded-xl p-4 cursor-pointer border-[var(--brand-primary)] bg-indigo-50';
          optP.className = 'block border-2 rounded-xl p-4 mb-2 cursor-pointer border-[var(--border-primary)]';
          rdT.className = 'w-5 h-5 rounded-full border-2 border-[var(--brand-primary)] flex items-center justify-center';
          rdT.textContent = '';
          var dot2 = document.createElement('div');
          dot2.className = 'w-2.5 h-2.5 rounded-full bg-[var(--brand-primary)]';
          rdT.appendChild(dot2);
          rdP.className = 'w-5 h-5 rounded-full border-2 border-[var(--border-primary)]';
          rdP.textContent = '';
          turBtn.style.display = 'block';
        }
      }
    </script>
    <% } %>
```

- [ ] **Step 4: Close the else block after existing Paddle content**

After the existing Paddle checkout content (end of file before footer), close:

```ejs
<% } /* end of isTurInvoiceQr else */ %>
```

- [ ] **Step 5: Commit**

```bash
git add src/views/payment.ejs
git commit -m "feat: add payment method selector UI and QR payment mode"
```

---

## Task 6: Integration Wiring + Verification

**Files:**
- Verify: `src/server.js`, `src/routes/payment.js`

- [ ] **Step 1: Verify server.js has all TurInvoice wiring**

Check these exist in server.js:
1. Import: `handleCallback as handleTurInvoiceCallback` from turInvoiceController
2. Import: `initialize as initTurInvoice, isEnabled as turInvoiceEnabled` from turInvoiceClient
3. Before CSRF: `app.post('/payment/turinvoice/callback', handleTurInvoiceCallback)`
4. After server start: `if (turInvoiceEnabled()) { initTurInvoice()... }`

- [ ] **Step 2: Verify payment routes**

Check `src/routes/payment.js` has:
- `router.get('/turinvoice/qr/:idOrder', ensureAuth, serveQrCode)`
- Modified `POST /payment/create` with provider branching
- Modified `GET /payment/status/:merchantOid` with TurInvoice polling

- [ ] **Step 3: Restart and smoke test**

```bash
docker compose restart app && docker compose logs app --tail=30
```

Expected: No errors. If `TURINVOICE_ENABLED=false`, no TurInvoice init attempt.

- [ ] **Step 4: Test payment page with TurInvoice enabled**

Set `TURINVOICE_ENABLED: "true"` with test credentials in docker-compose.yml, restart, verify:
- Login shows "TurInvoice client initialized" in logs
- Payment page shows radio card method selector
- Selecting "Rus Karti" shows the submit button

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TurInvoice integration issues"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Environment variables | docker-compose.yml |
| 2 | TurInvoice API client | turInvoiceClient.js (new) |
| 3 | Payment service extensions | paymentService.js |
| 4 | Controller + routes + server wiring | turInvoiceController.js (new), payment.js, server.js |
| 5 | Payment UI (method selector + QR) | payment.ejs |
| 6 | Integration verification | server.js, smoke tests |

**Total new files:** 2
**Total modified files:** 5
**Estimated PRs:** 6 (one per task)
