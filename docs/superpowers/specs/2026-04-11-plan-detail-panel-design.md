# Plan Detail Slide-up Panel

## Overview

Replace the current simple "Confirm Purchase" modal with a full slide-up panel that shows complete plan details, device compatibility check, and purchase action in one screen.

## Current State

- Offer card click opens a small modal with: plan name, price, details text, and confirm/cancel buttons.
- Compatibility check exists as a separate `/compatibility` page.
- Plan details (speed, coverage, notes, activation policy) are not shown before purchase.

## Design

### Layout: Slide-up Panel

- **Mobile**: Full-height panel sliding up from the bottom with a drag handle at the top.
- **Desktop**: Large centered modal (max-width ~480px) with backdrop overlay.
- Closes via: backdrop click, X button, Escape key, or swipe-down on mobile handle.

### Panel Sections (top to bottom)

#### 1. Header

- Drag handle bar (mobile)
- Country flag (from flagcdn.com using countryCode) + operator name + country/type label
- Price (right-aligned, accent color, large font)

#### 2. Plan Stats Grid (3 columns)

| Data | Duration | Speed |
|------|----------|-------|
| 1 GB | 7 days   | 4G    |

- `data` from package (or "Unlimited")
- `day` from package
- `bestSpeed` derived from rawData.operator.networks

#### 3. Detail Rows (icon + label + value)

Each row shows an icon, title, and description:

- **Activation**: from `rawData.operator.activation_policy` (e.g., "Starts on first use" or "Immediate")
- **Top-up**: from `rechargeability` field (e.g., "Rechargeable" or "Not rechargeable")
- **Network**: operator title + speed types from `rawData.operator.networks`

Only show rows where data is available.

#### 4. Note (conditional)

- Only rendered if `rawData.short_info` or `rawData.operator.info` has content.
- Gray card with "Note" label and the note text.

#### 5. Coverage Countries (conditional)

- Only rendered for packages with more than 1 coverage country.
- Show all country names from `rawData.operator.countries[].title`.

#### 6. Device Compatibility Check

- Two `<select>` dropdowns: Brand, then Model (model loads after brand selection).
- Data source: existing `/compatibility/check?brand=X&model=Y` API endpoint.
- Brand dropdown loads on panel open (from the existing `esim-devices.json` data).
- Model dropdown populates on brand change via fetch to the API.
- Result states:
  - **No selection**: Empty (no result shown)
  - **Compatible**: Green card with checkmark, model name, and notes (e.g., "Dual eSIM support")
  - **Not compatible**: Red card with X icon, model name, and explanation
  - **Not found**: Gray card with info that device was not found in the database

#### 7. Purchase Button (sticky bottom)

- Full-width button: "Buy for $X.XX"
- Submits the existing purchase form (POST `/payment/create` with packageId, vendor, amount, currency, planName, CSRF token).
- Disable on submit, show "Processing..." text.

### Data Flow

1. Offer card stores all needed data as `data-*` attributes on the card element (packageId, price, operator, countryCode, speed, activation policy, rechargeability, note, coverage countries, data, day, type).
2. On card click, JS reads these attributes and populates the panel.
3. Compatibility dropdowns fetch from existing `/compatibility/check` endpoint.
4. Purchase submits existing form to `/payment/create`.

No new backend endpoints needed. All data comes from existing package fields and the existing compatibility API.

### Responsive Behavior

- **Mobile (<768px)**: Panel fills full viewport height, has drag handle, slides up with animation.
- **Desktop (>=768px)**: Centered modal with max-width 480px, max-height 90vh with scroll, backdrop overlay.

### Animation

- Panel slides up from bottom: `transform: translateY(100%)` to `translateY(0)` with 300ms ease-out transition.
- Backdrop fades in: `opacity: 0` to `opacity: 1`.

## Files to Modify

| File | Change |
|------|--------|
| `src/views/offers.ejs` | Replace purchase modal HTML with slide-up panel; update `confirmPurchase()` JS; add compatibility fetch logic; add data-* attributes to offer cards |
| `src/input.css` | Add `.plan-panel`, `.plan-panel-backdrop`, stats grid, detail rows, compatibility result styles |
| `public/styles.css` | Rebuilt via `npm run css:build` |

## Out of Scope

- Swipe-to-dismiss gesture (close via button/backdrop/escape only)
- Saving compatibility results per user
- New API endpoints
