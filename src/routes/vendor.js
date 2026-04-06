import express from 'express';
import { ensureAuth, ensureVendor } from '../middleware/auth.js';
import { showVendorDashboard } from '../controllers/vendorDashboardController.js';

const router = express.Router();

router.get('/dashboard', ensureAuth, ensureVendor, showVendorDashboard);

export default router;
