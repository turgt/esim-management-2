import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import {
  showDashboard, listUsers, createUser, editUser,
  showAssignEsim, assignEsim, showTopup, topupEsim,
  showAllEsims, showEsimDetail,
  listPayments, retryEsimPurchase, resolvePayment, cancelPayment,
  listEmails, showEmailDetail, downloadAttachment, replyToEmail,
  showZenditPurchase, zenditPurchase,
  listAgencies, showAgencyDetail, createAgency, createContract,
  listWebhookLogs, retryWebhook
} from '../controllers/adminController.js';
import {
  listVendors, showCreateVendor, createVendor,
  showVendorDetail, showEditVendor, updateVendor,
  deleteVendor, downloadQrCode
} from '../controllers/vendorController.js';
import {
  showPricing, updateGlobalMarkup, previewChanges, saveOverrides, resetOverride
} from '../controllers/pricingController.js';
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
router.post('/payments/:id/cancel', ensureAuth, ensureAdmin, cancelPayment);

// Vendor Management
router.get('/vendors', ensureAuth, ensureAdmin, listVendors);
router.get('/vendors/create', ensureAuth, ensureAdmin, showCreateVendor);
router.post('/vendors/create', ensureAuth, ensureAdmin, createVendor);
router.get('/vendors/:id', ensureAuth, ensureAdmin, showVendorDetail);
router.get('/vendors/:id/edit', ensureAuth, ensureAdmin, showEditVendor);
router.post('/vendors/:id/edit', ensureAuth, ensureAdmin, updateVendor);
router.post('/vendors/:id/delete', ensureAuth, ensureAdmin, deleteVendor);
router.get('/vendors/:id/qr', ensureAuth, ensureAdmin, downloadQrCode);

// Email Management
router.get('/emails', ensureAuth, ensureAdmin, listEmails);
router.get('/emails/:id', ensureAuth, ensureAdmin, showEmailDetail);
router.get('/emails/:id/attachment/:attachmentIndex', ensureAuth, ensureAdmin, downloadAttachment);
router.post('/emails/:id/reply', ensureAuth, ensureAdmin, replyToEmail);

// Zendit Purchase (admin-only)
router.get('/zendit/purchase', ensureAuth, ensureAdmin, showZenditPurchase);
router.post('/zendit/purchase', ensureAuth, ensureAdmin, zenditPurchase);

// Pricing Management
router.get('/pricing', ensureAuth, ensureAdmin, showPricing);
router.post('/pricing/global-markup', ensureAuth, ensureAdmin, updateGlobalMarkup);
router.post('/pricing/preview', ensureAuth, ensureAdmin, express.json(), previewChanges);
router.post('/pricing/override', ensureAuth, ensureAdmin, express.json(), saveOverrides);
router.post('/pricing/reset/:packageId', ensureAuth, ensureAdmin, express.json(), resetOverride);

// Agency Management
router.get('/agencies', ensureAuth, ensureAdmin, listAgencies);
router.post('/agencies', ensureAuth, ensureAdmin, createAgency);
router.get('/agencies/:id', ensureAuth, ensureAdmin, showAgencyDetail);
router.post('/agencies/:id/contracts', ensureAuth, ensureAdmin, createContract);

// Webhook Logs
router.get('/webhook-logs', ensureAuth, ensureAdmin, listWebhookLogs);
router.post('/webhook-logs/:id/retry', ensureAuth, ensureAdmin, retryWebhook);

export default router;
