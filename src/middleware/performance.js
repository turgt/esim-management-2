import cacheService from '../services/cacheService.js';

// Helper function to safely set headers
function safeSetHeader(res, name, value) {
  try {
    if (!res.headersSent) {
      res.setHeader(name, value);
      return true;
    }
  } catch (error) {
    console.log(`📊 Could not set header ${name}: ${error.message}`);
  }
  return false;
}

// Performance monitoring middleware
export function performanceMonitor(req, res, next) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();
  
  // Add performance data to response
  res.locals.perf = {
    start: startTime,
    memory: startMemory
  };
  
  // Hook into response end - SAFELY
  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;
    
    // Safely add performance headers
    safeSetHeader(this, 'X-Response-Time', `${duration}ms`);
    safeSetHeader(this, 'X-Memory-Usage', `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    
    // Log performance data
    if (duration > 1000) {
      console.warn(`🐌 Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
    
    // Memory leak detection
    const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
    if (memoryDiff > 50 * 1024 * 1024) { // 50MB
      console.warn(`🧠 High memory usage: ${req.path} used ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Call original end
    originalEnd.apply(this, args);
  };
  
  next();
}

// Cache hit rate monitoring
export function cacheMonitor(req, res, next) {
  const originalRender = res.render;
  
  res.render = function(view, locals = {}, callback) {
    // Add cache stats to all views
    locals.cacheStats = cacheService.getStats();
    
    // Calculate cache hit rate
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
    
    // Clean old entries
    if (requests.has(ip)) {
      const userRequests = requests.get(ip).filter(time => time > windowStart);
      requests.set(ip, userRequests);
    } else {
      requests.set(ip, []);
    }
    
    const userRequests = requests.get(ip);
    
    // Check if user is authenticated (higher limits)
    const isAuthenticated = req.session && req.session.user;
    const isAdmin = isAuthenticated && req.session.user.isAdmin;
    
    let limit = maxRequests;
    if (isAdmin) {
      limit = maxRequests * 5; // Admins get 5x limit
    } else if (isAuthenticated) {
      limit = maxRequests * 2; // Auth users get 2x limit
    }
    
    if (userRequests.length >= limit) {
      console.warn(`🚫 Rate limit exceeded for IP: ${ip} (${userRequests.length}/${limit})`);
      return res.status(429).render('error', { 
        message: 'Too many requests. Please slow down.',
        title: 'Rate Limited'
      });
    }
    
    // Add current request
    userRequests.push(now);
    requests.set(ip, userRequests);
    
    // Add rate limit headers safely
    safeSetHeader(res, 'X-RateLimit-Limit', limit);
    safeSetHeader(res, 'X-RateLimit-Remaining', Math.max(0, limit - userRequests.length));
    safeSetHeader(res, 'X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));
    
    next();
  };
}

// Database query optimization monitor
export function queryMonitor() {
  if (process.env.NODE_ENV === 'development') {
    return (req, res, next) => {
      const queries = [];
      const startTime = Date.now();
      
      // Store original console.log
      const originalLog = console.log;
      
      // Hook into Sequelize logging
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
        // Restore original console.log
        console.log = originalLog;
        
        if (queries.length > 5) {
          console.warn(`🔍 High query count: ${queries.length} queries for ${req.path}`);
        }
        
        // Add query info to response headers safely
        safeSetHeader(res, 'X-Query-Count', queries.length);
      });
      
      next();
    };
  }
  
  return (req, res, next) => next(); // No-op in production
}

// Request logging with performance data
export function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    const method = req.method;
    const path = req.path;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    // Skip logging for common 404s that are not concerning
    const ignorePaths = ['/sw.js', '/favicon.ico', '/robots.txt', '/apple-touch-icon'];
    if (status === 404 && ignorePaths.some(ignorePath => path.includes(ignorePath))) {
      return; // Don't log these common 404s
    }
    
    // Determine log level based on status code
    let logLevel = 'info';
    if (status >= 500) logLevel = 'error';
    else if (status >= 400) logLevel = 'warn';
    else if (duration > 2000) logLevel = 'warn';
    
    const logData = {
      method,
      path,
      status,
      duration: `${duration}ms`,
      ip: ip.substring(0, 10) + '...', // Truncate IP for privacy
      userAgent: userAgent.substring(0, 50) + '...',
      user: req.session?.user?.username || 'anonymous'
    };
    
    if (logLevel === 'error') {
      console.error('🚨 Request failed:', logData);
    } else if (logLevel === 'warn') {
      console.warn('⚠️ Slow/problematic request:', logData);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('📊 Request completed:', logData);
    }
  });
  
  next();
}

// Health check endpoint with detailed metrics
export function healthCheck(req, res) {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const cacheStats = cacheService.getStats();
  
  // CPU usage estimation (rough)
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
  
  // Health status determination
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
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // HSTS for production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
}

// Performance metrics collection
export function metricsCollector(req, res, next) {
  // Simple metrics collection
  const metrics = {
    timestamp: Date.now(),
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    authenticated: !!(req.session && req.session.user),
    ip: req.ip
  };
  
  // Store in cache for analytics (last 1000 requests)
  const allMetrics = cacheService.get('system:metrics') || [];
  allMetrics.push(metrics);
  
  // Keep only last 1000 entries
  if (allMetrics.length > 1000) {
    allMetrics.splice(0, allMetrics.length - 1000);
  }
  
  cacheService.set('system:metrics', allMetrics, 3600); // 1 hour TTL
  
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