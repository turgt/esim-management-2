# Warm Sand Theme Migration — Design Spec

## Ozet

Demo sayfalarindaki "Warm Sand" design system'i production sayfalarına uygulama. Kullanici tarafi sidebar'dan floating tab bar + top bar yapisina geciyor. Admin tarafi sidebar korunuyor ama warm sand paleti ile yeniden stillendiriliyor. Dark mode warm sand paleti ile desteklenecek. Tum sayfalar tek seferde migrate edilecek.

## Kararlar

- **Renk paleti**: Slate+Indigo → Warm Sand (orange accent `#ea580c`)
- **Font**: Inter → Cabinet Grotesk (basliklar) + General Sans (govde) via Fontshare CDN
- **Kullanici navigasyonu**: Sidebar → Floating tab bar (alt) + sticky top bar (ust)
- **Admin navigasyonu**: Sidebar kalir, warm sand temasina uyumlu hale getirilir
- **Dark mode**: Korunur, warm sand dark paleti olusturulur
- **Component isimleri**: Mevcut class isimleri korunur (`.card`, `.btn`, `.badge` vs.), CSS degerleri degisir
- **Tek seferde**: Tum sayfalar ve layout birlikte degisir

## 1. Renk Sistemi

### Light Mode

```css
:root {
  /* Backgrounds */
  --bg: #f5f3f0;
  --surface: #ffffff;
  --surface-inset: #efecea;
  --surface-hover: #faf9f7;

  /* Text */
  --text: #1c1917;
  --text-secondary: #57534e;
  --text-muted: #a8a29e;

  /* Accent (Orange) */
  --accent: #ea580c;
  --accent-hover: #c2410c;
  --accent-light: #fff7ed;
  --accent-subtle: rgba(234, 88, 12, 0.06);

  /* Borders */
  --border: #e4e0db;
  --border-subtle: #ece9e4;

  /* Status */
  --success: #16a34a;
  --success-light: #f0fdf4;
  --warning: #ca8a04;
  --warning-light: #fefce8;
  --danger: #dc2626;
  --danger-light: #fef2f2;
  --info: #2563eb;
  --info-light: #eff6ff;

  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(28, 25, 23, 0.04);
  --shadow-md: 0 4px 12px rgba(28, 25, 23, 0.06);
  --shadow-lg: 0 8px 24px rgba(28, 25, 23, 0.08);
}
```

### Dark Mode

```css
.dark {
  --bg: #1c1917;
  --surface: #292524;
  --surface-inset: #1c1917;
  --surface-hover: #44403c;

  --text: #f5f5f4;
  --text-secondary: #a8a29e;
  --text-muted: #78716c;

  --accent: #f97316;
  --accent-hover: #fb923c;
  --accent-light: rgba(249, 115, 22, 0.12);
  --accent-subtle: rgba(249, 115, 22, 0.06);

  --border: #44403c;
  --border-subtle: #57534e;

  --success-light: rgba(22, 163, 74, 0.12);
  --warning-light: rgba(202, 138, 4, 0.12);
  --danger-light: rgba(220, 38, 38, 0.12);
  --info-light: rgba(37, 99, 235, 0.12);

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.4);
}
```

## 2. Tipografi

**Font Import (Fontshare CDN):**
```html
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=general-sans@400,500,600&display=swap" rel="stylesheet">
```

**Kullanim:**
- Basliklar (h1-h3, sayfa basliklari): Cabinet Grotesk, 700-800 weight
- Govde metni, butonlar, etiketler: General Sans, 400-600 weight
- Monospace: 'SF Mono', 'Fira Code', 'Consolas', monospace

**Font boyutlari (demo'dan):**
- Sayfa basligi: 24px (mobil) → 30px (desktop)
- Card basligi: 16px, weight 700
- Govde: 14px
- Kucuk: 12-13px

## 3. Navigasyon — Kullanici Tarafi

### Top Bar (`.topbar`)
- Sticky, top: 0, z-index: 50
- Yukseklik: 72px (desktop), 56px (mobil)
- Background: var(--surface), border-bottom: 1px solid var(--border-subtle)
- Icerik:
  - **Sol**: Logo (DataPatch) veya back button (detay sayfalarda)
  - **Orta** (desktop): Horizontal nav linkleri (Planlar, eSIM'lerim, Odemeler, Profil)
  - **Sag**: Search bar (desktop, 260px), bildirim ikonu, avatar butonu, dark mode toggle

### Tab Bar (`.tabbar`)
- Fixed, bottom: 12px, left: 50%, transform: translateX(-50%)
- Z-index: 100
- Background: var(--text) (koyu renk — light'ta dark, dark'ta biraz daha acik)
- Border-radius: 14px
- Padding: 6px
- Max-width: 400px (desktop'ta merkezde)
- 4 tab: Planlar, eSIM'lerim, Odemeler, Profil
- Her tab: SVG icon (20x20) + label text
- Active tab: background tint + accent rengi

### Content Area
- Padding: 16px (mobil), 36px 44px (desktop)
- Max-width: 1400px, margin: 0 auto
- Padding-bottom: tab bar yuksekligi + 12px (yaklasik 80px)

### Responsive
- Mobil (< 768px): Top bar minimal (logo + avatar), tab bar gorunur, nav linkleri gizli
- Desktop (>= 1024px): Top bar full (nav + search + avatar), tab bar gorunur (merkezde)

## 4. Navigasyon — Admin Tarafi

### Sidebar (mevcut yapi korunur)
- Genislik: 260px
- Background: var(--surface)
- Border-right: 1px solid var(--border-subtle)
- Active link: sol kenar 3px accent rengi + accent-light background
- Hover: surface-hover background
- Mobilde: hamburger ile acilir/kapanir (mevcut gibi)

### Renk guncellemesi
- Brand ikonu: orange gradient (accent rengi) — mevcut indigo yerine
- Active link border: var(--accent)
- Sidebar section baslik: var(--text-muted)

## 5. Component Stilleri

### Card (`.card`)
- Background: var(--surface)
- Border: 1px solid var(--border-subtle)
- Border-radius: 14px
- Box-shadow: var(--shadow-sm)
- Margin-bottom: 20px
- Overflow: hidden

### Button (`.btn`)
- Font: General Sans, 500 weight, 14px
- Border-radius: 10px
- Padding: 12px 24px
- Transition: all 0.15s
- `.btn-primary`: bg accent, text white, hover: accent-hover + translateY(-1px) + shadow
- `.btn-secondary`: bg white, border 1px, hover: accent rengi
- `.btn-ghost`: transparent bg, hover: inset bg
- `.btn-danger`: danger-light bg, danger text

### Badge (`.badge`)
- Inline-flex, 4px 12px padding
- Font-size: 12px, weight 600
- Border-radius: 6px
- `::before` colored dot (6px)
- `.badge-success`: success-light bg, success text, green dot
- `.badge-warning`: warning-light bg, warning text, yellow dot
- `.badge-danger`: danger-light bg, danger text, red dot
- `.badge-info`: info-light bg, info text, blue dot
- `.badge-amber` (Zendit): warning-light, amber — mevcut vendor badge'ler icin

### Input (`.input`)
- Background: var(--surface)
- Border: 1px solid var(--border)
- Border-radius: 10px
- Padding: 10px 14px
- Focus: accent border + accent glow ring
- Font: General Sans, 14px

### Stat Card (`.stat-card`)
- Flexbox layout: icon (renkli bg, rounded) + content (baslik + deger)
- Icon background: accent-light / success-light / warning-light / info-light

### Offer Card (`.offer-card`)
- Card base + hover: translateY(-2px) + shadow-md
- Header: flag + country + network badge
- Body: data, duration bilgileri
- Footer: fiyat + CTA butonu

### Status Banner
- Rounded-xl, padding 20px
- Success: success-light bg, success border
- Warning: warning-light bg
- Danger: danger-light bg

## 6. Animasyonlar

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- Sayfa icerigi: fadeUp 0.35s ease-out
- Staggered delay: child elementler 0.05s aralikla
- Button hover: translateY(-1px) + shadow transition 0.15s
- Tum interaktif elementler: transition all 0.15s
- `prefers-reduced-motion`: animasyonlar devre disi

## 7. Dosya Degisiklikleri

### CSS
- `src/input.css` — Tamamen yeniden yazilacak: CSS degiskenleri, base stiller, component class'lari, layout kurallari, responsive breakpoints, animasyonlar, dark mode

### Layout
- `src/views/partials/header.ejs` — Iki modlu layout:
  - Authenticated + non-admin: top bar + tab bar + content wrapper
  - Authenticated + admin: warm sand sidebar + content wrapper
  - Non-authenticated (login, register vs.): centered card layout (mevcut auth layout)
  - Font import: Fontshare CDN (Cabinet Grotesk + General Sans)
  - Dark mode toggle korunur
- `src/views/partials/footer.ejs` — Warm sand renklerle guncellenir

### Sayfa Template'leri (kullanici)
- `src/views/offers.ejs` — Offer card yapisini yeni stile uyumla
- `src/views/purchases.ejs` — Purchase card/list yeni stile
- `src/views/status.ejs` — Status banner + detail grid yeni stile
- `src/views/qrcode.ejs` — QR card yeni stile
- `src/views/profile.ejs` — Profil formu yeni stile
- `src/views/login.ejs` — Auth card warm sand
- `src/views/register.ejs` — Auth card warm sand
- `src/views/forgot-password.ejs` — Auth card warm sand
- `src/views/reset-password.ejs` — Auth card warm sand
- `src/views/verify-email.ejs` — Auth card warm sand
- `src/views/error.ejs` — Error card warm sand

### Sayfa Template'leri (admin)
- `src/views/admin/dashboard.ejs` — Stat card'lar yeni stile
- `src/views/admin/users.ejs` — Tablo yeni stile
- `src/views/admin/esims.ejs` — Tablo yeni stile
- `src/views/admin/esim-detail.ejs` — Detay kartlari yeni stile
- `src/views/admin/assign-esim.ejs` — Form yeni stile
- `src/views/admin/topup.ejs` — Form yeni stile
- `src/views/admin/zendit-purchase.ejs` — Form yeni stile (yeni eklendi, zaten warm sand uyumlu olmali)

### Degismeyen Dosyalar
- `src/views/demo/` — Demo dosyalari referans olarak kalir
- `src/routes/demo.js` — Degismez
- Backend controller'lar — Degismez
- `public/styles.css` — `npm run css:build` ile yeniden olusturulur

## 8. Kapsam Disi

- Demo-only sayfalar (receipt, compatibility detail vs.) production'a eklenmiyor
- Backend/controller logic degismiyor
- Yeni sayfa veya route eklenmiyor
- Service worker / offline sayfalari degismiyor
- Lucide icon CDN degismiyor (mevcut aynen kalir)
