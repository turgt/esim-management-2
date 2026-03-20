import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

import logger from './lib/logger.js';
import httpLogger from './lib/httpLogger.js';
import { validateEnv } from './lib/validateEnv.js';
import { bootstrap } from './lib/startup.js';

// Validate environment variables early
validateEnv();

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import esimRoutes from './routes/esim.js';
import profileRoutes from './routes/profile.js';
import paymentRoutes from './routes/payment.js';
import legalRoutes from './routes/legal.js';
import { cookieParser, doubleCsrfProtection, csrfTokenMiddleware, csrfErrorHandler } from './middleware/csrf.js';
import { verifyPaddleWebhook, processPaddleWebhook } from './services/paymentService.js';

import {
  performanceMonitor,
  cacheMonitor,
  smartRateLimit,
  queryMonitor,
  healthCheck,
  asyncErrorHandler,
  securityHeaders,
  metricsCollector
} from './middleware/performance.js';

import db from './db/models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for Railway
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.paddle.com", "https://checkout.paddle.com", "https://sandbox-checkout.paddle.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://checkout.paddle.com", "https://sandbox-checkout.paddle.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.paddle.com", "https://checkout.paddle.com", "https://sandbox-checkout.paddle.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://checkout.paddle.com", "https://sandbox-checkout.paddle.com", "https://cdn.paddle.com"],
      frameSrc: ["'self'", "https://checkout.paddle.com", "https://sandbox-checkout.paddle.com"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// Security headers
app.use(securityHeaders);

// Performance monitoring
app.use(performanceMonitor);
app.use(cacheMonitor);
app.use(queryMonitor());
app.use(metricsCollector);

// Structured HTTP logging (replaces Morgan + requestLogger)
app.use(httpLogger);

// Rate limiting in production
if (process.env.NODE_ENV === 'production') {
  app.use(smartRateLimit(15 * 60 * 1000, 200));
}

// EJS settings
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Static files with caching
app.use('/public', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// Service Worker route
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// Cookie parser (required for CSRF)
app.use(cookieParser());

// Session configuration
const PgSession = pgSession(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 24 * 60 * 60
  }),
  secret: process.env.SESSION_SECRET || 'development-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// User context middleware + theme
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.NODE_ENV = process.env.NODE_ENV;
  res.locals.theme = req.session.user?.theme || 'light';
  next();
});

// Paddle webhook route — MUST be before CSRF middleware (server-to-server, no CSRF)
// Raw body is captured via the express.json() verify callback above (req.rawBody)
app.post('/payment/webhook', async (req, res) => {
  const wLog = logger.child({ module: 'paddle-webhook' });
  try {
    const signature = req.headers['paddle-signature'];
    if (!verifyPaddleWebhook(req.rawBody || '', signature)) {
      wLog.warn({ event_type: req.body?.event_type }, 'Paddle webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    wLog.info({ event_type: req.body?.event_type }, 'Paddle webhook received');
    await processPaddleWebhook(req.body);
    res.json({ received: true });
  } catch (err) {
    wLog.error({ err }, 'Paddle webhook processing error');
    res.status(500).json({ error: 'Internal error' });
  }
});

// CSRF protection (after session, before routes)
app.use(doubleCsrfProtection);
app.use(csrfTokenMiddleware);

// Health check endpoints
app.get('/health', asyncErrorHandler(healthCheck));
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// Metrics endpoint (admin only)
app.get('/metrics', asyncErrorHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { default: cacheService } = await import('./services/cacheService.js');
  const metrics = cacheService.get('system:metrics') || [];
  const recentMetrics = metrics.slice(-100);

  res.json({
    totalRequests: metrics.length,
    recentRequests: recentMetrics,
    summary: {
      authenticated: metrics.filter(m => m.authenticated).length,
      methods: metrics.reduce((acc, m) => {
        acc[m.method] = (acc[m.method] || 0) + 1;
        return acc;
      }, {}),
      topPaths: Object.entries(
        metrics.reduce((acc, m) => {
          acc[m.path] = (acc[m.path] || 0) + 1;
          return acc;
        }, {})
      ).sort(([,a], [,b]) => b - a).slice(0, 10)
    }
  });
}));

// API routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/profile', profileRoutes);
app.use('/payment', paymentRoutes);
app.use('/legal', legalRoutes);
app.use('/', esimRoutes);

// Root redirect
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/offers');
  } else {
    res.redirect('/auth/login');
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    message: 'Page not found',
    title: '404 Not Found'
  });
});

// CSRF error handler
app.use(csrfErrorHandler);

// Global error handler
app.use((err, req, res, next) => {
  logger.error({ err, method: req.method, path: req.path }, 'Unhandled error in Express');

  if (res.headersSent) {
    return next(err);
  }

  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong'
    : err.message;

  const status = err.status || 500;

  if (err.code === 'ERR_HTTP_HEADERS_SENT') {
    logger.warn('Headers already sent error caught');
    return;
  }

  res.status(status).render('error', {
    message,
    title: 'Error'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ err: reason }, 'Unhandled rejection');
  if (reason && reason.code === 'ERR_HTTP_HEADERS_SENT') {
    logger.warn('Headers already sent in promise - continuing');
  } else {
    process.exit(1);
  }
});

// Bootstrap admin user
await bootstrap(db);

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
  }, 'Server started');
});

server.timeout = 30000;
