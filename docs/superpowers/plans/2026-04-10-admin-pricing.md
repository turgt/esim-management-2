# Admin Pricing Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to set a global markup percentage and per-package price overrides for Airalo eSIM packages, with preview before applying.

**Architecture:** Two new DB fields on AiraloPackage (`overrideType`, `overrideValue`) plus a new Settings key-value table for global markup. A shared `pricingService.js` computes final prices. A new admin page at `/admin/pricing` provides the UI. Sync preserves overrides by excluding those fields from upsert.

**Tech Stack:** Express.js, Sequelize ORM (PostgreSQL), EJS templates, Tailwind CSS v4, Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-10-admin-pricing-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/db/migrations/20260410000001_create_settings_table.cjs` | Create | Settings table migration |
| `src/db/migrations/20260410000002_add_pricing_override_to_airalo_packages.cjs` | Create | Add overrideType/overrideValue to AiraloPackages |
| `src/db/models/setting.js` | Create | Setting model (auto-loaded by models/index.js) |
| `src/db/models/airaloPackage.js` | Modify | Add overrideType, overrideValue fields |
| `src/services/pricingService.js` | Create | calcFinalPrice + getGlobalMarkup helpers |
| `src/services/airaloSync.js` | Modify | Exclude override fields from upsert |
| `src/controllers/pricingController.js` | Create | 5 route handlers for pricing management |
| `src/routes/admin.js` | Modify | Add pricing routes |
| `src/views/partials/header.ejs` | Modify | Add "Pricing" nav link in admin topbar |
| `src/views/admin/pricing.ejs` | Create | Pricing management page |
| `src/controllers/esimController.js` | Modify | Use calcFinalPrice in showOffers + showLandingPage |
| `src/views/offers.ejs` | Modify | Display finalPrice instead of raw price |

---

### Task 1: Settings Table Migration + Model

**Files:**
- Create: `src/db/migrations/20260410000001_create_settings_table.cjs`
- Create: `src/db/models/setting.js`

- [ ] **Step 1: Create the Settings migration**

Create `src/db/migrations/20260410000001_create_settings_table.cjs`:

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Settings', {
      key: {
        type: Sequelize.STRING,
        allowNull: false,
        primaryKey: true,
        unique: true,
      },
      value: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    // Seed default global markup
    await queryInterface.bulkInsert('Settings', [{
      key: 'global_markup_percent',
      value: '0',
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Settings');
  },
};
```

- [ ] **Step 2: Create the Setting model**

Create `src/db/models/setting.js`:

```js
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Setting extends Model {
    static associate(models) {
      // No associations
    }
  }
  Setting.init({
    key: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      unique: true,
    },
    value: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  }, { sequelize, modelName: 'Setting' });
  return Setting;
};
```

No changes needed to `src/db/models/index.js` — it auto-loads all `.js` files in the models directory.

- [ ] **Step 3: Run migration**

```bash
docker compose exec app npm run migrate
```

Expected: Migration runs, `Settings` table created with one row (`global_markup_percent` = `'0'`).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/20260410000001_create_settings_table.cjs src/db/models/setting.js
git commit -m "feat: add Settings table with global_markup_percent seed"
```

---

### Task 2: AiraloPackage Override Fields Migration + Model Update

**Files:**
- Create: `src/db/migrations/20260410000002_add_pricing_override_to_airalo_packages.cjs`
- Modify: `src/db/models/airaloPackage.js:9-28`

- [ ] **Step 1: Create migration for override fields**

Create `src/db/migrations/20260410000002_add_pricing_override_to_airalo_packages.cjs`:

```js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('AiraloPackages', 'overrideType', {
      type: Sequelize.ENUM('none', 'fixed', 'markup'),
      allowNull: false,
      defaultValue: 'none',
    });
    await queryInterface.addColumn('AiraloPackages', 'overrideValue', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('AiraloPackages', 'overrideValue');
    await queryInterface.removeColumn('AiraloPackages', 'overrideType');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_AiraloPackages_overrideType";');
  },
};
```

- [ ] **Step 2: Add fields to AiraloPackage model**

In `src/db/models/airaloPackage.js`, add after `lastSyncedAt` (line 27), before the closing `}` of `init`:

```js
    overrideType: {
      type: DataTypes.ENUM('none', 'fixed', 'markup'),
      allowNull: false,
      defaultValue: 'none',
    },
    overrideValue: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    },
```

- [ ] **Step 3: Run migration**

```bash
docker compose exec app npm run migrate
```

Expected: Two new columns added to `AiraloPackages`. Existing rows get `overrideType='none'`, `overrideValue=NULL`.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/20260410000002_add_pricing_override_to_airalo_packages.cjs src/db/models/airaloPackage.js
git commit -m "feat: add overrideType and overrideValue to AiraloPackage"
```

---

### Task 3: Pricing Service

**Files:**
- Create: `src/services/pricingService.js`

- [ ] **Step 1: Create pricingService.js**

Create `src/services/pricingService.js`:

```js
import db from '../db/models/index.js';

/**
 * Calculate the final price for a package given its override settings and the global markup.
 * @param {object} pkg - AiraloPackage instance or plain object with price, overrideType, overrideValue
 * @param {number} globalMarkup - Global markup percentage (e.g. 20 for 20%)
 * @returns {number} Final price rounded to 2 decimal places
 */
export function calcFinalPrice(pkg, globalMarkup) {
  const basePrice = parseFloat(pkg.price) || 0;
  const overrideVal = pkg.overrideValue !== null && pkg.overrideValue !== undefined
    ? parseFloat(pkg.overrideValue) : null;

  if (pkg.overrideType === 'fixed' && overrideVal !== null) {
    return Math.round(overrideVal * 100) / 100;
  }

  if (pkg.overrideType === 'markup' && overrideVal !== null) {
    return Math.round(basePrice * (1 + overrideVal / 100) * 100) / 100;
  }

  // No override — apply global markup
  const markup = parseFloat(globalMarkup) || 0;
  return Math.round(basePrice * (1 + markup / 100) * 100) / 100;
}

/**
 * Get the global markup percentage from Settings.
 * Returns 0 if not found.
 */
export async function getGlobalMarkup() {
  const setting = await db.Setting.findByPk('global_markup_percent');
  return setting ? parseFloat(setting.value) || 0 : 0;
}

/**
 * Set the global markup percentage.
 * @param {number} value - Markup percentage
 */
export async function setGlobalMarkup(value) {
  await db.Setting.upsert({
    key: 'global_markup_percent',
    value: String(value),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/pricingService.js
git commit -m "feat: add pricingService with calcFinalPrice and global markup helpers"
```

---

### Task 4: Protect Override Fields in Sync

**Files:**
- Modify: `src/services/airaloSync.js:38-57`

- [ ] **Step 1: Make upsert exclude override fields**

The current `db.AiraloPackage.upsert()` call at line 38-57 of `airaloSync.js` passes all fields. Sequelize upsert updates all provided fields on conflict. Since `overrideType` and `overrideValue` are NOT included in the upsert data object, they will NOT be touched by default — Sequelize only updates columns that are explicitly passed.

However, to be explicit and safe, add a comment clarifying this at line 38:

Replace line 38 in `src/services/airaloSync.js`:
```js
      await db.AiraloPackage.upsert({
```

With:
```js
      // Note: overrideType and overrideValue are intentionally excluded
      // so admin pricing overrides are preserved across syncs
      await db.AiraloPackage.upsert({
```

- [ ] **Step 2: Commit**

```bash
git add src/services/airaloSync.js
git commit -m "docs: clarify sync preserves pricing overrides"
```

---

### Task 5: Pricing Controller

**Files:**
- Create: `src/controllers/pricingController.js`

- [ ] **Step 1: Create pricingController.js**

Create `src/controllers/pricingController.js`:

```js
import db from '../db/models/index.js';
import { calcFinalPrice, getGlobalMarkup, setGlobalMarkup } from '../services/pricingService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'pricing' });

/**
 * GET /admin/pricing — Show pricing management page
 */
export async function showPricing(req, res) {
  try {
    const globalMarkup = await getGlobalMarkup();

    const packages = await db.AiraloPackage.findAll({
      order: [['countryCode', 'ASC'], ['price', 'ASC']],
    });

    // Group by country
    const countryGroups = {};
    for (const pkg of packages) {
      const cc = pkg.countryCode || 'OTHER';
      if (!countryGroups[cc]) countryGroups[cc] = [];
      countryGroups[cc].push({
        id: pkg.id,
        packageId: pkg.packageId,
        title: pkg.title,
        operatorTitle: pkg.operatorTitle,
        data: pkg.data,
        day: pkg.day,
        price: parseFloat(pkg.price) || 0,
        netPrice: parseFloat(pkg.netPrice) || 0,
        overrideType: pkg.overrideType || 'none',
        overrideValue: pkg.overrideValue !== null ? parseFloat(pkg.overrideValue) : null,
        finalPrice: calcFinalPrice(pkg, globalMarkup),
        isUnlimited: pkg.isUnlimited,
      });
    }

    res.render('admin/pricing', {
      title: 'Pricing',
      globalMarkup,
      countryGroups,
      packageCount: packages.length,
      pricingSuccess: req.session.pricingSuccess || null,
      pricingError: req.session.pricingError || null,
    });

    // Clear flash messages after rendering
    delete req.session.pricingSuccess;
    delete req.session.pricingError;
  } catch (err) {
    log.error({ err }, 'showPricing error');
    res.render('error', { message: 'Failed to load pricing page' });
  }
}

/**
 * POST /admin/pricing/global-markup — Update global markup
 */
export async function updateGlobalMarkup(req, res) {
  try {
    const value = parseFloat(req.body.globalMarkup);
    if (isNaN(value) || value < 0) {
      req.session.pricingError = 'Invalid markup value';
      return res.redirect('/admin/pricing');
    }

    await setGlobalMarkup(value);
    log.info({ globalMarkup: value, admin: req.session.user.username }, 'Global markup updated');
    req.session.pricingSuccess = 'Global markup updated to ' + value + '%';
    res.redirect('/admin/pricing');
  } catch (err) {
    log.error({ err }, 'updateGlobalMarkup error');
    req.session.pricingError = 'Failed to update global markup';
    res.redirect('/admin/pricing');
  }
}

/**
 * POST /admin/pricing/preview — Preview price changes without saving
 * Body: { globalMarkup?: number, overrides: [{ packageId, type, value }] }
 * Returns JSON with calculated changes.
 */
export async function previewChanges(req, res) {
  try {
    const { globalMarkup: newGlobalMarkup, overrides } = req.body;
    const currentGlobalMarkup = await getGlobalMarkup();
    const effectiveMarkup = newGlobalMarkup !== undefined && newGlobalMarkup !== null
      ? parseFloat(newGlobalMarkup) : currentGlobalMarkup;

    const overrideMap = {};
    if (Array.isArray(overrides)) {
      for (const o of overrides) {
        overrideMap[o.packageId] = { type: o.type, value: o.value !== null ? parseFloat(o.value) : null };
      }
    }

    const packages = await db.AiraloPackage.findAll();
    const changes = [];

    for (const pkg of packages) {
      const oldFinal = calcFinalPrice(pkg, currentGlobalMarkup);

      // Build a virtual package with the proposed override
      const override = overrideMap[pkg.packageId];
      const virtualPkg = {
        price: pkg.price,
        overrideType: override ? override.type : pkg.overrideType,
        overrideValue: override ? override.value : pkg.overrideValue,
      };
      const newFinal = calcFinalPrice(virtualPkg, effectiveMarkup);

      if (Math.abs(oldFinal - newFinal) > 0.001) {
        changes.push({
          packageId: pkg.packageId,
          title: pkg.title,
          operatorTitle: pkg.operatorTitle,
          countryCode: pkg.countryCode,
          netPrice: parseFloat(pkg.netPrice) || 0,
          oldPrice: oldFinal,
          newPrice: newFinal,
          profit: Math.round((newFinal - (parseFloat(pkg.netPrice) || 0)) * 100) / 100,
        });
      }
    }

    res.json({ changes, effectiveMarkup });
  } catch (err) {
    log.error({ err }, 'previewChanges error');
    res.status(500).json({ error: 'Failed to preview changes' });
  }
}

/**
 * POST /admin/pricing/override — Save package overrides (bulk)
 * Body: { overrides: [{ packageId, type, value }] }
 */
export async function saveOverrides(req, res) {
  try {
    const { overrides } = req.body;
    if (!Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({ error: 'No overrides provided' });
    }

    let updated = 0;
    for (const o of overrides) {
      const type = ['none', 'fixed', 'markup'].includes(o.type) ? o.type : 'none';
      const value = type === 'none' ? null : (parseFloat(o.value) || null);

      const [count] = await db.AiraloPackage.update(
        { overrideType: type, overrideValue: value },
        { where: { packageId: o.packageId } }
      );
      updated += count;
    }

    log.info({ updated, total: overrides.length, admin: req.session.user.username }, 'Package overrides saved');
    res.json({ success: true, updated });
  } catch (err) {
    log.error({ err }, 'saveOverrides error');
    res.status(500).json({ error: 'Failed to save overrides' });
  }
}

/**
 * POST /admin/pricing/reset/:packageId — Reset a package to no override
 */
export async function resetOverride(req, res) {
  try {
    const { packageId } = req.params;
    await db.AiraloPackage.update(
      { overrideType: 'none', overrideValue: null },
      { where: { packageId } }
    );

    log.info({ packageId, admin: req.session.user.username }, 'Package override reset');
    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'resetOverride error');
    res.status(500).json({ error: 'Failed to reset override' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/pricingController.js
git commit -m "feat: add pricingController with CRUD + preview handlers"
```

---

### Task 6: Admin Routes + Navigation

**Files:**
- Modify: `src/routes/admin.js:1-64`
- Modify: `src/views/partials/header.ejs:97`

- [ ] **Step 1: Add pricing routes to admin.js**

In `src/routes/admin.js`, add the import at top (after the vendorController import, line 15):

```js
import {
  showPricing, updateGlobalMarkup, previewChanges, saveOverrides, resetOverride
} from '../controllers/pricingController.js';
```

Add JSON body parsing and the routes before `export default router;` (before line 64):

```js
// Pricing Management
router.get('/pricing', ensureAuth, ensureAdmin, showPricing);
router.post('/pricing/global-markup', ensureAuth, ensureAdmin, updateGlobalMarkup);
router.post('/pricing/preview', ensureAuth, ensureAdmin, express.json(), previewChanges);
router.post('/pricing/override', ensureAuth, ensureAdmin, express.json(), saveOverrides);
router.post('/pricing/reset/:packageId', ensureAuth, ensureAdmin, express.json(), resetOverride);
```

Note: `express.json()` is added inline for the JSON endpoints since the admin router uses form-encoded body by default.

- [ ] **Step 2: Add Pricing link to admin navigation**

In `src/views/partials/header.ejs`, after line 97 (the Emails link), add:

```ejs
      <a href="/admin/pricing" class="<%= title === 'Pricing' ? 'active' : '' %>">Pricing</a>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin.js src/views/partials/header.ejs
git commit -m "feat: add admin pricing routes and navigation link"
```

---

### Task 7: Pricing Admin View (pricing.ejs)

**Files:**
- Create: `src/views/admin/pricing.ejs`

- [ ] **Step 1: Create the pricing admin page**

Create `src/views/admin/pricing.ejs`. This is the largest file in the plan. Key sections:

1. Header with title
2. Global markup card (form with POST to `/admin/pricing/global-markup`)
3. Country groups — each a collapsible card using `<details>/<summary>` (native HTML, no JS needed for collapse)
4. Package table inside each group
5. Sticky change bar at bottom (hidden by default, shown via JS when edits exist)
6. Preview modal (populated via fetch to `/admin/pricing/preview`)
7. Client-side JS for: live finalPrice calculation, change tracking, preview/apply flow

```ejs
<%- include('../partials/header', {title: 'Pricing', user: locals.user}) %>

<div class="mb-6">
  <h1 class="text-page-title">Pricing Management</h1>
  <p class="text-sm text-[var(--text-secondary)] mt-1"><%= packageCount %> packages synced from Airalo</p>
</div>

<% if (pricingSuccess) { %>
<div class="alert alert-success mb-4">
  <i data-lucide="check-circle" class="w-4 h-4"></i>
  <span><%= pricingSuccess %></span>
</div>
<% } %>

<% if (pricingError) { %>
<div class="alert alert-error mb-4">
  <i data-lucide="alert-circle" class="w-4 h-4"></i>
  <span><%= pricingError %></span>
</div>
<% } %>

<!-- Global Markup Card -->
<div class="card p-5 mb-6">
  <form method="POST" action="/admin/pricing/global-markup" class="flex flex-col sm:flex-row sm:items-end gap-4">
    <input type="hidden" name="_csrf" value="<%= csrfToken %>">
    <div class="flex-1">
      <h2 class="text-base font-semibold text-[var(--text-primary)] mb-1">Global Markup</h2>
      <p class="text-sm text-[var(--text-secondary)]">Applied to all packages without a specific override</p>
    </div>
    <div class="flex items-center gap-2">
      <div class="relative">
        <input type="number" name="globalMarkup" value="<%= globalMarkup %>" step="0.1" min="0" max="500"
          class="input w-28 pr-8 text-right" id="globalMarkupInput">
        <span class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] text-sm font-medium">%</span>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Save</button>
    </div>
  </form>
</div>

<!-- Country Groups -->
<div class="space-y-4" id="countryGroups">
  <% var countries = Object.keys(countryGroups).sort(); %>
  <% countries.forEach(function(cc) { %>
  <% var pkgs = countryGroups[cc]; %>
  <details class="card overflow-hidden">
    <summary class="flex items-center justify-between p-4 cursor-pointer select-none hover:bg-[var(--surface-1)] transition-colors">
      <div class="flex items-center gap-3">
        <span class="text-lg"><%= cc %></span>
        <span class="text-sm font-semibold text-[var(--text-primary)]"><%= cc %></span>
        <span class="badge badge-secondary text-xs"><%= pkgs.length %> packages</span>
      </div>
      <i data-lucide="chevron-down" class="w-4 h-4 text-[var(--text-tertiary)] transition-transform details-chevron"></i>
    </summary>
    <div class="overflow-x-auto border-t border-[var(--border-subtle)]">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-[var(--surface-1)]">
            <th class="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Package</th>
            <th class="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Data / Duration</th>
            <th class="text-right px-4 py-2.5 font-medium text-[var(--text-secondary)]">Cost</th>
            <th class="text-right px-4 py-2.5 font-medium text-[var(--text-secondary)]">Airalo Price</th>
            <th class="text-center px-4 py-2.5 font-medium text-[var(--text-secondary)]">Override</th>
            <th class="text-right px-4 py-2.5 font-medium text-[var(--text-secondary)]">Value</th>
            <th class="text-right px-4 py-2.5 font-medium text-[var(--text-secondary)]">Final Price</th>
            <th class="text-right px-4 py-2.5 font-medium text-[var(--text-secondary)]">Profit</th>
          </tr>
        </thead>
        <tbody>
          <% pkgs.forEach(function(pkg) { %>
          <tr class="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-1)]/50" data-package-id="<%= pkg.packageId %>">
            <td class="px-4 py-2.5">
              <div class="font-medium text-[var(--text-primary)]"><%= pkg.title %></div>
              <div class="text-xs text-[var(--text-tertiary)]"><%= pkg.operatorTitle %></div>
            </td>
            <td class="px-4 py-2.5 text-[var(--text-secondary)]">
              <%= pkg.isUnlimited ? 'Unlimited' : pkg.data %> &middot; <%= pkg.day %> days
            </td>
            <td class="px-4 py-2.5 text-right text-[var(--text-tertiary)]">$<%= pkg.netPrice.toFixed(2) %></td>
            <td class="px-4 py-2.5 text-right text-[var(--text-tertiary)]">$<%= pkg.price.toFixed(2) %></td>
            <td class="px-4 py-2.5 text-center">
              <select class="input input-sm text-xs w-28 override-select"
                data-package-id="<%= pkg.packageId %>"
                data-price="<%= pkg.price %>"
                data-net-price="<%= pkg.netPrice %>"
                data-original-type="<%= pkg.overrideType %>"
                data-original-value="<%= pkg.overrideValue !== null ? pkg.overrideValue : '' %>">
                <option value="none" <%= pkg.overrideType === 'none' ? 'selected' : '' %>>None</option>
                <option value="fixed" <%= pkg.overrideType === 'fixed' ? 'selected' : '' %>>Fixed Price</option>
                <option value="markup" <%= pkg.overrideType === 'markup' ? 'selected' : '' %>>Markup %</option>
              </select>
            </td>
            <td class="px-4 py-2.5 text-right">
              <input type="number" step="0.01" min="0"
                class="input input-sm text-xs w-24 text-right override-value"
                data-package-id="<%= pkg.packageId %>"
                data-original-value="<%= pkg.overrideValue !== null ? pkg.overrideValue : '' %>"
                value="<%= pkg.overrideValue !== null ? pkg.overrideValue : '' %>"
                <%= pkg.overrideType === 'none' ? 'disabled' : '' %>>
            </td>
            <td class="px-4 py-2.5 text-right font-semibold text-[var(--text-primary)] final-price">
              $<%= pkg.finalPrice.toFixed(2) %>
            </td>
            <td class="px-4 py-2.5 text-right font-medium profit-cell">
              <% var profit = pkg.finalPrice - pkg.netPrice; %>
              <span class="<%= profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500' %>">
                $<%= profit.toFixed(2) %>
              </span>
            </td>
          </tr>
          <% }) %>
        </tbody>
      </table>
    </div>
  </details>
  <% }) %>
</div>

<!-- Sticky Change Bar -->
<div id="changeBar" class="fixed bottom-0 left-0 right-0 bg-[var(--surface-0)] border-t border-[var(--border-subtle)] shadow-lg p-4 z-50 transition-transform translate-y-full">
  <div class="max-w-5xl mx-auto flex items-center justify-between">
    <span class="text-sm text-[var(--text-secondary)]"><strong id="changeCount" class="text-[var(--text-primary)]">0</strong> changes pending</span>
    <div class="flex gap-3">
      <button type="button" class="btn btn-secondary btn-sm" onclick="discardChanges()">Discard</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="showPreview()">
        <i data-lucide="eye" class="w-4 h-4"></i> Preview &amp; Apply
      </button>
    </div>
  </div>
</div>

<!-- Preview Modal -->
<div id="previewModal" class="modal-backdrop hidden" style="display:none">
  <div class="confirm-modal" style="max-width:600px;">
    <div class="flex items-center gap-3 mb-4">
      <div class="w-10 h-10 rounded-xl bg-[var(--brand-light)] flex items-center justify-center">
        <i data-lucide="eye" class="w-5 h-5 text-[var(--brand-primary)]"></i>
      </div>
      <div>
        <h3 class="text-base font-semibold text-[var(--text-primary)]">Preview Changes</h3>
        <p class="text-xs text-[var(--text-secondary)]" id="previewSubtext">Review before applying</p>
      </div>
    </div>
    <div id="previewContent" class="max-h-80 overflow-y-auto mb-4">
      <p class="text-sm text-[var(--text-secondary)]">Loading...</p>
    </div>
    <div class="flex gap-3">
      <button type="button" class="btn btn-secondary flex-1" onclick="closePreview()">Cancel</button>
      <button type="button" class="btn btn-primary flex-1" onclick="applyChanges()" id="applyBtn">
        <i data-lucide="check" class="w-4 h-4"></i> Apply Changes
      </button>
    </div>
  </div>
</div>

<script>
(function() {
  var csrfToken = '<%= csrfToken %>';
  var globalMarkup = <%= globalMarkup %>;
  var pendingOverrides = {};

  // Live calculation — mirrors server-side calcFinalPrice
  function calcFinal(price, type, value, gm) {
    price = parseFloat(price) || 0;
    value = parseFloat(value) || 0;
    if (type === 'fixed' && value > 0) return value;
    if (type === 'markup') return Math.round(price * (1 + value / 100) * 100) / 100;
    return Math.round(price * (1 + gm / 100) * 100) / 100;
  }

  function updateRow(row) {
    var sel = row.querySelector('.override-select');
    var inp = row.querySelector('.override-value');
    var finalEl = row.querySelector('.final-price');
    var profitEl = row.querySelector('.profit-cell');
    var price = parseFloat(sel.dataset.price);
    var netPrice = parseFloat(sel.dataset.netPrice);
    var type = sel.value;
    var val = inp.value;

    inp.disabled = (type === 'none');
    if (type === 'none') inp.value = '';

    var final = calcFinal(price, type, val, globalMarkup);
    finalEl.textContent = '$' + final.toFixed(2);

    var profit = final - netPrice;
    // Clear old content and build new span
    while (profitEl.firstChild) profitEl.removeChild(profitEl.firstChild);
    var span = document.createElement('span');
    span.className = profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500';
    span.textContent = '$' + profit.toFixed(2);
    profitEl.appendChild(span);

    // Track change
    var pkgId = sel.dataset.packageId;
    var origType = sel.dataset.originalType;
    var origVal = sel.dataset.originalValue;
    var changed = (type !== origType) || (String(val) !== String(origVal));
    if (changed) {
      pendingOverrides[pkgId] = { packageId: pkgId, type: type, value: type === 'none' ? null : parseFloat(val) || 0 };
    } else {
      delete pendingOverrides[pkgId];
    }

    updateChangeBar();
  }

  function updateChangeBar() {
    var count = Object.keys(pendingOverrides).length;
    document.getElementById('changeCount').textContent = count;
    var bar = document.getElementById('changeBar');
    if (count > 0) {
      bar.classList.remove('translate-y-full');
    } else {
      bar.classList.add('translate-y-full');
    }
  }

  // Bind events to all override selects and value inputs
  document.querySelectorAll('.override-select').forEach(function(sel) {
    sel.addEventListener('change', function() {
      updateRow(this.closest('tr'));
    });
  });

  document.querySelectorAll('.override-value').forEach(function(inp) {
    inp.addEventListener('input', function() {
      updateRow(this.closest('tr'));
    });
  });

  // Discard all pending changes
  window.discardChanges = function() {
    document.querySelectorAll('.override-select').forEach(function(sel) {
      sel.value = sel.dataset.originalType;
      var inp = sel.closest('tr').querySelector('.override-value');
      inp.value = sel.dataset.originalValue;
      inp.disabled = (sel.value === 'none');
      updateRow(sel.closest('tr'));
    });
    pendingOverrides = {};
    updateChangeBar();
  };

  // Build a preview table row using safe DOM methods
  function buildPreviewRow(c, tbody) {
    var tr = document.createElement('tr');
    tr.className = 'border-b border-[var(--border-subtle)]';

    // Package cell
    var tdPkg = document.createElement('td');
    tdPkg.className = 'py-2';
    var divName = document.createElement('div');
    divName.className = 'font-medium text-[var(--text-primary)]';
    divName.textContent = c.title;
    var divOp = document.createElement('div');
    divOp.className = 'text-xs text-[var(--text-tertiary)]';
    divOp.textContent = c.operatorTitle;
    tdPkg.appendChild(divName);
    tdPkg.appendChild(divOp);
    tr.appendChild(tdPkg);

    // Old price cell
    var tdOld = document.createElement('td');
    tdOld.className = 'text-right py-2 text-[var(--text-tertiary)]';
    tdOld.textContent = '$' + c.oldPrice.toFixed(2);
    tr.appendChild(tdOld);

    // New price cell
    var tdNew = document.createElement('td');
    tdNew.className = 'text-right py-2 font-semibold text-[var(--text-primary)]';
    tdNew.textContent = '$' + c.newPrice.toFixed(2);
    tr.appendChild(tdNew);

    // Profit cell
    var tdProfit = document.createElement('td');
    tdProfit.className = 'text-right py-2 ' + (c.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500');
    tdProfit.textContent = '$' + c.profit.toFixed(2);
    tr.appendChild(tdProfit);

    tbody.appendChild(tr);
  }

  // Show preview modal
  window.showPreview = function() {
    var modal = document.getElementById('previewModal');
    var content = document.getElementById('previewContent');
    modal.classList.remove('hidden');
    modal.style.display = '';

    // Show loading
    while (content.firstChild) content.removeChild(content.firstChild);
    var loadingP = document.createElement('p');
    loadingP.className = 'text-sm text-[var(--text-secondary)]';
    loadingP.textContent = 'Loading preview...';
    content.appendChild(loadingP);

    var overrides = Object.values(pendingOverrides);

    fetch('/admin/pricing/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ overrides: overrides })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      while (content.firstChild) content.removeChild(content.firstChild);

      if (!data.changes || data.changes.length === 0) {
        var noChange = document.createElement('p');
        noChange.className = 'text-sm text-[var(--text-secondary)]';
        noChange.textContent = 'No price changes detected.';
        content.appendChild(noChange);
        return;
      }

      document.getElementById('previewSubtext').textContent = data.changes.length + ' package(s) will change';

      var table = document.createElement('table');
      table.className = 'w-full text-sm';
      var thead = document.createElement('thead');
      var headRow = document.createElement('tr');
      headRow.className = 'border-b border-[var(--border-subtle)]';
      ['Package', 'Old', 'New', 'Profit'].forEach(function(label) {
        var th = document.createElement('th');
        th.className = label === 'Package' ? 'text-left py-2 font-medium text-[var(--text-secondary)]' : 'text-right py-2 font-medium text-[var(--text-secondary)]';
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      data.changes.forEach(function(c) {
        buildPreviewRow(c, tbody);
      });
      table.appendChild(tbody);
      content.appendChild(table);
    })
    .catch(function() {
      while (content.firstChild) content.removeChild(content.firstChild);
      var errP = document.createElement('p');
      errP.className = 'text-sm text-red-500';
      errP.textContent = 'Failed to load preview.';
      content.appendChild(errP);
    });
  };

  window.closePreview = function() {
    var modal = document.getElementById('previewModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
  };

  // Apply changes
  window.applyChanges = function() {
    var btn = document.getElementById('applyBtn');
    btn.disabled = true;
    btn.textContent = 'Applying...';

    var overrides = Object.values(pendingOverrides);

    fetch('/admin/pricing/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ overrides: overrides })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        window.location.reload();
      } else {
        btn.disabled = false;
        btn.textContent = 'Apply Changes';
        alert('Failed to apply: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(function() {
      btn.disabled = false;
      btn.textContent = 'Apply Changes';
      alert('Network error');
    });
  };

  // Chevron rotation for details elements
  document.querySelectorAll('details').forEach(function(d) {
    d.addEventListener('toggle', function() {
      var chevron = d.querySelector('.details-chevron');
      if (chevron) chevron.style.transform = d.open ? 'rotate(180deg)' : '';
    });
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
})();
</script>

<%- include('../partials/footer') %>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/admin/pricing.ejs
git commit -m "feat: add admin pricing management view"
```

---

### Task 8: Integrate finalPrice into Offers + Landing Pages

**Files:**
- Modify: `src/controllers/esimController.js:24-45` (showLandingPage)
- Modify: `src/controllers/esimController.js:77-115` (showOffers)
- Modify: `src/views/offers.ejs:54`

- [ ] **Step 1: Add pricingService import to esimController.js**

At the top of `src/controllers/esimController.js`, after line 8 (`import logger`), add:

```js
import { calcFinalPrice, getGlobalMarkup } from '../services/pricingService.js';
```

- [ ] **Step 2: Update showOffers to compute finalPrice**

Replace the `showOffers` function body (lines 77-115) in `src/controllers/esimController.js`:

```js
export async function showOffers(req, res) {
  try {
    const country = req.query.country || '';
    const type = req.query.type || '';

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

    const globalMarkup = await getGlobalMarkup();

    // Attach finalPrice to each package
    const offers = packages.map(pkg => {
      const plain = pkg.get({ plain: true });
      plain.finalPrice = calcFinalPrice(pkg, globalMarkup);
      return plain;
    });

    // Retrieve distinct synced countries for the filter UI
    const syncedCountries = await db.AiraloPackage.findAll({
      attributes: [[db.Sequelize.fn('DISTINCT', db.Sequelize.col('countryCode')), 'countryCode']],
      raw: true,
    });
    const availableCountries = syncedCountries
      .map(r => r.countryCode)
      .filter(Boolean)
      .sort();

    res.render('offers', {
      title: 'Offers',
      offers,
      availableCountries,
      selectedCountry: country,
    });
  } catch (err) {
    log.error({ err }, 'showOffers error');
    res.render('error', { message: 'Failed to load offers' });
  }
}
```

- [ ] **Step 3: Update showLandingPage to compute finalPrice**

Replace the `showLandingPage` function body (lines 24-45) in `src/controllers/esimController.js`:

```js
export async function showLandingPage(req, res) {
  try {
    const packages = await db.AiraloPackage.findAll({
      order: [['price', 'ASC']],
      limit: 6,
    });

    const globalMarkup = await getGlobalMarkup();
    const featuredOffers = packages.map(pkg => {
      const plain = pkg.get({ plain: true });
      plain.finalPrice = calcFinalPrice(pkg, globalMarkup);
      return plain;
    });

    res.render('landing', {
      title: 'DataPatch - eSIM Data Plans',
      offers: featuredOffers,
      user: req.session?.user || null
    });
  } catch (err) {
    log.error({ err }, 'showLandingPage error');
    res.render('landing', {
      title: 'DataPatch - eSIM Data Plans',
      offers: [],
      user: req.session?.user || null
    });
  }
}
```

- [ ] **Step 4: Update offers.ejs to use finalPrice**

In `src/views/offers.ejs`, change line 54 from:

```js
    var price = offer.price ? parseFloat(offer.price).toFixed(2) : null;
```

to:

```js
    var price = offer.finalPrice ? parseFloat(offer.finalPrice).toFixed(2) : (offer.price ? parseFloat(offer.price).toFixed(2) : null);
```

- [ ] **Step 5: Commit**

```bash
git add src/controllers/esimController.js src/views/offers.ejs
git commit -m "feat: integrate finalPrice (markup-applied) into offers and landing pages"
```

---

### Task 9: End-to-End Testing

- [ ] **Step 1: Run migrations and start the app**

```bash
docker compose exec app npm run migrate
docker compose restart app
```

- [ ] **Step 2: Test admin pricing page**

1. Login as admin (`admin` / `test123`)
2. Navigate to `/admin/pricing`
3. Verify: global markup card shows 0%, country groups are listed
4. Expand a country group — verify table shows packages with correct Airalo prices

- [ ] **Step 3: Test global markup**

1. Set global markup to 20%, click Save
2. Verify page reloads, all Final Price columns show 20% more than Airalo Price
3. Verify Profit column = Final Price - Cost (Net)

- [ ] **Step 4: Test per-package override**

1. Pick a package, change Override dropdown to "Fixed Price", enter a value (e.g. 15.00)
2. Verify Final Price updates live to $15.00
3. Pick another package, change to "Markup %", enter 50
4. Verify Final Price = Airalo Price * 1.5
5. Verify change bar appears at bottom with "2 changes pending"

- [ ] **Step 5: Test preview and apply**

1. Click "Preview & Apply"
2. Verify modal shows the two changed packages with old to new prices
3. Click "Apply Changes"
4. Verify page reloads, changes are persisted
5. Verify offers page (`/offers`) shows the updated final prices

- [ ] **Step 6: Test discard**

1. Make a change, verify change bar appears
2. Click "Discard" — verify change bar disappears and values reset

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during pricing e2e testing"
```
