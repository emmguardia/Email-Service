import dotenv from 'dotenv';

dotenv.config();

const ENVIRONMENT = process.env.ENVIRONMENT || 'production';

if (ENVIRONMENT === 'production' && !process.env.ALLOWED_ORIGINS) {
  throw new Error('ALLOWED_ORIGINS must be set in production (comma-separated list of allowed CORS origins)');
}

// Fallbacks « propres » par projet — utilisés si l'env var est absente OU si elle
// contient `??` (signe d'une corruption d'encodage UTF-8 dans le secret K8s).
const PROJECT_DEFAULT_DISPLAY_NAMES = {
  laurence: 'Domaine des Rêves Bleus',
  enzo: 'Enzo',
  'clos-de-la-reine': 'Clos de la Reine',
};

function readDisplayName(projectUpper, fallback) {
  const value = process.env[`PROJECT_${projectUpper}_DISPLAY_NAME`];
  // `??` indique typiquement un secret stocké avec un mauvais encodage
  // (ex: "Domaine des R??ves Bleus" au lieu de "Rêves"). On retombe sur le fallback.
  if (!value || value.includes('??')) return fallback;
  return value;
}

const allowedProjects = ['laurence', 'enzo', 'clos-de-la-reine'];

const fromDisplayNames = Object.fromEntries(
  allowedProjects.map(p => [
    p,
    readDisplayName(p.toUpperCase().replace(/-/g, '_'), PROJECT_DEFAULT_DISPLAY_NAMES[p] || p),
  ])
);

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  environment: ENVIRONMENT,
  jwt: {
    privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || '/app/secrets/jwt_private_key.pem',
    publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || '/app/secrets/jwt_public_key.pem',
    algorithm: process.env.JWT_ALGORITHM || 'RS256',
    expirationHours: parseFloat(process.env.JWT_EXPIRATION_HOURS || '24'),
    issuer: process.env.JWT_ISSUER || 'email-service',
    // audience: enforced uniquement si JWT_AUDIENCE est défini (sinon on accepte
    // les tokens existants qui ne portent pas de claim `aud`).
    audience: process.env.JWT_AUDIENCE || null,
  },
  smtp: {
    host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.GMAIL_SMTP_PORT || '587', 10),
    poolMaxConnections: parseInt(process.env.SMTP_POOL_MAX_CONNECTIONS || '3', 10),
    poolMaxMessages: parseInt(process.env.SMTP_POOL_MAX_MESSAGES || '100', 10),
    rateLimit: parseInt(process.env.SMTP_RATE_LIMIT || '5', 10),
  },
  rateLimit: {
    perIp: parseInt(process.env.RATE_LIMIT_PER_IP || '100', 10),
    perProject: parseInt(process.env.RATE_LIMIT_PER_PROJECT || '500', 10),
    windowHours: parseInt(process.env.RATE_LIMIT_WINDOW_HOURS || '1', 10),
    perProjectDaily: parseInt(process.env.RATE_LIMIT_PER_PROJECT_DAILY || '450', 10),
  },
  attachments: {
    maxCount: parseInt(process.env.ATTACHMENTS_MAX_COUNT || '5', 10),
    maxBytesPerFile: parseInt(process.env.ATTACHMENTS_MAX_BYTES_PER_FILE || String(2 * 1024 * 1024), 10),
    maxBytesTotal: parseInt(process.env.ATTACHMENTS_MAX_BYTES_TOTAL || String(5 * 1024 * 1024), 10),
    allowedMimeTypes: (process.env.ATTACHMENTS_ALLOWED_MIME ||
      'application/pdf,image/png,image/jpeg').split(',').map(s => s.trim()),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
      : null,
  },
  allowedProjects,
  fromDisplayNames,
  allowedTemplates: {
    laurence: ['forgot-password', 'order-confirmation', 'contact', 'contact-sent', 'new-order'],
    enzo: ['contact', 'admin-notification'],
    'clos-de-la-reine': ['contact', 'contact-sent', 'order-confirmation', 'new-order', 'order-validated', 'forgot-password', 'invoice'],
  },
  templatesDir: process.env.TEMPLATES_DIR || '/app/templates',
};
