// ES Module compatible cache service
let NodeCache;
let cache;

// Initialize cache service
async function initializeCache() {
  try {
    // Try to import node-cache
    const nodeCacheModule = await import('node-cache');
    NodeCache = nodeCacheModule.default;
    
    cache = new NodeCache({ 
      stdTTL: 600, // 10 minutes default
      checkperiod: 120, // Check for expired keys every 2 minutes
      useClones: false // Better performance
    });
    
    console.log('✅ NodeCache initialized successfully');
  } catch (error) {
    console.warn('⚠️ NodeCache not available, using fallback cache');
    
    // Fallback to simple in-memory Map
    cache = {
      data: new Map(),
      get(key) { 
        const item = this.data.get(key);
        if (!item) return null;
        if (item.expiry && Date.now() > item.expiry) {
          this.data.delete(key);
          return null;
        }
        return item.value;
      },
      set(key, value, ttl = 600) { 
        const expiry = ttl > 0 ? Date.now() + (ttl * 1000) : null;
        this.data.set(key, { value, expiry });
        return true;
      },
      del(key) { 
        return this.data.delete(key);
      },
      keys() { 
        return Array.from(this.data.keys());
      },
      getStats() { 
        return { 
          keys: this.data.size,
          stats: { hits: 0, misses: 0 }
        };
      },
      flushAll() { 
        this.data.clear();
      }
    };
  }
}

// Initialize cache immediately
await initializeCache();

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