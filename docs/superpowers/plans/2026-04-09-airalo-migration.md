# Airalo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the primary eSIM provider from Zendit to Airalo, keeping Zendit admin-only for balance consumption.

**Architecture:** Install `airalo-sdk` npm package as the primary eSIM provider. Add `vendor` field to Esim model to distinguish sources. Create `AiraloPackage` table for hourly package sync. Airalo SDK handles auth/cache/rate-limiting automatically. Zendit client stays untouched but gets restricted to admin-only routes.

**Tech Stack:** Express.js, Sequelize ORM, PostgreSQL, `airalo-sdk` npm package, EJS templates, Paddle payments

**Spec:** `docs/superpowers/specs/2026-04-09-airalo-migration-design.md`

---

## File Structure

### New Files
- `src/services/airaloClient.js` — Airalo SDK wrapper (init, order, usage, topup, balance)
- `src/services/airaloSync.js` — Hourly AiraloPackage table sync
- `src/db/models/airaloPackage.js` — AiraloPackage Sequelize model
- `src/db/migrations/20260409000001_add_vendor_fields_to_esims.cjs` — Add vendor, vendorOrderId, vendorData to Esims
- `src/db/migrations/20260409000002_create_airalo_packages.cjs` — Create AiraloPackages table
- `src/views/admin/zendit-purchase.ejs` — Admin-only Zendit purchase page

### Modified Files
- `package.json` — Add `airalo-sdk` dependency
- `.gitignore` — Add `.cache` directory
- `docker-compose.yml` — Add Airalo env vars
- `src/db/models/esim.js` — Add vendor, vendorOrderId, vendorData fields
- `src/server.js` — Import and start airaloSync
- `src/services/paymentService.js` — Switch to Airalo for purchase/topup after payment
- `src/controllers/esimController.js` — Read offers from DB, use Airalo for purchases
- `src/controllers/adminController.js` — Vendor-aware assign/topup/detail, new Zendit purchase functions
- `src/routes/admin.js` — Add Zendit purchase routes
- `src/views/offers.ejs` — Render AiraloPackage format
- `src/views/purchases.ejs` — Add vendor badge
- `src/views/status.ejs` — Vendor-aware status display
- `src/views/qrcode.ejs` — Airalo qrcode_url support
- `src/views/admin/esim-detail.ejs` — Show vendor info
- `src/views/partials/header.ejs` — Add Zendit link to admin sidebar

---

### Task 1: Install airalo-sdk and Update Configuration

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Install airalo-sdk**

```bash
cd C:/Users/turgu/Desktop/esim-management-system-2
npm install airalo-sdk
```

- [ ] **Step 2: Add `.cache` to `.gitignore`**

Append to `.gitignore`:
```
.cache
```

The Airalo SDK stores auth tokens and cached responses in a `.cache` directory.

- [ ] **Step 3: Add Airalo env vars to docker-compose.yml**

In `docker-compose.yml`, inside the `app.environment` section, after the `ZENDIT_API_KEY` line, add:

```yaml
      # Airalo Partner API
      AIRALO_CLIENT_ID: ""
      AIRALO_CLIENT_SECRET: ""
      AIRALO_ENV: "sandbox"
```

- [ ] **Step 4: Verify npm install succeeded**

```bash
node -e "const { Airalo } = require('airalo-sdk'); console.log('airalo-sdk loaded OK');"
```

Expected: `airalo-sdk loaded OK`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore docker-compose.yml
git commit -m "chore: install airalo-sdk, add env vars and .cache to gitignore"
```

---

### Task 2: Database Migration — Add Vendor Fields to Esims

**Files:**
- Create: `src/db/migrations/20260409000001_add_vendor_fields_to_esims.cjs`
- Modify: `src/db/models/esim.js`

- [ ] **Step 1: Create migration file**

Create `src/db/migrations/20260409000001_add_vendor_fields_to_esims.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Esims', 'vendor', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'zendit'
    });
    await queryInterface.addColumn('Esims', 'vendorOrderId', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('Esims', 'vendorData', {
      type: Sequelize.JSONB,
      allowNull: true
    });
    await queryInterface.addIndex('Esims', ['vendor'], {
      name: 'idx_esims_vendor'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Esims', 'idx_esims_vendor');
    await queryInterface.removeColumn('Esims', 'vendorData');
    await queryInterface.removeColumn('Esims', 'vendorOrderId');
    await queryInterface.removeColumn('Esims', 'vendor');
  }
};
```

Note: `defaultValue: 'zendit'` ensures all existing rows get `vendor='zendit'` automatically.

- [ ] **Step 2: Update Esim model**

In `src/db/models/esim.js`, add these three fields inside `Esim.init({...})`, after `priceCurrency`:

```javascript
    vendor: { type: DataTypes.STRING, allowNull: false, defaultValue: 'airalo' },
    vendorOrderId: { type: DataTypes.STRING, allowNull: true },
    vendorData: { type: DataTypes.JSONB, allowNull: true }
```

Note: Model default is `'airalo'` (new records), migration default is `'zendit'` (existing records).

- [ ] **Step 3: Run migration**

```bash
docker compose exec app npx sequelize-cli db:migrate
```

Expected: Migration runs successfully, all existing Esim rows now have `vendor='zendit'`.

- [ ] **Step 4: Verify migration**

```bash
docker compose exec db psql -U esim -d esim_db -c "SELECT vendor, COUNT(*) FROM \"Esims\" GROUP BY vendor;"
```

Expected: All rows show `vendor = zendit`.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/20260409000001_add_vendor_fields_to_esims.cjs src/db/models/esim.js
git commit -m "feat: add vendor, vendorOrderId, vendorData fields to Esim model"
```

---

### Task 3: Database Migration — Create AiraloPackage Table

**Files:**
- Create: `src/db/migrations/20260409000002_create_airalo_packages.cjs`
- Create: `src/db/models/airaloPackage.js`

- [ ] **Step 1: Create AiraloPackage model**

Create `src/db/models/airaloPackage.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AiraloPackage extends Model {
    static associate(models) {
      // No associations needed
    }
  }
  AiraloPackage.init({
    packageId: { type: DataTypes.STRING, allowNull: false, unique: true },
    slug: { type: DataTypes.STRING, allowNull: false },
    countryCode: { type: DataTypes.STRING, allowNull: true },
    title: { type: DataTypes.STRING, allowNull: false },
    operatorTitle: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    data: { type: DataTypes.STRING, allowNull: false },
    day: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    netPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    isUnlimited: { type: DataTypes.BOOLEAN, defaultValue: false },
    voice: { type: DataTypes.INTEGER, allowNull: true },
    text: { type: DataTypes.INTEGER, allowNull: true },
    rechargeability: { type: DataTypes.BOOLEAN, defaultValue: false },
    imageUrl: { type: DataTypes.STRING, allowNull: true },
    rawData: { type: DataTypes.JSONB, allowNull: true },
    lastSyncedAt: { type: DataTypes.DATE, allowNull: true }
  }, { sequelize, modelName: 'AiraloPackage' });
  return AiraloPackage;
};
```

- [ ] **Step 2: Create migration file**

Create `src/db/migrations/20260409000002_create_airalo_packages.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AiraloPackages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      packageId: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      slug: { type: Sequelize.STRING, allowNull: false },
      countryCode: { type: Sequelize.STRING, allowNull: true },
      title: { type: Sequelize.STRING, allowNull: false },
      operatorTitle: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING, allowNull: false },
      data: { type: Sequelize.STRING, allowNull: false },
      day: { type: Sequelize.INTEGER, allowNull: false },
      amount: { type: Sequelize.INTEGER, allowNull: false },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      netPrice: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      isUnlimited: { type: Sequelize.BOOLEAN, defaultValue: false },
      voice: { type: Sequelize.INTEGER, allowNull: true },
      text: { type: Sequelize.INTEGER, allowNull: true },
      rechargeability: { type: Sequelize.BOOLEAN, defaultValue: false },
      imageUrl: { type: Sequelize.STRING, allowNull: true },
      rawData: { type: Sequelize.JSONB, allowNull: true },
      lastSyncedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });
    await queryInterface.addIndex('AiraloPackages', ['countryCode'], {
      name: 'idx_airalo_packages_country'
    });
    await queryInterface.addIndex('AiraloPackages', ['type'], {
      name: 'idx_airalo_packages_type'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AiraloPackages');
  }
};
```

- [ ] **Step 3: Run migration**

```bash
docker compose exec app npx sequelize-cli db:migrate
```

Expected: `AiraloPackages` table created.

- [ ] **Step 4: Commit**

```bash
git add src/db/models/airaloPackage.js src/db/migrations/20260409000002_create_airalo_packages.cjs
git commit -m "feat: create AiraloPackage model and migration for package sync"
```

---

### Task 4: Create Airalo Client Service

**Files:**
- Create: `src/services/airaloClient.js`

- [ ] **Step 1: Create airaloClient.js**

Create `src/services/airaloClient.js`:

```javascript
import { Airalo } from 'airalo-sdk';
import axios from 'axios';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo' });

const API_BASE = 'https://partners-api.airalo.com/v2';

let airalo = null;
let accessToken = null;

// Initialize the Airalo SDK instance
export async function initialize() {
  const clientId = process.env.AIRALO_CLIENT_ID;
  const clientSecret = process.env.AIRALO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.warn('Airalo credentials not configured, skipping initialization');
    return;
  }

  try {
    airalo = new Airalo({
      client_id: clientId,
      client_secret: clientSecret,
    });
    await airalo.initialize();
    log.info('Airalo SDK initialized');

    // Get access token for REST calls not covered by SDK
    await refreshToken();
  } catch (err) {
    log.error({ err }, 'Failed to initialize Airalo SDK');
  }
}

// Refresh OAuth token for direct REST calls
async function refreshToken() {
  try {
    const res = await axios.post(`${API_BASE}/token`, new URLSearchParams({
      client_id: process.env.AIRALO_CLIENT_ID,
      client_secret: process.env.AIRALO_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }), {
      headers: { Accept: 'application/json' }
    });
    accessToken = res.data.data.access_token;
    log.info('Airalo access token refreshed');
  } catch (err) {
    log.error({ err }, 'Failed to refresh Airalo token');
  }
}

// Helper for authenticated REST calls
function restApi() {
  return axios.create({
    baseURL: API_BASE,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
}

// Get all packages (flat format for sync)
export async function getAllPackages() {
  if (!airalo) throw new Error('Airalo not initialized');
  return airalo.getAllPackages(true);
}

// Get packages by country
export async function getCountryPackages(countryCode) {
  if (!airalo) throw new Error('Airalo not initialized');
  return airalo.getCountryPackages(countryCode, true);
}

// Place an order (returns order with sims array containing iccid, qrcode_url, lpa, etc.)
export async function createOrder(packageId, quantity = 1, description = '') {
  if (!airalo) throw new Error('Airalo not initialized');
  const result = await airalo.order(packageId, quantity, description || `DataPatch order ${Date.now()}`);
  log.info({ packageId, quantity, orderId: result?.data?.id }, 'Airalo order placed');
  return result;
}

// Get eSIM details by ICCID (REST — not in SDK)
export async function getEsim(iccid) {
  const res = await restApi().get(`/sims/${iccid}`);
  return res.data;
}

// Get eSIM usage (REST — not in SDK)
export async function getUsage(iccid) {
  const res = await restApi().get(`/sims/${iccid}/usage`);
  return res.data;
}

// Get available top-up packages for an eSIM (REST)
export async function getTopupPackages(iccid) {
  const res = await restApi().get(`/sims/${iccid}/topups`);
  return res.data;
}

// Submit a top-up order (REST)
export async function createTopup(packageId, iccid, description = '') {
  const formData = new URLSearchParams();
  formData.append('package_id', packageId);
  formData.append('iccid', iccid);
  if (description) formData.append('description', description);

  const res = await restApi().post('/orders/topups', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  log.info({ packageId, iccid, orderId: res.data?.data?.id }, 'Airalo top-up order placed');
  return res.data;
}

// Get account balance (REST)
export async function getBalance() {
  const res = await restApi().get('/balance');
  const balanceData = res.data?.data?.balances?.availableBalance;
  return {
    amount: balanceData?.amount || 0,
    currency: balanceData?.currency || 'USD',
  };
}

// Check if Airalo balance is sufficient
export async function checkBalance(amount) {
  try {
    const balance = await getBalance();
    log.info({ available: balance.amount, required: amount }, 'Airalo balance check');
    return {
      sufficient: balance.amount >= amount,
      available: balance.amount,
      required: amount,
    };
  } catch (err) {
    log.error({ err }, 'Failed to check Airalo balance');
    return { sufficient: false, available: 0, required: amount, error: err.message };
  }
}

export function isInitialized() {
  return airalo !== null;
}
```

- [ ] **Step 2: Verify file created with correct imports**

```bash
node -e "import('./src/services/airaloClient.js').then(() => console.log('Module syntax OK')).catch(e => console.log('Syntax error:', e.message))"
```

Expected: `Module syntax OK` (or import error for missing credentials — that's fine, syntax is what matters)

- [ ] **Step 3: Commit**

```bash
git add src/services/airaloClient.js
git commit -m "feat: create Airalo client service wrapping airalo-sdk"
```

---

### Task 5: Create Airalo Package Sync Service

**Files:**
- Create: `src/services/airaloSync.js`
- Modify: `src/server.js`

- [ ] **Step 1: Create airaloSync.js**

Create `src/services/airaloSync.js`:

```javascript
import { getAllPackages, initialize, isInitialized } from './airaloClient.js';
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'airalo-sync' });

const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour

export async function syncPackages() {
  if (!isInitialized()) {
    log.warn('Airalo not initialized, skipping sync');
    return;
  }

  try {
    log.info('Starting Airalo package sync');
    const result = await getAllPackages();
    const packages = result?.data || [];

    if (!packages.length) {
      log.warn('No packages returned from Airalo API');
      return;
    }

    let upserted = 0;
    const now = new Date();

    for (const pkg of packages) {
      try {
        await db.AiraloPackage.upsert({
          packageId: pkg.package_id || pkg.id,
          slug: pkg.slug || '',
          countryCode: pkg.country_code || null,
          title: pkg.title || '',
          operatorTitle: pkg.operator_title || pkg.operator?.title || '',
          type: pkg.type || 'local',
          data: pkg.data || '',
          day: pkg.day || 0,
          amount: pkg.amount || 0,
          price: pkg.price || 0,
          netPrice: pkg.net_price || 0,
          isUnlimited: pkg.is_unlimited || false,
          voice: pkg.voice || null,
          text: pkg.text || null,
          rechargeability: pkg.rechargeability || false,
          imageUrl: pkg.image?.url || pkg.operator?.image?.url || null,
          rawData: pkg,
          lastSyncedAt: now,
        });
        upserted++;
      } catch (err) {
        log.error({ err, packageId: pkg.package_id || pkg.id }, 'Failed to upsert package');
      }
    }

    log.info({ total: packages.length, upserted }, 'Airalo package sync complete');
  } catch (err) {
    log.error({ err }, 'Airalo package sync failed');
  }
}

export async function startSync() {
  try {
    await initialize();

    if (!isInitialized()) {
      log.warn('Airalo not initialized, sync will not start');
      return;
    }

    // Initial sync on startup
    await syncPackages();

    // Schedule hourly sync
    setInterval(syncPackages, SYNC_INTERVAL);
    log.info({ intervalMs: SYNC_INTERVAL }, 'Airalo package sync scheduled');
  } catch (err) {
    log.error({ err }, 'Failed to start Airalo sync');
  }
}
```

- [ ] **Step 2: Wire up sync in server.js**

In `src/server.js`, add the import after the existing route imports (after line ~28 `import demoRoutes from './routes/demo.js';`):

```javascript
import { startSync as startAiraloSync } from './services/airaloSync.js';
```

Then, just before the `app.listen()` call (or at the end of route setup), add:

```javascript
// Start Airalo package sync (non-blocking)
startAiraloSync().catch(err => {
  console.error('Airalo sync startup error:', err.message);
});
```

- [ ] **Step 3: Verify app starts without errors**

```bash
docker compose restart app && docker compose logs app -f --tail=20
```

Expected: Logs show `Airalo not initialized, sync will not start` (since credentials are empty in dev). No crash.

- [ ] **Step 4: Commit**

```bash
git add src/services/airaloSync.js src/server.js
git commit -m "feat: add Airalo package sync service with hourly scheduling"
```

---

### Task 6: Update Offers Page to Read from AiraloPackage Table

**Files:**
- Modify: `src/controllers/esimController.js` (lines 85-109: `showOffers`)
- Modify: `src/views/offers.ejs`

- [ ] **Step 1: Update showOffers in esimController.js**

Replace the `showOffers` function (lines 85-109) with:

```javascript
export async function showOffers(req, res) {
  try {
    const country = req.query.country || process.env.COUNTRY || 'TR';
    const type = req.query.type || ''; // 'local' or 'global'

    const where = {};
    if (country && country !== 'ALL') {
      where.countryCode = country;
    }
    if (type) {
      where.type = type;
    }

    const packages = await db.AiraloPackage.findAll({
      where,
      order: [['price', 'ASC']],
      limit: parseInt(process.env.OFFERS_LIMIT) || 100,
    });

    res.render('offers', {
      title: 'Offers',
      offers: packages,
    });
  } catch (err) {
    log.error({ err }, 'showOffers error');
    res.render('error', { message: 'Failed to load offers' });
  }
}
```

- [ ] **Step 2: Update the showLandingPage offers section**

In `showLandingPage` (line 25), update the offers fetching to also use AiraloPackage:

Find the section that fetches offers from Zendit and replace with:

```javascript
    const featuredOffers = await db.AiraloPackage.findAll({
      where: { countryCode: process.env.COUNTRY || 'TR' },
      order: [['price', 'ASC']],
      limit: 6,
    });
```

Pass `featuredOffers` instead of the old offers variable to the render call.

- [ ] **Step 3: Update offers.ejs template**

The `offers.ejs` view needs to render AiraloPackage fields instead of Zendit offer fields. The key field mapping:

| Old (Zendit) | New (AiraloPackage) |
|---|---|
| `offer.offerId` | `offer.packageId` |
| `offer.brand` | `offer.operatorTitle` |
| `offer.dataGB` | `offer.data` (string like "10 GB") |
| `offer.durationDays` | `offer.day` |
| `offer.price.fixed / offer.price.currencyDivisor` | `offer.price` (already decimal USD) |
| `offer.enabled` | (all DB records are enabled) |

In `offers.ejs`, update the offer card rendering to use the new field names. Each offer card's hidden input for purchase should use `packageId` instead of `offerId`:

```html
<input type="hidden" name="packageId" value="<%= offer.packageId %>">
```

And update the display fields accordingly:
- Country/operator: `<%= offer.operatorTitle %>` or `<%= offer.title %>`
- Data: `<%= offer.data %>`
- Duration: `<%= offer.day %> days`
- Price: `$<%= offer.price %>`
- Image: `<% if (offer.imageUrl) { %><img src="<%= offer.imageUrl %>" alt=""><% } %>`

- [ ] **Step 4: Remove Zendit import for listOffers from esimController**

In `src/controllers/esimController.js` line 5, remove `listOffers` from the Zendit import:

```javascript
import { purchaseEsim, getPurchase, getPurchaseQrCode, getUsage, getEsimPlans, normalizeStatus, isCompletedStatus } from '../services/zenditClient.js';
```

Also remove or comment out the `cacheService.getOffers` / `cacheService.setOffers` calls since offers now come from the database.

- [ ] **Step 5: Verify offers page loads**

```bash
docker compose restart app
```

Visit `http://localhost:3000/offers` — should show AiraloPackage data (empty if no sync yet, which is OK).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/esimController.js src/views/offers.ejs
git commit -m "feat: switch offers page to read from AiraloPackage table"
```

---

### Task 7: Update Purchase Flow to Use Airalo

**Files:**
- Modify: `src/controllers/esimController.js` (lines 110-167: `createPurchase`)
- Modify: `src/services/paymentService.js` (lines 4, 24-38, 257-302, 303-349)

- [ ] **Step 1: Add airaloClient import to esimController**

In `src/controllers/esimController.js`, add at the top (after existing imports):

```javascript
import { createOrder as airaloCreateOrder } from '../services/airaloClient.js';
```

- [ ] **Step 2: Update createPurchase function**

Replace the `createPurchase` function (lines 110-167) with:

```javascript
export async function createPurchase(req, res) {
  const transaction = await db.sequelize.transaction();

  try {
    const { packageId } = req.body;
    const userId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      return res.render('error', { message: 'eSIM limit reached' });
    }

    log.info({ username: user.username, packageId }, 'Creating Airalo eSIM purchase');

    const orderResult = await airaloCreateOrder(packageId, 1, `User ${user.username}`);
    const order = orderResult?.data || orderResult;
    const sim = order.sims?.[0] || {};

    await db.Esim.create({
      userId: user.id,
      offerId: packageId,
      transactionId: String(order.id || order.code),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(order.id),
      iccid: sim.iccid || null,
      smdpAddress: null,
      activationCode: null,
      country: null,
      dataGB: order.data ? parseFloat(order.data) || null : null,
      durationDays: order.validity || null,
      brandName: order.package || null,
      priceAmount: order.price || null,
      priceCurrency: order.currency || 'USD',
      vendorData: {
        lpa: sim.lpa || null,
        matchingId: sim.matching_id || null,
        qrcodeUrl: sim.qrcode_url || null,
        qrcode: sim.qrcode || null,
        directAppleUrl: sim.direct_apple_installation_url || null,
        apn: sim.apn || null,
        msisdn: sim.msisdn || null,
        manualInstallation: order.manual_installation || null,
        qrcodeInstallation: order.qrcode_installation || null,
      }
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_PURCHASE, {
      userId: user.id, entity: 'Esim', entityId: null,
      details: { packageId, airaloOrderId: order.id },
      ipAddress: getIp(req)
    });

    res.redirect(`/status/${order.id || order.code}?purchased=true`);

  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'createPurchase error');
    res.render('error', { message: 'Failed to create purchase' });
  }
}
```

- [ ] **Step 3: Update paymentService — add Airalo imports**

In `src/services/paymentService.js`, update the imports:

Replace line 4:
```javascript
import { purchaseEsim, normalizeStatus, getBalance } from './zenditClient.js';
```

With:
```javascript
import { purchaseEsim as zenditPurchaseEsim, normalizeStatus, getBalance as getZenditBalance } from './zenditClient.js';
import { createOrder as airaloCreateOrder, checkBalance as checkAiraloBalance } from './airaloClient.js';
```

- [ ] **Step 4: Update purchaseEsimAfterPayment to use Airalo**

Replace the `purchaseEsimAfterPayment` function (lines 257-302) with:

```javascript
export async function purchaseEsimAfterPayment(payment) {
  const balanceCheck = await checkAiraloBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Airalo balance: available $${balanceCheck.available}, required $${balanceCheck.required}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  log.info({ merchantOid: payment.merchantOid, packageId: payment.offerId }, 'Purchasing Airalo eSIM after payment');

  const orderResult = await airaloCreateOrder(payment.offerId, 1, `Payment ${payment.merchantOid}`);
  const order = orderResult?.data || orderResult;
  const sim = order.sims?.[0] || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId: String(order.id || order.code),
    status: 'completed',
    vendor: 'airalo',
    vendorOrderId: String(order.id),
    iccid: sim.iccid || null,
    country: null,
    dataGB: order.data ? parseFloat(order.data) || null : null,
    durationDays: order.validity || null,
    brandName: order.package || null,
    priceAmount: order.price || null,
    priceCurrency: order.currency || 'USD',
    vendorData: {
      lpa: sim.lpa || null,
      matchingId: sim.matching_id || null,
      qrcodeUrl: sim.qrcode_url || null,
      qrcode: sim.qrcode || null,
      directAppleUrl: sim.direct_apple_installation_url || null,
      apn: sim.apn || null,
      msisdn: sim.msisdn || null,
      manualInstallation: order.manual_installation || null,
      qrcodeInstallation: order.qrcode_installation || null,
    }
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: String(order.id), esimId: esim.id }
  });

  await logAudit(ACTIONS.ESIM_PURCHASE, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, airaloOrderId: order.id, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, airaloOrderId: order.id, esimId: esim.id }, 'Airalo eSIM purchased after payment');
  return esim;
}
```

- [ ] **Step 5: Update topupEsimAfterPayment to use Airalo**

Replace the `topupEsimAfterPayment` function (lines 303-349) with:

```javascript
export async function topupEsimAfterPayment(payment) {
  const balanceCheck = await checkAiraloBalance(parseFloat(payment.amount));
  if (!balanceCheck.sufficient) {
    const msg = `Insufficient Airalo balance: available $${balanceCheck.available}, required $${balanceCheck.required}`;
    log.error({ merchantOid: payment.merchantOid, ...balanceCheck }, msg);
    throw new Error(msg);
  }

  const iccid = payment.targetIccid;
  log.info({ merchantOid: payment.merchantOid, packageId: payment.offerId, iccid }, 'Airalo top-up after payment');

  const parentEsim = await db.Esim.findOne({ where: { iccid, userId: payment.userId } });

  const { createTopup } = await import('./airaloClient.js');
  const topupResult = await createTopup(payment.offerId, iccid, `Topup ${payment.merchantOid}`);
  const order = topupResult?.data || topupResult;

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId: String(order.id || order.code),
    status: 'completed',
    vendor: 'airalo',
    vendorOrderId: String(order.id),
    iccid,
    parentEsimId: parentEsim ? parentEsim.id : null,
    dataGB: order.data ? parseFloat(order.data) || null : null,
    durationDays: order.validity || null,
    brandName: order.package || null,
    priceAmount: order.price || null,
    priceCurrency: order.currency || 'USD',
    vendorData: { topup: true }
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: String(order.id), esimId: esim.id }
  });

  await logAudit(ACTIONS.ESIM_TOPUP, {
    userId: payment.userId,
    entity: 'Esim',
    entityId: esim.id,
    details: { offerId: payment.offerId, iccid, airaloOrderId: order.id, merchantOid: payment.merchantOid }
  });

  log.info({ merchantOid: payment.merchantOid, airaloOrderId: order.id, esimId: esim.id }, 'Airalo top-up completed after payment');
  return esim;
}
```

- [ ] **Step 6: Update checkZenditBalance references**

Rename `checkZenditBalance` to `checkProviderBalance` and make it call Airalo by default:

```javascript
export async function checkProviderBalance(amount) {
  return checkAiraloBalance(amount);
}
```

Update any internal references that call `checkZenditBalance` to use `checkProviderBalance`.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/esimController.js src/services/paymentService.js
git commit -m "feat: switch purchase flow from Zendit to Airalo"
```

---

### Task 8: Update Status, QR Code, and Usage Pages (Vendor-Aware)

**Files:**
- Modify: `src/controllers/esimController.js` (showStatus, showQrCode, showUsage)
- Modify: `src/views/status.ejs`
- Modify: `src/views/qrcode.ejs`

- [ ] **Step 1: Add airaloClient imports to esimController**

Add to existing imports in `src/controllers/esimController.js`:

```javascript
import { getUsage as airaloGetUsage } from '../services/airaloClient.js';
```

- [ ] **Step 2: Update showStatus function**

Replace the `showStatus` function (lines 169-279) to be vendor-aware:

```javascript
export async function showStatus(req, res) {
  try {
    const txId = req.params.txId;
    log.info({ transactionId: txId }, 'Checking purchase status');

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{ model: db.User, as: 'owner', attributes: ['id', 'username'] }]
    });

    if (!esimRecord) {
      return res.render('error', { message: 'eSIM record not found in database' });
    }

    if (esimRecord.vendor === 'airalo') {
      // Airalo: status from DB, usage from API if iccid available
      let usageData = null;
      if (esimRecord.iccid) {
        try {
          const usage = await airaloGetUsage(esimRecord.iccid);
          usageData = usage?.data || null;
        } catch (e) {
          log.warn({ err: e.message, iccid: esimRecord.iccid }, 'Could not fetch Airalo usage');
        }
      }

      return res.render('status', {
        title: 'Purchase Status',
        esim: esimRecord,
        vendor: 'airalo',
        usageData,
        isQrReady: !!esimRecord.iccid,
        dbStatus: esimRecord.status,
      });
    }

    // Zendit: admin can query API, users see DB only
    if (req.session.user.isAdmin) {
      try {
        const apiStatus = await getPurchase(txId);
        const updateData = {};
        const normalizedApiStatus = normalizeStatus(apiStatus.status);
        if (esimRecord.status !== normalizedApiStatus) updateData.status = normalizedApiStatus;
        const confirmation = apiStatus.confirmation || {};
        if (!esimRecord.iccid && confirmation.iccid) updateData.iccid = confirmation.iccid;
        if (!esimRecord.smdpAddress && confirmation.smdpAddress) updateData.smdpAddress = confirmation.smdpAddress;
        const correctCode = confirmation.externalReferenceId || confirmation.activationCode;
        if (correctCode && esimRecord.activationCode !== correctCode) updateData.activationCode = correctCode;
        if (Object.keys(updateData).length > 0) await esimRecord.update(updateData);

        let activePlans = null;
        if (esimRecord.iccid) {
          try { activePlans = await getEsimPlans(esimRecord.iccid); } catch (e) { /* skip */ }
        }

        return res.render('status', {
          title: 'Purchase Status',
          status: apiStatus,
          esim: esimRecord,
          vendor: 'zendit',
          isQrReady: isQrReady(apiStatus.status),
          dbStatus: esimRecord.status,
          activePlans,
        });
      } catch (err) {
        log.warn({ err: err.message }, 'Zendit API failed, showing DB status');
      }
    }

    // Zendit fallback or non-admin: show DB data only
    res.render('status', {
      title: 'Purchase Status',
      esim: esimRecord,
      vendor: 'zendit',
      isQrReady: isQrReady(esimRecord.status),
      dbStatus: esimRecord.status,
      apiError: !req.session.user.isAdmin,
    });

  } catch (err) {
    log.error({ err }, 'showStatus error');
    res.render('error', { message: 'Failed to fetch status' });
  }
}
```

- [ ] **Step 3: Update showQrCode function**

Replace the `showQrCode` function (lines 280-323) with:

```javascript
export async function showQrCode(req, res) {
  try {
    const txId = req.params.txId;

    const esimRecord = await db.Esim.findOne({
      where: { transactionId: txId },
      include: [{ model: db.User, as: 'owner', attributes: ['id', 'username'] }]
    });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.render('error', { message: 'Access denied' });
    }

    if (esimRecord.vendor === 'airalo') {
      // Airalo: QR data is in vendorData
      const vd = esimRecord.vendorData || {};
      return res.render('qrcode', {
        title: 'QR Code',
        esim: esimRecord,
        vendor: 'airalo',
        qrcodeUrl: vd.qrcodeUrl || null,
        directAppleUrl: vd.directAppleUrl || null,
        lpa: vd.lpa || null,
        matchingId: vd.matchingId || null,
        manualInstallation: vd.manualInstallation || null,
        qrcodeInstallation: vd.qrcodeInstallation || null,
      });
    }

    // Zendit: admin-only QR code from API
    if (!req.session.user.isAdmin) {
      return res.render('error', { message: 'QR code only available through admin for legacy eSIMs' });
    }

    const apiStatus = await getPurchase(txId);
    if (!isQrReady(apiStatus.status)) {
      return res.render('error', { message: `QR code not ready. Status: ${apiStatus.status}` });
    }

    const qr = await getPurchaseQrCode(txId);
    res.render('qrcode', {
      title: 'QR Code',
      qr,
      esim: esimRecord,
      vendor: 'zendit',
    });

  } catch (err) {
    log.error({ err }, 'showQrCode error');
    res.render('error', { message: 'Failed to fetch QR code' });
  }
}
```

- [ ] **Step 4: Update showUsage function**

Replace the `showUsage` function (line 450+) with:

```javascript
export async function showUsage(req, res) {
  try {
    const txId = req.params.txId;
    const esimRecord = await db.Esim.findOne({ where: { transactionId: txId } });

    if (!esimRecord || (esimRecord.userId !== req.session.user.id && !req.session.user.isAdmin)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (esimRecord.vendor === 'airalo' && esimRecord.iccid) {
      const usage = await airaloGetUsage(esimRecord.iccid);
      return res.json({ usage: usage?.data, esim: esimRecord, vendor: 'airalo' });
    }

    if (esimRecord.vendor === 'zendit' && req.session.user.isAdmin) {
      const usage = await getUsage(txId);
      return res.json({ usage, esim: esimRecord, vendor: 'zendit' });
    }

    res.json({ usage: null, esim: esimRecord, vendor: esimRecord.vendor, message: 'Usage not available' });
  } catch (err) {
    log.error({ err }, 'showUsage error');
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}
```

- [ ] **Step 5: Update status.ejs to handle vendor field**

In `src/views/status.ejs`, add vendor-aware rendering. At the top of the content area, add:

```ejs
<% if (typeof vendor !== 'undefined' && vendor === 'zendit') { %>
  <span class="badge badge-amber">Zendit</span>
<% } %>
```

For Airalo eSIMs, show usage data from `usageData` if available:
```ejs
<% if (vendor === 'airalo' && usageData) { %>
  <div class="stat-card">
    <span>Remaining: <%= usageData.remaining %> MB / <%= usageData.total %> MB</span>
    <span>Status: <%= usageData.status %></span>
  </div>
<% } %>
```

- [ ] **Step 6: Update qrcode.ejs to handle Airalo QR**

In `src/views/qrcode.ejs`, add Airalo-specific rendering:

```ejs
<% if (typeof vendor !== 'undefined' && vendor === 'airalo') { %>
  <% if (qrcodeUrl) { %>
    <img src="<%= qrcodeUrl %>" alt="eSIM QR Code" class="mx-auto" style="max-width: 250px;">
  <% } %>
  <% if (directAppleUrl) { %>
    <a href="<%= directAppleUrl %>" class="btn btn-primary mt-4">Install on iPhone (iOS 17.4+)</a>
  <% } %>
  <% if (lpa) { %>
    <div class="mt-4">
      <p class="text-sm text-secondary">Manual: <code><%= lpa %></code></p>
    </div>
  <% } %>
<% } else { %>
  <%/* existing Zendit QR rendering */%>
<% } %>
```

- [ ] **Step 7: Commit**

```bash
git add src/controllers/esimController.js src/views/status.ejs src/views/qrcode.ejs
git commit -m "feat: make status, QR code, and usage pages vendor-aware"
```

---

### Task 9: Update Purchases List with Vendor Badge

**Files:**
- Modify: `src/controllers/esimController.js` (listUserPurchases)
- Modify: `src/views/purchases.ejs`

- [ ] **Step 1: Update listUserPurchases to be vendor-aware**

Replace the `listUserPurchases` function (lines 324-375) with:

```javascript
export async function listUserPurchases(req, res) {
  try {
    const userId = req.session.user.id;
    const { page, limit, offset } = getPaginationParams(req);

    const { count, rows: purchases } = await db.Esim.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const pagination = buildPagination(page, limit, count, req.query);

    // Only fetch plans for Airalo eSIMs with iccid
    const plansMap = {};
    const airaloIccids = [...new Set(
      purchases.filter(p => p.vendor === 'airalo' && p.iccid).map(p => p.iccid)
    )];
    await Promise.all(airaloIccids.map(async (iccid) => {
      try {
        const usage = await airaloGetUsage(iccid);
        plansMap[iccid] = usage?.data || null;
      } catch (e) {
        log.warn({ iccid, err: e.message }, 'Failed to fetch Airalo usage');
      }
    }));

    res.render('purchases', {
      title: 'My Purchases',
      purchases,
      plansMap,
      pagination
    });

  } catch (err) {
    log.error({ err }, 'listUserPurchases error');
    res.render('error', { message: 'Failed to load purchases' });
  }
}
```

- [ ] **Step 2: Update purchases.ejs to show vendor badge**

In `src/views/purchases.ejs`, add a vendor badge to each purchase card. Inside the card rendering loop, add:

```ejs
<% if (purchase.vendor === 'zendit') { %>
  <span class="badge badge-amber text-xs">Zendit</span>
<% } %>
```

Airalo eSIMs don't need a badge (they're the default now).

- [ ] **Step 3: Commit**

```bash
git add src/controllers/esimController.js src/views/purchases.ejs
git commit -m "feat: add vendor badge to purchases list, use Airalo usage API"
```

---

### Task 10: Update Admin Assign eSIM to Use Airalo

**Files:**
- Modify: `src/controllers/adminController.js` (showAssignEsim, assignEsim)

- [ ] **Step 1: Update admin imports**

In `src/controllers/adminController.js`, update the imports:

Replace line 4:
```javascript
import { listOffers, purchaseEsim, getUsage, getBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
```

With:
```javascript
import { listOffers, purchaseEsim as zenditPurchaseEsim, getUsage as zenditGetUsage, getBalance as zenditGetBalance, getEsimPlans, normalizeStatus } from '../services/zenditClient.js';
import { createOrder as airaloCreateOrder, getUsage as airaloGetUsage } from '../services/airaloClient.js';
```

- [ ] **Step 2: Update showAssignEsim to use AiraloPackage table**

Replace the `showAssignEsim` function (line 158) with:

```javascript
export async function showAssignEsim(req, res) {
  try {
    const users = await db.User.findAll({
      where: { isActive: true },
      attributes: ['id', 'username', 'displayName', 'esimLimit'],
      include: [{ model: db.Esim, foreignKey: 'userId', attributes: ['id'] }],
      order: [['username', 'ASC']]
    });

    const country = process.env.COUNTRY || 'TR';
    const packages = await db.AiraloPackage.findAll({
      where: { countryCode: country },
      order: [['price', 'ASC']],
      limit: 100,
    });

    const errors = req.session.validationErrors || [];
    const success = req.session.assignSuccess || null;
    delete req.session.validationErrors;
    delete req.session.assignSuccess;

    res.render('admin/assign-esim', {
      title: 'Assign eSIM',
      users,
      offers: packages,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showAssignEsim error');
    res.render('error', { message: 'Failed to load assign form' });
  }
}
```

- [ ] **Step 3: Update assignEsim to use Airalo**

Replace the `assignEsim` function (line 194) with:

```javascript
export async function assignEsim(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const { userId, packageId } = req.body;
    const adminId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (!user) {
      await transaction.rollback();
      req.session.validationErrors = ['User not found'];
      return res.redirect('/admin/assign-esim');
    }

    if (user.esimLimit && user.Esims.length >= user.esimLimit) {
      await transaction.rollback();
      req.session.validationErrors = [`User ${user.username} has reached their eSIM limit (${user.esimLimit})`];
      return res.redirect('/admin/assign-esim');
    }

    log.info({ username: user.username, packageId }, 'Admin assigning Airalo eSIM');

    const orderResult = await airaloCreateOrder(packageId, 1, `Admin assign to ${user.username}`);
    const order = orderResult?.data || orderResult;
    const sim = order.sims?.[0] || {};

    const esim = await db.Esim.create({
      userId: user.id,
      offerId: packageId,
      transactionId: String(order.id || order.code),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(order.id),
      assignedBy: adminId,
      iccid: sim.iccid || null,
      dataGB: order.data ? parseFloat(order.data) || null : null,
      durationDays: order.validity || null,
      brandName: order.package || null,
      priceAmount: order.price || null,
      priceCurrency: order.currency || 'USD',
      vendorData: {
        lpa: sim.lpa || null,
        matchingId: sim.matching_id || null,
        qrcodeUrl: sim.qrcode_url || null,
        qrcode: sim.qrcode || null,
        directAppleUrl: sim.direct_apple_installation_url || null,
        apn: sim.apn || null,
      }
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_ASSIGN, {
      userId: adminId, entity: 'Esim', entityId: esim.id,
      details: { targetUser: user.username, packageId, airaloOrderId: order.id },
      ipAddress: getIp(req)
    });

    if (user.email) {
      await sendEsimAssignedEmail(user, esim);
    }

    req.session.assignSuccess = `eSIM assigned to ${user.username} successfully!`;
    res.redirect('/admin/assign-esim');
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'assignEsim error');
    req.session.validationErrors = ['Failed to assign eSIM: ' + (err.response?.data?.message || err.message)];
    res.redirect('/admin/assign-esim');
  }
}
```

- [ ] **Step 4: Update assign-esim.ejs field name**

In `src/views/admin/assign-esim.ejs`, change the offer select's value from `offerId` to `packageId`:

The `<select name="offerId">` becomes `<select name="packageId">`, and option values use `offer.packageId` instead of `offer.offerId`.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/adminController.js src/views/admin/assign-esim.ejs
git commit -m "feat: switch admin assign-esim to use Airalo packages"
```

---

### Task 11: Update Admin eSIM Detail (Vendor-Aware)

**Files:**
- Modify: `src/controllers/adminController.js` (showEsimDetail)
- Modify: `src/views/admin/esim-detail.ejs`

- [ ] **Step 1: Update showEsimDetail function**

Replace the `showEsimDetail` function (line 553) with:

```javascript
export async function showEsimDetail(req, res) {
  try {
    const esim = await db.Esim.findByPk(req.params.id, {
      include: [
        { model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName', 'email'] },
        { model: db.User, as: 'assigner', attributes: ['id', 'username'] },
        { model: db.Esim, as: 'topups', order: [['createdAt', 'DESC']] }
      ]
    });

    if (!esim) {
      return res.render('error', { message: 'eSIM not found' });
    }

    let usage = null;
    let activePlans = null;

    if (esim.vendor === 'airalo' && esim.iccid) {
      try {
        const usageRes = await airaloGetUsage(esim.iccid);
        usage = usageRes?.data || null;
      } catch (e) {
        log.warn({ err: e.message, iccid: esim.iccid }, 'Could not fetch Airalo usage');
      }
    } else if (esim.vendor === 'zendit') {
      try {
        usage = await zenditGetUsage(esim.transactionId);
      } catch (e) {
        log.warn({ err: e.message, transactionId: esim.transactionId }, 'Could not fetch Zendit usage');
      }
      if (esim.iccid) {
        try { activePlans = await getEsimPlans(esim.iccid); } catch (e) { /* skip */ }
      }
    }

    res.render('admin/esim-detail', { title: 'eSIM Detail', esim, usage, activePlans });
  } catch (err) {
    log.error({ err }, 'showEsimDetail error');
    res.render('error', { message: 'Failed to load eSIM detail' });
  }
}
```

- [ ] **Step 2: Update esim-detail.ejs to show vendor info**

In `src/views/admin/esim-detail.ejs`, add vendor badge and vendor-specific data display:

After the eSIM title/header, add:
```ejs
<span class="badge <%= esim.vendor === 'airalo' ? 'badge-indigo' : 'badge-amber' %>"><%= esim.vendor %></span>
```

For Airalo eSIMs, show vendorData fields:
```ejs
<% if (esim.vendor === 'airalo' && esim.vendorData) { %>
  <% if (esim.vendorData.qrcodeUrl) { %>
    <a href="<%= esim.vendorData.qrcodeUrl %>" target="_blank" class="btn btn-sm">View QR Code</a>
  <% } %>
  <% if (esim.vendorData.directAppleUrl) { %>
    <a href="<%= esim.vendorData.directAppleUrl %>" class="btn btn-sm">Apple Install Link</a>
  <% } %>
<% } %>
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/adminController.js src/views/admin/esim-detail.ejs
git commit -m "feat: make admin eSIM detail vendor-aware with Airalo/Zendit display"
```

---

### Task 12: Create Admin Zendit Purchase Page

**Files:**
- Modify: `src/controllers/adminController.js` — add `showZenditPurchase` and `zenditPurchase` functions
- Modify: `src/routes/admin.js` — add Zendit routes
- Create: `src/views/admin/zendit-purchase.ejs`

- [ ] **Step 1: Add Zendit purchase functions to adminController**

At the end of `src/controllers/adminController.js` (before the last export), add:

```javascript
// Admin-only: Zendit purchase page (for consuming remaining balance)
export async function showZenditPurchase(req, res) {
  try {
    const users = await db.User.findAll({
      where: { isActive: true },
      attributes: ['id', 'username', 'displayName', 'esimLimit'],
      include: [{ model: db.Esim, foreignKey: 'userId', attributes: ['id'] }],
      order: [['username', 'ASC']]
    });

    const country = process.env.COUNTRY || 'TR';
    let offers = cacheService.getOffers(country);
    if (!offers) {
      offers = await listOffers(country);
      cacheService.setOffers(country, offers);
    }
    const activeOffers = offers.list.filter(o => o.enabled);

    let balance = null;
    try {
      const bal = await zenditGetBalance();
      balance = {
        amount: (bal.availableBalance / (bal.currencyDivisor || 100)).toFixed(2),
        currency: bal.currency || 'USD'
      };
    } catch (e) {
      log.warn({ err: e.message }, 'Could not fetch Zendit balance');
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.zenditSuccess || null;
    delete req.session.validationErrors;
    delete req.session.zenditSuccess;

    res.render('admin/zendit-purchase', {
      title: 'Zendit Purchase',
      users,
      offers: activeOffers,
      balance,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showZenditPurchase error');
    res.render('error', { message: 'Failed to load Zendit purchase form' });
  }
}

export async function zenditPurchase(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const { userId, offerId } = req.body;
    const adminId = req.session.user.id;

    const user = await db.User.findByPk(userId, {
      include: [{ model: db.Esim, foreignKey: 'userId' }],
      transaction
    });

    if (!user) {
      await transaction.rollback();
      req.session.validationErrors = ['User not found'];
      return res.redirect('/admin/zendit/purchase');
    }

    const transactionId = uuidv4();
    log.info({ username: user.username, offerId, transactionId }, 'Admin Zendit purchase');

    const purchase = await zenditPurchaseEsim(offerId, transactionId);
    const confirmation = purchase.confirmation || {};

    await db.Esim.create({
      userId: user.id,
      offerId,
      transactionId,
      status: normalizeStatus(purchase.status),
      vendor: 'zendit',
      assignedBy: adminId,
      iccid: confirmation.iccid || null,
      smdpAddress: confirmation.smdpAddress || null,
      activationCode: confirmation.externalReferenceId || confirmation.activationCode || null,
      country: purchase.country || process.env.COUNTRY || 'TR',
      dataGB: purchase.dataGB || null,
      durationDays: purchase.durationDays || null,
      brandName: purchase.brandName || null,
      priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
      priceCurrency: purchase.price?.currency || null
    }, { transaction });

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_PURCHASE, {
      userId: adminId, entity: 'Esim', entityId: null,
      details: { offerId, transactionId, vendor: 'zendit', targetUser: user.username },
      ipAddress: getIp(req)
    });

    req.session.zenditSuccess = `Zendit eSIM purchased for ${user.username}!`;
    res.redirect('/admin/zendit/purchase');
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'zenditPurchase error');
    req.session.validationErrors = ['Zendit purchase failed: ' + (err.response?.data?.message || err.message)];
    res.redirect('/admin/zendit/purchase');
  }
}
```

- [ ] **Step 2: Add Zendit routes to admin.js**

In `src/routes/admin.js`, add the import and routes.

Add to the import from adminController:
```javascript
  showZenditPurchase, zenditPurchase
```

Add routes after the existing vendor routes:
```javascript
// Zendit Purchase (admin-only, for consuming remaining Zendit balance)
router.get('/zendit/purchase', ensureAuth, ensureAdmin, showZenditPurchase);
router.post('/zendit/purchase', ensureAuth, ensureAdmin, zenditPurchase);
```

- [ ] **Step 3: Create zendit-purchase.ejs view**

Create `src/views/admin/zendit-purchase.ejs`:

```ejs
<div class="mb-6">
  <h1 class="text-2xl font-bold">Zendit Purchase</h1>
  <p class="text-secondary mt-1">Purchase eSIM from Zendit (legacy — for consuming remaining balance)</p>
</div>

<% if (balance) { %>
<div class="card p-4 mb-6">
  <div class="flex items-center gap-3">
    <i data-lucide="wallet" class="w-5 h-5 text-amber-500"></i>
    <span class="font-semibold">Zendit Balance:</span>
    <span class="text-lg font-bold">$<%= balance.amount %> <%= balance.currency %></span>
    <% if (parseFloat(balance.amount) <= 0) { %>
      <span class="badge badge-rose">Empty</span>
    <% } %>
  </div>
</div>
<% } %>

<% if (errors && errors.length > 0) { %>
<div class="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4 mb-4">
  <% errors.forEach(error => { %>
    <p class="text-rose-600 dark:text-rose-400"><%= error %></p>
  <% }) %>
</div>
<% } %>

<% if (success) { %>
<div class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 mb-4">
  <p class="text-emerald-600 dark:text-emerald-400"><%= success %></p>
</div>
<% } %>

<div class="card p-6">
  <form method="POST" action="/admin/zendit/purchase">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">

    <div class="mb-4">
      <label class="block text-sm font-medium mb-1">User</label>
      <select name="userId" class="input w-full" required>
        <option value="">Select user...</option>
        <% users.forEach(user => { %>
          <option value="<%= user.id %>">
            <%= user.username %> <%= user.displayName ? '(' + user.displayName + ')' : '' %>
            — <%= user.Esims.length %><%= user.esimLimit ? '/' + user.esimLimit : '' %> eSIMs
          </option>
        <% }) %>
      </select>
    </div>

    <div class="mb-4">
      <label class="block text-sm font-medium mb-1">Zendit Offer</label>
      <select name="offerId" class="input w-full" required>
        <option value="">Select offer...</option>
        <% offers.forEach(offer => { %>
          <option value="<%= offer.offerId %>">
            <%= offer.brand %> — <%= offer.dataGB %>GB / <%= offer.durationDays %> days
            — $<%= offer.price?.fixed ? (offer.price.fixed / (offer.price.currencyDivisor || 100)).toFixed(2) : 'N/A' %>
          </option>
        <% }) %>
      </select>
    </div>

    <button type="submit" class="btn btn-primary">
      <i data-lucide="shopping-cart" class="w-4 h-4 mr-2"></i>
      Purchase from Zendit
    </button>
  </form>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/adminController.js src/routes/admin.js src/views/admin/zendit-purchase.ejs
git commit -m "feat: add admin-only Zendit purchase page for remaining balance"
```

---

### Task 13: Update Admin Sidebar and Final Cleanup

**Files:**
- Modify: `src/views/partials/header.ejs` — add Zendit link
- Modify: `.gitignore` (verify .cache is present)

- [ ] **Step 1: Add Zendit Purchase link to admin sidebar**

In `src/views/partials/header.ejs`, inside the admin sidebar section (after the Emails link), add:

```ejs
<a href="/admin/zendit/purchase" class="sidebar-link <%= typeof title !== 'undefined' && title === 'Zendit Purchase' ? 'active' : '' %>">
  <i data-lucide="zap" class="w-[1.125rem] h-[1.125rem]"></i> Zendit Purchase
</a>
```

- [ ] **Step 2: Verify the complete flow**

Start the application and test:

```bash
docker compose up --build -d && docker compose logs app -f --tail=30
```

Check:
1. `http://localhost:3000/offers` — shows AiraloPackage data (may be empty without credentials)
2. `http://localhost:3000/purchases` — shows existing purchases with Zendit badge
3. Admin sidebar shows "Zendit Purchase" link
4. `http://localhost:3000/admin/zendit/purchase` — shows Zendit offers and balance

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/header.ejs
git commit -m "feat: add Zendit Purchase link to admin sidebar"
```

---

### Task 14: Update Admin Topup to Be Vendor-Aware

**Files:**
- Modify: `src/controllers/adminController.js` (showTopup, topupEsim)

- [ ] **Step 1: Update showTopup to branch by vendor**

Replace the `showTopup` function (line 263) with:

```javascript
export async function showTopup(req, res) {
  try {
    const esim = await db.Esim.findByPk(req.params.esimId, {
      include: [
        { model: db.User, as: 'owner', attributes: ['id', 'username', 'displayName'] },
        { model: db.Esim, as: 'topups' }
      ]
    });

    if (!esim) {
      return res.render('error', { message: 'eSIM not found' });
    }

    let offers = [];
    let activePlans = null;

    if (esim.vendor === 'airalo' && esim.iccid) {
      try {
        const { getTopupPackages } = await import('../services/airaloClient.js');
        const topupResult = await getTopupPackages(esim.iccid);
        offers = topupResult?.data || [];
      } catch (e) {
        log.warn({ err: e.message, iccid: esim.iccid }, 'Could not fetch Airalo top-up packages');
      }
      try {
        const usageRes = await airaloGetUsage(esim.iccid);
        activePlans = usageRes?.data || null;
      } catch (e) { /* skip */ }
    } else if (esim.vendor === 'zendit') {
      const country = esim.country || process.env.COUNTRY || 'TR';
      let zenditOffers = cacheService.getOffers(country);
      if (!zenditOffers) {
        zenditOffers = await listOffers(country);
        cacheService.setOffers(country, zenditOffers);
      }
      offers = zenditOffers.list.filter(o => o.enabled);
      if (esim.iccid) {
        try { activePlans = await getEsimPlans(esim.iccid); } catch (e) { /* skip */ }
      }
    }

    const errors = req.session.validationErrors || [];
    const success = req.session.topupSuccess || null;
    delete req.session.validationErrors;
    delete req.session.topupSuccess;

    res.render('admin/topup', {
      title: 'Top-up eSIM',
      esim,
      offers,
      activePlans,
      errors,
      success
    });
  } catch (err) {
    log.error({ err }, 'showTopup error');
    res.render('error', { message: 'Failed to load top-up form' });
  }
}
```

- [ ] **Step 2: Update topupEsim to branch by vendor**

Replace the `topupEsim` function (line 313) with:

```javascript
export async function topupEsim(req, res) {
  const transaction = await db.sequelize.transaction();
  try {
    const esim = await db.Esim.findByPk(req.params.esimId, { transaction });

    if (!esim || !esim.iccid) {
      await transaction.rollback();
      req.session.validationErrors = ['eSIM not found or ICCID not available'];
      return res.redirect(`/admin/topup/${req.params.esimId}`);
    }

    if (esim.vendor === 'airalo') {
      const { packageId } = req.body;
      log.info({ iccid: esim.iccid, packageId }, 'Airalo top-up');

      const { createTopup } = await import('../services/airaloClient.js');
      const topupResult = await createTopup(packageId, esim.iccid, `Admin topup`);
      const order = topupResult?.data || topupResult;

      await db.Esim.create({
        userId: esim.userId,
        offerId: packageId,
        transactionId: String(order.id || order.code),
        status: 'completed',
        vendor: 'airalo',
        vendorOrderId: String(order.id),
        assignedBy: req.session.user.id,
        iccid: esim.iccid,
        parentEsimId: esim.id,
        dataGB: order.data ? parseFloat(order.data) || null : null,
        durationDays: order.validity || null,
        brandName: order.package || null,
        priceAmount: order.price || null,
        priceCurrency: order.currency || 'USD',
        vendorData: { topup: true }
      }, { transaction });

    } else {
      // Zendit top-up (legacy)
      const { offerId } = req.body;
      const transactionId = uuidv4();
      log.info({ iccid: esim.iccid, offerId, transactionId }, 'Zendit top-up');

      const purchase = await zenditPurchaseEsim(offerId, transactionId, esim.iccid);
      const confirmation = purchase.confirmation || {};

      await db.Esim.create({
        userId: esim.userId,
        offerId,
        transactionId,
        status: normalizeStatus(purchase.status),
        vendor: 'zendit',
        assignedBy: req.session.user.id,
        iccid: esim.iccid,
        parentEsimId: esim.id,
        country: purchase.country || esim.country,
        dataGB: purchase.dataGB || null,
        durationDays: purchase.durationDays || null,
        brandName: purchase.brandName || null,
        priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
        priceCurrency: purchase.price?.currency || null
      }, { transaction });
    }

    await transaction.commit();

    await logAudit(ACTIONS.ESIM_TOPUP, {
      userId: req.session.user.id, entity: 'Esim', entityId: esim.id,
      details: { iccid: esim.iccid, vendor: esim.vendor },
      ipAddress: getIp(req)
    });

    req.session.topupSuccess = 'Top-up completed successfully!';
    res.redirect(`/admin/topup/${req.params.esimId}`);
  } catch (err) {
    await transaction.rollback();
    log.error({ err, apiError: err.response?.data }, 'topupEsim error');
    req.session.validationErrors = ['Top-up failed: ' + (err.response?.data?.message || err.message)];
    res.redirect(`/admin/topup/${req.params.esimId}`);
  }
}
```

- [ ] **Step 3: Update admin/topup.ejs for vendor-aware form**

In `src/views/admin/topup.ejs`, the offer select field name should be `packageId` for Airalo and `offerId` for Zendit:

```ejs
<% if (esim.vendor === 'airalo') { %>
  <select name="packageId" class="input w-full" required>
    <% offers.forEach(pkg => { %>
      <option value="<%= pkg.id %>"><%= pkg.title %> — <%= pkg.data %> / <%= pkg.day %> days — $<%= pkg.price %></option>
    <% }) %>
  </select>
<% } else { %>
  <select name="offerId" class="input w-full" required>
    <% offers.forEach(offer => { %>
      <option value="<%= offer.offerId %>"><%= offer.brand %> — <%= offer.dataGB %>GB / <%= offer.durationDays %> days</option>
    <% }) %>
  </select>
<% } %>
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/adminController.js src/views/admin/topup.ejs
git commit -m "feat: make admin top-up vendor-aware (Airalo + Zendit)"
```

---

### Task 15: Update retryEsimPurchase to Be Vendor-Aware

**Files:**
- Modify: `src/services/paymentService.js`

- [ ] **Step 1: Keep retryEsimPurchase working**

The `retryEsimPurchase` in `adminController.js` (line 466) calls `purchaseEsimAfterPayment` and `topupEsimAfterPayment` which we already updated to use Airalo in Task 7. This should work for new payments (which are all Airalo).

For old Zendit payments that need retry, we need to check the payment metadata. Add a Zendit fallback to `purchaseEsimAfterPayment`:

At the beginning of `purchaseEsimAfterPayment`, add a vendor check:

```javascript
export async function purchaseEsimAfterPayment(payment) {
  // Check if this is a legacy Zendit payment (existing eSIM linked or metadata indicates Zendit)
  if (payment.metadata?.vendor === 'zendit') {
    return zenditPurchaseEsimAfterPayment(payment);
  }

  // ... rest of Airalo purchase code ...
}
```

Add a `zenditPurchaseEsimAfterPayment` function that contains the old Zendit logic:

```javascript
async function zenditPurchaseEsimAfterPayment(payment) {
  const balance = await getZenditBalance();
  const availableUsd = balance.availableBalance / (balance.currencyDivisor || 100);
  if (availableUsd < parseFloat(payment.amount)) {
    throw new Error(`Insufficient Zendit balance: $${availableUsd.toFixed(2)}`);
  }

  const transactionId = uuidv4();
  const purchase = await zenditPurchaseEsim(payment.offerId, transactionId);
  const confirmation = purchase.confirmation || {};

  const esim = await db.Esim.create({
    userId: payment.userId,
    offerId: payment.offerId,
    transactionId,
    status: normalizeStatus(purchase.status),
    vendor: 'zendit',
    iccid: confirmation.iccid || null,
    smdpAddress: confirmation.smdpAddress || null,
    activationCode: confirmation.externalReferenceId || confirmation.activationCode || null,
    country: purchase.country || process.env.COUNTRY || 'TR',
    dataGB: purchase.dataGB || null,
    durationDays: purchase.durationDays || null,
    brandName: purchase.brandName || null,
    priceAmount: purchase.price?.fixed ? (purchase.price.fixed / (purchase.price.currencyDivisor || 100)) : null,
    priceCurrency: purchase.price?.currency || null
  });

  await payment.update({
    esimId: esim.id,
    metadata: { ...payment.metadata, esimTransactionId: transactionId, esimId: esim.id }
  });

  return esim;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/paymentService.js
git commit -m "feat: add Zendit fallback in retryEsimPurchase for legacy payments"
```

---

### Task 16: Final Verification and Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Verify no remaining direct Zendit calls in user-facing code**

```bash
grep -rn "zenditClient\|listOffers\|purchaseEsim" src/controllers/esimController.js
```

Expected: Only imports for `getPurchase`, `getPurchaseQrCode`, `getUsage`, `getEsimPlans`, `normalizeStatus`, `isCompletedStatus` should remain (used for Zendit eSIM status/QR in admin context).

- [ ] **Step 2: Verify all new files exist**

```bash
ls -la src/services/airaloClient.js src/services/airaloSync.js src/db/models/airaloPackage.js src/db/migrations/20260409000001_add_vendor_fields_to_esims.cjs src/db/migrations/20260409000002_create_airalo_packages.cjs src/views/admin/zendit-purchase.ejs
```

Expected: All 6 files exist.

- [ ] **Step 3: Rebuild and test**

```bash
docker compose up --build -d
docker compose logs app -f --tail=30
```

Expected: App starts without errors. Airalo sync logs appear (either success or "not initialized" if no credentials).

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git status
# If any uncommitted changes:
git add -A
git commit -m "chore: final cleanup for Airalo migration"
```
