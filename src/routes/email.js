import express from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { emailRequestSchema, validateTemplate } from '../utils/validators.js';
import { rateLimiter } from '../utils/rateLimiter.js';
import { config } from '../utils/config.js';
import { verifyJWTToken, verifyProjectAccess } from '../middleware/auth.js';
import { emailService } from '../services/emailService.js';
import { logger } from '../utils/logger.js';
import { metrics } from './metrics.js';
import { getRedis, redisReady } from '../utils/redis.js';

const router = express.Router();

// rate-limit-redis charge son script Lua dès l'initialisation, avant que Redis
// soit connecté. Avec enableOfflineQueue: false, ce SCRIPT LOAD échouait, et la
// lib ne le retente jamais (seule une erreur NOSCRIPT déclenche un rechargement) :
// toutes les requêtes renvoyaient 500 jusqu'au redémarrage du pod.
//  - SCRIPT LOAD : retenté jusqu'à ce que Redis réponde (ne rejette jamais) ;
//  - autres commandes : échec immédiat si Redis n'est pas prêt ;
//  - increment plafonné à 2 s (sinon il attendrait le chargement du script).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ipStore = new RedisStore({
  sendCommand: async (...args) => {
    const redis = getRedis();
    if (String(args[0]).toUpperCase() === 'SCRIPT') {
      for (let attempt = 1; ; attempt++) {
        try {
          await redisReady();
          return await redis.call(...args);
        } catch (err) {
          logger.warn({ error: err.message, attempt }, 'rate_limit_script_load_retry');
          await sleep(Math.min(attempt * 1000, 5000));
        }
      }
    }
    if (redis.status !== 'ready') throw new Error('redis_not_ready');
    return redis.call(...args);
  },
  prefix: 'rl:ip:',
});
const rawIncrement = ipStore.increment.bind(ipStore);
ipStore.increment = (key) =>
  Promise.race([
    rawIncrement(key),
    new Promise((_, reject) => setTimeout(() => reject(new Error('rate_limit_store_timeout')), 2000).unref()),
  ]);

const ipRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowHours * 60 * 60 * 1000,
  limit: config.rateLimit.perIp,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  store: ipStore,
  // Redis indisponible ou lent : on laisse passer (même politique open-fail que
  // utils/rateLimiter.js) plutôt que de couper l'envoi d'emails.
  passOnStoreError: true,
  handler: (req, res) => {
    metrics.rateLimitHits.inc({ scope: 'ip' });
    res.status(429).json({ error: 'Too many requests from this IP, please try again later.' });
  },
});

router.post(
  '/send',
  ipRateLimiter,
  verifyJWTToken,
  verifyProjectAccess,
  async (req, res) => {
    try {
      const { error, value } = emailRequestSchema.validate(req.body);

      if (error) {
        return res.status(400).json({
          error: 'Validation error',
          details: error.details.map(d => d.message),
          request_id: req.id,
        });
      }

      const { template_id, to_email, to_name, project, variables, subject, reply_to, attachments } = value;

      try {
        validateTemplate(project, template_id);
      } catch (validationError) {
        return res.status(400).json({
          error: validationError.message,
          request_id: req.id,
        });
      }

      const hourly = await rateLimiter.checkProjectHourly(
        project,
        config.rateLimit.perProject,
        config.rateLimit.windowHours * 3600
      );
      if (!hourly.allowed) {
        res.setHeader('Retry-After', String(hourly.remaining));
        return res.status(429).json({
          error: 'Project hourly rate limit exceeded',
          message: `Try again in ${hourly.remaining} seconds.`,
          request_id: req.id,
        });
      }

      const daily = await rateLimiter.checkProjectDaily(project, config.rateLimit.perProjectDaily);
      if (!daily.allowed) {
        res.setHeader('Retry-After', String(daily.remaining));
        return res.status(429).json({
          error: 'Project daily quota exceeded',
          message: `Try again in ${daily.remaining} seconds.`,
          request_id: req.id,
        });
      }

      await emailService.sendEmail(
        project,
        template_id,
        to_email,
        to_name,
        variables || {},
        subject,
        attachments,
        reply_to
      );

      logger.info(
        {
          project,
          template: template_id,
          to_domain: to_email.split('@')[1] || 'unknown',
          request_id: req.id,
        },
        'email_send_success'
      );

      return res.json({
        success: true,
        message: 'Email sent successfully',
        request_id: req.id,
      });
    } catch (error) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          request_id: req.id,
        },
        'email_send_error'
      );

      const isClientError = /not allowed|not found|Invalid|too large|Missing/i.test(error.message);
      return res.status(isClientError ? 400 : 500).json({
        error: isClientError ? 'Invalid request' : 'Internal server error',
        details: isClientError ? error.message : undefined,
        request_id: req.id,
      });
    }
  }
);

router.get(
  '/templates/:project',
  verifyJWTToken,
  verifyProjectAccess,
  (req, res) => {
    const { project } = req.params;

    if (!config.allowedProjects.includes(project)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json({
      project,
      templates: config.allowedTemplates[project] || [],
    });
  }
);

export default router;
