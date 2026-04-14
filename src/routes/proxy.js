import express from 'express';
import { showProxyPage, checkBookingStatus } from '../controllers/proxyController.js';

const router = express.Router();

router.get('/e/:token', showProxyPage);
router.get('/api/booking-status/:token', checkBookingStatus);

export default router;
