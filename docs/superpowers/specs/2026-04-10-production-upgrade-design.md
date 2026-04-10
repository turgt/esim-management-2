# Production Upgrade: Design Migration + Airalo Completion

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Two independent workstreams executed in parallel

---

## Workstream 1: Demo Design → Production

### Goal
Replace the production sidebar-based layout with the demo's tab bar + topbar navigation system. Apply the v2 "Warm Sand" visual style to all production templates while preserving all dynamic functionality.

### Architecture Changes

#### Navigation System
- **Remove:** Sidebar layout (`sidebar`, `sidebar-nav`, `sidebar-overlay`, `sidebar-mobile`)
- **Add:** Bottom tab bar for mobile (fixed, 5 tabs: Home, Plans, My eSIMs, Profile, Admin)
- **Add:** Topbar with logo, navigation links, avatar (desktop)
- **Keep:** Admin-only "Zendit Purchase" link in admin section of navigation
- **Desktop (1024px+):** Topbar with horizontal nav links; content max-width centered
- **Mobile (<1024px):** Topbar (simplified) + bottom tab bar

#### Layout (header.ejs rewrite)
- Single layout structure replacing the current dual sidebar/auth-card system
- Auth pages (login, register, forgot-password, reset-password, verify-email): Centered card, no tab bar
- Authenticated pages: Topbar + content area + tab bar (mobile)
- Landing page: Uses separate landing-header/landing-footer (unchanged)

#### CSS Changes (input.css)
- Remove all sidebar-related component classes
- Add tab bar component classes (`.tabbar`, `.tabbar-item`, `.tabbar-icon`)
- Add topbar component classes (`.topbar` already exists, extend for nav links)
- Add v2-style animation class (`.anim` for staggered fade-in)
- Keep dark mode support throughout
- Keep Tailwind utility usage pattern
- Keep existing color tokens (already identical to demo)

#### Template Updates
Each production EJS template gets updated markup to match demo's visual structure:
- Cards: cleaner borders, warm shadows
- Badges: rounded pill style
- Buttons: consistent sizing with demo
- Forms: v2-style input groups
- Icons: Keep Lucide (don't switch to inline SVG)
- Page headers: breadcrumb style from demo

#### Pages to Update
1. `partials/header.ejs` — Full rewrite (sidebar → tabbar/topbar)
2. `partials/footer.ejs` — Minimal changes
3. `login.ejs` — Auth card styling
4. `register.ejs` — Auth card styling
5. `forgot-password.ejs` — Auth card styling
6. `reset-password.ejs` — Auth card styling
7. `verify-email.ejs` — Auth card styling
8. `offers.ejs` — Grid layout, filter chips, offer cards
9. `purchases.ejs` — Purchase list with stat cards
10. `status.ejs` — Status banner, timeline, details grid
11. `profile.ejs` — Profile sections, avatar
12. `qrcode.ejs` — QR display, installation tabs
13. `payment.ejs` — Order summary card
14. `payment-result.ejs` — Result display
15. `payment-history.ejs` — History list
16. `receipt.ejs` — Receipt card
17. `compatibility.ejs` — Compatibility check
18. `topup.ejs` — Top-up flow
19. `admin/dashboard.ejs` — Admin stats grid
20. `admin/users.ejs` — User table
21. `admin/esims.ejs` — eSIM table
22. `admin/esim-detail.ejs` — Detail view
23. `admin/assign-esim.ejs` — Assignment form
24. `admin/topup.ejs` — Admin top-up
25. `admin/zendit-purchase.ejs` — Keep as-is (admin legacy feature)

#### What to Preserve
- All dynamic EJS logic (loops, conditionals, data binding)
- CSRF token integration
- Lucide icon system
- Dark mode toggle + CSS variable system
- Flash message / alert system
- Pagination partial
- All JavaScript functionality (payment gateway, copy-to-clipboard, etc.)

---

## Workstream 2: Airalo Migration Completion

### Goal
Fix remaining Zendit dependencies in primary flows and clean up configuration.

### Changes

#### 1. Admin Dashboard Balance (Critical)
- **File:** `src/controllers/adminController.js:25`
- **Change:** Replace `zenditGetBalance()` with `airaloGetBalance()`
- **Import:** Add `import { getBalance as airaloGetBalance } from '../services/airaloClient.js'`
- **Fallback:** Try Airalo first; if fails, try Zendit as fallback with warning

#### 2. Dashboard Label
- **File:** `src/views/admin/dashboard.ejs`
- **Change:** "Zendit Balance" → "Airalo Balance" (or "Provider Balance")

#### 3. Environment Documentation
- **File:** `.env.example`
- **Add:** All Airalo, Paddle, and Resend environment variables with comments

#### 4. Validation & Edge Cases
- Audit all controller error paths for Airalo-specific handling
- Ensure graceful degradation when Airalo credentials not configured
- Verify purchase flow handles Airalo API errors with user-friendly messages

---

## Out of Scope
- PayTR payment integration (separate branch)
- Multi-country package sync (future enhancement)
- Zendit Purchase admin page (stays as-is)
- Landing page header/footer partials (already good)
