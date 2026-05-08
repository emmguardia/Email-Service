import Redis from 'ioredis';
import { logger } from './logger.js';

let client = null;

export function getRedis() {
  if (client) return client;

  // Préférence : args séparés (REDIS_HOST/PORT/PASSWORD) car un mot de passe
  // contenant `@`, `/`, `:`, `#`, `?` casse la forme URL `redis://:pwd@host:port`.
  // Fallback : REDIS_URL (utile en dev local sans password).
  const opts = {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };

  if (process.env.REDIS_HOST) {
    opts.host = process.env.REDIS_HOST;
    opts.port = parseInt(process.env.REDIS_PORT || '6379', 10);
    if (process.env.REDIS_PASSWORD) opts.password = process.env.REDIS_PASSWORD;
    opts.db = parseInt(process.env.REDIS_DB || '0', 10);
    client = new Redis(opts);
  } else if (process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, opts);
  } else {
    throw new Error('REDIS_HOST (recommended) or REDIS_URL is required');
  }

  client.on('connect', () => logger.info({}, 'redis_connected'));
  client.on('error', (err) => logger.error({ error: err.message }, 'redis_error'));
  client.on('close', () => logger.warn({}, 'redis_closed'));

  return client;
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.quit();
    logger.info({}, 'redis_quit');
  } catch (err) {
    logger.warn({ error: err.message }, 'redis_quit_error');
  } finally {
    client = null;
  }
}
