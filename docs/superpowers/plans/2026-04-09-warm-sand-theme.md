# Warm Sand Theme Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate production UI from Slate+Indigo to Warm Sand design system with floating tab bar navigation for users and warm sand sidebar for admin.

**Architecture:** Rewrite `src/input.css` with warm sand design tokens and component styles. Restructure `header.ejs` to provide two layout modes: tab bar + top bar for users, warm sand sidebar for admin. Update all EJS templates to use the new component classes. Demo files at `src/views/demo/` serve as the visual reference throughout.

**Tech Stack:** Tailwind CSS v4.2.1, EJS templates, Fontshare CDN (Cabinet Grotesk + General Sans), Lucide icons

**Design Spec:** `docs/superpowers/specs/2026-04-09-warm-sand-theme-design.md`

**Reference Implementation:** `src/views/demo/demo-styles.css` + `src/views/demo/layout.ejs` + all files in `src/views/demo/`

---

## File Structure

### Modified Files
- `src/input.css` — Complete rewrite: warm sand design tokens, component styles, tab bar layout, admin sidebar, animations, dark mode
- `src/views/partials/header.ejs` — Two-mode layout: user (top bar + tab bar) vs admin (warm sand sidebar). Font import change to Fontshare.
- `src/views/partials/footer.ejs` — Warm sand colors
- `src/views/login.ejs` — Auth card warm sand style
- `src/views/register.ejs` — Auth card warm sand style
- `src/views/forgot-password.ejs` — Auth card warm sand style
- `src/views/reset-password.ejs` — Auth card warm sand style
- `src/views/verify-email.ejs` — Auth card warm sand style
- `src/views/offers.ejs` — Offer cards warm sand style
- `src/views/purchases.ejs` — Purchase list warm sand style
- `src/views/status.ejs` — Status page warm sand style
- `src/views/qrcode.ejs` — QR page warm sand style
- `src/views/profile.ejs` — Profile form warm sand style
- `src/views/error.ejs` — Error page warm sand style
- `src/views/landing.ejs` — Landing page warm sand style
- `src/views/admin/dashboard.ejs` — Admin dashboard warm sand
- `src/views/admin/users.ejs` — Users table warm sand
- `src/views/admin/esims.ejs` — eSIMs table warm sand
- `src/views/admin/esim-detail.ejs` — eSIM detail warm sand
- `src/views/admin/assign-esim.ejs` — Assign form warm sand
- `src/views/admin/topup.ejs` — Topup form warm sand
- `src/views/admin/zendit-purchase.ejs` — Zendit purchase warm sand
- `src/views/admin/payments.ejs` — Payments table warm sand
- `src/views/admin/emails.ejs` — Emails table warm sand
- `src/views/admin/email-detail.ejs` — Email detail warm sand
- `src/views/admin/vendors.ejs` — Vendors table warm sand
- `src/views/admin/vendor-detail.ejs` — Vendor detail warm sand
- `src/views/admin/vendor-form.ejs` — Vendor form warm sand

### Reference Files (read-only, do NOT modify)
- `src/views/demo/demo-styles.css` — CSS reference for warm sand design system
- `src/views/demo/layout.ejs` — Layout reference for tab bar + top bar
- `src/views/demo/*.ejs` — Individual page references
- `src/views/demo/admin/*.ejs` — Admin page references

---

### Task 1: Rewrite input.css — Warm Sand Design System

**Files:**
- Modify: `src/input.css` (complete rewrite)

**Reference:** `src/views/demo/demo-styles.css`

This is the foundation task. The entire CSS file is rewritten with warm sand design tokens, component styles, and layout rules. The demo CSS is the primary reference but must be adapted for:
1. Tailwind CSS v4 integration (keep `@import "tailwindcss"`, `@source`, `@custom-variant`, `@theme`)
2. Dark mode support (add `.dark` variant for all tokens)
3. Both user layout (tab bar) and admin layout (sidebar)
4. Existing class names (`.card`, `.btn`, `.badge`, `.input`, `.sidebar-link`, `.offer-card`, `.stat-card`, `.status-banner`, etc.)

- [ ] **Step 1: Read the demo CSS for reference**

Read `src/views/demo/demo-styles.css` completely. This is the source of truth for colors, typography, spacing, component styles, and animations. Note all CSS custom properties, component classes, and responsive breakpoints.

- [ ] **Step 2: Read the current input.css structure**

Read `src/input.css` completely. Note the Tailwind v4 directives at the top (`@import`, `@source`, `@custom-variant`, `@theme`), all existing class names used in templates, and the overall structure (tokens → base → components → layout → responsive → animations → dark mode).

- [ ] **Step 3: Rewrite input.css**

Rewrite `src/input.css` with this structure:

**Section 1 — Tailwind v4 directives** (keep existing):
```css
@import "tailwindcss";
@source "../src/views/**/*.ejs";
@source "../public/*.html";
@custom-variant dark (&:where(.dark, .dark *));
@theme {
  --font-display: 'Cabinet Grotesk', system-ui, sans-serif;
  --font-sans: 'General Sans', system-ui, sans-serif;
  --container-sm: 24rem;
}
```

**Section 2 — Design tokens** (from spec section 1):
- Light mode `:root` — all warm sand colors, shadows, border-radius
- Dark mode `.dark` — warm sand dark palette
- CSS variable names should match existing production names where possible for minimal template breakage. Map:
  - `--surface-0` → `--surface` (or keep both as aliases)
  - `--brand-primary` → `--accent`
  - `--text-primary` → `--text`
  - Keep old names as aliases if any Tailwind utilities reference them

**Section 3 — Base styles**:
- Global transitions: `all 0.15s` on interactive elements
- Body: `background: var(--bg); color: var(--text); font-family: var(--font-sans);`
- Selection color
- Scrollbar styles

**Section 4 — Component classes** (adapt from demo CSS, keep production class names):
- `.card` — border-radius 14px, border 1px solid var(--border-subtle), shadow-sm
- `.btn` — General Sans 500, border-radius 10px, padding 12px 24px
- `.btn-primary` — bg accent, white text, hover translateY(-1px) + shadow
- `.btn-secondary`, `.btn-ghost`, `.btn-danger`
- `.badge` — inline-flex, 4px 12px, 12px font, with `::before` colored dot
- `.badge-success`, `.badge-warning`, `.badge-danger`, `.badge-info`, `.badge-amber`, `.badge-indigo`
- `.input`, `select` — border-radius 10px, accent focus ring
- `.stat-card` — icon + content layout
- `.offer-card` — hover lift + shadow
- `.status-banner` — rounded-xl with status colors
- `.purchase-card` — card with status badge

**Section 5 — User layout** (from demo layout.ejs):
- `.topbar` — sticky top, 72px height, flex layout, logo/nav/actions
- `.topbar-nav` — horizontal nav links (desktop only, hidden < 1024px)
- `.tabbar` — fixed bottom 12px, centered, dark bg, rounded 14px, z-100
- `.tabbar a` — icon + label, active state with accent bg
- `.content-area` — padding-bottom for tab bar clearance
- Hide tabbar with `.no-tabbar` class (for auth pages)

**Section 6 — Admin layout** (warm sand version of existing sidebar):
- `.sidebar` — 260px, var(--surface) bg, accent-colored active states
- `.sidebar-link` — hover/active with warm sand colors
- `.sidebar-link.active` — 3px left border var(--accent), accent-light bg
- `.mobile-header` — warm sand colors, hamburger toggle
- Sidebar overlay/backdrop for mobile

**Section 7 — Auth layout**:
- `.auth-wrapper` — centered card on warm beige background
- Warm sand auth card styles

**Section 8 — Page-specific styles**:
- Offer card grid responsive
- Purchase card list
- Status page layout
- QR code card

**Section 9 — Animations**:
```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```
- Staggered fade-up for list items
- Button hover transitions
- `prefers-reduced-motion` support

**Section 10 — Print styles**

IMPORTANT: Reference the demo-styles.css for exact values (colors, spacing, shadows, transitions). The goal is to produce the same visual result as the demo but integrated with Tailwind v4 and supporting dark mode.

- [ ] **Step 4: Build CSS to verify no syntax errors**

```bash
cd C:/Users/turgu/Desktop/esim-management-system-2 && npm run css:build
```

Expected: Build succeeds, `public/styles.css` is generated without errors.

- [ ] **Step 5: Commit**

```bash
git add src/input.css
git commit -m "feat: rewrite CSS with Warm Sand design system"
```

---

### Task 2: Rewrite header.ejs — Dual-Mode Layout

**Files:**
- Modify: `src/views/partials/header.ejs`

**Reference:** `src/views/demo/layout.ejs` for the tab bar + top bar structure

This is the most complex template change. The header must provide two completely different layouts:
1. **User mode** (authenticated, non-admin): top bar + floating tab bar + content wrapper
2. **Admin mode** (authenticated, admin): warm sand sidebar + content wrapper  
3. **Auth mode** (not authenticated): centered auth card wrapper

- [ ] **Step 1: Read demo layout.ejs for reference**

Read `src/views/demo/layout.ejs` completely. Note:
- Top bar structure (logo, nav links, search, avatar)
- Tab bar structure (4-5 tabs with SVG icons)
- Content wrapper classes
- How `adminMode` flag switches between layouts
- How `showTabBar` and `showTopBar` flags work

- [ ] **Step 2: Read current header.ejs**

Read `src/views/partials/header.ejs` completely. Note:
- Dark mode detection JavaScript
- Theme toggle function
- Sidebar management functions (open/close/toggle)
- Toast notification function
- Copy to clipboard function
- Form protection script
- Sidebar HTML structure and links
- Mobile header HTML
- How `user` variable is checked for auth state

- [ ] **Step 3: Rewrite header.ejs**

The new header.ejs must:

**Head section:**
- Replace Google Fonts Inter import with Fontshare CDN:
  ```html
  <link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
  ```
- Keep `public/styles.css` link
- Keep Lucide icons CDN
- Keep dark mode detection script (update class reference if needed)
- Keep theme toggle, toast, copy, form protection JavaScript

**For authenticated non-admin users:**
- Top bar (`.topbar`):
  - Left: DataPatch logo (link to /offers)
  - Center (desktop >=1024px): Nav links — Planlar (/offers), eSIM'lerim (/purchases), Odemeler (/payment-history), Profil (/profile)
  - Right: Dark mode toggle icon, notification bell, user avatar circle (first letter of username)
- Tab bar (`.tabbar`):
  - 4 tabs: Planlar, eSIM'lerim, Odemeler, Profil
  - Each tab: SVG icon + label text
  - Active tab detection using `title` variable (same pattern as current sidebar)
  - Tab bar at fixed bottom 12px, centered
- Content wrapper with appropriate padding

**For authenticated admin users:**
- Warm sand sidebar (260px):
  - Brand section at top (DataPatch logo with orange accent)
  - Sidebar links: Dashboard, Users, All Datas, Payments, Vendors, Emails, Zendit Purchase
  - Active link detection using `title` variable (keep existing pattern)
  - Active state: left accent border + accent-light bg
  - Mobile: hamburger toggle + overlay (keep existing JS functions, update colors)
- Mobile header for admin (warm sand colors)
- Content wrapper next to sidebar

**For non-authenticated (auth pages):**
- No top bar, no tab bar, no sidebar
- Centered auth wrapper with warm beige background
- DataPatch logo above the auth card

**Tab bar SVG icons** — use Lucide-style simple SVG paths for each tab:
- Planlar: grid/package icon
- eSIM'lerim: layers/sim icon
- Odemeler: credit-card icon
- Profil: user icon

- [ ] **Step 4: Verify layout renders**

```bash
npm run css:build && docker compose restart app
```

Visit `http://localhost:3000` — check layout loads without errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/partials/header.ejs
git commit -m "feat: rewrite header with tab bar for users, warm sand sidebar for admin"
```

---

### Task 3: Update Footer and Auth Pages

**Files:**
- Modify: `src/views/partials/footer.ejs`
- Modify: `src/views/login.ejs`
- Modify: `src/views/register.ejs`
- Modify: `src/views/forgot-password.ejs`
- Modify: `src/views/reset-password.ejs`
- Modify: `src/views/verify-email.ejs`
- Modify: `src/views/error.ejs`

**Reference:** `src/views/demo/login.ejs`, `src/views/demo/register.ejs`, `src/views/demo/forgot-password.ejs`, `src/views/demo/reset-password.ejs`, `src/views/demo/verify-email.ejs`

- [ ] **Step 1: Read demo auth pages for reference**

Read the demo versions of login, register, forgot-password, reset-password, verify-email. Note the HTML structure, CSS classes used, and form layout.

- [ ] **Step 2: Read current production auth pages**

Read the current login.ejs, register.ejs, etc. Note the form fields, validation error display, CSRF token handling, and any JavaScript.

- [ ] **Step 3: Update footer.ejs**

Update colors and styles to warm sand. The footer appears inside the header.ejs for authenticated users (as part of the layout), and separately for auth pages. Ensure it uses warm sand colors:
- Background: var(--surface) or var(--bg)
- Text: var(--text-muted)
- Links: var(--text-secondary), hover var(--accent)
- Keep all legal links and payment icons

- [ ] **Step 4: Update auth pages**

For each auth page (login, register, forgot-password, reset-password, verify-email):
- Update form card to use warm sand card styling
- Update input fields to use `.input` class with warm sand focus states
- Update buttons to use `.btn .btn-primary` with orange accent
- Update error/success messages to use warm sand status colors
- Keep all form fields, CSRF tokens, validation, and JavaScript intact
- Keep the `<%- include('partials/header', {title: '...', user: null}) %>` pattern

For error.ejs:
- Update to warm sand card styling
- Keep the error message display and back link

- [ ] **Step 5: Build and verify auth pages**

```bash
npm run css:build && docker compose restart app
```

Visit `http://localhost:3000/auth/login` — verify warm sand auth card renders correctly.

- [ ] **Step 6: Commit**

```bash
git add src/views/partials/footer.ejs src/views/login.ejs src/views/register.ejs src/views/forgot-password.ejs src/views/reset-password.ejs src/views/verify-email.ejs src/views/error.ejs
git commit -m "feat: update auth pages and footer with warm sand theme"
```

---

### Task 4: Update User Pages — Offers, Purchases, Status, QR Code

**Files:**
- Modify: `src/views/offers.ejs`
- Modify: `src/views/purchases.ejs`
- Modify: `src/views/status.ejs`
- Modify: `src/views/qrcode.ejs`

**Reference:** `src/views/demo/offers.ejs`, `src/views/demo/purchases.ejs`, `src/views/demo/status.ejs`, `src/views/demo/qrcode.ejs`

- [ ] **Step 1: Read demo user pages for reference**

Read the demo versions of offers, purchases, status, qrcode. Note the card layouts, badge styles, button styles, and responsive grid.

- [ ] **Step 2: Read current production user pages**

Read current offers.ejs, purchases.ejs, status.ejs, qrcode.ejs. Note the data variables available (from controllers), the HTML structure, and any JavaScript.

- [ ] **Step 3: Update offers.ejs**

- Page title with Cabinet Grotesk heading
- Filter chips row (if present) with warm sand active state
- Offer cards using `.offer-card` class with warm sand hover effect
- Each card: operator image, title, data/duration info, price, CTA button
- Responsive: single column mobile, 2-3 columns desktop
- Keep all form actions, packageId hidden inputs, modal functionality
- Keep the purchase confirmation modal if present

- [ ] **Step 4: Update purchases.ejs**

- Page title
- Purchase cards/list with warm sand card styling
- Status badges using new `.badge-*` classes with colored dots
- Vendor badge (Zendit amber badge) — already exists, just verify styling
- Usage data display for Airalo eSIMs
- Pagination using warm sand button styles
- Keep all data variables and links intact

- [ ] **Step 5: Update status.ejs**

- Status banner using `.status-banner` with appropriate status color
- Detail grid with warm sand card sections
- Usage data card (Airalo)
- Action buttons (QR Code, Top-up) with warm sand button styles
- Vendor badge
- Keep all vendor-aware conditional rendering

- [ ] **Step 6: Update qrcode.ejs**

- QR code card centered with warm sand styling
- Airalo: qrcode_url image, Apple install button, LPA manual field
- Zendit: existing base64 QR display
- Installation tabs/instructions
- Keep all vendor-aware conditional rendering

- [ ] **Step 7: Build and verify**

```bash
npm run css:build && docker compose restart app
```

Visit offers, purchases, status pages — verify warm sand styling.

- [ ] **Step 8: Commit**

```bash
git add src/views/offers.ejs src/views/purchases.ejs src/views/status.ejs src/views/qrcode.ejs
git commit -m "feat: update user pages (offers, purchases, status, qrcode) with warm sand theme"
```

---

### Task 5: Update User Pages — Profile, Landing, Payment, Misc

**Files:**
- Modify: `src/views/profile.ejs`
- Modify: `src/views/landing.ejs`
- Modify: `src/views/payment.ejs` (if exists)
- Modify: `src/views/payment-history.ejs` (if exists)
- Modify: `src/views/payment-result.ejs` (if exists)
- Modify: `src/views/topup.ejs` (if exists)
- Modify: `src/views/receipt.ejs` (if exists)
- Modify: `src/views/compatibility.ejs` (if exists)

**Reference:** `src/views/demo/profile.ejs`, `src/views/demo/landing.ejs`, `src/views/demo/payment.ejs`, `src/views/demo/payment-history.ejs`

- [ ] **Step 1: Read demo profile and landing pages**

Read the demo versions. Note the form layout for profile, hero section for landing.

- [ ] **Step 2: Read current production pages**

Read current profile.ejs, landing.ejs, and any payment-related pages. Note data variables and form fields.

- [ ] **Step 3: Update profile.ejs**

- Profile form card with warm sand styling
- Input fields with warm sand focus states
- Save button with orange accent
- Password change section
- Keep all form fields, CSRF tokens, validation

- [ ] **Step 4: Update landing.ejs**

- Hero section with warm sand aesthetic
- Featured offers cards
- Trust bar / how it works section
- CTA buttons with orange accent
- Keep the dynamic offer data rendering

- [ ] **Step 5: Update remaining user pages**

For each remaining page (payment, payment-history, payment-result, topup, receipt, compatibility):
- Read the current file
- Update card styles, button styles, badge styles to warm sand
- Keep all data variables and form fields intact
- If a page doesn't exist or is empty, skip it

- [ ] **Step 6: Build and verify**

```bash
npm run css:build && docker compose restart app
```

- [ ] **Step 7: Commit**

```bash
git add src/views/profile.ejs src/views/landing.ejs src/views/payment.ejs src/views/payment-history.ejs src/views/payment-result.ejs src/views/topup.ejs src/views/receipt.ejs src/views/compatibility.ejs
git commit -m "feat: update profile, landing, and payment pages with warm sand theme"
```

---

### Task 6: Update Admin Pages

**Files:**
- Modify: `src/views/admin/dashboard.ejs`
- Modify: `src/views/admin/users.ejs`
- Modify: `src/views/admin/esims.ejs`
- Modify: `src/views/admin/esim-detail.ejs`
- Modify: `src/views/admin/assign-esim.ejs`
- Modify: `src/views/admin/topup.ejs`
- Modify: `src/views/admin/zendit-purchase.ejs`
- Modify: `src/views/admin/payments.ejs`
- Modify: `src/views/admin/emails.ejs`
- Modify: `src/views/admin/email-detail.ejs`
- Modify: `src/views/admin/vendors.ejs`
- Modify: `src/views/admin/vendor-detail.ejs`
- Modify: `src/views/admin/vendor-form.ejs`

**Reference:** `src/views/demo/admin/dashboard.ejs`, `src/views/demo/admin/users.ejs`, `src/views/demo/admin/esims.ejs`, `src/views/demo/admin/esim-detail.ejs`, `src/views/demo/admin/vendors.ejs`, `src/views/demo/admin/emails.ejs`, `src/views/demo/admin/vendor-detail.ejs`

- [ ] **Step 1: Read demo admin pages for reference**

Read the demo admin pages. Note stat card layouts, table styles, form styles, and detail page layouts.

- [ ] **Step 2: Read current production admin pages**

Read each admin page. Note data variables from controllers, table structures, form fields, action buttons, pagination.

- [ ] **Step 3: Update dashboard.ejs**

- Stat cards using `.stat-card` with colored icon backgrounds (orange, green, blue, amber)
- Summary cards with warm sand styling
- Recent activity table with warm sand rows
- Keep all data variables and chart functionality

- [ ] **Step 4: Update list pages (users, esims, payments, emails, vendors)**

For each list/table page:
- Page heading with Cabinet Grotesk
- Search/filter bar with warm sand input styles
- Table/card list with warm sand row styling
- Status badges with new `.badge-*` classes
- Action buttons (edit, view, delete) with warm sand styles
- Pagination with warm sand buttons
- Keep all data variables, pagination params, filter functionality

- [ ] **Step 5: Update detail pages (esim-detail, email-detail, vendor-detail)**

For each detail page:
- Detail card with warm sand styling
- Info grid with label/value pairs
- Action buttons with warm sand styles
- Related data sections (topups, payments, etc.)
- Keep all data variables and conditional rendering

- [ ] **Step 6: Update form pages (assign-esim, topup, vendor-form, zendit-purchase)**

For each form page:
- Form card with warm sand styling
- Input fields with warm sand focus states
- Select dropdowns with warm sand styling
- Submit buttons with orange accent
- Error/success message display with warm sand status colors
- Keep all form fields, CSRF tokens, validation, select options

- [ ] **Step 7: Build and verify admin pages**

```bash
npm run css:build && docker compose restart app
```

Login as admin (admin/test123), visit each admin page — verify warm sand styling.

- [ ] **Step 8: Commit**

```bash
git add src/views/admin/
git commit -m "feat: update all admin pages with warm sand theme"
```

---

### Task 7: Final Build, Polish, and Verification

**Files:**
- All modified files

- [ ] **Step 1: Full CSS rebuild**

```bash
cd C:/Users/turgu/Desktop/esim-management-system-2 && npm run css:build
```

Expected: Build succeeds without errors.

- [ ] **Step 2: Visual verification checklist**

Start the app and verify each page:

```bash
docker compose up --build -d
```

Check these pages (login as admin/test123):
- [ ] `/auth/login` — warm sand auth card, orange button
- [ ] `/auth/register` — warm sand auth card
- [ ] `/offers` — tab bar visible, offer cards warm sand, orange CTA
- [ ] `/purchases` — tab bar, purchase cards, vendor badges
- [ ] `/status/:txId` — status banner colors, detail grid
- [ ] `/qrcode/:txId` — QR card centered
- [ ] `/profile` — form card, orange save button
- [ ] `/admin/dashboard` — sidebar with warm sand, stat cards
- [ ] `/admin/users` — table warm sand
- [ ] `/admin/esims` — table warm sand
- [ ] `/admin/zendit/purchase` — form warm sand
- [ ] Dark mode toggle — verify dark palette works on all pages

- [ ] **Step 3: Fix any visual issues found**

Address any CSS inconsistencies, missing styles, or broken layouts found during verification.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish warm sand theme — visual fixes"
```

- [ ] **Step 5: Final build verification**

```bash
npm run css:build
```

Verify `public/styles.css` is generated and the file size is reasonable.
