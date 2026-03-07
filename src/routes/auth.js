import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { registerRules, loginRules, forgotPasswordRules, resetPasswordRules, validate } from '../middleware/validation.js';
import { loginRateLimit, registrationRateLimit, passwordResetRateLimit } from '../middleware/performance.js';

const r = Router();

r.get('/login', c.showLogin);
r.post('/login', loginRateLimit, loginRules, validate, c.login);
r.get('/logout', c.logout);

r.get('/register', c.showRegister);
r.post('/register', registrationRateLimit, registerRules, validate, c.register);

r.get('/verify-email/:token', c.verifyEmail);

r.get('/forgot-password', c.showForgotPassword);
r.post('/forgot-password', passwordResetRateLimit, forgotPasswordRules, validate, c.forgotPassword);

r.get('/reset-password/:token', c.showResetPassword);
r.post('/reset-password/:token', resetPasswordRules, validate, c.resetPassword);

export default r;
