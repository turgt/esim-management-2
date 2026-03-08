import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import { showOffers, createPurchase, showStatus, showQrCode, listUserPurchases, showUsage } from '../controllers/esimController.js';

const router = express.Router();

router.get('/offers', ensureAuth, showOffers);
router.post('/purchases', ensureAuth, ensureAdmin, createPurchase);
router.get('/purchases', ensureAuth, listUserPurchases);
router.get('/status/:txId', ensureAuth, showStatus);
router.get('/qrcode/:txId', ensureAuth, showQrCode);
router.get('/usage/:txId', ensureAuth, showUsage);

export default router;
