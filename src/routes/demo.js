import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Mock Data ───

const mockPlans = [
  { id: 1, country: 'Türkiye', flag: '🇹🇷', flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)', data: '10 GB', duration: '30 gün', durationNum: 30, network: '5G', price: '$4.99', featured: true },
  { id: 2, country: 'Avrupa', flag: '🇪🇺', flagBg: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', data: '5 GB', duration: '15 gün', durationNum: 15, network: '4G', price: '$9.99', featured: false },
  { id: 3, country: 'ABD', flag: '🇺🇸', flagBg: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', data: '3 GB', duration: '7 gün', durationNum: 7, network: '5G', price: '$6.99', featured: false },
  { id: 4, country: 'Asya Paketi', flag: '🌏', flagBg: 'linear-gradient(135deg, #fef9c3, #fde68a)', data: '8 GB', duration: '30 gün', durationNum: 30, network: '4G', price: '$12.99', featured: false },
  { id: 5, country: 'Global', flag: '🌍', flagBg: 'linear-gradient(135deg, #d1fae5, #a7f3d0)', data: '20 GB', duration: '30 gün', durationNum: 30, network: '5G', price: '$19.99', featured: false },
  { id: 6, country: 'Türkiye', flag: '🇹🇷', flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)', data: '1 GB', duration: '7 gün', durationNum: 7, network: '4G', price: '$1.99', featured: false },
];

const mockPurchase = {
  country: 'Türkiye',
  data: '10 GB',
  duration: '30 gün',
  network: '5G',
  iccid: '8990000000000000001',
  date: '9 Nisan 2026',
};

const mockPurchases = [
  { id: 1, country: 'Türkiye', flag: '🇹🇷', flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)', data: '10 GB', duration: '30 gün', iccid: '899000...0001', status: 'active', statusLabel: 'Aktif' },
  { id: 2, country: 'Avrupa', flag: '🇪🇺', flagBg: 'linear-gradient(135deg, #dbeafe, #bfdbfe)', data: '5 GB', duration: '15 gün', iccid: '899000...0002', status: 'active', statusLabel: 'Aktif' },
  { id: 3, country: 'ABD', flag: '🇺🇸', flagBg: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)', data: '3 GB', duration: '7 gün', iccid: '899000...0003', status: 'active', statusLabel: 'Aktif' },
  { id: 4, country: 'Global', flag: '🌍', flagBg: 'linear-gradient(135deg, #d1fae5, #a7f3d0)', data: '20 GB', duration: '30 gün', iccid: '899000...0004', status: 'pending', statusLabel: 'Bekleyen' },
  { id: 5, country: 'Türkiye', flag: '🇹🇷', flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)', data: '1 GB', duration: '7 gün', iccid: '899000...0005', status: 'expired', statusLabel: 'Süresi Dolmuş' },
  { id: 6, country: 'Asya Paketi', flag: '🌏', flagBg: 'linear-gradient(135deg, #fef9c3, #fde68a)', data: '8 GB', duration: '30 gün', iccid: '899000...0006', status: 'active', statusLabel: 'Aktif' },
];

const mockPayments = [
  { id: 1, plan: 'Türkiye 10GB', date: '9 Nisan 2026', amount: '$4.99', status: 'completed', statusLabel: 'Tamamlandı' },
  { id: 2, plan: 'Avrupa 5GB', date: '5 Nisan 2026', amount: '$9.99', status: 'completed', statusLabel: 'Tamamlandı' },
  { id: 3, plan: 'ABD 3GB', date: '1 Nisan 2026', amount: '$6.99', status: 'completed', statusLabel: 'Tamamlandı' },
  { id: 4, plan: 'Global 20GB', date: '28 Mart 2026', amount: '$19.99', status: 'pending', statusLabel: 'Bekleyen' },
  { id: 5, plan: 'Türkiye 1GB', date: '20 Mart 2026', amount: '$1.99', status: 'failed', statusLabel: 'Başarısız' },
];

const mockBrands = [
  { name: 'Apple', models: [
    { name: 'iPhone 15 Pro Max', compatible: true }, { name: 'iPhone 15 Pro', compatible: true },
    { name: 'iPhone 15', compatible: true }, { name: 'iPhone 14', compatible: true },
    { name: 'iPhone SE (3rd gen)', compatible: true }, { name: 'iPhone X', compatible: false },
  ]},
  { name: 'Samsung', models: [
    { name: 'Galaxy S24 Ultra', compatible: true }, { name: 'Galaxy S24+', compatible: true },
    { name: 'Galaxy S23', compatible: true }, { name: 'Galaxy Z Fold 5', compatible: true },
    { name: 'Galaxy A54', compatible: false },
  ]},
  { name: 'Google', models: [
    { name: 'Pixel 8 Pro', compatible: true }, { name: 'Pixel 8', compatible: true },
    { name: 'Pixel 7a', compatible: true }, { name: 'Pixel 6', compatible: true },
  ]},
  { name: 'Huawei', models: [
    { name: 'P60 Pro', compatible: true }, { name: 'Mate 50 Pro', compatible: true },
    { name: 'P40 Lite', compatible: false },
  ]},
  { name: 'Xiaomi', models: [
    { name: '13 Pro', compatible: true }, { name: '12T Pro', compatible: true },
    { name: 'Redmi Note 12', compatible: false },
  ]},
];

const mockOrder = {
  flag: '🇹🇷',
  flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)',
  country: 'Türkiye',
  data: '10 GB',
  duration: '30 gün',
  network: '5G',
  subtotal: '$4.16',
  tax: '$0.83',
  total: '$4.99',
};

// Admin mock data
const mockAdminUsers = [
  { id: 1, username: 'turgut', email: 'turgut@datapatch.co', role: 'admin', esimCount: 6, status: 'active' },
  { id: 2, username: 'ayse', email: 'ayse@example.com', role: 'user', esimCount: 3, status: 'active' },
  { id: 3, username: 'mehmet', email: 'mehmet@example.com', role: 'user', esimCount: 2, status: 'active' },
  { id: 4, username: 'zeynep', email: 'zeynep@example.com', role: 'user', esimCount: 1, status: 'active' },
  { id: 5, username: 'can', email: 'can@example.com', role: 'user', esimCount: 0, status: 'suspended' },
  { id: 6, username: 'elif', email: 'elif@example.com', role: 'user', esimCount: 4, status: 'active' },
];

const mockAdminEsims = [
  { id: 1, iccid: '8990000000000000001', user: 'turgut', plan: 'Türkiye 10GB', status: 'active', statusLabel: 'Aktif', date: '9 Nis 2026' },
  { id: 2, iccid: '8990000000000000002', user: 'ayse', plan: 'Avrupa 5GB', status: 'active', statusLabel: 'Aktif', date: '5 Nis 2026' },
  { id: 3, iccid: '8990000000000000003', user: 'turgut', plan: 'ABD 3GB', status: 'active', statusLabel: 'Aktif', date: '1 Nis 2026' },
  { id: 4, iccid: '8990000000000000004', user: 'mehmet', plan: 'Global 20GB', status: 'pending', statusLabel: 'Bekleyen', date: '28 Mar 2026' },
  { id: 5, iccid: '8990000000000000005', user: 'turgut', plan: 'Türkiye 1GB', status: 'expired', statusLabel: 'Süresi Dolmuş', date: '20 Mar 2026' },
  { id: 6, iccid: '8990000000000000006', user: 'zeynep', plan: 'Asya 8GB', status: 'active', statusLabel: 'Aktif', date: '15 Mar 2026' },
  { id: 7, iccid: '8990000000000000007', user: 'elif', plan: 'Türkiye 10GB', status: 'active', statusLabel: 'Aktif', date: '10 Mar 2026' },
  { id: 8, iccid: '8990000000000000008', user: 'can', plan: 'Avrupa 5GB', status: 'failed', statusLabel: 'Başarısız', date: '5 Mar 2026' },
];

const mockAdminPayments = [
  { id: 1, user: 'turgut', plan: 'Türkiye 10GB', amount: '$4.99', status: 'completed', statusLabel: 'Tamamlandı', date: '9 Nis 2026' },
  { id: 2, user: 'ayse', plan: 'Avrupa 5GB', amount: '$9.99', status: 'completed', statusLabel: 'Tamamlandı', date: '5 Nis 2026' },
  { id: 3, user: 'turgut', plan: 'ABD 3GB', amount: '$6.99', status: 'completed', statusLabel: 'Tamamlandı', date: '1 Nis 2026' },
  { id: 4, user: 'mehmet', plan: 'Global 20GB', amount: '$19.99', status: 'pending', statusLabel: 'Bekleyen', date: '28 Mar 2026' },
  { id: 5, user: 'can', plan: 'Avrupa 5GB', amount: '$9.99', status: 'failed', statusLabel: 'Başarısız', date: '5 Mar 2026' },
  { id: 6, user: 'elif', plan: 'Türkiye 10GB', amount: '$4.99', status: 'completed', statusLabel: 'Tamamlandı', date: '10 Mar 2026' },
];

const mockVendors = [
  { id: 1, name: 'Zendit', apiStatus: 'connected', esimCount: 245, commission: '%2.5' },
  { id: 2, name: 'Airalo', apiStatus: 'connected', esimCount: 89, commission: '%3.0' },
  { id: 3, name: 'eSIM Go', apiStatus: 'disconnected', esimCount: 8, commission: '%1.5' },
];

const mockEmails = [
  { id: 1, to: 'turgut@datapatch.co', subject: 'eSIM Aktivasyon Bilgisi', status: 'sent', statusLabel: 'Gönderildi', date: '9 Nis 2026 10:32' },
  { id: 2, to: 'ayse@example.com', subject: 'Hoş Geldiniz!', status: 'sent', statusLabel: 'Gönderildi', date: '5 Nis 2026 14:20' },
  { id: 3, to: 'mehmet@example.com', subject: 'Ödeme Onayı', status: 'sent', statusLabel: 'Gönderildi', date: '1 Nis 2026 09:15' },
  { id: 4, to: 'can@example.com', subject: 'Şifre Sıfırlama', status: 'failed', statusLabel: 'Başarısız', date: '28 Mar 2026 16:45' },
  { id: 5, to: 'elif@example.com', subject: 'eSIM Aktivasyon Bilgisi', status: 'sent', statusLabel: 'Gönderildi', date: '10 Mar 2026 11:00' },
  { id: 6, to: 'zeynep@example.com', subject: 'Top-up Onayı', status: 'sent', statusLabel: 'Gönderildi', date: '15 Mar 2026 08:30' },
];

const filters = ['Tümü', 'Türkiye', 'Avrupa', 'Asya', 'Amerika', 'Global'];

// ─── Render Helper ───

function renderDemo(res, template, locals) {
  const viewPath = path.join(__dirname, '..', 'views', 'demo', `${template}.ejs`);
  res.render(viewPath, { ...locals }, (err, body) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    const layoutPath = path.join(__dirname, '..', 'views', 'demo', 'layout.ejs');
    res.render(layoutPath, { ...locals, body });
  });
}

function renderAdminDemo(res, template, locals) {
  const viewPath = path.join(__dirname, '..', 'views', 'demo', 'admin', `${template}.ejs`);
  res.render(viewPath, { ...locals, adminMode: true }, (err, body) => {
    if (err) {
      res.status(500).send(err.message);
      return;
    }
    const layoutPath = path.join(__dirname, '..', 'views', 'demo', 'layout.ejs');
    res.render(layoutPath, { ...locals, adminMode: true, body });
  });
}

// ─── Static Assets ───

router.get('/styles.css', (req, res) => {
  const cssPath = path.join(__dirname, '..', 'views', 'demo', 'demo-styles.css');
  res.sendFile(cssPath);
});

// ─── User Routes ───

router.get('/', (req, res) => {
  renderDemo(res, 'landing', { title: 'DataPatch', plans: mockPlans, showTabBar: false, showTopBar: false });
});

router.get('/login', (req, res) => {
  renderDemo(res, 'login', { title: 'Giriş', showTabBar: false, showTopBar: false });
});

router.get('/register', (req, res) => {
  renderDemo(res, 'register', { title: 'Kayıt', showTabBar: false, showTopBar: false });
});

router.get('/forgot-password', (req, res) => {
  renderDemo(res, 'forgot-password', { title: 'Şifremi Unuttum', showTabBar: false, showTopBar: false });
});

router.get('/reset-password', (req, res) => {
  renderDemo(res, 'reset-password', { title: 'Şifre Sıfırla', showTabBar: false, showTopBar: false });
});

router.get('/verify-email', (req, res) => {
  renderDemo(res, 'verify-email', { title: 'E-posta Doğrulama', showTabBar: false, showTopBar: false });
});

router.get('/offers', (req, res) => {
  renderDemo(res, 'offers', { title: 'Planlar', plans: mockPlans, filters, activeTab: 'plans' });
});

router.get('/purchases', (req, res) => {
  renderDemo(res, 'purchases', { title: 'eSIM\'lerim', purchases: mockPurchases, activeTab: 'esims' });
});

router.get('/status', (req, res) => {
  renderDemo(res, 'status', { title: 'Satın Alma Detayı', purchase: mockPurchase, activeTab: 'esims', backUrl: '/demo/purchases' });
});

router.get('/qrcode', (req, res) => {
  renderDemo(res, 'qrcode', { title: 'eSIM Yükle', activeTab: 'esims', backUrl: '/demo/status' });
});

router.get('/profile', (req, res) => {
  renderDemo(res, 'profile', { title: 'Profil', activeTab: 'profile' });
});

router.get('/compatibility', (req, res) => {
  renderDemo(res, 'compatibility', { title: 'Cihaz Uyumluluğu', brands: mockBrands, activeTab: '' });
});

router.get('/payment', (req, res) => {
  renderDemo(res, 'payment', { title: 'Ödeme', order: mockOrder, showTabBar: false, backUrl: '/demo/offers' });
});

router.get('/payment-history', (req, res) => {
  renderDemo(res, 'payment-history', { title: 'Ödeme Geçmişi', payments: mockPayments, activeTab: 'payments' });
});

router.get('/receipt', (req, res) => {
  renderDemo(res, 'receipt', { title: 'Fatura Detayı', showTabBar: false, backUrl: '/demo/payment-history' });
});

// ─── Admin Routes ───

router.get('/admin/dashboard', (req, res) => {
  renderAdminDemo(res, 'dashboard', { title: 'Admin Dashboard', activeTab: 'dashboard' });
});

router.get('/admin/users', (req, res) => {
  renderAdminDemo(res, 'users', { title: 'Kullanıcı Yönetimi', users: mockAdminUsers, activeTab: 'users' });
});

router.get('/admin/esims', (req, res) => {
  renderAdminDemo(res, 'esims', { title: 'Tüm eSIM\'ler', esims: mockAdminEsims, activeTab: 'esims' });
});

router.get('/admin/esims/:id', (req, res) => {
  renderAdminDemo(res, 'esim-detail', { title: 'eSIM Detay', activeTab: 'esims', backUrl: '/demo/admin/esims' });
});

router.get('/admin/assign-esim', (req, res) => {
  renderAdminDemo(res, 'assign-esim', { title: 'eSIM Ata', users: mockAdminUsers, activeTab: 'esims', backUrl: '/demo/admin/esims' });
});

router.get('/admin/payments', (req, res) => {
  renderAdminDemo(res, 'payments', { title: 'Ödemeler', adminPayments: mockAdminPayments, activeTab: 'payments' });
});

router.get('/admin/topup/:id', (req, res) => {
  renderAdminDemo(res, 'topup', { title: 'Top-up', activeTab: 'esims', backUrl: '/demo/admin/esims/1' });
});

router.get('/admin/vendors', (req, res) => {
  renderAdminDemo(res, 'vendors', { title: 'Vendorlar', vendors: mockVendors, activeTab: 'vendors' });
});

router.get('/admin/vendors/new', (req, res) => {
  renderAdminDemo(res, 'vendor-form', { title: 'Vendor Ekle', isEdit: false, activeTab: 'vendors', backUrl: '/demo/admin/vendors' });
});

router.get('/admin/vendors/:id', (req, res) => {
  const vendor = mockVendors[0];
  renderAdminDemo(res, 'vendor-detail', { title: vendor.name, vendor, activeTab: 'vendors', backUrl: '/demo/admin/vendors' });
});

router.get('/admin/vendors/:id/edit', (req, res) => {
  const vendor = mockVendors[0];
  renderAdminDemo(res, 'vendor-form', { title: 'Vendor Düzenle', vendor, isEdit: true, activeTab: 'vendors', backUrl: '/demo/admin/vendors/1' });
});

router.get('/admin/emails', (req, res) => {
  renderAdminDemo(res, 'emails', { title: 'E-posta Logları', emails: mockEmails, activeTab: '' });
});

router.get('/admin/emails/:id', (req, res) => {
  const email = mockEmails[0];
  renderAdminDemo(res, 'email-detail', { title: email.subject, email, activeTab: '', backUrl: '/demo/admin/emails' });
});

export default router;
