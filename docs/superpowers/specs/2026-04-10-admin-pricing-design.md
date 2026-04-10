# Admin Fiyat Yonetimi — Tasarim Spesifikasyonu

**Tarih:** 2026-04-10
**Kapsam:** Admin panelinden Airalo paket fiyatlarini yonetme — global markup + paket bazli override

---

## 1. Data Model

### AiraloPackage — Yeni Field'lar

| Field | Type | Default | Aciklama |
|-------|------|---------|----------|
| `overrideType` | ENUM('none','fixed','markup') | 'none' | Override turu |
| `overrideValue` | DECIMAL(10,2) | null | fixed → satis fiyati, markup → yuzde |

Migration dosyasi: `add-pricing-override-to-airalo-packages.cjs`

### Settings Modeli (Yeni)

| Field | Type | Aciklama |
|-------|------|----------|
| `key` | STRING, PK, unique | Ayar adi |
| `value` | STRING | Deger |

Baslangic kaydi: `key: 'global_markup_percent'`, `value: '0'`

Migration dosyasi: `create-settings-table.cjs`

### Fiyat Hesaplama Mantigi

```
calcFinalPrice(package, globalMarkup):
  if overrideType === 'fixed'  → return overrideValue
  if overrideType === 'markup' → return price * (1 + overrideValue / 100)
  if overrideType === 'none'   → return price * (1 + globalMarkup / 100)
```

Tek fonksiyon, hem controller hem view tarafindan kullanilir: `src/services/pricingService.js`

---

## 2. API Endpoints

Tum route'lar `/admin/pricing` altinda, `isAdmin` middleware ile korunur.

| Method | Path | Aciklama |
|--------|------|----------|
| GET | `/admin/pricing` | Fiyat yonetim sayfasi |
| POST | `/admin/pricing/global-markup` | Global markup % guncelle |
| POST | `/admin/pricing/preview` | Degisiklikleri onizle (kaydetmez) |
| POST | `/admin/pricing/override` | Paket bazli override'lari kaydet |
| POST | `/admin/pricing/reset/:packageId` | Paketi override'dan cikar |

### Route Dosyalari

- `src/routes/admin.js` — yeni route tanimlari eklenir
- `src/controllers/pricingController.js` — yeni controller dosyasi

### Preview Akisi

1. Admin UI'da degisiklik yapar (henuz kaydedilmez, client-side state)
2. "Onizle" butonuna basar → `POST /admin/pricing/preview`
   - Body: `{ globalMarkup?: number, overrides: [{ packageId, type, value }] }`
3. Server hesaplar, dondurur: `{ changes: [{ packageId, title, oldPrice, newPrice, profit }] }`
4. Modal'da onizleme gosterilir
5. Admin "Uygula" derse → `POST /admin/pricing/override` ile kaydedilir

---

## 3. Admin UI

### Sayfa: `/admin/pricing` (pricing.ejs)

**Ust Bolum — Global Markup Card:**
- Sol: "Global Markup" basligi + aciklama ("Override olmayan tum paketlere uygulanir")
- Sag: `%` input (number, step 0.1) + "Kaydet" butonu
- Mevcut deger input'ta gosterilir

**Orta Bolum — Ulke Gruplari (Collapse/Expand):**
- Her ulke bir card
- Baslik: bayrak emoji + ulke adi + paket sayisi + expand/collapse toggle
- Default: tum gruplar kapali (collapsed)
- Basliga tiklaninca acilir

**Paket Tablosu (her ulke grubunun icinde):**

| Kolon | Aciklama |
|-------|----------|
| Paket Adi | title + operatorTitle |
| Data / Sure | 1GB / 7 gun gibi |
| Maliyet (Net) | Airalo netPrice (readonly, gri) |
| Airalo Fiyat | Airalo price (readonly, gri) |
| Override | Dropdown: Yok / Sabit Fiyat / Markup % |
| Deger | Override secimine gore input (Yok seciliyse disabled) |
| Son Fiyat | Hesaplanmis final fiyat (canli guncellenir, JS ile) |
| Kar | Son Fiyat - Maliyet (yesil pozitif, kirmizi negatif) |

**Alt Bar (sticky, degisiklik varken gorunur):**
- "X degisiklik" sayaci
- "Onizle" butonu → preview modal acar
- "Iptal" butonu → degisiklikleri sifirlar

**Preview Modal:**
- Degisen paketlerin listesi: paket adi, eski fiyat → yeni fiyat, kar
- "Uygula" butonu → `POST /admin/pricing/override`
- "Vazgec" butonu → modal kapatir

**Responsive:** Mobilde tablo yatay scroll, sticky bar altta kalir.

---

## 4. Sync Korumasi

### airaloSync.js Degisiklikleri

Upsert isleminde guncellenen field listesi **sadece** Airalo field'lari:
`price`, `netPrice`, `title`, `operatorTitle`, `data`, `day`, `amount`, `type`, `isUnlimited`, `voice`, `text`, `rechargeability`, `imageUrl`, `rawData`, `lastSyncedAt`

`overrideType` ve `overrideValue` **upsert listesinden haric tutulur.**

Yeni paket gelirse: `overrideType` default 'none', `overrideValue` default null → otomatik olarak global markup uygulanir.

### Offers Sayfasi Entegrasyonu

`esimController.js` `showOffers` fonksiyonu degisir:
- Settings'ten `global_markup_percent` okunur
- Her paket icin `calcFinalPrice(pkg, globalMarkup)` cagrilir
- Template'e `finalPrice` gonderilir (raw `price` yerine)

Payment route da `finalPrice` kullanir.

---

## 5. Edge Case'ler

| Durum | Davranis |
|-------|----------|
| Airalo fiyat degisirse, override fixed ise | Son fiyat degismez |
| Airalo fiyat degisirse, override markup ise | Yeni Airalo fiyati * markup ile guncellenir |
| Airalo fiyat degisirse, override yok ise | Yeni Airalo fiyati * global markup |
| Paket Airalo'dan kaldilirsa | Sync silmez, eski paketler kalir |
| Global markup 0 ise | Airalo fiyati oldugi gibi gosterilir |
| Override ile kar negatif olursa | Kar kolonu kirmizi gosterilir (uyari, engel yok) |
| Admin ayni anda birden fazla paket duzenlerse | Toplu preview + toplu apply |

---

## 6. Dosya Degisiklikleri Ozeti

| Dosya | Islem |
|-------|-------|
| `src/db/models/airaloPackage.js` | `overrideType`, `overrideValue` field'lari eklenir |
| `src/db/models/setting.js` | Yeni model |
| `src/db/models/index.js` | Setting modeli register edilir |
| `src/db/migrations/XXXX-add-pricing-override-to-airalo-packages.cjs` | Yeni migration |
| `src/db/migrations/XXXX-create-settings-table.cjs` | Yeni migration |
| `src/services/pricingService.js` | `calcFinalPrice()` fonksiyonu |
| `src/controllers/pricingController.js` | Yeni controller — 5 handler |
| `src/routes/admin.js` | Pricing route'lari eklenir |
| `src/views/admin/pricing.ejs` | Yeni view |
| `src/services/airaloSync.js` | Upsert field listesinden override field'lari haric tutulur |
| `src/controllers/esimController.js` | showOffers'ta finalPrice hesaplanir |
| `src/views/offers.ejs` | `finalPrice` kullanilir |
| `src/input.css` | Pricing sayfasi icin gerekli stiller |
