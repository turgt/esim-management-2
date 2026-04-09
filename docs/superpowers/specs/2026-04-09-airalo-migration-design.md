# Airalo Migration — Design Spec

## Ozet

Sistemin birincil eSIM saglayicisini Zendit'ten Airalo'ya gecirme. Kullanicilar sadece Airalo planlarini gorecek. Zendit yalnizca admin panelinde kalan bakiyeyi tuketmek icin kalacak. Zendit'ten alinan eski eSIM'ler veritabaninda korunacak.

## Kararlar

- **Airalo Node.js SDK** (`airalo-sdk` npm) kullanilacak — otomatik auth, cache, rate limit
- Airalo paketleri **saatte bir DB'ye senkronize** edilecek (Airalo'nun onerisi)
- Esim modeline `vendor` alani eklenecek — mevcut kayitlar `'zendit'` olarak migrate edilecek
- Zendit client aynen kalacak, sadece admin rotalari ile erisim
- Paddle odeme akisi aynen devam edecek

## 1. Veritabani Degisiklikleri

### Esim Modeli — Yeni Alanlar

| Alan | Tip | Default | Aciklama |
|------|-----|---------|----------|
| `vendor` | STRING | `'airalo'` | `'zendit'` veya `'airalo'` |
| `vendorOrderId` | STRING (nullable) | null | Airalo order ID'si |
| `vendorData` | JSONB (nullable) | null | Vendor'a ozel ekstra veri (lpa, matching_id, qrcode_url, direct_apple_installation_url vs.) |

### Migration

- Mevcut tum eSIM kayitlari `vendor = 'zendit'` olarak guncellenecek
- Yeni kayitlar default olarak `'airalo'` alacak

### Yeni Tablo — `AiraloPackage`

Airalo paketlerini cache'lemek icin (saatlik senkronizasyon).

| Alan | Tip | Aciklama |
|------|-----|----------|
| `id` | INTEGER (PK) | Auto-increment |
| `packageId` | STRING (unique) | Airalo package ID (e.g., "meraki-mobile-7days-1gb") |
| `slug` | STRING | Ulke/bolge slug'i (e.g., "turkey") |
| `countryCode` | STRING (nullable) | ISO ulke kodu (bos = global) |
| `title` | STRING | Paket basligi |
| `operatorTitle` | STRING | Operator adi |
| `type` | STRING | "local" veya "global" |
| `data` | STRING | Data gosterimi (e.g., "10 GB", "Unlimited") |
| `day` | INTEGER | Gecerlilik suresi (gun) |
| `amount` | INTEGER | Data miktari (MB) |
| `price` | DECIMAL(10,2) | Perakende fiyat (USD) |
| `netPrice` | DECIMAL(10,2) | Partner fiyat (USD) |
| `isUnlimited` | BOOLEAN | Limitsiz mi |
| `voice` | INTEGER (nullable) | Dakika |
| `text` | INTEGER (nullable) | SMS |
| `rechargeability` | BOOLEAN | Top-up destegi var mi |
| `imageUrl` | STRING (nullable) | Ulke/operator gorseli |
| `rawData` | JSONB | Tum API yaniti (yedek) |
| `lastSyncedAt` | DATE | Son senkronizasyon zamani |
| `createdAt` | DATE | |
| `updatedAt` | DATE | |

**Vendor modeline dokunulmayacak** — mevcut Vendor modeli referral sistemi icin, karistirilmayacak.

## 2. Airalo Client & Senkronizasyon

### `src/services/airaloClient.js`

Airalo SDK wrapper. `airalo-sdk` npm paketi kullanilacak.

```javascript
import { Airalo } from 'airalo-sdk';

const airalo = new Airalo({
  client_id: process.env.AIRALO_CLIENT_ID,
  client_secret: process.env.AIRALO_CLIENT_SECRET,
});
await airalo.initialize();
```

| Fonksiyon | SDK/REST | Aciklama |
|-----------|----------|----------|
| `initialize()` | SDK: `airalo.initialize()` | Baslangic, auth token al |
| `getPackages(country?)` | SDK: `getCountryPackages()` / `getAllPackages(true)` | Paket listesi (flat format) |
| `createOrder(packageId, qty, desc)` | SDK: `order()` | eSIM satin alma |
| `getEsim(iccid)` | REST: `GET /v2/sims/{iccid}` | eSIM detayi |
| `getUsage(iccid)` | REST: `GET /v2/sims/{iccid}/usage` | Kullanim bilgisi |
| `getTopupPackages(iccid)` | REST: `GET /v2/sims/{iccid}/topups` | Top-up paketleri |
| `createTopup(packageId, iccid)` | REST: `POST /v2/orders/topups` | Top-up siparisi |
| `getBalance()` | REST: `GET /v2/balance` | Bakiye kontrolu |

SDK'nin desteklemedigi endpoint'ler icin dogrudan REST cagrisi yapilacak, SDK'nin auth token'i kullanilarak.

### `src/services/airaloSync.js`

Paket senkronizasyonu:

- `syncPackages()`: `getAllPackages(true)` ile tum katalogu ceker, `AiraloPackage` tablosuna upsert yapar
- `setInterval` ile saatte bir calisir (`server.js`'de baslatilir)
- Uygulama acilisinda da bir kez calisir
- Basarisiz olursa log yazar, retry yok (bir sonraki saatte tekrar dener)

### Environment Variables

```
AIRALO_CLIENT_ID=xxx
AIRALO_CLIENT_SECRET=xxx
AIRALO_ENV=production    # veya sandbox
```

## 3. Satin Alma Akislari

### Kullanici Satin Alma (Airalo)

```
1. GET /offers → AiraloPackage tablosundan paketleri listele (DB'den)
2. Kullanici paket secer → GET /payment/:packageId → odeme sayfasi
3. Paddle checkout baslar → Payment kaydi olusur (status: pending)
4. Paddle webhook gelir → payment completed
5. airaloClient.createOrder(packageId, 1, description)
6. Airalo yanitindan: iccid, qrcode_url, lpa, matching_id alinir
7. Esim kaydi olusur: vendor='airalo', vendorOrderId=order.id,
   vendorData={qrcode_url, lpa, matching_id, direct_apple_installation_url, ...}
8. Redirect → /status/:txId
```

### Admin Zendit Satin Alma (kalan bakiyeyi tuketmek icin)

```
1. GET /admin/zendit/purchase → Zendit offers listesi (mevcut zenditClient)
2. POST /admin/zendit/purchase → zenditClient.purchaseEsim()
3. Esim kaydi: vendor='zendit'
4. Sadece isAdmin middleware ile korunan ayri bir sayfa
```

### Admin Airalo Satin Alma (assign)

```
1. Mevcut /admin/assign-esim sayfasi → Airalo paketlerini gosterecek
2. airaloClient.createOrder() kullanacak
3. Esim kaydi: vendor='airalo'
```

### Eski Zendit eSIM'ler — Kullanici Tarafi

- Purchases listesinde gorunmeye devam edecek (DB'den)
- Durum/usage sorgusu yapilamayacak (API cagrisi yok)
- "Zendit" badge'i gosterilecek

### Eski Zendit eSIM'ler — Admin Tarafi

- Durum sorgulama: `zenditClient.getPurchase()` — calismaya devam edecek
- Top-up: `zenditClient.purchaseEsim(offerId, txId, iccid)` — calismaya devam edecek
- QR code: `zenditClient.getPurchaseQrCode()` — calismaya devam edecek

### QR Code

- Airalo eSIM'ler: `vendorData.qrcode_url` + `vendorData.direct_apple_installation_url`
- Zendit eSIM'ler: `zenditClient.getPurchaseQrCode()` — sadece admin erisebilecek

## 4. Route & View Degisiklikleri

### Yeni Rotalar

| Rota | Method | Aciklama |
|------|--------|----------|
| `/admin/zendit/purchase` | GET | Zendit plan listesi (admin only) |
| `/admin/zendit/purchase` | POST | Zendit'ten satin al (admin only) |
| `/admin/zendit/esims/:id/status` | GET | Zendit eSIM durum sorgula (admin only) |
| `/admin/zendit/topup/:esimId` | POST | Zendit eSIM top-up (admin only) |

### Degisen Rotalar

| Rota | Degisiklik |
|------|-----------|
| `GET /offers` | Zendit API yerine AiraloPackage tablosundan oku |
| `POST /purchases` | zenditClient yerine airaloClient kullan |
| `GET /status/:txId` | Vendor'a gore farkli veri goster |
| `GET /qrcode/:txId` | Airalo: vendorData.qrcode_url, Zendit: admin-only |
| `GET /usage/:txId` | Airalo: airaloClient.getUsage(), Zendit: admin-only |
| `GET /admin/assign-esim` | Airalo paketlerini goster |
| `POST /admin/assign-esim` | airaloClient.createOrder() kullan |

### View Degisiklikleri

- `offers.ejs` — AiraloPackage formatina uygun render (image, operator, data/voice/text)
- `purchases.ejs` — vendor badge goster (Airalo/Zendit etiketi)
- `status.ejs` — vendor'a gore farkli detay goster
- `qrcode.ejs` — Airalo: qrcode_url + direct_apple_installation_url, Zendit: eski flow
- **Yeni:** `admin/zendit-purchase.ejs` — admin Zendit satin alma sayfasi
- `admin/esim-detail.ejs` — vendor bilgisi + vendor'a gore aksiyonlar
- Admin sidebar'a "Zendit Satin Al" linki eklenecek (bakiye bilgisiyle)

## 5. Guvenlik & Edge Case'ler

### Guvenlik

- Airalo credentials env variable'da — SDK otomatik token yonetimi
- Zendit rotalari `isAdmin` middleware ile korunacak
- Kullanicilar Zendit endpoint'lerine erisemeyecek
- `vendorData` icinde hassas veri yok

### Edge Case'ler

- **Airalo senkronizasyon basarisiz:** Son basarili senkronizasyondaki paketler DB'de kalir, offers sayfasi calismaya devam eder. Log yazilir.
- **Airalo API down (satin alma sirasinda):** Payment completed ama eSIM olusamadi → admin retry mekanizmasi (`retryEsimPurchase` mantigi Airalo icin de calisacak)
- **Zendit bakiyesi bittiginde:** Admin sayfasinda bakiye gosterilecek, 0 ise uyari
- **Migration rollback:** `vendor` alani kaldirilir, sistem eski haline doner
- **Airalo SDK cache dizini:** `.cache` klasoru `.gitignore`'a eklenecek

## 6. Kapsam Disi

- Airalo webhook entegrasyonu (low data notification vs.)
- Airalo future orders
- Airalo async order
- Airalo voucher sistemi
- Vendor bazli raporlama/analytics
- Vendor modeli degisikligi (referral sistemi ayri kalacak)

## Airalo API Referansi

### Authentication
- `POST /v2/token` — OAuth2 client_credentials, token ~366 gun gecerli, 24 saatte bir yenilenmeli
- Rate: 5 req/min

### Packages
- `GET /v2/packages` — Tum paketler, `filter[country]`, `filter[type]`, `limit`, `page`, `include=topup`
- Rate: 40 req/min
- ~3200 paket, saatlik senkronizasyon oneriliyor

### Orders
- `POST /v2/orders` — eSIM satin alma (multipart/form-data: package_id, quantity, type="sim", description)
- Yanit: order detaylari + sims array (iccid, lpa, qrcode, qrcode_url, direct_apple_installation_url, apn)

### eSIM Management
- `GET /v2/sims/{iccid}` — eSIM detayi
- `GET /v2/sims/{iccid}/usage` — Kullanim (remaining/total MB, voice, text, status, expired_at). Rate: 100 req/min/iccid, 20 min cache
- `GET /v2/sims/{iccid}/topups` — Top-up paketleri
- `POST /v2/orders/topups` — Top-up siparisi (package_id, iccid)

### Balance
- `GET /v2/balance` — { amount, currency }

### Rate Limits
- Token: 5/min
- Packages: 40/min
- Usage: 100/min/iccid
- SIM Packages: 1/15min/iccid
- 429 Too Many Attempts response
