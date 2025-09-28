import express from 'express';
import { ensureAuth, ensureAdmin } from '../middleware/auth.js';
import { listUsers, createUser } from '../controllers/adminController.js';

const router = express.Router();

// Kullanıcıları listele
router.get('/users', ensureAuth, ensureAdmin, listUsers);

// Yeni kullanıcı ekle
router.post('/users', ensureAuth, ensureAdmin, createUser);

export default router;
