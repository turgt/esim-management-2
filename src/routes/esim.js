import {Router} from 'express';
import * as c from '../controllers/esimController.js';
import {ensureAuth} from '../middleware/auth.js';

const r=Router();
r.get('/offers',ensureAuth,c.offers);
r.post('/purchase',ensureAuth,c.createPurchase);
r.get('/purchases',ensureAuth,c.listPurchases);
r.get('/purchases/:id',ensureAuth,c.purchaseStatus);
r.get('/purchases/:id/qrcode',ensureAuth,c.purchaseQr);

export default r;
