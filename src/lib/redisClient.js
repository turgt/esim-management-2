import Redis from 'ioredis';
import logger from './logger.js';

const log = logger.child({ module: 'redis' });

let client = null;
let everConnected = false;

function redactRedisUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid-url>';
  }
}

export function getRedisClient() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 30000),
    reconnectOnError: () => true,
    lazyConnect: false
  });

  client.on('connect', () => {
    everConnected = true;
    log.info({ url: redactRedisUrl(url) }, 'Redis connected');
  });

  client.on('ready', () => {
    log.info('Redis ready');
  });

  client.on('error', (err) => {
    if (everConnected) {
      log.warn({ err: err.message }, 'Redis error');
    } else {
      log.debug({ err: err.message }, 'Redis initial connection error');
    }
  });

  client.on('end', () => {
    log.warn('Redis connection ended');
  });

  client.on('reconnecting', (delay) => {
    log.info({ delay }, 'Redis reconnecting');
  });

  return client;
}

export function isRedisReady() {
  return Boolean(client && client.status === 'ready');
}

export async function pingRedis() {
  const c = getRedisClient();
  if (!c) return { ok: false, status: 'not_configured' };
  if (c.status !== 'ready') return { ok: false, status: c.status };

  try {
    const start = Date.now();
    const pong = await c.ping();
    return {
      ok: pong === 'PONG',
      status: 'ready',
      latencyMs: Date.now() - start
    };
  } catch (err) {
    return { ok: false, status: 'error', error: err.message };
  }
}

export async function shutdownRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch (err) {
    log.warn({ err: err.message }, 'Redis quit error');
  }
  client = null;
  everConnected = false;
}
