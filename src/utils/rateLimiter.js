import { logger } from './logger.js';
import { metrics } from '../routes/metrics.js';
import { getRedis } from './redis.js';

// Redis-backed fixed-window rate limiter using INCR + EXPIRE.
// - Atomic via Lua script (initial INCR sets TTL only if first hit).
// - Distributed across replicas (counters shared in Redis).
// - On Redis failure: open-fail (allow) to avoid taking the service down.

const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

class RateLimiter {
  constructor() {
    this._scriptSha = null;
  }

  async _runScript(key, windowSeconds) {
    const redis = getRedis();
    try {
      if (!this._scriptSha) {
        this._scriptSha = await redis.script('LOAD', FIXED_WINDOW_SCRIPT);
      }
      return await redis.evalsha(this._scriptSha, 1, key, windowSeconds);
    } catch (err) {
      if (err && /NOSCRIPT/i.test(err.message)) {
        this._scriptSha = null;
        return await redis.eval(FIXED_WINDOW_SCRIPT, 1, key, windowSeconds);
      }
      throw err;
    }
  }

  async _check(key, limit, windowSeconds, scope) {
    try {
      const [current, ttl] = await this._runScript(key, windowSeconds);
      if (current > limit) {
        const remaining = ttl > 0 ? ttl : windowSeconds;
        logger.warn({ scope, key, limit, current, remaining_seconds: remaining }, 'rate_limit_exceeded');
        metrics.rateLimitHits.inc({ scope });
        return { allowed: false, remaining };
      }
      return { allowed: true, remaining: ttl > 0 ? ttl : windowSeconds };
    } catch (err) {
      logger.error({ scope, key, error: err.message }, 'rate_limit_redis_error');
      // open-fail: do not block traffic if Redis is down
      return { allowed: true, remaining: windowSeconds };
    }
  }

  checkProjectHourly(project, limit, windowSeconds = 3600) {
    return this._check(`rl:project:hour:${project}`, limit, windowSeconds, 'project_hourly');
  }

  checkProjectDaily(project, limit) {
    return this._check(`rl:project:day:${project}`, limit, 86400, 'project_daily');
  }
}

export const rateLimiter = new RateLimiter();
