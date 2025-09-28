import cacheService from '../services/cacheService.js';

// Performance monitoring middleware
export function performanceMonitor(req, res, next) {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();
  
  // Add performance data to response
  res.locals.perf = {
    start: startTime,
    memory: startMemory
  };
  
  // Hook into response end
  const originalEnd = res.end;
  res.end = function(...args) {
    const endTime = Date.now();
    const endMemory = process.memoryUsage();
    const duration = endTime - startTime;
    
    // Log slow requests
    if (duration > 1000) {
      console.warn(`🐌 Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
    
    // Memory leak detection
    const memoryDiff = endMemory.heapUsed - startMemory.heapUsed;
    if (memoryDiff > 50 * 1024 * 1024) { // 50MB
      console.warn(`🧠 High memory usage: ${req.path} used ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Add performance headers
    res.setHeader('X-Response-Time', `${duration}ms`);
    res.setHeader('X-Memory-Usage', `${(endMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    
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
    const ip = req.ip;
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
    const limit = isAuthenticated ? maxRequests * 2 : maxRequests;
    
    if (userRequests.length >= limit) {
      console.warn(`🚫 Rate limit exceeded for IP: ${ip}`);
      return res.status(429).render('error', { 
        message: 'Too many requests. Please slow down.' 
      });
    }
    
    // Add current request
    userRequests.push(now);
    requests.set(ip, userRequests);
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - userRequests.length));
    res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));
    
    next();
  };
}

// Database query optimization monitor
export function queryMonitor() {
  if (process.env.NODE_ENV === 'development') {
    return (req, res, next) => {
      const queries = [];
      
      // Hook into Sequelize logging
      const originalLog = console.log;
      console.log = function(...args) {
        if (args[0] && args[0].includes('SELECT') || args[0].includes('UPDATE') || args[0].includes('INSERT')) {
          queries.push({
            query: args[0],
            time: Date.now()
          });
        }
        return originalLog.apply(console, args);
      };
      
      res.on('finish