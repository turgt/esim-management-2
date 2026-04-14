# Future-Dated B2B eSIM Sales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable travel agencies to book future-dated eSIMs in bulk via contracts, with Airalo FutureOrder integration and a traveler-facing proxy page for just-in-time eSIM delivery.

**Architecture:** Express.js backend with Sequelize ORM. New agency portal (`/agency/*`), public proxy page (`/e/:token`), Airalo FutureOrder/webhook integration, and node-cron background jobs. All new routes follow the existing middleware chain pattern (auth -> controller -> EJS view).

**Tech Stack:** Express.js, Sequelize 6, PostgreSQL, EJS + Tailwind v4, Airalo SDK (FutureOrder), node-cron, nanoid

**Spec:** `docs/superpowers/specs/2026-04-13-future-dated-b2b-esim-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `src/db/migrations/20260414000001-create-agencies.cjs` | agencies table |
| `src/db/migrations/20260414000002-create-agency-contracts.cjs` | agency_contracts table |
| `src/db/migrations/20260414000003-add-agency-fields-to-users.cjs` | agencyId + agencyRole on users |
| `src/db/migrations/20260414000004-create-traveler-bookings.cjs` | traveler_bookings table |
| `src/db/migrations/20260414000005-add-booking-fk-to-esims.cjs` | travelerBookingId on esims |
| `src/db/migrations/20260414000006-create-webhook-logs-and-api-keys.cjs` | airalo_webhook_logs + agency_api_keys |
| `src/db/migrations/20260414000007-create-agency-invoices.cjs` | agency_invoices table |
| `src/db/models/agency.js` | Agency Sequelize model |
| `src/db/models/agencyContract.js` | AgencyContract model |
| `src/db/models/travelerBooking.js` | TravelerBooking model |
| `src/db/models/airaloWebhookLog.js` | AiraloWebhookLog model |
| `src/db/models/agencyApiKey.js` | AgencyApiKey model |
| `src/db/models/agencyInvoice.js` | AgencyInvoice model |
| `src/services/futureOrderService.js` | Airalo FutureOrder/cancel/verify wrappers |
| `src/services/bookingService.js` | Booking create/cancel/dateChange business logic |
| `src/services/tokenService.js` | nanoid token generation |
| `src/middleware/agency.js` | ensureAgency, ensureAgencyOwner middleware |
| `src/controllers/agencyController.js` | Agency portal route handlers |
| `src/controllers/proxyController.js` | Public proxy page handler |
| `src/controllers/webhookController.js` | Airalo webhook handler |
| `src/routes/agency.js` | Agency portal routes |
| `src/routes/proxy.js` | Proxy page route |
| `src/jobs/index.js` | node-cron scheduler entry point |
| `src/jobs/webhookRetry.js` | Retry failed webhooks |
| `src/jobs/provisionWatchdog.js` | Detect stuck provisioning |
| `src/jobs/expiryJobs.js` | Expiry reminder + marker |
| `src/views/agency/dashboard.ejs` | Agency dashboard |
| `src/views/agency/bookings.ejs` | Booking list |
| `src/views/agency/booking-new.ejs` | New booking form |
| `src/views/agency/booking-detail.ejs` | Booking detail + timeline |
| `src/views/agency/contracts.ejs` | Contract list (read-only) |
| `src/views/proxy/page.ejs` | Traveler proxy page (all 4 states) |
| `src/views/admin/agencies.ejs` | Admin agency list |
| `src/views/admin/agency-detail.ejs` | Admin agency detail + contracts |
| `src/views/admin/webhook-logs.ejs` | Admin webhook monitor |

### Modified files

| File | Change |
|------|--------|
| `src/db/models/user.js` | Add `agencyId` FK + `agencyRole` enum |
| `src/db/models/esim.js` | Add `travelerBookingId` FK |
| `src/services/airaloClient.js` | Add FutureOrder/cancel/webhook exports |
| `src/services/auditService.js` | Add new ACTIONS constants |
| `src/controllers/adminController.js` | Add agency/contract/webhook CRUD handlers |
| `src/routes/admin.js` | Add agency/contract/webhook routes |
| `src/server.js` | Mount agency/proxy routes, start cron jobs |
| `src/views/partials/header.ejs` | Add agency sidebar nav items |
| `package.json` | Add node-cron, nanoid dependencies |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install node-cron and nanoid**

```bash
cd /Users/turgt/Desktop/CODES/esim-management-2
npm install node-cron nanoid@3
```

Note: nanoid@3 is the last version supporting CommonJS-compatible import. nanoid@4+ is ESM-only but the import syntax differs — v3 uses `import { nanoid } from 'nanoid'` which works with our ES modules setup.

- [ ] **Step 2: Verify installation**

```bash
node -e "import('nanoid').then(m => console.log(m.nanoid(22)))"
node -e "import('node-cron').then(m => console.log('cron OK'))"
```

Expected: a 22-char random string, then "cron OK".

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-cron and nanoid dependencies for B2B eSIM feature"
```

---

## Task 2: Database Migrations — Core Tables

**Files:**
- Create: `src/db/migrations/20260414000001-create-agencies.cjs`
- Create: `src/db/migrations/20260414000002-create-agency-contracts.cjs`
- Create: `src/db/migrations/20260414000003-add-agency-fields-to-users.cjs`

- [ ] **Step 1: Create agencies migration**

Create `src/db/migrations/20260414000001-create-agencies.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Agencies', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      name: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, allowNull: false, unique: true },
      logoUrl: { type: Sequelize.STRING, allowNull: true },
      contactEmail: { type: Sequelize.STRING, allowNull: false },
      contactName: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'suspended'),
        allowNull: false,
        defaultValue: 'active'
      },
      settings: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('Agencies', ['slug'], {
      name: 'idx_agencies_slug',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Agencies');
  }
};
```

- [ ] **Step 2: Create agency_contracts migration**

Create `src/db/migrations/20260414000002-create-agency-contracts.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AgencyContracts', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      airaloPackageId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'AiraloPackages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      quantity: { type: Sequelize.INTEGER, allowNull: false },
      usedQuantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unitPriceAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      unitPriceCurrency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      contractEndAt: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('active', 'exhausted', 'expired', 'terminated'),
        allowNull: false,
        defaultValue: 'active'
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('AgencyContracts', ['agencyId'], {
      name: 'idx_agency_contracts_agency'
    });

    await queryInterface.addIndex('AgencyContracts', ['agencyId', 'airaloPackageId'], {
      name: 'idx_agency_contracts_agency_package'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AgencyContracts');
  }
};
```

- [ ] **Step 3: Create users extension migration**

Create `src/db/migrations/20260414000003-add-agency-fields-to-users.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'agencyId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'Agencies', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addColumn('Users', 'agencyRole', {
      type: Sequelize.ENUM('owner', 'staff'),
      allowNull: true
    });

    await queryInterface.addIndex('Users', ['agencyId'], {
      name: 'idx_users_agency'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Users', 'idx_users_agency');
    await queryInterface.removeColumn('Users', 'agencyRole');
    await queryInterface.removeColumn('Users', 'agencyId');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Users_agencyRole";');
  }
};
```

- [ ] **Step 4: Run migrations to verify**

```bash
docker compose exec app npx sequelize-cli db:migrate
```

Expected: 3 migrations run successfully.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/20260414000001-create-agencies.cjs \
        src/db/migrations/20260414000002-create-agency-contracts.cjs \
        src/db/migrations/20260414000003-add-agency-fields-to-users.cjs
git commit -m "feat: add agencies, agency_contracts tables and user agency fields"
```

---

## Task 3: Database Migrations — Bookings, Webhooks, Invoices

**Files:**
- Create: `src/db/migrations/20260414000004-create-traveler-bookings.cjs`
- Create: `src/db/migrations/20260414000005-add-booking-fk-to-esims.cjs`
- Create: `src/db/migrations/20260414000006-create-webhook-logs-and-api-keys.cjs`
- Create: `src/db/migrations/20260414000007-create-agency-invoices.cjs`

- [ ] **Step 1: Create traveler_bookings migration**

Create `src/db/migrations/20260414000004-create-traveler-bookings.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TravelerBookings', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      agencyContractId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'AgencyContracts', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      travelerName: { type: Sequelize.STRING, allowNull: false },
      travelerEmail: { type: Sequelize.STRING, allowNull: true },
      travelerPhone: { type: Sequelize.STRING, allowNull: true },
      agencyBookingRef: { type: Sequelize.STRING, allowNull: true },
      token: { type: Sequelize.STRING, allowNull: false, unique: true },
      dueDate: { type: Sequelize.DATE, allowNull: false },
      originalDueDate: { type: Sequelize.DATE, allowNull: false },
      changeCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM(
          'pending_provisioning', 'provisioned', 'installed',
          'cancelled', 'failed', 'expired'
        ),
        allowNull: false,
        defaultValue: 'pending_provisioning'
      },
      airaloRequestId: { type: Sequelize.STRING, allowNull: true },
      esimId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Esims', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      cancelledAt: { type: Sequelize.DATE, allowNull: true },
      cancelReason: { type: Sequelize.STRING, allowNull: true },
      provisionedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('TravelerBookings', ['token'], {
      name: 'idx_traveler_bookings_token',
      unique: true
    });

    await queryInterface.addIndex('TravelerBookings', ['agencyId'], {
      name: 'idx_traveler_bookings_agency'
    });

    await queryInterface.addIndex('TravelerBookings', ['airaloRequestId'], {
      name: 'idx_traveler_bookings_airalo_request'
    });

    await queryInterface.addIndex('TravelerBookings', ['status'], {
      name: 'idx_traveler_bookings_status'
    });

    await queryInterface.addIndex('TravelerBookings', ['agencyId', 'agencyBookingRef'], {
      name: 'idx_traveler_bookings_agency_ref',
      unique: true,
      where: { agencyBookingRef: { [Sequelize.Op.ne]: null } }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('TravelerBookings');
  }
};
```

- [ ] **Step 2: Create esims extension migration**

Create `src/db/migrations/20260414000005-add-booking-fk-to-esims.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Esims', 'travelerBookingId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'TravelerBookings', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('Esims', ['travelerBookingId'], {
      name: 'idx_esims_traveler_booking'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Esims', 'idx_esims_traveler_booking');
    await queryInterface.removeColumn('Esims', 'travelerBookingId');
  }
};
```

- [ ] **Step 3: Create webhook logs and API keys migration**

Create `src/db/migrations/20260414000006-create-webhook-logs-and-api-keys.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AiraloWebhookLogs', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      webhookType: { type: Sequelize.STRING, allowNull: false },
      airaloRequestId: { type: Sequelize.STRING, allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false },
      travelerBookingId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'TravelerBookings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      processedAt: { type: Sequelize.DATE, allowNull: true },
      processStatus: {
        type: Sequelize.ENUM('pending', 'success', 'failed', 'retrying'),
        allowNull: false,
        defaultValue: 'pending'
      },
      error: { type: Sequelize.TEXT, allowNull: true },
      retryCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      receivedAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('AiraloWebhookLogs', ['airaloRequestId'], {
      name: 'idx_webhook_logs_airalo_request'
    });

    await queryInterface.addIndex('AiraloWebhookLogs', ['processStatus'], {
      name: 'idx_webhook_logs_status'
    });

    await queryInterface.createTable('AgencyApiKeys', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      keyHash: { type: Sequelize.STRING, allowNull: false },
      keyPrefix: { type: Sequelize.STRING(12), allowNull: false },
      label: { type: Sequelize.STRING, allowNull: false },
      lastUsedAt: { type: Sequelize.DATE, allowNull: true },
      status: {
        type: Sequelize.ENUM('active', 'revoked'),
        allowNull: false,
        defaultValue: 'active'
      },
      revokedAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('AgencyApiKeys', ['agencyId'], {
      name: 'idx_agency_api_keys_agency'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AgencyApiKeys');
    await queryInterface.dropTable('AiraloWebhookLogs');
  }
};
```

- [ ] **Step 4: Create agency invoices migration**

Create `src/db/migrations/20260414000007-create-agency-invoices.cjs`:

```javascript
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AgencyInvoices', {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agencyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Agencies', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      periodStart: { type: Sequelize.DATEONLY, allowNull: false },
      periodEnd: { type: Sequelize.DATEONLY, allowNull: false },
      totalBookings: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      totalAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      paymentStatus: {
        type: Sequelize.ENUM('pending', 'paid', 'overdue'),
        allowNull: false,
        defaultValue: 'pending'
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE }
    });

    await queryInterface.addIndex('AgencyInvoices', ['agencyId'], {
      name: 'idx_agency_invoices_agency'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AgencyInvoices');
  }
};
```

- [ ] **Step 5: Run migrations**

```bash
docker compose exec app npx sequelize-cli db:migrate
```

Expected: 4 migrations run successfully.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/20260414000004-create-traveler-bookings.cjs \
        src/db/migrations/20260414000005-add-booking-fk-to-esims.cjs \
        src/db/migrations/20260414000006-create-webhook-logs-and-api-keys.cjs \
        src/db/migrations/20260414000007-create-agency-invoices.cjs
git commit -m "feat: add traveler_bookings, webhook_logs, api_keys, invoices tables"
```

---

## Task 4: Sequelize Models — All New Models

**Files:**
- Create: `src/db/models/agency.js`
- Create: `src/db/models/agencyContract.js`
- Create: `src/db/models/travelerBooking.js`
- Create: `src/db/models/airaloWebhookLog.js`
- Create: `src/db/models/agencyApiKey.js`
- Create: `src/db/models/agencyInvoice.js`
- Modify: `src/db/models/user.js`
- Modify: `src/db/models/esim.js`

- [ ] **Step 1: Create Agency model**

Create `src/db/models/agency.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class Agency extends Model {
    static associate(models) {
      Agency.hasMany(models.AgencyContract, { foreignKey: 'agencyId' });
      Agency.hasMany(models.TravelerBooking, { foreignKey: 'agencyId' });
      Agency.hasMany(models.User, { foreignKey: 'agencyId', as: 'users' });
      Agency.hasMany(models.AgencyApiKey, { foreignKey: 'agencyId' });
      Agency.hasMany(models.AgencyInvoice, { foreignKey: 'agencyId' });
    }
  }
  Agency.init({
    name: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false, unique: true },
    logoUrl: { type: DataTypes.STRING, allowNull: true },
    contactEmail: { type: DataTypes.STRING, allowNull: false },
    contactName: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM('active', 'suspended'),
      allowNull: false,
      defaultValue: 'active'
    },
    settings: { type: DataTypes.JSONB, allowNull: true, defaultValue: {} }
  }, { sequelize, modelName: 'Agency' });
  return Agency;
};
```

- [ ] **Step 2: Create AgencyContract model**

Create `src/db/models/agencyContract.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyContract extends Model {
    static associate(models) {
      AgencyContract.belongsTo(models.Agency, { foreignKey: 'agencyId' });
      AgencyContract.belongsTo(models.AiraloPackage, { foreignKey: 'airaloPackageId', as: 'package' });
      AgencyContract.hasMany(models.TravelerBooking, { foreignKey: 'agencyContractId' });
    }
  }
  AgencyContract.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    airaloPackageId: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    usedQuantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unitPriceAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    unitPriceCurrency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    contractEndAt: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('active', 'exhausted', 'expired', 'terminated'),
      allowNull: false,
      defaultValue: 'active'
    }
  }, { sequelize, modelName: 'AgencyContract' });
  return AgencyContract;
};
```

- [ ] **Step 3: Create TravelerBooking model**

Create `src/db/models/travelerBooking.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class TravelerBooking extends Model {
    static associate(models) {
      TravelerBooking.belongsTo(models.Agency, { foreignKey: 'agencyId' });
      TravelerBooking.belongsTo(models.AgencyContract, { foreignKey: 'agencyContractId', as: 'contract' });
      TravelerBooking.belongsTo(models.Esim, { foreignKey: 'esimId', as: 'esim' });
      TravelerBooking.hasMany(models.AiraloWebhookLog, { foreignKey: 'travelerBookingId', as: 'webhookLogs' });
    }
  }
  TravelerBooking.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    agencyContractId: { type: DataTypes.INTEGER, allowNull: false },
    travelerName: { type: DataTypes.STRING, allowNull: false },
    travelerEmail: { type: DataTypes.STRING, allowNull: true },
    travelerPhone: { type: DataTypes.STRING, allowNull: true },
    agencyBookingRef: { type: DataTypes.STRING, allowNull: true },
    token: { type: DataTypes.STRING, allowNull: false, unique: true },
    dueDate: { type: DataTypes.DATE, allowNull: false },
    originalDueDate: { type: DataTypes.DATE, allowNull: false },
    changeCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: {
      type: DataTypes.ENUM(
        'pending_provisioning', 'provisioned', 'installed',
        'cancelled', 'failed', 'expired'
      ),
      allowNull: false,
      defaultValue: 'pending_provisioning'
    },
    airaloRequestId: { type: DataTypes.STRING, allowNull: true },
    esimId: { type: DataTypes.INTEGER, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    cancelReason: { type: DataTypes.STRING, allowNull: true },
    provisionedAt: { type: DataTypes.DATE, allowNull: true }
  }, { sequelize, modelName: 'TravelerBooking' });
  return TravelerBooking;
};
```

- [ ] **Step 4: Create AiraloWebhookLog model**

Create `src/db/models/airaloWebhookLog.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AiraloWebhookLog extends Model {
    static associate(models) {
      AiraloWebhookLog.belongsTo(models.TravelerBooking, { foreignKey: 'travelerBookingId', as: 'booking' });
    }
  }
  AiraloWebhookLog.init({
    webhookType: { type: DataTypes.STRING, allowNull: false },
    airaloRequestId: { type: DataTypes.STRING, allowNull: true },
    payload: { type: DataTypes.JSONB, allowNull: false },
    travelerBookingId: { type: DataTypes.INTEGER, allowNull: true },
    processedAt: { type: DataTypes.DATE, allowNull: true },
    processStatus: {
      type: DataTypes.ENUM('pending', 'success', 'failed', 'retrying'),
      allowNull: false,
      defaultValue: 'pending'
    },
    error: { type: DataTypes.TEXT, allowNull: true },
    retryCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    receivedAt: { type: DataTypes.DATE, allowNull: false }
  }, { sequelize, modelName: 'AiraloWebhookLog' });
  return AiraloWebhookLog;
};
```

- [ ] **Step 5: Create AgencyApiKey and AgencyInvoice models**

Create `src/db/models/agencyApiKey.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyApiKey extends Model {
    static associate(models) {
      AgencyApiKey.belongsTo(models.Agency, { foreignKey: 'agencyId' });
    }
  }
  AgencyApiKey.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    keyHash: { type: DataTypes.STRING, allowNull: false },
    keyPrefix: { type: DataTypes.STRING(12), allowNull: false },
    label: { type: DataTypes.STRING, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true },
    status: {
      type: DataTypes.ENUM('active', 'revoked'),
      allowNull: false,
      defaultValue: 'active'
    },
    revokedAt: { type: DataTypes.DATE, allowNull: true }
  }, { sequelize, modelName: 'AgencyApiKey' });
  return AgencyApiKey;
};
```

Create `src/db/models/agencyInvoice.js`:

```javascript
'use strict';
import { Model } from 'sequelize';
export default (sequelize, DataTypes) => {
  class AgencyInvoice extends Model {
    static associate(models) {
      AgencyInvoice.belongsTo(models.Agency, { foreignKey: 'agencyId' });
    }
  }
  AgencyInvoice.init({
    agencyId: { type: DataTypes.INTEGER, allowNull: false },
    periodStart: { type: DataTypes.DATEONLY, allowNull: false },
    periodEnd: { type: DataTypes.DATEONLY, allowNull: false },
    totalBookings: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'USD' },
    paymentStatus: {
      type: DataTypes.ENUM('pending', 'paid', 'overdue'),
      allowNull: false,
      defaultValue: 'pending'
    },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, { sequelize, modelName: 'AgencyInvoice' });
  return AgencyInvoice;
};
```

- [ ] **Step 6: Update User model — add agency fields**

In `src/db/models/user.js`, add inside `User.init({...})` block, after the `vendorId` field:

```javascript
    agencyId: { type: DataTypes.INTEGER, allowNull: true },
    agencyRole: {
      type: DataTypes.ENUM('owner', 'staff'),
      allowNull: true
    }
```

Add association inside `static associate(models)`:

```javascript
      User.belongsTo(models.Agency, { foreignKey: 'agencyId', as: 'agency' });
```

- [ ] **Step 7: Update Esim model — add booking FK**

In `src/db/models/esim.js`, add inside `Esim.init({...})` block, after the `vendorData` field:

```javascript
    travelerBookingId: { type: DataTypes.INTEGER, allowNull: true }
```

Add association inside `static associate(models)`:

```javascript
      Esim.belongsTo(models.TravelerBooking, { foreignKey: 'travelerBookingId', as: 'booking' });
```

- [ ] **Step 8: Verify models load correctly**

```bash
docker compose restart app && docker compose logs app --tail=30
```

Expected: No model loading errors, app starts successfully.

- [ ] **Step 9: Commit**

```bash
git add src/db/models/agency.js src/db/models/agencyContract.js \
        src/db/models/travelerBooking.js src/db/models/airaloWebhookLog.js \
        src/db/models/agencyApiKey.js src/db/models/agencyInvoice.js \
        src/db/models/user.js src/db/models/esim.js
git commit -m "feat: add all B2B models — agency, contract, booking, webhook log, api key, invoice"
```

---

## Task 5: Token Service + Airalo Client Extensions

**Files:**
- Create: `src/services/tokenService.js`
- Create: `src/services/futureOrderService.js`
- Modify: `src/services/airaloClient.js`

- [ ] **Step 1: Create token service**

Create `src/services/tokenService.js`:

```javascript
import { nanoid } from 'nanoid';

export function generateBookingToken() {
  return nanoid(22);
}
```

- [ ] **Step 2: Add FutureOrder methods to airaloClient.js**

Add these exports at the bottom of `src/services/airaloClient.js`, before the final closing (after the existing `isInitialized` export):

```javascript
export async function createFutureOrder({ packageId, dueDate, webhookUrl, description }) {
  if (!airalo) throw new Error('Airalo not initialized');
  const result = await airalo.createFutureOrder(
    packageId,
    1,
    dueDate,
    webhookUrl,
    description || `DataPatch future order ${Date.now()}`
  );
  log.info({ packageId, dueDate, requestId: result?.data?.request_id }, 'Airalo future order created');
  return result;
}

export async function cancelFutureOrder(requestId) {
  if (!airalo) throw new Error('Airalo not initialized');
  const result = await airalo.cancelFutureOrder(requestId);
  log.info({ requestId }, 'Airalo future order cancelled');
  return result;
}

export async function getFutureOrder(requestId) {
  const res = await restApi().get(`/orders/future/${requestId}`);
  return res.data;
}

export function verifyWebhookSignature(rawBody, signature, secret) {
  const crypto = await import('crypto');
  const computed = crypto.default
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return computed === signature;
}
```

Note: `verifyWebhookSignature` uses dynamic import for `crypto` to keep the top-level import list clean. Alternative: add `import crypto from 'crypto'` at the top of the file.

- [ ] **Step 3: Create futureOrderService.js — business logic wrapper**

Create `src/services/futureOrderService.js`:

```javascript
import * as airalo from './airaloClient.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'futureOrder' });

const WEBHOOK_URL = process.env.APP_URL
  ? `${process.env.APP_URL}/api/webhooks/airalo`
  : 'https://datapatch.app/api/webhooks/airalo';

export async function submitFutureOrder({ packageId, dueDate, agencySlug, bookingId }) {
  const dueDateStr = formatDueDateUTC(dueDate);
  const description = `DataPatch-${agencySlug}-${bookingId}`;

  const result = await airalo.createFutureOrder({
    packageId,
    dueDate: dueDateStr,
    webhookUrl: WEBHOOK_URL,
    description
  });

  const requestId = result?.data?.request_id || result?.data?.id;
  if (!requestId) {
    throw new Error('Airalo createFutureOrder returned no request_id');
  }

  log.info({ packageId, dueDate: dueDateStr, requestId, bookingId }, 'Future order submitted');
  return requestId;
}

export async function cancelOrder(requestId) {
  await airalo.cancelFutureOrder(requestId);
  log.info({ requestId }, 'Future order cancelled');
}

export async function pollOrderStatus(requestId) {
  const result = await airalo.getFutureOrder(requestId);
  return result?.data;
}

function formatDueDateUTC(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/tokenService.js src/services/futureOrderService.js src/services/airaloClient.js
git commit -m "feat: add token service and Airalo FutureOrder client extensions"
```

---

## Task 6: Agency Auth Middleware

**Files:**
- Create: `src/middleware/agency.js`

- [ ] **Step 1: Create agency middleware**

Create `src/middleware/agency.js`:

```javascript
export function ensureAgency(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!req.session.user.agencyId) {
    return res.status(403).render('error', {
      title: 'Error',
      user: req.session.user,
      message: 'Bu sayfa sadece acente kullanicilari icindir.'
    });
  }
  return next();
}

export function ensureAgencyOwner(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!req.session.user.agencyId || req.session.user.agencyRole !== 'owner') {
    return res.status(403).render('error', {
      title: 'Error',
      user: req.session.user,
      message: 'Bu islem sadece acente yoneticileri tarafindan yapilabilir.'
    });
  }
  return next();
}
```

- [ ] **Step 2: Update session user population to include agency fields**

In `src/controllers/authController.js`, find where `req.session.user` is set during login (the login handler). Add `agencyId` and `agencyRole` to the session object. Find the section that looks like:

```javascript
req.session.user = {
  id: user.id,
  username: user.username,
  // ... other fields
};
```

Add these fields:

```javascript
  agencyId: user.agencyId || null,
  agencyRole: user.agencyRole || null,
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/agency.js src/controllers/authController.js
git commit -m "feat: add agency auth middleware (ensureAgency, ensureAgencyOwner)"
```

---

## Task 7: Audit Actions + Booking Service

**Files:**
- Modify: `src/services/auditService.js`
- Create: `src/services/bookingService.js`

- [ ] **Step 1: Add new audit action constants**

In `src/services/auditService.js`, add to the `ACTIONS` object:

```javascript
  AGENCY_CREATE: 'admin.agency_create',
  AGENCY_EDIT: 'admin.agency_edit',
  CONTRACT_CREATE: 'admin.contract_create',
  CONTRACT_EDIT: 'admin.contract_edit',
  BOOKING_CREATE: 'agency.booking_create',
  BOOKING_CANCEL: 'agency.booking_cancel',
  BOOKING_DATE_CHANGE: 'agency.booking_date_change',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_FAILED: 'webhook.failed',
  WEBHOOK_RETRIED: 'admin.webhook_retry',
```

- [ ] **Step 2: Create bookingService.js — createBooking**

Create `src/services/bookingService.js`:

```javascript
import db from '../db/models/index.js';
import { generateBookingToken } from './tokenService.js';
import { submitFutureOrder, cancelOrder } from './futureOrderService.js';
import { logAudit, ACTIONS, getIp } from './auditService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'booking' });

const MIN_DUE_DATE_HOURS = 24;
const MAX_DUE_DATE_MONTHS = 12;
const DATE_CHANGE_CUTOFF_HOURS = 72;

export async function createBooking({ contractId, travelerName, travelerEmail, travelerPhone, agencyBookingRef, dueDate, agencyId }, req) {
  const transaction = await db.sequelize.transaction();

  try {
    const contract = await db.AgencyContract.findOne({
      where: { id: contractId, agencyId },
      include: [
        { model: db.AiraloPackage, as: 'package' },
        { model: db.Agency }
      ],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!contract) {
      throw new BookingError('Kontrat bulunamadi.', 404);
    }
    if (contract.status !== 'active') {
      throw new BookingError('Bu kontrat aktif degil.', 400);
    }
    if (new Date(contract.contractEndAt) < new Date()) {
      throw new BookingError('Kontrat suresi dolmus.', 400);
    }
    if (contract.usedQuantity >= contract.quantity) {
      throw new BookingError('Kontrat havuzu tukenmis.', 400);
    }

    const dueDateObj = new Date(dueDate);
    const now = new Date();
    const minDate = new Date(now.getTime() + MIN_DUE_DATE_HOURS * 60 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setMonth(maxDate.getMonth() + MAX_DUE_DATE_MONTHS);

    if (dueDateObj <= minDate) {
      throw new BookingError(`Seyahat tarihi en az ${MIN_DUE_DATE_HOURS} saat sonrasi olmalidir.`, 400);
    }
    if (dueDateObj > maxDate) {
      throw new BookingError(`Seyahat tarihi en fazla ${MAX_DUE_DATE_MONTHS} ay sonrasi olabilir.`, 400);
    }

    // Idempotency: check agency_booking_ref uniqueness OR idempotency-key header
    const idempotencyKey = req?.headers?.['idempotency-key'] || null;
    if (agencyBookingRef) {
      const existing = await db.TravelerBooking.findOne({
        where: { agencyId, agencyBookingRef },
        transaction
      });
      if (existing) {
        throw new BookingError('Bu rezervasyon referansi zaten kullanilmis.', 409);
      }
    } else if (idempotencyKey) {
      // For bookings without ref, use idempotency-key to prevent double-click
      const existing = await db.TravelerBooking.findOne({
        where: {
          agencyId,
          travelerName,
          dueDate: new Date(dueDate),
          createdAt: { [db.Sequelize.Op.gte]: new Date(Date.now() - 5 * 60 * 1000) }
        },
        transaction
      });
      if (existing) {
        throw new BookingError('Bu rezervasyon zaten olusturuldu (tekrar istek).', 409);
      }
    }

    const token = generateBookingToken();
    const bookingId = `tmp-${Date.now()}`;

    const airaloRequestId = await submitFutureOrder({
      packageId: contract.package.packageId,
      dueDate: dueDateObj,
      agencySlug: contract.Agency.slug,
      bookingId
    });

    const booking = await db.TravelerBooking.create({
      agencyId,
      agencyContractId: contractId,
      travelerName,
      travelerEmail: travelerEmail || null,
      travelerPhone: travelerPhone || null,
      agencyBookingRef: agencyBookingRef || null,
      token,
      dueDate: dueDateObj,
      originalDueDate: dueDateObj,
      status: 'pending_provisioning',
      airaloRequestId
    }, { transaction });

    await contract.increment('usedQuantity', { by: 1, transaction });

    if (contract.usedQuantity + 1 >= contract.quantity) {
      await contract.update({ status: 'exhausted' }, { transaction });
    }

    await logAudit(ACTIONS.BOOKING_CREATE, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: booking.id,
      details: {
        contractId,
        packageId: contract.package.packageId,
        dueDate: dueDateObj.toISOString(),
        airaloRequestId,
        travelerName
      },
      ipAddress: req ? getIp(req) : null
    });

    await transaction.commit();

    // Send booking confirmation email to traveler (non-blocking)
    const appUrl = process.env.APP_URL || 'https://datapatch.app';
    if (travelerEmail) {
      import('../services/emailService.js').then(({ sendMail }) => {
        const dueDateStr = dueDateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        sendMail(travelerEmail, 'eSIM rezervasyonunuz olusturuldu',
          `<p>Merhaba ${travelerName},</p>
           <p>eSIM'iniz <strong>${dueDateStr}</strong> tarihinde hazir olacak.</p>
           <p>Hazir oldugunda su linkten kurabilirsiniz:</p>
           <p><a href="${appUrl}/e/${token}">${appUrl}/e/${token}</a></p>`,
          { type: 'booking_created', userId: null }
        ).catch(err => log.error({ err }, 'Booking confirmation email failed'));
      });
    }

    return {
      bookingId: booking.id,
      token,
      tokenUrl: `${appUrl}/e/${token}`,
      status: booking.status,
      dueDate: booking.dueDate
    };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'createBooking failed');
    throw new BookingError('Rezervasyon olusturulamadi. Lutfen tekrar deneyin.', 500);
  }
}

export async function cancelBooking(bookingId, agencyId, { reason, req } = {}) {
  const transaction = await db.sequelize.transaction();

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { id: bookingId, agencyId },
      include: [{ model: db.AgencyContract, as: 'contract' }],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!booking) {
      throw new BookingError('Rezervasyon bulunamadi.', 404);
    }
    if (booking.status !== 'pending_provisioning') {
      throw new BookingError('Sadece bekleyen rezervasyonlar iptal edilebilir.', 400);
    }

    if (booking.airaloRequestId) {
      try {
        await cancelOrder(booking.airaloRequestId);
      } catch (err) {
        log.warn({ err, bookingId, airaloRequestId: booking.airaloRequestId }, 'Airalo cancel failed — proceeding with local cancel');
      }
    }

    await booking.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason || null
    }, { transaction });

    await booking.contract.decrement('usedQuantity', { by: 1, transaction });

    if (booking.contract.status === 'exhausted') {
      await booking.contract.update({ status: 'active' }, { transaction });
    }

    await logAudit(ACTIONS.BOOKING_CANCEL, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: bookingId,
      details: { reason, airaloRequestId: booking.airaloRequestId },
      ipAddress: req ? getIp(req) : null
    });

    await transaction.commit();
    return { success: true };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'cancelBooking failed');
    throw new BookingError('Iptal islemi basarisiz.', 500);
  }
}

export async function changeDueDate(bookingId, newDueDate, agencyId, req) {
  const transaction = await db.sequelize.transaction();

  try {
    const booking = await db.TravelerBooking.findOne({
      where: { id: bookingId, agencyId },
      include: [
        { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }, { model: db.Agency }] }
      ],
      lock: transaction.LOCK.UPDATE,
      transaction
    });

    if (!booking) {
      throw new BookingError('Rezervasyon bulunamadi.', 404);
    }
    if (booking.status !== 'pending_provisioning') {
      throw new BookingError('Sadece bekleyen rezervasyonlarin tarihi degistirilebilir.', 400);
    }

    const now = new Date();
    const cutoff = new Date(booking.dueDate.getTime() - DATE_CHANGE_CUTOFF_HOURS * 60 * 60 * 1000);
    if (now > cutoff) {
      throw new BookingError(`Tarih degisikligi icin en az ${DATE_CHANGE_CUTOFF_HOURS} saat kalmis olmalidir.`, 400);
    }

    const newDateObj = new Date(newDueDate);
    const minDate = new Date(now.getTime() + MIN_DUE_DATE_HOURS * 60 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setMonth(maxDate.getMonth() + MAX_DUE_DATE_MONTHS);

    if (newDateObj <= minDate) {
      throw new BookingError(`Yeni tarih en az ${MIN_DUE_DATE_HOURS} saat sonrasi olmalidir.`, 400);
    }
    if (newDateObj > maxDate) {
      throw new BookingError(`Yeni tarih en fazla ${MAX_DUE_DATE_MONTHS} ay sonrasi olabilir.`, 400);
    }

    await cancelOrder(booking.airaloRequestId);

    const newRequestId = await submitFutureOrder({
      packageId: booking.contract.package.packageId,
      dueDate: newDateObj,
      agencySlug: booking.contract.Agency.slug,
      bookingId: booking.id
    });

    const oldDate = booking.dueDate;
    await booking.update({
      dueDate: newDateObj,
      airaloRequestId: newRequestId,
      changeCount: booking.changeCount + 1
    }, { transaction });

    await logAudit(ACTIONS.BOOKING_DATE_CHANGE, {
      userId: req?.session?.user?.id,
      entity: 'TravelerBooking',
      entityId: bookingId,
      details: {
        oldDate: oldDate.toISOString(),
        newDate: newDateObj.toISOString(),
        changeCount: booking.changeCount + 1,
        oldRequestId: booking.airaloRequestId,
        newRequestId
      },
      ipAddress: getIp(req)
    });

    await transaction.commit();
    return { success: true, newDueDate: newDateObj, airaloRequestId: newRequestId };
  } catch (err) {
    await transaction.rollback();
    if (err instanceof BookingError) throw err;
    log.error({ err }, 'changeDueDate failed');
    throw new BookingError('Tarih degisikligi basarisiz.', 500);
  }
}

export class BookingError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'BookingError';
    this.statusCode = statusCode;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/auditService.js src/services/bookingService.js
git commit -m "feat: add booking service with create, cancel, dateChange + audit actions"
```

---

## Task 8: Webhook Controller + Processing

**Files:**
- Create: `src/controllers/webhookController.js`

- [ ] **Step 1: Create webhook controller**

Create `src/controllers/webhookController.js`:

```javascript
import db from '../db/models/index.js';
import logger from '../lib/logger.js';
import { logAudit, ACTIONS } from '../services/auditService.js';

const log = logger.child({ module: 'webhook' });

export async function handleAiraloWebhook(req, res) {
  const payload = req.body;
  const webhookType = payload?.type || payload?.event || 'unknown';
  const airaloRequestId = payload?.data?.request_id || payload?.request_id || null;

  let webhookLog;
  try {
    webhookLog = await db.AiraloWebhookLog.create({
      webhookType,
      airaloRequestId,
      payload,
      processStatus: 'pending',
      receivedAt: new Date()
    });
  } catch (err) {
    log.error({ err, payload }, 'Failed to persist webhook log');
  }

  res.status(200).json({ received: true });

  try {
    await processWebhook(webhookLog || { id: null, webhookType, airaloRequestId, payload });
  } catch (err) {
    log.error({ err, webhookLogId: webhookLog?.id }, 'Webhook processing failed');
    if (webhookLog) {
      await webhookLog.update({
        processStatus: 'failed',
        error: err.message
      }).catch(() => {});
    }
  }
}

export async function processWebhook(webhookLog) {
  const { webhookType, airaloRequestId, payload } = webhookLog;

  if (!airaloRequestId) {
    log.warn({ webhookType }, 'Webhook without request_id — skipping');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'failed', error: 'No request_id in payload' });
    }
    return;
  }

  const existing = await db.AiraloWebhookLog.findOne({
    where: {
      airaloRequestId,
      webhookType,
      processStatus: 'success',
      id: { [db.Sequelize.Op.ne]: webhookLog.id || 0 }
    }
  });
  if (existing) {
    log.info({ airaloRequestId, webhookType }, 'Duplicate webhook — skipping');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'success', processedAt: new Date(), error: 'duplicate — skipped' });
    }
    return;
  }

  const booking = await db.TravelerBooking.findOne({
    where: { airaloRequestId },
    include: [
      { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }] },
      { model: db.Agency }
    ]
  });

  if (!booking) {
    log.warn({ airaloRequestId, webhookType }, 'No booking found for webhook request_id');
    if (webhookLog.id) {
      await webhookLog.update({ processStatus: 'failed', error: 'No matching booking' });
    }
    return;
  }

  if (webhookLog.id) {
    await webhookLog.update({ travelerBookingId: booking.id });
  }

  if (webhookType === 'future_order_fulfilled' || webhookType === 'order.completed') {
    await handleFulfilled(booking, payload);
  } else if (webhookType === 'future_order_failed' || webhookType === 'order.failed') {
    await handleFailed(booking, payload);
  } else if (webhookType === 'esim_activated' || webhookType === 'sim.activated') {
    await handleActivated(booking);
  } else {
    log.info({ webhookType, airaloRequestId }, 'Unhandled webhook type');
  }

  if (webhookLog.id) {
    await webhookLog.update({ processStatus: 'success', processedAt: new Date() });
  }

  await logAudit(ACTIONS.WEBHOOK_PROCESSED, {
    entity: 'TravelerBooking',
    entityId: booking.id,
    details: { webhookType, airaloRequestId }
  });
}

async function handleFulfilled(booking, payload) {
  const simData = payload?.data?.sims?.[0] || payload?.data || {};
  const transaction = await db.sequelize.transaction();

  try {
    const esim = await db.Esim.create({
      userId: null,
      offerId: booking.contract?.package?.packageId || null,
      transactionId: String(simData.id || simData.order_id || booking.airaloRequestId),
      status: 'completed',
      vendor: 'airalo',
      vendorOrderId: String(simData.order_id || simData.id || ''),
      iccid: simData.iccid || null,
      smdpAddress: simData.smdp_address || null,
      activationCode: simData.matching_id || simData.activation_code || null,
      country: booking.contract?.package?.countryCode || null,
      dataGB: booking.contract?.package?.amount ? booking.contract.package.amount / 1024 : null,
      durationDays: booking.contract?.package?.day || null,
      brandName: booking.contract?.package?.operatorTitle || null,
      priceAmount: booking.contract?.unitPriceAmount || null,
      priceCurrency: booking.contract?.unitPriceCurrency || null,
      vendorData: {
        lpa: simData.lpa || null,
        matchingId: simData.matching_id || null,
        qrcodeUrl: simData.qrcode_url || null,
        apn: simData.apn || null,
        airaloRequestId: booking.airaloRequestId
      },
      travelerBookingId: booking.id
    }, { transaction });

    await booking.update({
      status: 'provisioned',
      esimId: esim.id,
      provisionedAt: new Date()
    }, { transaction });

    await transaction.commit();
    log.info({ bookingId: booking.id, iccid: esim.iccid }, 'Booking provisioned via webhook');

    // Send "eSIM ready" email to traveler
    if (booking.travelerEmail) {
      const { default: emailService } = await import('../services/emailService.js');
      const appUrl = process.env.APP_URL || 'https://datapatch.app';
      await emailService.sendMail(booking.travelerEmail, 'eSIM\'in hazir!',
        `<p>Merhaba ${booking.travelerName},</p>
         <p>eSIM'in hazir! Asagidaki linkten kurabilirsin:</p>
         <p><a href="${appUrl}/e/${booking.token}">eSIM'i Kur</a></p>
         <p>30 gun icinde kurulmasi gerekmektedir.</p>`,
        { type: 'esim_ready', userId: null }
      ).catch(err => log.error({ err, bookingId: booking.id }, 'Provisioned email failed'));
    }
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleFailed(booking, payload) {
  const transaction = await db.sequelize.transaction();

  try {
    await booking.update({ status: 'failed' }, { transaction });

    await booking.contract.decrement('usedQuantity', { by: 1, transaction });
    if (booking.contract.status === 'exhausted') {
      await booking.contract.update({ status: 'active' }, { transaction });
    }

    await transaction.commit();
    log.warn({ bookingId: booking.id, payload }, 'Booking failed via webhook');
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function handleActivated(booking) {
  if (booking.status === 'provisioned') {
    await booking.update({ status: 'installed' });
    log.info({ bookingId: booking.id }, 'Booking marked as installed');
  }
}
```

- [ ] **Step 2: Add webhook route to server.js**

In `src/server.js`, the webhook routes are mounted BEFORE CSRF (line 182). Add the Airalo webhook alongside the existing pattern. Find this section:

```javascript
app.use('/webhooks', webhookRoutes);
```

Add before it:

```javascript
import { handleAiraloWebhook } from './controllers/webhookController.js';
// ... (at the webhook section, before CSRF)
app.post('/api/webhooks/airalo', handleAiraloWebhook);
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/webhookController.js src/server.js
git commit -m "feat: add Airalo webhook handler with idempotent processing"
```

---

## Task 9: Agency Routes + Controller (Bookings)

**Files:**
- Create: `src/controllers/agencyController.js`
- Create: `src/routes/agency.js`

- [ ] **Step 1: Create agency controller**

Create `src/controllers/agencyController.js`:

```javascript
import db from '../db/models/index.js';
import { createBooking, cancelBooking, changeDueDate, BookingError } from '../services/bookingService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'agency' });

export async function showDashboard(req, res) {
  const agencyId = req.session.user.agencyId;

  const [contractStats, upcomingBookings, recentBookings] = await Promise.all([
    db.AgencyContract.findAll({
      where: { agencyId, status: 'active' },
      include: [{ model: db.AiraloPackage, as: 'package' }],
      order: [['createdAt', 'DESC']]
    }),
    db.TravelerBooking.findAll({
      where: {
        agencyId,
        status: 'pending_provisioning',
        dueDate: {
          [db.Sequelize.Op.between]: [new Date(), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
        }
      },
      order: [['dueDate', 'ASC']],
      limit: 10
    }),
    db.TravelerBooking.count({
      where: { agencyId },
      group: ['status']
    })
  ]);

  const totalContracts = contractStats.reduce((sum, c) => sum + c.quantity, 0);
  const thisWeekBookings = await db.TravelerBooking.count({
    where: {
      agencyId,
      createdAt: { [db.Sequelize.Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }
  });

  res.render('agency/dashboard', {
    title: 'Dashboard',
    user: req.session.user,
    contractStats,
    upcomingBookings,
    recentBookings,
    totalContracts,
    thisWeekBookings
  });
}

export async function listBookings(req, res) {
  const agencyId = req.session.user.agencyId;
  const { status, search, page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const where = { agencyId };
  if (status && status !== 'all') {
    where.status = status;
  }
  if (search) {
    where[db.Sequelize.Op.or] = [
      { travelerName: { [db.Sequelize.Op.iLike]: `%${search}%` } },
      { travelerEmail: { [db.Sequelize.Op.iLike]: `%${search}%` } },
      { agencyBookingRef: { [db.Sequelize.Op.iLike]: `%${search}%` } }
    ];
  }

  const { count, rows: bookings } = await db.TravelerBooking.findAndCountAll({
    where,
    include: [{ model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }] }],
    order: [['createdAt', 'DESC']],
    limit,
    offset
  });

  res.render('agency/bookings', {
    title: 'Rezervasyonlar',
    user: req.session.user,
    bookings,
    total: count,
    page: Number(page),
    totalPages: Math.ceil(count / limit),
    filters: { status: status || 'all', search: search || '' }
  });
}

export async function showNewBookingForm(req, res) {
  const agencyId = req.session.user.agencyId;

  const contracts = await db.AgencyContract.findAll({
    where: { agencyId, status: 'active' },
    include: [{ model: db.AiraloPackage, as: 'package' }],
    order: [['createdAt', 'DESC']]
  });

  res.render('agency/booking-new', {
    title: 'Yeni Rezervasyon',
    user: req.session.user,
    contracts,
    error: null
  });
}

export async function handleCreateBooking(req, res) {
  const agencyId = req.session.user.agencyId;
  const { contractId, travelerName, travelerEmail, travelerPhone, agencyBookingRef, dueDate } = req.body;

  try {
    const result = await createBooking({
      contractId: Number(contractId),
      travelerName,
      travelerEmail,
      travelerPhone,
      agencyBookingRef,
      dueDate,
      agencyId
    }, req);

    res.redirect(`/agency/bookings/${result.bookingId}?created=true`);
  } catch (err) {
    if (err instanceof BookingError) {
      const contracts = await db.AgencyContract.findAll({
        where: { agencyId, status: 'active' },
        include: [{ model: db.AiraloPackage, as: 'package' }]
      });
      return res.render('agency/booking-new', {
        title: 'Yeni Rezervasyon',
        user: req.session.user,
        contracts,
        error: err.message
      });
    }
    log.error({ err }, 'handleCreateBooking unexpected error');
    res.render('error', { title: 'Hata', user: req.session.user, message: 'Rezervasyon olusturulamadi.' });
  }
}

export async function showBookingDetail(req, res) {
  const agencyId = req.session.user.agencyId;
  const booking = await db.TravelerBooking.findOne({
    where: { id: req.params.id, agencyId },
    include: [
      { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }] },
      { model: db.Esim, as: 'esim' },
      { model: db.AiraloWebhookLog, as: 'webhookLogs', order: [['receivedAt', 'DESC']] }
    ]
  });

  if (!booking) {
    return res.status(404).render('error', { title: 'Hata', user: req.session.user, message: 'Rezervasyon bulunamadi.' });
  }

  const appUrl = process.env.APP_URL || 'https://datapatch.app';
  const now = new Date();
  const cutoffDate = new Date(booking.dueDate.getTime() - 72 * 60 * 60 * 1000);
  const canChangeDate = booking.status === 'pending_provisioning' && now < cutoffDate;
  const canCancel = booking.status === 'pending_provisioning';

  res.render('agency/booking-detail', {
    title: `Rezervasyon #${booking.id}`,
    user: req.session.user,
    booking,
    tokenUrl: `${appUrl}/e/${booking.token}`,
    canChangeDate,
    canCancel,
    created: req.query.created === 'true'
  });
}

export async function handleCancelBooking(req, res) {
  const agencyId = req.session.user.agencyId;

  try {
    await cancelBooking(Number(req.params.id), agencyId, {
      reason: req.body.reason,
      req
    });
    res.redirect(`/agency/bookings/${req.params.id}`);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).render('error', { title: 'Hata', user: req.session.user, message: err.message });
    }
    res.render('error', { title: 'Hata', user: req.session.user, message: 'Iptal islemi basarisiz.' });
  }
}

export async function handleChangeDueDate(req, res) {
  const agencyId = req.session.user.agencyId;

  try {
    await changeDueDate(Number(req.params.id), req.body.dueDate, agencyId, req);
    res.redirect(`/agency/bookings/${req.params.id}`);
  } catch (err) {
    if (err instanceof BookingError) {
      return res.status(err.statusCode).render('error', { title: 'Hata', user: req.session.user, message: err.message });
    }
    res.render('error', { title: 'Hata', user: req.session.user, message: 'Tarih degisikligi basarisiz.' });
  }
}

export async function listContracts(req, res) {
  const agencyId = req.session.user.agencyId;

  const contracts = await db.AgencyContract.findAll({
    where: { agencyId },
    include: [{ model: db.AiraloPackage, as: 'package' }],
    order: [['createdAt', 'DESC']]
  });

  res.render('agency/contracts', {
    title: 'Kontratlar',
    user: req.session.user,
    contracts
  });
}
```

- [ ] **Step 2: Create agency routes**

Create `src/routes/agency.js`:

```javascript
import express from 'express';
import { ensureAgency, ensureAgencyOwner } from '../middleware/agency.js';
import {
  showDashboard,
  listBookings,
  showNewBookingForm,
  handleCreateBooking,
  showBookingDetail,
  handleCancelBooking,
  handleChangeDueDate,
  listContracts
} from '../controllers/agencyController.js';

const router = express.Router();

router.use(ensureAgency);

router.get('/', showDashboard);
router.get('/bookings', listBookings);
router.get('/bookings/new', showNewBookingForm);
router.post('/bookings', handleCreateBooking);
router.get('/bookings/:id', showBookingDetail);
router.post('/bookings/:id/cancel', handleCancelBooking);
router.post('/bookings/:id/change-date', handleChangeDueDate);
router.get('/contracts', listContracts);

export default router;
```

- [ ] **Step 3: Mount agency routes in server.js**

In `src/server.js`, add the import at the top with other route imports:

```javascript
import agencyRoutes from './routes/agency.js';
```

Add the route mounting after the vendor routes (before `app.use('/', esimRoutes)`):

```javascript
app.use('/agency', agencyRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/agencyController.js src/routes/agency.js src/server.js
git commit -m "feat: add agency portal routes — dashboard, bookings CRUD, contracts"
```

---

## Task 10: Proxy Page (Traveler-Facing)

**Files:**
- Create: `src/controllers/proxyController.js`
- Create: `src/routes/proxy.js`
- Create: `src/views/proxy/page.ejs`

- [ ] **Step 1: Create proxy controller**

Create `src/controllers/proxyController.js`:

```javascript
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'proxy' });

export async function showProxyPage(req, res) {
  const { token } = req.params;

  const booking = await db.TravelerBooking.findOne({
    where: { token },
    include: [
      { model: db.Agency },
      { model: db.AgencyContract, as: 'contract', include: [{ model: db.AiraloPackage, as: 'package' }] },
      { model: db.Esim, as: 'esim' }
    ]
  });

  if (!booking) {
    return res.status(404).render('proxy/page', {
      title: 'Gecersiz Link',
      state: 'not_found',
      booking: null,
      agency: null,
      package: null,
      esim: null
    });
  }

  log.info({
    bookingId: booking.id,
    status: booking.status,
    ip: req.ip,
    userAgent: req.get('user-agent')
  }, 'Proxy page viewed');

  const agency = booking.Agency;
  const pkg = booking.contract?.package;
  const esim = booking.esim;

  res.render('proxy/page', {
    title: pkg ? `${pkg.title} eSIM` : 'eSIM',
    state: booking.status,
    booking: {
      id: booking.id,
      travelerName: booking.travelerName,
      dueDate: booking.dueDate,
      provisionedAt: booking.provisionedAt,
      status: booking.status
    },
    agency: agency ? {
      name: agency.name,
      logoUrl: agency.logoUrl,
      contactEmail: agency.contactEmail,
      phone: agency.phone
    } : null,
    package: pkg ? {
      title: pkg.title,
      data: pkg.data,
      day: pkg.day,
      countryCode: pkg.countryCode,
      operatorTitle: pkg.operatorTitle
    } : null,
    esim: esim ? {
      iccid: esim.iccid,
      lpa: esim.vendorData?.lpa || null,
      qrcodeUrl: esim.vendorData?.qrcodeUrl || null,
      matchingId: esim.vendorData?.matchingId || null,
      smdpAddress: esim.smdpAddress || 'rsp.airalo.com'
    } : null
  });
}

export async function checkBookingStatus(req, res) {
  const { token } = req.params;
  const booking = await db.TravelerBooking.findOne({
    where: { token },
    attributes: ['status', 'provisionedAt']
  });
  if (!booking) return res.status(404).json({ error: 'not_found' });
  res.json({ status: booking.status });
}
```

- [ ] **Step 2: Create proxy routes**

Create `src/routes/proxy.js`:

```javascript
import express from 'express';
import { showProxyPage, checkBookingStatus } from '../controllers/proxyController.js';

const router = express.Router();

router.get('/e/:token', showProxyPage);
router.get('/api/booking-status/:token', checkBookingStatus);

export default router;
```

- [ ] **Step 3: Mount proxy routes in server.js BEFORE CSRF**

The proxy page is public (no session/CSRF needed). In `src/server.js`, find the section where webhook routes are mounted before CSRF (around line 182). Add proxy routes there:

```javascript
import proxyRoutes from './routes/proxy.js';
// ... in the pre-CSRF section:
app.use('/', proxyRoutes);
```

Important: This must be BEFORE `app.use(doubleCsrfProtection)` since the proxy page and status API are public endpoints.

- [ ] **Step 3b: Add rate limiting for proxy endpoints**

In `src/server.js`, in the pre-CSRF section where proxy routes are mounted, add rate limiting for the `/e/:token` and `/api/booking-status/:token` endpoints (30 req/min per IP):

```javascript
import rateLimit from 'express-rate-limit';

const proxyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

app.use('/e', proxyRateLimit);
app.use('/api/booking-status', proxyRateLimit);
```

Note: `express-rate-limit` is already in `package.json` (currently disabled globally but available). This enables it specifically for proxy endpoints.

- [ ] **Step 4: Create proxy page EJS template**

Create `src/views/proxy/page.ejs`:

```ejs
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= title %> - DataPatch</title>
  <link rel="stylesheet" href="/public/styles.css">
  <style>
    .proxy-container { max-width: 420px; margin: 0 auto; padding: 16px; min-height: 100vh; }
    .proxy-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border-primary, #e2e8f0); margin-bottom: 24px; }
    .proxy-logo { height: 32px; }
    .countdown-box { background: var(--bg-secondary, #f1f5f9); border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .countdown-value { font-size: 2rem; font-weight: 700; color: var(--brand-primary, #4f46e5); }
    .countdown-label { font-size: 0.875rem; color: var(--text-secondary, #64748b); }
    .install-btn { display: block; width: 100%; padding: 16px; background: var(--brand-primary, #4f46e5); color: white; border: none; border-radius: 12px; font-size: 1.125rem; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; }
    .install-btn:hover { opacity: 0.9; }
    .qr-container { background: white; border-radius: 12px; padding: 20px; text-align: center; margin: 16px 0; border: 1px solid var(--border-primary, #e2e8f0); }
    .qr-container img { max-width: 200px; margin: 0 auto; }
    .manual-details { background: var(--bg-secondary, #f1f5f9); border-radius: 8px; padding: 12px; font-family: monospace; font-size: 0.8rem; word-break: break-all; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-pending { background: #fef3c7; color: #92400e; }
    .badge-ready { background: #d1fae5; color: #065f46; }
    .badge-installed { background: #dbeafe; color: #1e40af; }
    .badge-error { background: #fee2e2; color: #991b1b; }
    .warning-box { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 12px; margin: 16px 0; font-size: 0.875rem; }
    .info-section { margin: 16px 0; padding: 16px 0; border-top: 1px solid var(--border-primary, #e2e8f0); }
  </style>
</head>
<body style="background: var(--bg-primary, #fff);">
  <div class="proxy-container">
    <!-- Header with agency branding -->
    <div class="proxy-header">
      <% if (agency && agency.logoUrl) { %>
        <img src="<%= agency.logoUrl %>" alt="<%= agency.name %>" class="proxy-logo">
      <% } else if (agency) { %>
        <span style="font-weight: 600;"><%= agency.name %></span>
      <% } else { %>
        <span style="font-weight: 600;">DataPatch</span>
      <% } %>
      <span style="font-size: 0.75rem; color: var(--text-secondary);">Powered by DataPatch</span>
    </div>

    <% if (state === 'not_found') { %>
      <!-- NOT FOUND -->
      <div style="text-align: center; padding: 40px 0;">
        <h2 style="margin-bottom: 8px;">Gecersiz Link</h2>
        <p style="color: var(--text-secondary);">Bu link gecersiz veya suresi dolmus olabilir.</p>
      </div>

    <% } else if (state === 'pending_provisioning') { %>
      <!-- PENDING — countdown -->
      <div style="text-align: center;">
        <h2 style="margin-bottom: 4px;">eSIM Hazirlaniyor</h2>
        <% if (package) { %>
          <p style="color: var(--text-secondary); margin-bottom: 0;"><%= package.title %></p>
          <p style="color: var(--text-secondary); font-size: 0.875rem;"><%= package.data %>, <%= package.day %> gun</p>
        <% } %>
      </div>

      <div class="countdown-box" id="countdown-box">
        <div class="countdown-value" id="countdown-value">--</div>
        <div class="countdown-label">kalan sure</div>
      </div>

      <p style="text-align: center; color: var(--text-secondary); font-size: 0.875rem;">
        eSIM'in <strong><%= new Date(booking.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) %></strong>
        tarihinde otomatik olarak hazirlanacak.
      </p>
      <p style="text-align: center; color: var(--text-secondary); font-size: 0.875rem;">
        Hazir oldugunda e-posta ile bilgilendirileceksin. Bu sayfa da otomatik guncellenecek.
      </p>

      <script>
        (function() {
          var dueDate = new Date('<%= new Date(booking.dueDate).toISOString() %>');
          function update() {
            var now = new Date();
            var diff = dueDate - now;
            if (diff <= 0) { document.getElementById('countdown-value').textContent = 'Hazir!'; return; }
            var days = Math.floor(diff / 86400000);
            var hours = Math.floor((diff % 86400000) / 3600000);
            var mins = Math.floor((diff % 3600000) / 60000);
            var parts = [];
            if (days > 0) parts.push(days + ' gun');
            if (hours > 0) parts.push(hours + ' saat');
            parts.push(mins + ' dk');
            document.getElementById('countdown-value').textContent = parts.join(' ');
          }
          update();
          setInterval(update, 60000);

          // Silent status check every 30s
          setInterval(function() {
            fetch('/api/booking-status/<%= booking.token || '' %>')
              .then(function(r) { return r.json(); })
              .then(function(d) { if (d.status !== 'pending_provisioning') location.reload(); })
              .catch(function() {});
          }, 30000);
        })();
      </script>

    <% } else if (state === 'provisioned') { %>
      <!-- READY — install -->
      <div style="text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 8px;">&#10003;</div>
        <h2 style="margin-bottom: 4px; color: #065f46;">eSIM'in Hazir!</h2>
        <% if (package) { %>
          <p style="color: var(--text-secondary);"><%= package.title %> — <%= package.data %>, <%= package.day %> gun</p>
        <% } %>
      </div>

      <div style="margin: 24px 0;">
        <% if (esim && esim.lpa) { %>
          <a href="<%= esim.lpa %>" class="install-btn">eSIM'i Simdi Kur</a>
        <% } %>
      </div>

      <% if (esim && esim.qrcodeUrl) { %>
        <p style="text-align: center; color: var(--text-secondary); font-size: 0.875rem;">veya QR ile manuel kur:</p>
        <div class="qr-container">
          <img src="<%= esim.qrcodeUrl %>" alt="eSIM QR Code">
        </div>
      <% } %>

      <% if (esim) { %>
        <details class="info-section">
          <summary style="cursor: pointer; font-weight: 600; font-size: 0.875rem;">Manuel kurulum detaylari</summary>
          <div class="manual-details" style="margin-top: 8px;">
            <p><strong>SM-DP+:</strong> <%= esim.smdpAddress %></p>
            <% if (esim.matchingId) { %><p><strong>Matching ID:</strong> <%= esim.matchingId %></p><% } %>
            <% if (esim.iccid) { %><p><strong>ICCID:</strong> <%= esim.iccid %></p><% } %>
          </div>
        </details>
      <% } %>

      <div class="warning-box">
        <strong>Onemli:</strong> eSIM, hazir olduktan sonra 30 gun icinde kurulmalidir. Bu sure doldugunda eSIM gecersiz olur.
      </div>

    <% } else if (state === 'installed') { %>
      <!-- INSTALLED -->
      <div style="text-align: center; padding: 24px 0;">
        <div style="font-size: 2rem; margin-bottom: 8px;">&#127758;</div>
        <h2 style="margin-bottom: 8px;">eSIM Kuruldu!</h2>
        <p style="color: var(--text-secondary);">Iyi yolculuklar! Hedefinize vardiginda otomatik olarak baglanti saglanacaktir.</p>
      </div>

      <div class="info-section">
        <h3 style="font-size: 0.875rem; font-weight: 600; margin-bottom: 8px;">Baglanti sorunu yasarsaniz:</h3>
        <ul style="font-size: 0.875rem; color: var(--text-secondary); padding-left: 16px;">
          <li>Ayarlar > Hucresel > eSIM'in acik oldugundan emin olun</li>
          <li>Veri dolasimi (Data Roaming) acik olmalidir</li>
          <li>Cihazi yeniden baslatmayi deneyin</li>
        </ul>
      </div>

    <% } else { %>
      <!-- CANCELLED / FAILED / EXPIRED -->
      <div style="text-align: center; padding: 24px 0;">
        <h2 style="margin-bottom: 8px;">
          <% if (state === 'cancelled') { %>Rezervasyon Iptal Edildi
          <% } else if (state === 'failed') { %>Bir Sorun Olustu
          <% } else { %>eSIM Suresi Doldu<% } %>
        </h2>
        <p style="color: var(--text-secondary);">
          <% if (state === 'cancelled') { %>Bu eSIM rezervasyonu iptal edilmistir.
          <% } else if (state === 'failed') { %>eSIM hazirlama islemi basarisiz oldu. Lutfen acente ile iletisime gecin.
          <% } else { %>Bu eSIM'in kurulum suresi dolmustur.<% } %>
        </p>
      </div>

      <% if (agency) { %>
        <div class="info-section" style="text-align: center;">
          <p style="font-size: 0.875rem; color: var(--text-secondary);">Destek icin:</p>
          <% if (agency.phone) { %><p><strong><%= agency.phone %></strong></p><% } %>
          <% if (agency.contactEmail) { %><p><a href="mailto:<%= agency.contactEmail %>"><%= agency.contactEmail %></a></p><% } %>
        </div>
      <% } %>
    <% } %>
  </div>
</body>
</html>
```

- [ ] **Step 5: Verify proxy page renders**

```bash
docker compose restart app
# Then open http://localhost:3000/e/test-token-that-does-not-exist
```

Expected: Shows "Gecersiz Link" page (404 state).

- [ ] **Step 6: Commit**

```bash
git add src/controllers/proxyController.js src/routes/proxy.js src/views/proxy/page.ejs src/server.js
git commit -m "feat: add traveler proxy page with 4 states — pending, provisioned, installed, error"
```

---

## Task 11: Admin Agency + Contract Management

**Files:**
- Modify: `src/controllers/adminController.js`
- Modify: `src/routes/admin.js`
- Create: `src/views/admin/agencies.ejs`
- Create: `src/views/admin/agency-detail.ejs`
- Create: `src/views/admin/webhook-logs.ejs`

- [ ] **Step 1: Add admin controller handlers for agencies**

Add these functions to the bottom of `src/controllers/adminController.js`:

```javascript
// --- Agency Management ---

export async function listAgencies(req, res) {
  const agencies = await db.Agency.findAll({
    order: [['createdAt', 'DESC']],
    include: [
      { model: db.AgencyContract, attributes: ['id', 'quantity', 'usedQuantity', 'status'] }
    ]
  });

  res.render('admin/agencies', {
    title: 'Acenteler',
    user: req.session.user,
    agencies
  });
}

export async function showAgencyDetail(req, res) {
  const agency = await db.Agency.findByPk(req.params.id, {
    include: [
      {
        model: db.AgencyContract,
        include: [{ model: db.AiraloPackage, as: 'package' }]
      },
      { model: db.User, as: 'users', attributes: ['id', 'username', 'email', 'agencyRole', 'isActive'] }
    ]
  });

  if (!agency) {
    return res.status(404).render('error', { title: 'Hata', user: req.session.user, message: 'Acente bulunamadi.' });
  }

  const bookingStats = await db.TravelerBooking.count({
    where: { agencyId: agency.id },
    group: ['status']
  });

  res.render('admin/agency-detail', {
    title: agency.name,
    user: req.session.user,
    agency,
    bookingStats
  });
}

export async function createAgency(req, res) {
  const { name, slug, contactEmail, contactName, phone } = req.body;

  try {
    const agency = await db.Agency.create({
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, ''),
      contactEmail,
      contactName,
      phone: phone || null,
      status: 'active'
    });

    await logAudit(ACTIONS.AGENCY_CREATE, {
      userId: req.session.user.id,
      entity: 'Agency',
      entityId: agency.id,
      details: { name, slug },
      ipAddress: getIp(req)
    });

    res.redirect(`/admin/agencies/${agency.id}`);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.render('error', { title: 'Hata', user: req.session.user, message: 'Bu slug zaten kullanilmakta.' });
    }
    log.error({ err }, 'createAgency failed');
    res.render('error', { title: 'Hata', user: req.session.user, message: 'Acente olusturulamadi.' });
  }
}

export async function createContract(req, res) {
  const agencyId = Number(req.params.id);
  const { airaloPackageId, quantity, unitPriceAmount, unitPriceCurrency, contractEndAt } = req.body;

  const agency = await db.Agency.findByPk(agencyId);
  if (!agency) {
    return res.status(404).render('error', { title: 'Hata', user: req.session.user, message: 'Acente bulunamadi.' });
  }

  const pkg = await db.AiraloPackage.findByPk(airaloPackageId);
  if (!pkg) {
    return res.status(400).render('error', { title: 'Hata', user: req.session.user, message: 'Paket bulunamadi.' });
  }

  const contract = await db.AgencyContract.create({
    agencyId,
    airaloPackageId: Number(airaloPackageId),
    quantity: Number(quantity),
    usedQuantity: 0,
    unitPriceAmount: Number(unitPriceAmount),
    unitPriceCurrency: unitPriceCurrency || 'USD',
    contractEndAt: new Date(contractEndAt),
    status: 'active'
  });

  await logAudit(ACTIONS.CONTRACT_CREATE, {
    userId: req.session.user.id,
    entity: 'AgencyContract',
    entityId: contract.id,
    details: { agencyId, packageId: pkg.packageId, quantity },
    ipAddress: getIp(req)
  });

  res.redirect(`/admin/agencies/${agencyId}`);
}

export async function listWebhookLogs(req, res) {
  const { status, page = 1 } = req.query;
  const limit = 50;
  const offset = (page - 1) * limit;

  const where = {};
  if (status && status !== 'all') {
    where.processStatus = status;
  }

  const { count, rows: logs } = await db.AiraloWebhookLog.findAndCountAll({
    where,
    include: [{ model: db.TravelerBooking, as: 'booking', attributes: ['id', 'travelerName', 'token'] }],
    order: [['receivedAt', 'DESC']],
    limit,
    offset
  });

  res.render('admin/webhook-logs', {
    title: 'Webhook Logs',
    user: req.session.user,
    logs,
    total: count,
    page: Number(page),
    totalPages: Math.ceil(count / limit),
    filter: status || 'all'
  });
}

export async function retryWebhook(req, res) {
  const { processWebhook } = await import('../controllers/webhookController.js');
  const webhookLog = await db.AiraloWebhookLog.findByPk(req.params.id);

  if (!webhookLog || webhookLog.processStatus === 'success') {
    return res.redirect('/admin/webhook-logs');
  }

  try {
    await webhookLog.update({ processStatus: 'retrying', retryCount: webhookLog.retryCount + 1 });
    await processWebhook(webhookLog);
    await logAudit(ACTIONS.WEBHOOK_RETRIED, {
      userId: req.session.user.id,
      entity: 'AiraloWebhookLog',
      entityId: webhookLog.id,
      ipAddress: getIp(req)
    });
  } catch (err) {
    log.error({ err, webhookLogId: webhookLog.id }, 'Manual webhook retry failed');
  }

  res.redirect('/admin/webhook-logs');
}
```

Make sure to import the needed modules at the top of `adminController.js` if not already present:

```javascript
import { logAudit, ACTIONS, getIp } from '../services/auditService.js';
```

- [ ] **Step 2: Add admin routes for agencies, contracts, webhooks**

In `src/routes/admin.js`, add imports and routes:

```javascript
import {
  listAgencies,
  showAgencyDetail,
  createAgency,
  createContract,
  listWebhookLogs,
  retryWebhook
} from '../controllers/adminController.js';
```

Add routes (within the existing router, after existing admin routes):

```javascript
// Agency management
router.get('/agencies', ensureAuth, ensureAdmin, listAgencies);
router.post('/agencies', ensureAuth, ensureAdmin, createAgency);
router.get('/agencies/:id', ensureAuth, ensureAdmin, showAgencyDetail);
router.post('/agencies/:id/contracts', ensureAuth, ensureAdmin, createContract);

// Webhook logs
router.get('/webhook-logs', ensureAuth, ensureAdmin, listWebhookLogs);
router.post('/webhook-logs/:id/retry', ensureAuth, ensureAdmin, retryWebhook);
```

- [ ] **Step 3: Create admin agencies view**

Create `src/views/admin/agencies.ejs` with the standard admin layout pattern:

```ejs
<%- include('../partials/header', {title: 'Acenteler', user: locals.user}) %>

<div class="mb-6 flex items-center justify-between">
  <h1 class="text-page-title">Acenteler</h1>
  <button onclick="document.getElementById('newAgencyModal').showModal()" class="btn btn-primary">
    <i data-lucide="plus" class="w-4 h-4"></i> Yeni Acente
  </button>
</div>

<div class="card overflow-hidden">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-[var(--border-primary)]">
        <th class="text-left p-3">Acente</th>
        <th class="text-left p-3">Slug</th>
        <th class="text-center p-3">Kontrat</th>
        <th class="text-center p-3">Durum</th>
        <th class="text-right p-3"></th>
      </tr>
    </thead>
    <tbody>
      <% agencies.forEach(a => { %>
        <tr class="border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]">
          <td class="p-3 font-medium"><%= a.name %></td>
          <td class="p-3 text-[var(--text-secondary)]"><%= a.slug %></td>
          <td class="p-3 text-center"><%= a.AgencyContracts ? a.AgencyContracts.length : 0 %></td>
          <td class="p-3 text-center">
            <span class="badge <%= a.status === 'active' ? 'badge-success' : 'badge-warning' %>">
              <%= a.status %>
            </span>
          </td>
          <td class="p-3 text-right">
            <a href="/admin/agencies/<%= a.id %>" class="text-[var(--brand-primary)] hover:underline">Detay</a>
          </td>
        </tr>
      <% }) %>
    </tbody>
  </table>
</div>

<!-- New Agency Modal -->
<dialog id="newAgencyModal" class="rounded-xl p-6 w-full max-w-md shadow-xl backdrop:bg-black/50">
  <form method="post" action="/admin/agencies">
    <input type="hidden" name="_csrf" value="<%= typeof csrfToken !== 'undefined' ? csrfToken : '' %>">
    <h2 class="text-lg font-semibold mb-4">Yeni Acente</h2>
    <div class="space-y-3">
      <div>
        <label class="block text-sm font-medium mb-1">Acente Adi *</label>
        <input name="name" required class="input w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Slug *</label>
        <input name="slug" required class="input w-full" placeholder="bodrum-tatil">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Yetkili Adi *</label>
        <input name="contactName" required class="input w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">E-posta *</label>
        <input name="contactEmail" type="email" required class="input w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Telefon</label>
        <input name="phone" class="input w-full">
      </div>
    </div>
    <div class="flex justify-end gap-2 mt-6">
      <button type="button" onclick="this.closest('dialog').close()" class="btn">Iptal</button>
      <button type="submit" class="btn btn-primary">Olustur</button>
    </div>
  </form>
</dialog>

<%- include('../partials/footer') %>
```

- [ ] **Step 4: Create admin agency detail view and webhook logs view**

Create `src/views/admin/agency-detail.ejs` and `src/views/admin/webhook-logs.ejs` following the same admin layout pattern. These are standard CRUD views — agency detail shows contracts + a "new contract" form, webhook logs shows a filterable table with a retry button for failed entries.

(These views follow the identical pattern as `agencies.ejs` above: header include, card layout, table, form modal. Adapt the column names to match the data passed from the controller.)

- [ ] **Step 5: Commit**

```bash
git add src/controllers/adminController.js src/routes/admin.js \
        src/views/admin/agencies.ejs src/views/admin/agency-detail.ejs \
        src/views/admin/webhook-logs.ejs
git commit -m "feat: add admin agency management, contract CRUD, and webhook log viewer"
```

---

## Task 12: Agency Views (Dashboard, Bookings, Contracts)

**Files:**
- Create: `src/views/agency/dashboard.ejs`
- Create: `src/views/agency/bookings.ejs`
- Create: `src/views/agency/booking-new.ejs`
- Create: `src/views/agency/booking-detail.ejs`
- Create: `src/views/agency/contracts.ejs`

- [ ] **Step 1: Create agency dashboard view**

Create `src/views/agency/dashboard.ejs`:

```ejs
<%- include('../partials/header', {title: 'Dashboard', user: locals.user}) %>

<div class="mb-8">
  <h1 class="text-page-title">Dashboard</h1>
</div>

<!-- Stat Cards -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
  <div class="stat-card">
    <div class="stat-content">
      <p class="stat-label">Toplam Kontrat</p>
      <p class="stat-value"><%= totalContracts %></p>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-content">
      <p class="stat-label">Bu Hafta Rez.</p>
      <p class="stat-value"><%= thisWeekBookings %></p>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-content">
      <p class="stat-label">Yaklasan</p>
      <p class="stat-value"><%= upcomingBookings.length %></p>
    </div>
  </div>
  <div class="stat-card">
    <div class="stat-content">
      <p class="stat-label">Aktif Kontrat</p>
      <p class="stat-value"><%= contractStats.length %></p>
    </div>
  </div>
</div>

<!-- Active Contracts -->
<div class="card mb-8">
  <div class="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
    <h2 class="font-semibold">Aktif Kontratlar</h2>
    <a href="/agency/contracts" class="text-sm text-[var(--brand-primary)]">Hepsi &rarr;</a>
  </div>
  <% contractStats.forEach(c => { %>
    <div class="flex items-center justify-between p-4 border-b border-[var(--border-primary)] last:border-0">
      <div>
        <p class="font-medium"><%= c.package ? c.package.title : 'Paket' %></p>
        <p class="text-sm text-[var(--text-secondary)]"><%= c.usedQuantity %> / <%= c.quantity %> kullanildi</p>
      </div>
      <div class="w-24 h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
        <div class="h-full bg-[var(--brand-primary)] rounded-full" style="width: <%= Math.round((c.usedQuantity / c.quantity) * 100) %>%"></div>
      </div>
    </div>
  <% }) %>
  <% if (contractStats.length === 0) { %>
    <p class="p-4 text-[var(--text-secondary)] text-sm">Henuz aktif kontrat yok.</p>
  <% } %>
</div>

<!-- Upcoming Activations -->
<div class="card">
  <div class="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
    <h2 class="font-semibold">Yaklasan Aktivasyonlar (7 gun)</h2>
    <a href="/agency/bookings?status=pending_provisioning" class="text-sm text-[var(--brand-primary)]">Hepsi &rarr;</a>
  </div>
  <% upcomingBookings.forEach(b => { %>
    <a href="/agency/bookings/<%= b.id %>" class="flex items-center justify-between p-4 border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-secondary)]">
      <div>
        <p class="font-medium"><%= b.travelerName %></p>
        <p class="text-sm text-[var(--text-secondary)]"><%= new Date(b.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) %></p>
      </div>
      <i data-lucide="chevron-right" class="w-4 h-4 text-[var(--text-secondary)]"></i>
    </a>
  <% }) %>
  <% if (upcomingBookings.length === 0) { %>
    <p class="p-4 text-[var(--text-secondary)] text-sm">Onumuzdeki 7 gun icinde aktivasyon yok.</p>
  <% } %>
</div>

<%- include('../partials/footer') %>
```

- [ ] **Step 2: Create bookings list view**

Create `src/views/agency/bookings.ejs`:

```ejs
<%- include('../partials/header', {title: 'Rezervasyonlar', user: locals.user}) %>

<div class="mb-6 flex items-center justify-between">
  <h1 class="text-page-title">Rezervasyonlar</h1>
  <a href="/agency/bookings/new" class="btn btn-primary">
    <i data-lucide="plus" class="w-4 h-4"></i> Yeni
  </a>
</div>

<!-- Filters -->
<div class="flex gap-2 mb-4 flex-wrap">
  <% ['all', 'pending_provisioning', 'provisioned', 'installed', 'cancelled'].forEach(s => { %>
    <a href="/agency/bookings?status=<%= s %>&search=<%= filters.search %>"
       class="badge <%= filters.status === s ? 'bg-[var(--brand-primary)] text-white' : '' %>">
      <%= s === 'all' ? 'Hepsi' : s.replace('_', ' ') %>
    </a>
  <% }) %>
</div>

<!-- Search -->
<form method="get" action="/agency/bookings" class="mb-4">
  <input type="hidden" name="status" value="<%= filters.status %>">
  <div class="flex gap-2">
    <input name="search" value="<%= filters.search %>" placeholder="Isim, e-posta veya ref. ara..." class="input flex-1">
    <button type="submit" class="btn btn-primary">Ara</button>
  </div>
</form>

<!-- Table -->
<div class="card overflow-x-auto">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-[var(--border-primary)]">
        <th class="text-left p-3">Gezgin</th>
        <th class="text-left p-3 hidden sm:table-cell">Paket</th>
        <th class="text-left p-3">Tarih</th>
        <th class="text-center p-3">Durum</th>
        <th class="text-right p-3"></th>
      </tr>
    </thead>
    <tbody>
      <% bookings.forEach(b => { %>
        <tr class="border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]">
          <td class="p-3">
            <p class="font-medium"><%= b.travelerName %></p>
            <% if (b.agencyBookingRef) { %><p class="text-xs text-[var(--text-secondary)]"><%= b.agencyBookingRef %></p><% } %>
          </td>
          <td class="p-3 hidden sm:table-cell text-[var(--text-secondary)]"><%= b.contract && b.contract.package ? b.contract.package.title : '-' %></td>
          <td class="p-3"><%= new Date(b.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) %></td>
          <td class="p-3 text-center">
            <span class="badge
              <%= b.status === 'provisioned' ? 'badge-success' : '' %>
              <%= b.status === 'pending_provisioning' ? 'badge-warning' : '' %>
              <%= b.status === 'installed' ? 'badge-info' : '' %>
              <%= ['cancelled', 'failed', 'expired'].includes(b.status) ? 'badge-danger' : '' %>
            "><%= b.status %></span>
          </td>
          <td class="p-3 text-right">
            <a href="/agency/bookings/<%= b.id %>" class="text-[var(--brand-primary)]">Detay</a>
          </td>
        </tr>
      <% }) %>
    </tbody>
  </table>
</div>

<!-- Pagination -->
<% if (totalPages > 1) { %>
  <div class="flex justify-center gap-2 mt-4">
    <% for (let p = 1; p <= totalPages; p++) { %>
      <a href="/agency/bookings?page=<%= p %>&status=<%= filters.status %>&search=<%= filters.search %>"
         class="btn btn-sm <%= p === page ? 'btn-primary' : '' %>"><%= p %></a>
    <% } %>
  </div>
<% } %>

<%- include('../partials/footer') %>
```

- [ ] **Step 3: Create new booking form view**

Create `src/views/agency/booking-new.ejs`:

```ejs
<%- include('../partials/header', {title: 'Yeni Rezervasyon', user: locals.user}) %>

<div class="max-w-lg mx-auto">
  <h1 class="text-page-title mb-6">Yeni Rezervasyon</h1>

  <% if (error) { %>
    <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4"><%= error %></div>
  <% } %>

  <form method="post" action="/agency/bookings" class="card p-6 space-y-4">
    <input type="hidden" name="_csrf" value="<%= typeof csrfToken !== 'undefined' ? csrfToken : '' %>">

    <div>
      <label class="block text-sm font-medium mb-1">Kontrat / Paket *</label>
      <select name="contractId" required class="input w-full">
        <option value="">Secin...</option>
        <% contracts.forEach(c => { %>
          <option value="<%= c.id %>">
            <%= c.package ? c.package.title : 'Paket #' + c.airaloPackageId %>
            (<%= c.quantity - c.usedQuantity %> adet kaldi)
          </option>
        <% }) %>
      </select>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium mb-1">Gezgin Adi *</label>
        <input name="travelerName" required class="input w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Rez. Referansi</label>
        <input name="agencyBookingRef" class="input w-full" placeholder="PNR-12345">
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium mb-1">E-posta</label>
        <input name="travelerEmail" type="email" class="input w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Telefon</label>
        <input name="travelerPhone" class="input w-full">
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium mb-1">Seyahat Tarihi (UTC) *</label>
      <input name="dueDate" type="datetime-local" required class="input w-full">
      <p class="text-xs text-[var(--text-secondary)] mt-1">
        Gezgin bu tarihten itibaren 30 gun icinde eSIM'i kurmalidir.
        Ucustan 1-2 gun oncesini ayarlamaniz onerilir.
      </p>
    </div>

    <div class="flex justify-end gap-2 pt-4">
      <a href="/agency/bookings" class="btn">Iptal</a>
      <button type="submit" class="btn btn-primary">Rezervasyon Olustur</button>
    </div>
  </form>
</div>

<%- include('../partials/footer') %>
```

- [ ] **Step 4: Create booking detail view**

Create `src/views/agency/booking-detail.ejs`:

```ejs
<%- include('../partials/header', {title: title, user: locals.user}) %>

<div class="max-w-2xl mx-auto">
  <% if (typeof created !== 'undefined' && created) { %>
    <div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
      Rezervasyon basariyla olusturuldu!
    </div>
  <% } %>

  <div class="flex items-center justify-between mb-6">
    <h1 class="text-page-title">Rezervasyon #<%= booking.id %></h1>
    <span class="badge
      <%= booking.status === 'provisioned' ? 'badge-success' : '' %>
      <%= booking.status === 'pending_provisioning' ? 'badge-warning' : '' %>
      <%= booking.status === 'installed' ? 'badge-info' : '' %>
      <%= ['cancelled', 'failed', 'expired'].includes(booking.status) ? 'badge-danger' : '' %>
    "><%= booking.status %></span>
  </div>

  <!-- Info Card -->
  <div class="card p-6 mb-4 space-y-3">
    <div class="grid grid-cols-2 gap-4">
      <div>
        <p class="text-sm text-[var(--text-secondary)]">Gezgin</p>
        <p class="font-medium"><%= booking.travelerName %></p>
      </div>
      <div>
        <p class="text-sm text-[var(--text-secondary)]">Paket</p>
        <p class="font-medium"><%= booking.contract && booking.contract.package ? booking.contract.package.title : '-' %></p>
      </div>
      <div>
        <p class="text-sm text-[var(--text-secondary)]">Seyahat Tarihi</p>
        <p class="font-medium"><%= new Date(booking.dueDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) %></p>
      </div>
      <div>
        <p class="text-sm text-[var(--text-secondary)]">Olusturulma</p>
        <p class="font-medium"><%= new Date(booking.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) %></p>
      </div>
    </div>

    <% if (booking.travelerEmail) { %>
      <div><p class="text-sm text-[var(--text-secondary)]">E-posta: <span class="text-[var(--text-primary)]"><%= booking.travelerEmail %></span></p></div>
    <% } %>
    <% if (booking.agencyBookingRef) { %>
      <div><p class="text-sm text-[var(--text-secondary)]">Ref: <span class="text-[var(--text-primary)]"><%= booking.agencyBookingRef %></span></p></div>
    <% } %>
    <% if (booking.changeCount > 0) { %>
      <div><p class="text-sm text-amber-600">Tarih <%= booking.changeCount %> kez degistirildi (Orijinal: <%= new Date(booking.originalDueDate).toLocaleDateString('tr-TR') %>)</p></div>
    <% } %>
  </div>

  <!-- Token URL -->
  <div class="card p-6 mb-4">
    <p class="text-sm text-[var(--text-secondary)] mb-2">Gezgin Linki</p>
    <div class="flex items-center gap-2">
      <input id="tokenUrl" readonly value="<%= tokenUrl %>" class="input flex-1 text-sm font-mono">
      <button onclick="navigator.clipboard.writeText(document.getElementById('tokenUrl').value)" class="btn btn-sm">Kopyala</button>
    </div>
  </div>

  <!-- Actions -->
  <% if (canChangeDate || canCancel) { %>
    <div class="flex gap-2 mb-4">
      <% if (canChangeDate) { %>
        <button onclick="document.getElementById('changeDateModal').showModal()" class="btn">Tarihi Degistir</button>
      <% } %>
      <% if (canCancel) { %>
        <button onclick="document.getElementById('cancelModal').showModal()" class="btn text-red-600">Iptal Et</button>
      <% } %>
    </div>
  <% } %>

  <!-- Change Date Modal -->
  <dialog id="changeDateModal" class="rounded-xl p-6 w-full max-w-sm shadow-xl backdrop:bg-black/50">
    <form method="post" action="/agency/bookings/<%= booking.id %>/change-date">
      <input type="hidden" name="_csrf" value="<%= typeof csrfToken !== 'undefined' ? csrfToken : '' %>">
      <h3 class="font-semibold mb-4">Tarih Degistir</h3>
      <input name="dueDate" type="datetime-local" required class="input w-full mb-4">
      <p class="text-xs text-[var(--text-secondary)] mb-4">72 saat kurali gecerlidir. Due date'e 72 saatten az kaldiysa degisiklik yapilamaz.</p>
      <div class="flex justify-end gap-2">
        <button type="button" onclick="this.closest('dialog').close()" class="btn">Iptal</button>
        <button type="submit" class="btn btn-primary">Degistir</button>
      </div>
    </form>
  </dialog>

  <!-- Cancel Modal -->
  <dialog id="cancelModal" class="rounded-xl p-6 w-full max-w-sm shadow-xl backdrop:bg-black/50">
    <form method="post" action="/agency/bookings/<%= booking.id %>/cancel">
      <input type="hidden" name="_csrf" value="<%= typeof csrfToken !== 'undefined' ? csrfToken : '' %>">
      <h3 class="font-semibold mb-4">Iptal Et</h3>
      <p class="text-sm text-[var(--text-secondary)] mb-4">Bu islem geri alinamaz. Kontrat havuzuna 1 adet iade edilecektir.</p>
      <textarea name="reason" placeholder="Iptal sebebi (opsiyonel)" class="input w-full mb-4" rows="2"></textarea>
      <div class="flex justify-end gap-2">
        <button type="button" onclick="this.closest('dialog').close()" class="btn">Vazgec</button>
        <button type="submit" class="btn bg-red-600 text-white hover:bg-red-700">Iptal Et</button>
      </div>
    </form>
  </dialog>
</div>

<%- include('../partials/footer') %>
```

- [ ] **Step 5: Create contracts list view**

Create `src/views/agency/contracts.ejs`:

```ejs
<%- include('../partials/header', {title: 'Kontratlar', user: locals.user}) %>

<h1 class="text-page-title mb-6">Kontratlar</h1>

<div class="grid gap-4">
  <% contracts.forEach(c => { %>
    <div class="card p-6">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold"><%= c.package ? c.package.title : 'Paket' %></h3>
        <span class="badge <%= c.status === 'active' ? 'badge-success' : 'badge-warning' %>"><%= c.status %></span>
      </div>
      <div class="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p class="text-[var(--text-secondary)]">Havuz</p>
          <p class="font-medium"><%= c.usedQuantity %> / <%= c.quantity %></p>
        </div>
        <div>
          <p class="text-[var(--text-secondary)]">Birim Fiyat</p>
          <p class="font-medium"><%= c.unitPriceCurrency %> <%= Number(c.unitPriceAmount).toFixed(2) %></p>
        </div>
        <div>
          <p class="text-[var(--text-secondary)]">Bitis</p>
          <p class="font-medium"><%= new Date(c.contractEndAt).toLocaleDateString('tr-TR') %></p>
        </div>
      </div>
      <div class="mt-3 w-full h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
        <div class="h-full bg-[var(--brand-primary)] rounded-full" style="width: <%= Math.round((c.usedQuantity / c.quantity) * 100) %>%"></div>
      </div>
    </div>
  <% }) %>
  <% if (contracts.length === 0) { %>
    <p class="text-[var(--text-secondary)]">Henuz kontrat yok. Yonetici ile iletisime gecin.</p>
  <% } %>
</div>

<%- include('../partials/footer') %>
```

- [ ] **Step 6: Commit**

```bash
git add src/views/agency/
git commit -m "feat: add agency portal views — dashboard, bookings, booking detail, contracts"
```

---

## Task 13: Background Jobs

**Files:**
- Create: `src/jobs/index.js`
- Create: `src/jobs/webhookRetry.js`
- Create: `src/jobs/provisionWatchdog.js`
- Create: `src/jobs/expiryJobs.js`

- [ ] **Step 1: Create webhook retry job**

Create `src/jobs/webhookRetry.js`:

```javascript
import db from '../db/models/index.js';
import { processWebhook } from '../controllers/webhookController.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:webhook-retry' });
const MAX_RETRIES = 3;

export async function run() {
  const failedLogs = await db.AiraloWebhookLog.findAll({
    where: {
      processStatus: 'failed',
      retryCount: { [db.Sequelize.Op.lt]: MAX_RETRIES }
    },
    order: [['receivedAt', 'ASC']],
    limit: 20
  });

  if (failedLogs.length === 0) return;

  log.info({ count: failedLogs.length }, 'Retrying failed webhooks');

  for (const webhookLog of failedLogs) {
    try {
      await webhookLog.update({ processStatus: 'retrying', retryCount: webhookLog.retryCount + 1 });
      await processWebhook(webhookLog);
      log.info({ id: webhookLog.id }, 'Webhook retry succeeded');
    } catch (err) {
      log.error({ err, id: webhookLog.id }, 'Webhook retry failed');
      await webhookLog.update({ processStatus: 'failed', error: err.message }).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: Create provision watchdog job**

Create `src/jobs/provisionWatchdog.js`:

```javascript
import db from '../db/models/index.js';
import { pollOrderStatus } from '../services/futureOrderService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:provision-watchdog' });

export async function run() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const stuckBookings = await db.TravelerBooking.findAll({
    where: {
      status: 'pending_provisioning',
      dueDate: { [db.Sequelize.Op.lt]: twoHoursAgo }
    },
    limit: 20
  });

  if (stuckBookings.length === 0) return;

  log.info({ count: stuckBookings.length }, 'Checking stuck provisioning bookings');

  for (const booking of stuckBookings) {
    if (!booking.airaloRequestId) continue;

    try {
      const status = await pollOrderStatus(booking.airaloRequestId);
      log.info({ bookingId: booking.id, airaloStatus: status?.status }, 'Polled Airalo order status');
    } catch (err) {
      log.error({ err, bookingId: booking.id }, 'Watchdog poll failed');
    }
  }
}
```

- [ ] **Step 3: Create expiry jobs**

Create `src/jobs/expiryJobs.js`:

```javascript
import db from '../db/models/index.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'job:expiry' });

export async function runReminder() {
  const twentyFiveDaysAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const expiringSoon = await db.TravelerBooking.findAll({
    where: {
      status: 'provisioned',
      provisionedAt: {
        [db.Sequelize.Op.between]: [thirtyDaysAgo, twentyFiveDaysAgo]
      }
    },
    include: [{ model: db.Agency }]
  });

  if (expiringSoon.length === 0) return;

  log.info({ count: expiringSoon.length }, 'Sending expiry reminders');

  for (const booking of expiringSoon) {
    if (booking.travelerEmail) {
      const { sendMail } = await import('../services/emailService.js');
      await sendMail(booking.travelerEmail, 'eSIM kurulum suren tukeniyor!',
        `<p>Merhaba ${booking.travelerName},</p>
         <p>eSIM'ini kurman icin <strong>5 gun</strong> kaldi. Su linkten kurabilirsin:</p>
         <p><a href="${process.env.APP_URL || 'https://datapatch.app'}/e/${booking.token}">eSIM'i Kur</a></p>
         <p>30 gun icinde kurulmayan eSIM'ler gecersiz olur.</p>`,
        { type: 'expiry_reminder', userId: null }
      ).catch(err => log.error({ err, bookingId: booking.id }, 'Expiry reminder email failed'));
    }
  }
}

export async function runMarker() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [count] = await db.TravelerBooking.update(
    { status: 'expired' },
    {
      where: {
        status: 'provisioned',
        provisionedAt: { [db.Sequelize.Op.lt]: thirtyDaysAgo }
      }
    }
  );

  if (count > 0) {
    log.info({ count }, 'Marked expired bookings');
  }
}
```

- [ ] **Step 4: Create job scheduler**

Create `src/jobs/index.js`:

```javascript
import cron from 'node-cron';
import logger from '../lib/logger.js';
import { run as webhookRetry } from './webhookRetry.js';
import { run as provisionWatchdog } from './provisionWatchdog.js';
import { runReminder, runMarker } from './expiryJobs.js';

const log = logger.child({ module: 'jobs' });

export function startJobs() {
  log.info('Starting background jobs');

  // Retry failed webhooks every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try { await webhookRetry(); }
    catch (err) { log.error({ err }, 'webhookRetry job error'); }
  });

  // Provision stuck watchdog every hour
  cron.schedule('0 * * * *', async () => {
    try { await provisionWatchdog(); }
    catch (err) { log.error({ err }, 'provisionWatchdog job error'); }
  });

  // Expiry reminder daily at 09:00 UTC
  cron.schedule('0 9 * * *', async () => {
    try { await runReminder(); }
    catch (err) { log.error({ err }, 'expiryReminder job error'); }
  });

  // Expiry marker daily at 00:30 UTC
  cron.schedule('30 0 * * *', async () => {
    try { await runMarker(); }
    catch (err) { log.error({ err }, 'expiryMarker job error'); }
  });

  log.info('Background jobs scheduled');
}
```

- [ ] **Step 5: Wire jobs into server.js**

In `src/server.js`, add import at the top:

```javascript
import { startJobs } from './jobs/index.js';
```

Then in the server startup section (after `app.listen` or after DB sync), call:

```javascript
startJobs();
```

- [ ] **Step 6: Commit**

```bash
git add src/jobs/ src/server.js
git commit -m "feat: add background jobs — webhook retry, provision watchdog, expiry reminder/marker"
```

---

## Task 14: Header Navigation + Agency Sidebar

**Files:**
- Modify: `src/views/partials/header.ejs`

- [ ] **Step 1: Add agency navigation to sidebar**

In `src/views/partials/header.ejs`, find the sidebar navigation section (where links like Dashboard, Users, eSIMs are listed for admin users). Add a new section for agency users. Find the appropriate conditional block and add:

```ejs
<% if (typeof user !== 'undefined' && user && user.agencyId) { %>
  <!-- Agency Navigation -->
  <a href="/agency" class="sidebar-link <%= title === 'Dashboard' ? 'active' : '' %>">
    <i data-lucide="layout-dashboard" class="w-5 h-5"></i>
    <span>Dashboard</span>
  </a>
  <a href="/agency/bookings" class="sidebar-link <%= title === 'Rezervasyonlar' ? 'active' : '' %>">
    <i data-lucide="calendar-check" class="w-5 h-5"></i>
    <span>Rezervasyonlar</span>
  </a>
  <a href="/agency/contracts" class="sidebar-link <%= title === 'Kontratlar' ? 'active' : '' %>">
    <i data-lucide="file-text" class="w-5 h-5"></i>
    <span>Kontratlar</span>
  </a>
<% } %>
```

Also add admin-only links for agency management:

```ejs
<% if (typeof user !== 'undefined' && user && user.isAdmin) { %>
  <!-- ... existing admin links ... -->
  <a href="/admin/agencies" class="sidebar-link <%= title === 'Acenteler' ? 'active' : '' %>">
    <i data-lucide="building-2" class="w-5 h-5"></i>
    <span>Acenteler</span>
  </a>
  <a href="/admin/webhook-logs" class="sidebar-link <%= title === 'Webhook Logs' ? 'active' : '' %>">
    <i data-lucide="webhook" class="w-5 h-5"></i>
    <span>Webhooks</span>
  </a>
<% } %>
```

- [ ] **Step 2: Verify navigation renders**

```bash
docker compose restart app
```

Log in as admin and verify new sidebar links appear.

- [ ] **Step 3: Commit**

```bash
git add src/views/partials/header.ejs
git commit -m "feat: add agency and webhook navigation links to sidebar"
```

---

## Task 15: Final Integration + Verification

**Files:**
- Modify: `src/server.js` (final check)

- [ ] **Step 1: Verify all route mounting in server.js**

Ensure `src/server.js` has these changes (some from earlier tasks):

1. Imports at top:
```javascript
import agencyRoutes from './routes/agency.js';
import proxyRoutes from './routes/proxy.js';
import { handleAiraloWebhook } from './controllers/webhookController.js';
import { startJobs } from './jobs/index.js';
```

2. Pre-CSRF section (before `app.use(doubleCsrfProtection)`):
```javascript
app.post('/api/webhooks/airalo', handleAiraloWebhook);
app.use('/', proxyRoutes);
```

3. Post-CSRF section (with other authenticated routes):
```javascript
app.use('/agency', agencyRoutes);
```

4. After app.listen:
```javascript
startJobs();
```

- [ ] **Step 2: Run all migrations on fresh DB**

```bash
docker compose exec app npx sequelize-cli db:migrate:undo:all
docker compose exec app npx sequelize-cli db:migrate
```

Expected: All migrations (including 7 new ones) run successfully.

- [ ] **Step 3: Restart and verify app starts cleanly**

```bash
docker compose restart app && docker compose logs app --tail=50
```

Expected: No errors, "Background jobs scheduled" message visible.

- [ ] **Step 4: Smoke test key routes**

```bash
# Health check
curl http://localhost:3000/health

# Proxy page (404 expected — no bookings yet)
curl -s http://localhost:3000/e/test-token | head -5

# Webhook endpoint (200 expected — accepts any POST)
curl -X POST http://localhost:3000/api/webhooks/airalo -H "Content-Type: application/json" -d '{"type":"test"}' -s
```

- [ ] **Step 5: Commit final integration**

```bash
git add src/server.js
git commit -m "feat: complete B2B eSIM integration — all routes mounted, jobs started"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Dependencies (node-cron, nanoid) | package.json |
| 2 | Migrations: agencies, contracts, users | 3 migration files |
| 3 | Migrations: bookings, esims, webhooks, invoices | 4 migration files |
| 4 | All Sequelize models + user/esim updates | 8 model files |
| 5 | Token service + Airalo FutureOrder wrappers | 3 service files |
| 6 | Agency auth middleware | 2 files |
| 7 | Audit actions + booking service | 2 service files |
| 8 | Webhook controller + processing | 1 controller + server.js |
| 9 | Agency controller + routes | 2 files + server.js |
| 10 | Proxy page (traveler-facing, 4 states) | 3 files + server.js |
| 11 | Admin agency/contract/webhook management | 2 files + 3 views |
| 12 | Agency portal views | 5 EJS templates |
| 13 | Background jobs (4 jobs + scheduler) | 5 files + server.js |
| 14 | Header navigation updates | 1 view file |
| 15 | Final integration + verification | server.js |

**Deferred to V2 (per spec):**
- REST API key authentication middleware (AgencyApiKey table exists, auth middleware is V2)
- Outbound webhook to agency systems
- SMS notifications
- i18n system for traveler proxy page (TR + EN) — page structure supports it, translation framework deferred

**Total new files:** ~35
**Total modified files:** ~8
**Estimated PRs:** 15 (one per task)
