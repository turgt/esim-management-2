import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import {
  showDashboard, listUsers, createUser, editUser,
  showAssignEsim, assignEsim, showTopup, topupEsim,
  showAllEsims, showEsimDetail,
  listPayments, retryEsimPurchase, resolvePayment
} from '../controllers/adminController.js';
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

export default router;
