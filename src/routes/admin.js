import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import {
  showDashboard, listUsers, createUser, editUser,
  showAssignEsim, assignEsim, showTopup, topupEsim,
  showAllEsims, showEsimDetail,
  listPayments, retryEsimPurchase, resolvePayment
} from '../controllers/adminController.js';
import {
  listVendors, showCreateVendor, createVendor,
  showVendorDetail, showEditVendor, updateVendor,
  deleteVendor, downloadQrCode
} from '../controllers/vendorController.js';
import { adminCreateUserRules, assignEsimRules, topupRules, validate } from '../middleware/validation.js';

const router = express.Router();

// Dashboard
router.get('/dashboard', ensureAuth, ensureAdmin, showDashboard);

// Users
router.get('/users', ensureAuth, ensureAdmin, listUsers);
router.post('/users', ensureAuth, ensureAdmin, adminCreateUserRules, validate, createUser);
router.post('/users/:id/edit', ensureAuth, ensureAdmin, editUser);

// eSIM Management
router.get('/esims', ensureAuth, ensureAdmin, showAllEsims);
router.get('/esims/:id', ensureAuth, ensureAdmin, showEsimDetail);

// Assign eSIM
router.get('/assign-esim', ensureAuth, ensureAdmin, showAssignEsim);
router.post('/assign-esim', ensureAuth, ensureAdmin, assignEsimRules, validate, assignEsim);

// Top-up
router.get('/topup/:esimId', ensureAuth, ensureAdmin, showTopup);
router.post('/topup/:esimId', ensureAuth, ensureAdmin, topupRules, validate, topupEsim);

// Payment Management
router.get('/payments', ensureAuth, ensureAdmin, listPayments);
router.post('/payments/:id/retry', ensureAuth, ensureAdmin, retryEsimPurchase);
router.post('/payments/:id/resolve', ensureAuth, ensureAdmin, resolvePayment);

// Vendor Management
router.get('/vendors', ensureAuth, ensureAdmin, listVendors);
router.get('/vendors/create', ensureAuth, ensureAdmin, showCreateVendor);
router.post('/vendors/create', ensureAuth, ensureAdmin, createVendor);
router.get('/vendors/:id', ensureAuth, ensureAdmin, showVendorDetail);
router.get('/vendors/:id/edit', ensureAuth, ensureAdmin, showEditVendor);
router.post('/vendors/:id/edit', ensureAuth, ensureAdmin, updateVendor);
router.post('/vendors/:id/delete', ensureAuth, ensureAdmin, deleteVendor);
router.get('/vendors/:id/qr', ensureAuth, ensureAdmin, downloadQrCode);

export default router;
