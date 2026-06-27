import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { config } from './utils/config.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.js';
import emailRouter from './routes/email.js';
import metricsRouter from './routes/metrics.js';
import { emailService } from './services/emailService.js';
import { getRedis, closeRedis } from './utils/redis.js';

getRedis();

const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && incoming.length <= 64) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

const corsOrigin = config.cors.allowedOrigins ?? false;
app.use(cors({
  origin: corsOrigin,
  credentials: corsOrigin !== false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
}));

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/health', healthRouter);
app.use('/metrics', metricsRouter);
app.use('/api/v1', emailRouter);

app.get('/', (req, res) => {
  res.json({
    service: 'email-service',
    version: config.version,
    status: 'running',
  });
});

app.use(errorHandler);

const PORT = config.port;

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT, environment: config.environment }, 'server_started');
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'server_shutdown_initiated');

  const forceTimer = setTimeout(() => {
    logger.warn('server_shutdown_force_exit');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await emailService.close();
    } catch (err) {
      logger.warn({ error: err.message }, 'shutdown_email_close_error');
    }
    try {
      await closeRedis();
    } catch (err) {
      logger.warn({ error: err.message }, 'shutdown_redis_close_error');
    }
    logger.info({}, 'server_shutdown_complete');
    clearTimeout(forceTimer);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason?.message ?? String(reason) }, 'unhandled_rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ error: err.message, stack: err.stack }, 'uncaught_exception');
  shutdown('uncaughtException');
});
