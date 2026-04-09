import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockPlans = [
  {
    id: 1,
    country: 'Türkiye',
    flag: '🇹🇷',
    flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)',
    data: '10 GB',
    duration: '30 gün',
    durationNum: 30,
    network: '5G',
    price: '$4.99',
    featured: true,
  },
  {
    id: 2,
    country: 'Avrupa',
    flag: '🇪🇺',
    flagBg: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
    data: '5 GB',
    duration: '15 gün',
    durationNum: 15,
    network: '4G',
    price: '$9.99',
    featured: false,
  },
  {
    id: 3,
    country: 'ABD',
    flag: '🇺🇸',
    flagBg: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
    data: '3 GB',
    duration: '7 gün',
    durationNum: 7,
    network: '5G',
    price: '$6.99',
    featured: false,
  },
  {
    id: 4,
    country: 'Asya Paketi',
    flag: '🌏',
    flagBg: 'linear-gradient(135deg, #fef9c3, #fde68a)',
    data: '8 GB',
    duration: '30 gün',
    durationNum: 30,
    network: '4G',
    price: '$12.99',
    featured: false,
  },
  {
    id: 5,
    country: 'Global',
    flag: '🌍',
    flagBg: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
    data: '20 GB',
    duration: '30 gün',
    durationNum: 30,
    network: '5G',
    price: '$19.99',
    featured: false,
  },
  {
    id: 6,
    country: 'Türkiye',
    flag: '🇹🇷',
    flagBg: 'linear-gradient(135deg, #fee2e2, #fecaca)',
    data: '1 GB',
    duration: '7 gün',
    durationNum: 7,
    network: '4G',
    price: '$1.99',
    featured: false,
  },
];

const mockPurchase = {
  country: 'Türkiye',
  data: '10 GB',
  duration: '30 gün',
  network: '5G',
  iccid: '8990000000000000001',
  date: '9 Nisan 2026',
};

const filters = ['Tümü', 'Türkiye', 'Avrupa', 'Asya', 'Amerika', 'Global'];

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

// Serve demo CSS
router.get('/styles.css', (req, res) => {
  const cssPath = path.join(__dirname, '..', 'views', 'demo', 'demo-styles.css');
  res.sendFile(cssPath);
});

// Landing page
router.get('/', (req, res) => {
  renderDemo(res, 'landing', {
    title: 'DataPatch',
    plans: mockPlans,
    showTabBar: false,
    showTopBar: false,
  });
});

// Login page
router.get('/login', (req, res) => {
  renderDemo(res, 'login', {
    title: 'Giriş',
    showTabBar: false,
    showTopBar: false,
  });
});

// Offers page
router.get('/offers', (req, res) => {
  renderDemo(res, 'offers', {
    title: 'Planlar',
    plans: mockPlans,
    filters,
    activeTab: 'plans',
  });
});

// Purchase status page
router.get('/status', (req, res) => {
  renderDemo(res, 'status', {
    title: 'Satın Alma Detayı',
    purchase: mockPurchase,
    activeTab: 'esims',
    backUrl: '/demo/offers',
  });
});

// QR code page
router.get('/qrcode', (req, res) => {
  renderDemo(res, 'qrcode', {
    title: 'eSIM Yükle',
    activeTab: 'esims',
    backUrl: '/demo/status',
  });
});

export default router;
