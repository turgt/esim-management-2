import logger from '../lib/logger.js';

const log = logger.child({ module: 'cache' });

// ES Module compatible cache service
let NodeCache;
let cache;

// Initialize cache service
async function initializeCache() {
  try {
    const nodeCacheModule = await import('node-cache');
    NodeCache = nodeCacheModule.default;

    cache = new NodeCache({
      stdTTL: 600,
      checkperiod: 120,
      useClones: false
    });

    log.info('NodeCache initialized successfully');
  } catch (error) {
    log.warn('NodeCache not available, using fallback cache');

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

await initializeCache();

export const CACHE_DURATIONS = {
  OFFERS: 300,
  LANDING_OFFERS: 600,
};

class CacheService {
  get(key) {
    try {
      const value = cache.get(key);
      if (value) {
        log.debug({ key }, 'Cache hit');
        return value;
      }
      log.debug({ key }, 'Cache miss');
      return null;
    } catch (error) {
      log.error({ err: error, key }, 'Cache get error');
      return null;
    }
  }

  set(key, value, ttl = 600) {
    try {
      cache.set(key, value, ttl);
      log.debug({ key, ttl }, 'Cache set');
      return true;
    } catch (error) {
      log.error({ err: error, key }, 'Cache set error');
      return false;
    }
  }

  del(key) {
    try {
      cache.del(key);
      log.debug({ key }, 'Cache delete');
      return true;
    } catch (error) {
      log.error({ err: error, key }, 'Cache delete error');
      return false;
    }
  }

  getOffers(country) {
    return this.get(`offers:${country}`);
  }

  setOffers(country, offers) {
    return this.set(`offers:${country}`, offers, CACHE_DURATIONS.OFFERS);
  }

  getLandingOffers(country) {
    return this.get(`landing:offers:${country}`);
  }

  setLandingOffers(country, offers) {
    return this.set(`landing:offers:${country}`, offers, CACHE_DURATIONS.LANDING_OFFERS);
  }

  invalidateUser(userId) {
    this.del(`purchases:${userId}`);
    log.debug({ userId }, 'Invalidated user cache');
  }

  getStats() {
    return {
      keys: cache.keys().length,
      stats: cache.getStats()
    };
  }

  flush() {
    cache.flushAll();
    log.info('Cache flushed completely');
  }
}

export default new CacheService();
