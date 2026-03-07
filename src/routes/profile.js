import { Router } from 'express';
import { ensureAuth } from '../middleware/auth.js';
import { showProfile, updateProfile, changePassword, showMyEsims } from '../controllers/profileController.js';
import { profileUpdateRules, passwordChangeRules, validate } from '../middleware/validation.js';

const router = Router();

router.get('/', ensureAuth, showProfile);
router.post('/', ensureAuth, profileUpdateRules, validate, updateProfile);
router.post('/password', ensureAuth, passwordChangeRules, validate, changePassword);
router.get('/esims', ensureAuth, showMyEsims);

export default router;
