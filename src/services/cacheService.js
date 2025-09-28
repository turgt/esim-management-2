// ES Module compatible cache service
let NodeCache;

// Dynamic import for ES module compatibility
try {
  const module = await import('node-cache');
  NodeCache = module.default || module.NodeCache;
} catch (error) {
  console.warn('⚠️ NodeCache not available, using fallback');
  // Fallback to simple in-memory object
  NodeCache = class {
    constructor() {
      this.cache = new Map();
    }
    get(key) { return this.cache.get(key); }
    set(key, value) { this.cache.set(key, value); return true; }
    del(key) { this.cache.delete(key); return true; }
    keys() { return Array.from(this.cache.keys()); }
    getStats() { return { hits: 0, misses: 0, keys: this.cache.size }; }
    flushAll() { this.cache.clear(); }
  };
}

// In-memory cache (for Railway deployment without Redis)
const cache = new NodeCache({ 
  stdTTL: 600, // 10 minutes default
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false // Better performance
});

// Cache duration constants (in seconds)
export const CACHE_DURATIONS = {
  OFFERS: 300,        // 5 minutes - offers don't change often
  STATUS: 30,         // 30 seconds - status updates frequently
  QR_CODE: 3600,      // 1 hour - QR codes are static once generated
  USER_PURCHASES: 60  // 1 minute - user purchases list
};

class CacheService {
  // Generic cache methods
  get(key) {
    try {
      const value = cache.get(key);
      if (value) {
        console.log(`🎯 Cache HIT for key: ${key}`);
        return value;
      }
      console.log(`❌ Cache MISS for key: ${key}`);
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  set(key, value, ttl = CACHE_DURATIONS.STATUS) {
    try {
      cache.set(key, value, ttl);
      console.log(`💾 Cache SET for key: ${key} (TTL: ${ttl}s)`);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  del(key) {
    try {
      cache.del(key);
      console.log(`🗑️ Cache DELETE for key: ${key}`);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  // Specific cache methods
  getOffers(country) {
    return this.get(`offers:${country}`);
  }

  setOffers(country, offers) {
    return this.set(`offers:${country}`, offers, CACHE_DURATIONS.OFFERS);
  }

  getStatus(transactionId) {
    return this.get(`status:${transactionId}`);
  }

  setStatus(transactionId, status) {
    return this.set(`status:${transactionId}`, status, CACHE_DURATIONS.STATUS);
  }

  getQrCode(transactionId) {
    return this.get(`qr:${transactionId}`);
  }

  setQrCode(transactionId, qrData) {
    return this.set(`qr:${transactionId}`, qrData, CACHE_DURATIONS.QR_CODE);
  }

  getUserPurchases(userId) {
    return this.get(`purchases:${userId}`);
  }

  setUserPurchases(userId, purchases) {
    return this.set(`purchases:${userId}`, purchases, CACHE_DURATIONS.USER_PURCHASES);
  }

  // Invalidate related caches
  invalidateUser(userId) {
    this.del(`purchases:${userId}`);
    console.log(`🧹 Invalidated user cache for: ${userId}`);
  }

  invalidateStatus(transactionId) {
    this.del(`status:${transactionId}`);
    console.log(`🧹 Invalidated status cache for: ${transactionId}`);
  }

  // Cache statistics
  getStats() {
    return {
      keys: cache.keys().length,
      stats: cache.getStats()
    };
  }

  // Clear all cache (admin function)
  flush() {
    cache.flushAll();
    console.log('🧹 Cache flushed completely');
  }
}

export default new CacheService();