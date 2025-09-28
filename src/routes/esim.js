import express from 'express';
import { ensureAuth } from '../middleware/auth.js';
import { showOffers, createPurchase, showStatus, showQrCode } from '../controllers/esimController.js';

const router = express.Router();

router.get('/offers', ensureAuth, showOffers);
router.post('/purchases', ensureAuth, createPurchase);
router.get('/status/:txId', ensureAuth, showStatus);
router.get('/qrcode/:txId', ensureAuth, showQrCode);

export default router;
