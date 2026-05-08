import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
const ENVIRONMENT = process.env.ENVIRONMENT || 'production';

const pinoConfig = {
  level: LOG_LEVEL,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(ENVIRONMENT === 'development' && LOG_FORMAT === 'pretty'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
};

export const logger = pino(pinoConfig);

export function sanitizeEmail(email) {
  if (!email || !email.includes('@')) {
    return 'invalid_email';
  }
  
  const [local, domain] = email.split('@');
  const maskedLocal = local.length > 2
    ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
    : '*'.repeat(local.length);
  
  return `${maskedLocal}@${domain}`;
}

export function sanitizeData(data) {
  const sanitized = {};
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'email', 'app_password'];
  
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => keyLower.includes(sensitive))) {
      if (typeof value === 'string' && value.includes('@')) {
        sanitized[key] = sanitizeEmail(value);
      } else if (typeof value === 'string' && value.length > 8) {
        sanitized[key] = value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2);
      } else {
        sanitized[key] = '***';
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}
