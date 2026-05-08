import express from 'express';
import { readFileSync } from 'fs';
import { config } from '../utils/config.js';
import { getRedis } from '../utils/redis.js';

const router = express.Router();

let jwtKeysReady = false;
function checkJwtKeysOnce() {
  if (jwtKeysReady) return true;
  try {
    readFileSync(config.jwt.privateKeyPath, 'utf8');
    readFileSync(config.jwt.publicKeyPath, 'utf8');
    jwtKeysReady = true;
    return true;
  } catch {
    return false;
  }
}

router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'email-service',
    version: '1.0.0',
  });
});

router.get('/live', (req, res) => {
  res.json({ status: 'alive' });
});

router.get('/ready', async (req, res) => {
  const missing = ['JWT_PRIVATE_KEY_PATH', 'JWT_PUBLIC_KEY_PATH'].filter(s => !process.env[s]);
  if (!process.env.REDIS_HOST && !process.env.REDIS_URL) missing.push('REDIS_HOST_or_REDIS_URL');
  if (missing.length > 0) {
    return res.status(503).json({ status: 'not_ready', missing_env: missing });
  }
  if (!checkJwtKeysOnce()) {
    return res.status(503).json({ status: 'not_ready', error: 'JWT keys not found' });
  }
  try {
    const pong = await getRedis().ping();
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);
  } catch (err) {
    return res.status(503).json({ status: 'not_ready', error: `Redis: ${err.message}` });
  }
  res.json({ status: 'ready' });
});

export default router;
