import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import cacheService from '../services/cacheService.js';
import logger from '../lib/logger.js';
import { getRedisClient, pingRedis } from '../lib/redisClient.js';

const log = logger.child({ module: 'performance' });

// Build a rate limiter backed by Redis when REDIS_URL is configured, falling back
// to per-process memory when it is not. Redis-backed instances also use a memory
// "insurance" limiter so brief Redis outages keep enforcing a per-instance limit
// rather than letting all traffic through unmetered.
function buildLimiter(keyPrefix, points, durationSec) {
  const insuranceLimiter = new RateLimiterMemory({ points, duration: durationSec });
  const redis = getRedisClient();

  if (!redis) {
    return insuranceLimiter;
  }

  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:${keyPrefix}`,
    points,
    duration: durationSec,
    insuranceLimiter
  });
}

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

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

// Smart rate limiting with role-aware multipliers. Each call creates three
// independent buckets (anon / authed / admin) so a logged-in user gets a higher
// limit than an anonymous visitor sharing the same IP. Buckets are keyed per
// instance via `name` so multiple smartRateLimit middlewares do not collide.
let smartSeq = 0;
export function smartRateLimit(windowMs = 15 * 60 * 1000, maxRequests = 100, name) {
  const durationSec = Math.ceil(windowMs / 1000);
  const instanceName = name || `smart-${++smartSeq}`;
  const anon = buildLimiter(`${instanceName}:anon`, maxRequests, durationSec);
  const authed = buildLimiter(`${instanceName}:authed`, maxRequests * 2, durationSec);
  const admin = buildLimiter(`${instanceName}:admin`, maxRequests * 5, durationSec);

  return async (req, res, next) => {
    const ip = clientIp(req);
    const isAuthenticated = Boolean(req.session && req.session.user);
    const isAdmin = Boolean(isAuthenticated && req.session.user.isAdmin);
    const limiter = isAdmin ? admin : isAuthenticated ? authed : anon;
    const role = isAdmin ? 'admin' : isAuthenticated ? 'authed' : 'anon';

    try {
      const result = await limiter.consume(ip);
      safeSetHeader(res, 'X-RateLimit-Limit', limiter.points);
      safeSetHeader(res, 'X-RateLimit-Remaining', Math.max(0, result.remainingPoints));
      safeSetHeader(res, 'X-RateLimit-Reset', Math.ceil((Date.now() + result.msBeforeNext) / 1000));
      return next();
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        log.warn({ err: rejRes.message, ip, name: instanceName }, 'Rate limiter unavailable — failing open');
        return next();
      }
      const retryAfterSec = Math.ceil(rejRes.msBeforeNext / 1000);
      log.warn({ ip, role, name: instanceName, limit: limiter.points }, 'Rate limit exceeded');
      safeSetHeader(res, 'Retry-After', retryAfterSec);
      safeSetHeader(res, 'X-RateLimit-Limit', limiter.points);
      safeSetHeader(res, 'X-RateLimit-Remaining', 0);
      safeSetHeader(res, 'X-RateLimit-Reset', Math.ceil((Date.now() + rejRes.msBeforeNext) / 1000));
      return res.status(429).render('error', {
        message: 'Too many requests. Please slow down.',
        title: 'Rate Limited'
      });
    }
  };
}

// Endpoint-specific rate limiter. Single bucket per call, distinguished by `name`.
let endpointSeq = 0;
export function endpointRateLimit(windowMs, maxRequests, name) {
  const durationSec = Math.ceil(windowMs / 1000);
  const instanceName = name || `ep-${++endpointSeq}`;
  const limiter = buildLimiter(instanceName, maxRequests, durationSec);

  return async (req, res, next) => {
    const ip = clientIp(req);
    try {
      await limiter.consume(ip);
      return next();
    } catch (rejRes) {
      if (rejRes instanceof Error) {
        log.warn({ err: rejRes.message, ip, name: instanceName }, 'Rate limiter unavailable — failing open');
        return next();
      }
      const retryAfterSec = Math.ceil(rejRes.msBeforeNext / 1000);
      log.warn({ ip, name: instanceName, limit: limiter.points }, 'Endpoint rate limit exceeded');
      safeSetHeader(res, 'Retry-After', retryAfterSec);
      return res.status(429).render('error', {
        message: 'Too many attempts. Please try again later.',
        title: 'Rate Limited'
      });
    }
  };
}

// Pre-built rate limiters for specific endpoints
export const registrationRateLimit = endpointRateLimit(60 * 60 * 1000, 5, 'register');     // 5 per hour
export const loginRateLimit = endpointRateLimit(15 * 60 * 1000, 10, 'login');               // 10 per 15 min
export const passwordResetRateLimit = endpointRateLimit(60 * 60 * 1000, 3, 'password-reset'); // 3 per hour

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
export async function healthCheck(req, res) {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const cacheStats = cacheService.getStats();

  const cpuUsage = process.cpuUsage();
  const cpuPercent = Math.round((cpuUsage.user + cpuUsage.system) / 1000000 / uptime * 100);

  const redis = await pingRedis();

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
    redis,
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

  // Redis: configured-but-down is a warning (rate limiter falls back to in-memory).
  // not_configured is fine (dev) but flagged as a warning in production.
  if (redis.status !== 'not_configured' && !redis.ok) {
    warnings.push('Redis unavailable — rate limiting degraded');
    if (health.status === 'healthy') health.status = 'warning';
  } else if (redis.status === 'not_configured' && process.env.NODE_ENV === 'production') {
    warnings.push('Redis not configured — rate limits do not survive restarts');
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
