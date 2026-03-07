import { doubleCsrf } from 'csrf-csrf';
import cookieParser from 'cookie-parser';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'csrf' });

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'development-secret-change-in-production',
  getSessionIdentifier: (req) => req.session?.user?.id?.toString() || '',
  cookieName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  },
  getCsrfTokenFromRequest: (req) => {
    return req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'];
  }
});

// Middleware to set CSRF token in res.locals for templates
function csrfTokenMiddleware(req, res, next) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}

// Error handler for CSRF failures
function csrfErrorHandler(err, req, res, next) {
  if (err.code === 'EBADCSRFTOKEN' || err.message?.includes('csrf')) {
    log.warn({ method: req.method, path: req.path, ip: req.ip }, 'CSRF validation failed');
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return res.status(403).render('error', {
      message: 'Form session expired. Please go back and try again.',
      title: 'Security Error'
    });
  }
  next(err);
}

export { cookieParser, doubleCsrfProtection, csrfTokenMiddleware, csrfErrorHandler };
