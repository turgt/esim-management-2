# DataPatch Demo Redesign — Design Spec

## Overview

A standalone design demo accessible at `/demo` that reimagines the DataPatch eSIM marketplace with a bold "Sunset Vibrant" aesthetic and app-like floating tab bar navigation. Serves static/mock data — no backend dependency. Existing codebase remains untouched.

## Design Direction

### Aesthetic: Sunset Vibrant
- **Background:** Light (#fafafa base, #fff cards)
- **Gradient accent:** `linear-gradient(135deg, #f97316, #ec4899)` (orange→pink) as the primary brand gradient
- **Secondary gradient:** `linear-gradient(135deg, #ec4899, #8b5cf6)` (pink→purple) for variety
- **Text colors:** #1a1a2e (primary), #64748b (secondary), #94a3b8 (muted)
- **Typography:** Satoshi (headings, 700-800 weight), DM Sans (body, 400-600 weight) — loaded via CDN
- **Decorative:** Soft gradient blobs in background (low opacity 0.08-0.15), large border-radius (16-20px cards, 10-12px buttons), soft box-shadows (0 4px 24px rgba(0,0,0,0.06))
- **Dark mode:** Not in scope for demo

### Layout: Floating Tab Bar
- **Top bar:** Minimal — logo (left, gradient text) + user avatar (right, gradient circle). Height ~56px
- **Bottom tab bar:** Fixed, floating, dark (#1a1a2e), rounded (16px), centered with margin. Contains 4 tabs: Planlar, eSIM'lerim, Ödemeler, Profil. Active tab has gradient background highlight
- **Content area:** Full width between top bar and bottom tab. Max-width 960px centered on desktop. Padding 16-24px
- **Mobile:** Natural — tab bar already mobile-native. Top bar stays minimal. Content stacks to single column
- **Desktop:** Content centered, tab bar centered at bottom (max-width 400px)

### Card Styles

#### Offer Cards (Hybrid)
- **Featured card:** Large, full-width. Gradient border/shadow (rgba(249,115,22,0.15)). "POPÜLER" badge top-right. Flag (56px) + country name + network badge + data/duration info + large price + CTA button
- **Regular cards:** Compact horizontal rows. Flag (44px rounded square) + country + info line (data • duration) + price (gradient text) + arrow button (32px gradient square)
- **Hover:** Slight lift (translateY -2px), shadow increase

#### Status Cards
- **Done:** Green gradient background, checkmark icon
- **Pending:** Amber gradient, spinner icon
- **Failed:** Rose gradient, X icon

### Filters
- Pill-shaped chips, horizontal scroll on mobile
- Default: light bg (#f1f5f9), dark text
- Active: gradient background, white text
- Categories: Tümü, Türkiye, Avrupa, Asya, Amerika, Global

## Pages

### 1. Landing Page (`/demo`)
- **Hero section:** Large heading ("Sınırsız Bağlantı, Sınırsız Keşif"), subheading, 2 CTA buttons (gradient primary + outlined secondary), decorative gradient blobs behind
- **Trust bar:** "190+ Ülke", "Anında Aktivasyon", "7/24 Destek" — icon + text horizontal row
- **How it works:** 3-step cards (Planını Seç → Ödeme Yap → QR ile Yükle) with numbered circles
- **Featured plans:** 3 offer cards (mock data) with "Tüm Planları Gör →" link
- **Footer:** Minimal — logo, copyright, links

### 2. Login Page (`/demo/login`)
- Centered card (max-width 400px) on light background with subtle gradient blob
- Logo (gradient text) at top
- Username/email input + password input + "Giriş Yap" gradient button
- "Hesabın yok mu? Kayıt ol" link below
- Forgot password link
- Inputs: white bg, 1px border (#e2e8f0), 12px radius, focus: gradient border

### 3. Offers Page (`/demo/offers`)
- **Top bar** + page title ("Planlar") below
- **Filter chips** row: Tümü, Türkiye, Avrupa, Asya, Global
- **Sort dropdown:** Fiyat (artan), Fiyat (azalan), Data (çok→az)
- **Featured card** (1 popular plan, highlighted)
- **Regular cards** list (5-6 mock plans)
- **Floating tab bar** at bottom (Planlar tab active)
- Click on any card → navigates to `/demo/status`

### 4. Purchase Status Page (`/demo/status`)
- **Top bar** with back arrow (←) + "Satın Alma Detayı"
- **Status banner:** Full-width, rounded, gradient background (green=done). Icon + "Aktif" title + "eSIM başarıyla yüklendi" message
- **Detail grid:** 2-column grid showing: Ülke, Data, Süre, Ağ Tipi, ICCID (monospace), Satın Alma Tarihi
- **Active plan card:** Progress bar showing data usage (e.g., 3.2GB / 10GB), expiry date
- **Action buttons:** "QR Kodu Göster" (gradient) + "Top-up" (outlined)
- **Activity timeline:** 3-4 mock entries with timestamp + description + status dot
- **Floating tab bar** (eSIM'lerim tab active)

### 5. QR Code Page (`/demo/qrcode`)
- **Top bar** with back arrow + "eSIM Yükle"
- **QR Code card:** Centered, large QR placeholder (200x200, gradient border), plan name below
- **Installation tabs:** "Otomatik Yükleme" | "Manuel Giriş" pill toggle
- **Auto tab:** Step-by-step instructions (1. Ayarlar > Hücresel, 2. eSIM Ekle, 3. QR Kodu Tara). Each step in a numbered card
- **Manual tab:** SM-DP+ address field + activation code field + copy buttons
- **Platform buttons:** "iOS Ayarları" + "Android Ayarları" links (outlined buttons with platform icons)
- **Floating tab bar** (eSIM'lerim tab active)

## Technical Implementation

### File Structure
```
src/
├── views/
│   └── demo/
│       ├── layout.ejs          # Shared layout (top bar + tab bar + content slot)
│       ├── landing.ejs         # Landing/hero page
│       ├── login.ejs           # Login form
│       ├── offers.ejs          # Plans listing
│       ├── status.ejs          # Purchase status detail
│       ├── qrcode.ejs          # QR code & install instructions
│       └── demo-styles.css     # All demo styles (self-contained)
├── routes/
│   └── demo.js                 # Express router for /demo/*
```

### Routing
```
GET /demo           → landing.ejs
GET /demo/login     → login.ejs
GET /demo/offers    → offers.ejs
GET /demo/status    → status.ejs (mock data)
GET /demo/qrcode    → qrcode.ejs (mock data)
```

### Mock Data
All data hardcoded in the route handler — no database, no API calls. Example offers:
- Türkiye 10GB / 30 gün / 5G / $4.99 (featured)
- Avrupa 5GB / 15 gün / 4G / $9.99
- ABD 3GB / 7 gün / 5G / $6.99
- Asya Paketi 8GB / 30 gün / 4G / $12.99
- Global 20GB / 30 gün / 5G / $19.99
- Türkiye 1GB / 7 gün / 4G / $1.99

### Fonts (CDN)
```html
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@700,800&f[]=dm-sans@400,500,600&display=swap" rel="stylesheet">
```

### Icons
Lucide icons via existing CDN (already in project), or inline SVG for tab bar icons.

### No Dependencies on Existing Code
- Demo templates do NOT use existing `header.ejs` or `footer.ejs`
- Demo has its own `layout.ejs` with the floating tab bar
- Demo CSS is fully self-contained (no import of `input.css` or `styles.css`)
- No auth middleware on demo routes
- No CSRF, no session, no database

### CSS Architecture
Single `demo-styles.css` file containing:
- CSS custom properties (colors, fonts, shadows, radii)
- Reset/base styles for demo scope
- Layout (top bar, tab bar, content container)
- Component classes (cards, badges, buttons, inputs, filters, status banners)
- Responsive breakpoints (mobile-first: 640px, 768px, 1024px)
- Animations (fade-in on page load, hover transitions, tab bar active state)

## Out of Scope
- Dark mode
- Admin pages
- Real authentication/backend integration
- Payment flow
- Profile page
- Compatibility page
- Registration page (login only for demo)
- Responsive testing on all devices (basic mobile/desktop support)
