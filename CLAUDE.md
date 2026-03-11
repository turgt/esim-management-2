# DataPatch - Project Guide

## Quick Start

```bash
# Full build & run (Docker required)
docker compose up --build -d

# Quick restart after code changes (src/ and public/ are volume-mounted)
docker compose restart app

# Rebuild CSS only
npm run css:build

# Local dev without Docker (requires PostgreSQL)
npm run dev
```

App runs at **http://localhost:3000**. Default admin: `admin` / `test123`.

## Tech Stack

- **Backend**: Express.js (ES Modules), Node 20
- **Views**: EJS templates (src/views/)
- **Database**: PostgreSQL 16 + Sequelize ORM
- **CSS**: Tailwind CSS v4.2.1 (src/input.css → public/styles.css)
- **Auth**: Session-based (express-session + connect-pg-simple)
- **Icons**: Lucide (loaded via CDN)
- **API**: Zendit API for eSIM purchases
- **Deploy**: Docker Compose (app + postgres:16-alpine)

## Project Structure

```
src/
├── server.js              # Express app entry point
├── input.css              # Tailwind + custom CSS (design tokens, components)
├── lib/logger.js          # Pino logger
├── controllers/           # Route handlers
│   ├── authController.js
│   ├── esimController.js
│   ├── adminController.js
│   └── profileController.js
├── routes/                # Express routers
│   ├── auth.js
│   ├── esim.js
│   ├── admin.js
│   ├── profile.js
│   └── payment.js
├── services/              # Business logic
│   ├── zenditClient.js    # Zendit API wrapper
│   ├── cacheService.js    # node-cache wrapper
│   ├── emailService.js    # Nodemailer
│   ├── paymentService.js
│   └── auditService.js
├── middleware/             # Express middleware
│   ├── auth.js            # isAuthenticated, isAdmin
│   ├── performance.js     # Response time headers
│   ├── validation.js      # express-validator rules
│   └── csrf.js            # CSRF protection
├── db/
│   ├── models/            # Sequelize models (User, Esim, Payment, AuditLog)
│   ├── migrations/        # .cjs files (CommonJS for sequelize-cli)
│   └── config.json        # DB connection config
└── views/
    ├── partials/           # header.ejs (layout), footer.ejs, pagination.ejs
    ├── login.ejs, register.ejs, forgot-password.ejs, reset-password.ejs
    ├── offers.ejs, purchases.ejs, status.ejs, qrcode.ejs, profile.ejs
    ├── error.ejs, verify-email.ejs
    └── admin/              # dashboard, users, esims, esim-detail, assign-esim, topup
public/
├── styles.css             # Compiled CSS (don't edit - generated from input.css)
├── sw.js                  # Service worker
└── offline.html           # Offline fallback
```

## Key Conventions

### ES Modules
Project uses `"type": "module"`. Use `import/export`, not `require()`. Database migrations use `.cjs` extension for CommonJS compatibility with sequelize-cli.

### CSS & Styling
- Edit `src/input.css`, never `public/styles.css` (it's generated)
- Run `npm run css:build` after CSS changes
- Design tokens are CSS custom properties in `:root` and `.dark` (Slate + Indigo palette)
- Custom component classes: `.card`, `.btn`, `.input`, `.badge`, `.stat-card`, `.offer-card`, `.purchase-card`, `.status-banner`
- `.mobile-header` display is controlled via `@media` queries, NOT Tailwind responsive classes (layer specificity issue with Tailwind v4)
- Dark mode via `.dark` class on `<html>` element

### Templates (EJS)
- `header.ejs` handles the full layout: authenticated users get sidebar layout, auth pages get centered card
- Pass `title` and `user` to header: `<%- include('partials/header', {title: 'Page', user: locals.user}) %>`
- Active sidebar link detection uses the `title` variable
- CSRF token available as `csrfToken` in all views
- Use `locals.varName` for optional variables to avoid undefined errors

### Database
- Models in `src/db/models/` with associations defined in `index.js`
- Create migrations as `.cjs` files: `npx sequelize-cli migration:generate --name your-migration`
- Run migrations: `npm run migrate`
- Docker volumes persist PostgreSQL data

### Zendit API
- API wrapper: `src/services/zenditClient.js`
- Key endpoints: purchases (POST), status (GET), QR code (GET), plans (GET), balance (GET)
- Purchase flow: POST /purchases → redirect to /status/:txId?purchased=true

## Environment Variables

All configured in `docker-compose.yml` for local dev. For production, use `.env` file or environment:

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| SESSION_SECRET | Session encryption key |
| ZENDIT_API_KEY | Zendit API key |
| ZENDIT_API_BASE | Zendit API base URL |
| COUNTRY | Default country filter (e.g., TR) |
| OFFERS_LIMIT | Max offers to fetch |
| APP_URL | Application URL |
| SMTP_HOST/PORT/USER/PASS | Email config (empty = console output) |

## Common Tasks

```bash
# View logs
docker compose logs app -f

# Reset database
docker compose exec app npm run reset-db

# Run tests
npm test

# Check health
curl http://localhost:3000/health
```

## Rate Limiting
Currently disabled (commented out in server.js and auth routes). Re-enable for production.
