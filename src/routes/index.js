import { Router } from 'express';
import * as controller from '../controllers/esimController.js';

const router = Router();
router.get('/offers', controller.getOffers);
router.post('/purchase', controller.createPurchase);
router.get('/purchases/:txId', controller.getPurchaseStatus);
router.get('/purchases/:txId/qrcode', controller.getPurchaseQr);

export default router;
