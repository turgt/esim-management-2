import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import morgan from 'morgan';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import esimRoutes from './routes/esim.js';

import { 
  performanceMonitor, 
  cacheMonitor, 
  smartRateLimit, 
  queryMonitor,
  healthCheck,
  requestLogger,
  asyncErrorHandler,
  securityHeaders,
  metricsCollector
} from './middleware/performance.js';

dotenv.config();

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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
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
  level: 6, // Good balance between compression and speed
  threshold: 1024 // Only compress files larger than 1KB
}));

// Security headers
app.use(securityHeaders);

// Performance monitoring
app.use(performanceMonitor);
app.use(cacheMonitor);
app.use(queryMonitor());
app.use(metricsCollector);

// Request logging
app.use(requestLogger);

// Rate limiting
app.use(smartRateLimit(15 * 60 * 1000, 100)); // 100 requests per 15 minutes

// EJS settings
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsing
app.use(express.urlencoded({ 
  extended: true,
  limit: '10mb' // Prevent large payload attacks
}));
app.use(express.json({ 
  limit: '10mb'
}));

// Logging - conditional based on environment
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400 // Only log errors in production
  }));
}

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

// Session configuration
const PgSession = pgSession(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: 24 * 60 * 60 // 24 hours
  }),
  secret: process.env.SESSION_SECRET || 'development-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // Reset expiration on activity
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// User context middleware
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  res.locals.NODE_ENV = process.env.NODE_ENV;
  next();
});

// Health check endpoints
app.get('/health', asyncErrorHandler(healthCheck));
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// Metrics endpoint (admin only)
app.get('/metrics', asyncErrorHandler(async (req, res) => {
  if (!req.session?.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  // Import cache service dynamically to avoid circular dependency
  const { default: cacheService } = await import('./services/cacheService.js');
  const metrics = cacheService.get('system:metrics') || [];
  const recentMetrics = metrics.slice(-100); // Last 100 requests
  
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

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Global error:', err);
  
  // Prevent headers already sent error
  if (res.headersSent) {
    return next(err);
  }
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Something went wrong' 
    : err.message;
    
  const status = err.status || 500;
  
  // Handle specific error types
  if (err.code === 'ERR_HTTP_HEADERS_SENT') {
    console.warn('⚠️ Headers already sent error caught');
    return;
  }
  
  res.status(status).render('error', { 
    message,
    title: 'Error'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('💤 Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('💤 Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  
  // Graceful shutdown for critical errors
  if (err.code !== 'ERR_HTTP_HEADERS_SENT') {
    console.error('🛑 Critical error, shutting down...');
    process.exit(1);
  } else {
    console.warn('⚠️ Headers already sent error - continuing...');
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Don't exit for non-critical errors
  if (reason && reason.code === 'ERR_HTTP_HEADERS_SENT') {
    console.warn('⚠️ Headers already sent in promise - continuing...');
  } else {
    console.error('🛑 Critical promise rejection, shutting down...');
    process.exit(1);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
});

// Increase server timeout for Railway
server.timeout = 30000; // 30 seconds