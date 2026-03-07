import cacheService from '../services/cacheService.js';
import logger from '../lib/logger.js';

const log = logger.child({ module: 'performance' });

// Helper function to safely set headers
function safeSetHeader(res, name, value) {
  try {
    if (!res.headersSent) {
      res.setHeader(name, value);
      return true;
    }
  } catch (error) {
    // silently ignore header errors
  }
  return false;
}

// Performance monitoring middleware
export function performanceMonitor(req, res, next) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  res.locals.perf = {
    start: startTime,
    memory: startMemory
  };

  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;

    safeSetHeader(this, 'X-Response-Time', `${duration}ms`);
    safeSetHeader(this, 'X-Memory-Usage', `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

    if (duration > 1000) {
      log.warn({ method: req.method, path: req.path, duration }, 'Slow request detected');
    }

    const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
    if (memoryDiff > 50 * 1024 * 1024) {
      log.warn({ path: req.path, memoryMB: (memoryDiff / 1024 / 1024).toFixed(2) }, 'High memory usage');
    }

    originalEnd.apply(this, args);
  };

  next();
}

// Cache hit rate monitoring
export function cacheMonitor(req, res, next) {
  const originalRender = res.render;

  res.render = function(view, locals = {}, callback) {
    locals.cacheStats = cacheService.getStats();

    const stats = cacheService.getStats();
    if (stats.stats) {
      const hitRate = stats.stats.hits / (stats.stats.hits + stats.stats.misses) * 100;
      locals.cacheHitRate = hitRate.toFixed(1);
    }

    return originalRender.call(this, view, locals, callback);
  };

  next();
}

// Rate limiting with smart throttling
export function smartRateLimit(windowMs = 15 * 60 * 1000, maxRequests = 100) {
  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (requests.has(ip)) {
      const userRequests = requests.get(ip).filter(time => time > windowStart);
      requests.set(ip, userRequests);
    } else {
      requests.set(ip, []);
    }

    const userRequests = requests.get(ip);

    const isAuthenticated = req.session && req.session.user;
    const isAdmin = isAuthenticated && req.session.user.isAdmin;

    let limit = maxRequests;
    if (isAdmin) {
      limit = maxRequests * 5;
    } else if (isAuthenticated) {
      limit = maxRequests * 2;
    }

    if (userRequests.length >= limit) {
      log.warn({ ip, count: userRequests.length, limit }, 'Rate limit exceeded');
      return res.status(429).render('error', {
        message: 'Too many requests. Please slow down.',
        title: 'Rate Limited'
      });
    }

    userRequests.push(now);
    requests.set(ip, userRequests);

    safeSetHeader(res, 'X-RateLimit-Limit', limit);
    safeSetHeader(res, 'X-RateLimit-Remaining', Math.max(0, limit - userRequests.length));
    safeSetHeader(res, 'X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));

    next();
  };
}

// Endpoint-specific rate limiters
export function endpointRateLimit(windowMs, maxRequests) {
  const requests = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of requests.entries()) {
      const filtered = times.filter(t => t > now - windowMs);
      if (filtered.length === 0) {
        requests.delete(key);
      } else {
        requests.set(key, filtered);
      }
    }
  }, 5 * 60 * 1000);

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!requests.has(ip)) {
      requests.set(ip, []);
    }

    const ipRequests = requests.get(ip).filter(t => t > windowStart);

    if (ipRequests.length >= maxRequests) {
      return res.status(429).render('error', {
        message: 'Too many attempts. Please try again later.',
        title: 'Rate Limited'
      });
    }

    ipRequests.push(now);
    requests.set(ip, ipRequests);
    next();
  };
}

// Pre-built rate limiters for specific endpoints
export const registrationRateLimit = endpointRateLimit(60 * 60 * 1000, 5);  // 5 per hour
export const loginRateLimit = endpointRateLimit(15 * 60 * 1000, 10);        // 10 per 15 min
export const passwordResetRateLimit = endpointRateLimit(60 * 60 * 1000, 3); // 3 per hour

// Database query optimization monitor
export function queryMonitor() {
  if (process.env.NODE_ENV === 'development') {
    return (req, res, next) => {
      const queries = [];
      const startTime = Date.now();

      const originalLog = console.log;

      console.log = function(...args) {
        const logMessage = args[0];
        if (typeof logMessage === 'string' &&
            (logMessage.includes('SELECT') || logMessage.includes('UPDATE') ||
             logMessage.includes('INSERT') || logMessage.includes('DELETE'))) {
          queries.push({
            query: logMessage.substring(0, 100) + '...',
            time: Date.now() - startTime
          });
        }
        return originalLog.apply(console, args);
      };

      res.on('finish', () => {
        console.log = originalLog;

        if (queries.length > 5) {
          log.warn({ path: req.path, queryCount: queries.length }, 'High query count');
        }

        safeSetHeader(res, 'X-Query-Count', queries.length);
      });

      next();
    };
  }

  return (req, res, next) => next();
}

// Health check endpoint with detailed metrics
export function healthCheck(req, res) {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const cacheStats = cacheService.getStats();

  const cpuUsage = process.cpuUsage();
  const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000 / uptime * 100);

  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.floor(uptime),
      human: formatUptime(uptime)
    },
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    },
    cache: {
      keys: cacheStats.keys,
      stats: cacheStats.stats || { hits: 0, misses: 0 },
      hitRate: cacheStats.stats ?
        Math.round((cacheStats.stats.hits / (cacheStats.stats.hits + cacheStats.stats.misses)) * 100) || 0 : 0
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuUsage: cpuPercent + '%'
    },
    environment: process.env.NODE_ENV || 'development'
  };

  const warnings = [];
  const errors = [];

  if (health.memory.percentage > 90) {
    errors.push('Critical memory usage');
    health.status = 'critical';
  } else if (health.memory.percentage > 75) {
    warnings.push('High memory usage');
    health.status = 'warning';
  }

  if (cpuPercent > 80) {
    errors.push('High CPU usage');
    health.status = 'critical';
  } else if (cpuPercent > 60) {
    warnings.push('Elevated CPU usage');
    if (health.status === 'healthy') health.status = 'warning';
  }

  if (health.cache.hitRate < 30 && health.cache.stats.hits + health.cache.stats.misses > 100) {
    warnings.push('Low cache hit rate');
    if (health.status === 'healthy') health.status = 'warning';
  }

  if (warnings.length > 0) health.warnings = warnings;
  if (errors.length > 0) health.errors = errors;

  const statusCode = health.status === 'healthy' ? 200 : health.status === 'warning' ? 200 : 503;
  res.status(statusCode).json(health);
}

// Error boundary for async middleware
export function asyncErrorHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Security headers middleware
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// Performance metrics collection
export function metricsCollector(req, res, next) {
  const metrics = {
    timestamp: Date.now(),
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    authenticated: !!(req.session && req.session.user),
    ip: req.ip
  };

  const allMetrics = cacheService.get('system:metrics') || [];
  allMetrics.push(metrics);

  if (allMetrics.length > 1000) {
    allMetrics.splice(0, allMetrics.length - 1000);
  }

  cacheService.set('system:metrics', allMetrics, 3600);

  next();
}

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
