import express from 'express';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics({ register });

export const metrics = {
  emailsSent: new Counter({
    name: 'emails_sent_total',
    help: 'Total emails processed',
    labelNames: ['project', 'template', 'status'],
    registers: [register],
  }),
  emailSendDuration: new Histogram({
    name: 'email_send_duration_seconds',
    help: 'Email send duration in seconds',
    labelNames: ['project', 'template'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
  }),
  smtpErrors: new Counter({
    name: 'smtp_errors_total',
    help: 'SMTP errors by code',
    labelNames: ['project', 'code'],
    registers: [register],
  }),
  rateLimitHits: new Counter({
    name: 'rate_limit_hits_total',
    help: 'Rate limit rejections',
    labelNames: ['scope'],
    registers: [register],
  }),
};

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error.message);
  }
});

export default router;
