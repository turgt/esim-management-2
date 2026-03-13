import { Router } from 'express';

const router = Router();

const legalPages = {
  'about':           { title: 'Hakkimizda',                 view: 'legal/about' },
  'distance-sales':  { title: 'Mesafeli Satis Sozlesmesi',  view: 'legal/distance-sales' },
  'delivery-refund': { title: 'Teslimat ve Iade Sartlari',  view: 'legal/delivery-refund' },
  'kvkk':            { title: 'KVKK Aydinlatma Metni',      view: 'legal/kvkk' },
  'refund':          { title: 'Para Iadesi Politikasi',      view: 'legal/refund' },
  'terms':           { title: 'Hizmet Sartlari',             view: 'legal/terms' },
  'privacy':         { title: 'Gizlilik Politikasi',         view: 'legal/privacy' }
};

for (const [slug, page] of Object.entries(legalPages)) {
  router.get(`/${slug}`, (req, res) => {
    res.render(page.view, {
      title: page.title,
      user: req.session?.user || null
    });
  });
}

export default router;
