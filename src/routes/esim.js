import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import { showOffers, createPurchase, showStatus, showQrCode, listUserPurchases, showUsage, debugOfferFields, debugEsimData, showCompatibility, checkCompatibility } from '../controllers/esimController.js';

const router = express.Router();

router.get('/offers', ensureAuth, showOffers);
router.get('/compatibility', ensureAuth, showCompatibility);
router.get('/api/compatibility', ensureAuth, checkCompatibility);
router.post('/purchases', ensureAuth, ensureAdmin, createPurchase);
router.get('/purchases', ensureAuth, listUserPurchases);
router.get('/status/:txId', ensureAuth, showStatus);
router.get('/qrcode/:txId', ensureAuth, showQrCode);
router.get('/usage/:txId', ensureAuth, showUsage);
router.get('/debug/offers', ensureAuth, ensureAdmin, debugOfferFields);
router.get('/debug/esim/:txId', ensureAuth, ensureAdmin, debugEsimData);

export default router;
