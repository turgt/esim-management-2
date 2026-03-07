import { Router } from 'express';
import { ensureAuth } from '../middleware/auth.js';

const router = Router();

// All payment endpoints return 501 - Not Implemented
const notImplemented = (req, res) => {
  res.status(501).json({
    error: 'Payment system not yet available',
    message: 'This feature is coming soon. Stay tuned!'
  });
};

router.post('/create', ensureAuth, notImplemented);
router.post('/webhook', notImplemented);
router.get('/status/:id', ensureAuth, notImplemented);

export default router;
