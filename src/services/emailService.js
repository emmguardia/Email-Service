import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import { htmlToText } from 'html-to-text';
import { logger, sanitizeEmail } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { validateTemplatePath } from '../utils/validators.js';
import { metrics } from '../routes/metrics.js';

const SUBJECT_RE = /<!--\s*EMAIL_SUBJECT:\s*(.+?)\s*-->/i;
const TRANSIENT_SMTP_CODES = new Set([421, 450, 451, 452]);
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

class EmailService {
  constructor() {
    this._transporters = new Map();
    this._templates = new Map();
    this._closing = false;
  }

  _getProjectCredentials(project) {
    const projectUpper = project.toUpperCase().replace(/-/g, '_');
    const appPasswordKey = `PROJECT_${projectUpper}_GMAIL_APP_PASSWORD`;
    const fromEmailKey = `PROJECT_${projectUpper}_FROM_EMAIL`;
    const gmailUserKey = `PROJECT_${projectUpper}_GMAIL_USER`;

    const appPassword = process.env[appPasswordKey];
    const fromEmail = process.env[fromEmailKey];
    const gmailUser = process.env[gmailUserKey] || fromEmail;

    if (!appPassword) {
      logger.error({ project, key: appPasswordKey }, 'missing_gmail_credentials');
      throw new Error(`Missing Gmail app password for project '${project}'`);
    }
    if (!fromEmail) {
      logger.error({ project, key: fromEmailKey }, 'missing_from_email');
      throw new Error(`Missing from email for project '${project}'`);
    }
    return { appPassword, fromEmail, gmailUser };
  }

  _getTransporter(project) {
    const cached = this._transporters.get(project);
    if (cached) return cached;

    const { appPassword, fromEmail, gmailUser } = this._getProjectCredentials(project);
    const port = config.smtp.port;

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      pool: true,
      maxConnections: config.smtp.poolMaxConnections,
      maxMessages: config.smtp.poolMaxMessages,
      rateLimit: config.smtp.rateLimit,
      auth: { user: gmailUser, pass: appPassword },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    });

    transporter.verify()
      .then(() => logger.info({ project, host: config.smtp.host, port }, 'smtp_pool_ready'))
      .catch(err => logger.error({ project, error: err.message }, 'smtp_verify_failed'));

    const entry = { transporter, fromEmail };
    this._transporters.set(project, entry);
    return entry;
  }

  _getCompiledTemplate(project, templateId) {
    const key = `${project}:${templateId}`;
    if (this._templates.has(key)) return this._templates.get(key);

    const filePath = validateTemplatePath(templateId, project);
    let raw;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.error({ template_path: filePath }, 'template_not_found');
        throw new Error(`Template not found: ${templateId}`);
      }
      logger.error({ template_path: filePath, error: error.message }, 'template_load_error');
      throw new Error(`Failed to load template: ${error.message}`);
    }

    const subjectMatch = raw.match(SUBJECT_RE);
    const compiled = {
      render: Handlebars.compile(raw, { strict: true, noEscape: false }),
      defaultSubject: subjectMatch ? subjectMatch[1].trim() : null,
    };
    this._templates.set(key, compiled);
    return compiled;
  }

  _safeSubject(input, fallback) {
    if (!input || typeof input !== 'string') return fallback;
    const cleaned = input.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    return cleaned || fallback;
  }

  _buildAttachments(items) {
    if (!items || items.length === 0) return undefined;
    return items.map(({ filename, content, contentType }) => ({
      filename,
      content: Buffer.from(content, 'base64'),
      contentType,
    }));
  }

  async _sendOnce(transporter, mailOptions) {
    return transporter.sendMail(mailOptions);
  }

  _isTransient(err) {
    if (!err) return false;
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ESOCKET') return true;
    if (typeof err.responseCode === 'number') return TRANSIENT_SMTP_CODES.has(err.responseCode);
    return false;
  }

  async sendEmail(project, templateId, toEmail, toName, variables = {}, subject = null, attachments = [], replyTo = null) {
    const startedAt = Date.now();
    const { transporter, fromEmail } = this._getTransporter(project);
    const tpl = this._getCompiledTemplate(project, templateId);

    // Pas de pré-escape : Handlebars `{{ var }}` escape déjà.
    const html = tpl.render({
      to_email: toEmail,
      to_name: toName,
      ...variables,
    });

    const text = htmlToText(html, { wordwrap: 100, selectors: [{ selector: 'img', format: 'skip' }] });

    const displayName = config.fromDisplayNames[project] || project;
    const safeSubject = this._safeSubject(subject, tpl.defaultSubject || `Message from ${displayName}`);

    const mailOptions = {
      from: `"${displayName}" <${fromEmail}>`,
      to: toEmail,
      subject: safeSubject,
      html,
      text,
    };
    if (replyTo) mailOptions.replyTo = replyTo;

    const builtAttachments = this._buildAttachments(attachments);
    if (builtAttachments) mailOptions.attachments = builtAttachments;

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const info = await this._sendOnce(transporter, mailOptions);

        const toDomain = sanitizeEmail(toEmail).split('@')[1] || 'unknown';
        const durationSeconds = (Date.now() - startedAt) / 1000;

        metrics.emailsSent.inc({ project, template: templateId, status: 'success' });
        metrics.emailSendDuration.observe({ project, template: templateId }, durationSeconds);

        logger.info(
          {
            project,
            template: templateId,
            to_domain: toDomain,
            from_email: sanitizeEmail(fromEmail),
            message_id: info.messageId,
            attempts: attempt + 1,
            duration_seconds: durationSeconds,
          },
          'email_sent'
        );
        return true;
      } catch (error) {
        lastError = error;
        const transient = this._isTransient(error);
        logger.warn(
          {
            project,
            template: templateId,
            attempt: attempt + 1,
            transient,
            response_code: error.responseCode,
            error: error.message,
          },
          'email_send_attempt_failed'
        );
        metrics.smtpErrors.inc({
          project,
          code: String(error.responseCode || error.code || 'unknown'),
        });
        if (!transient || attempt === MAX_RETRIES) break;
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    }

    metrics.emailsSent.inc({ project, template: templateId, status: 'failure' });
    logger.error(
      {
        project,
        template: templateId,
        to_domain: toEmail.includes('@') ? sanitizeEmail(toEmail).split('@')[1] : 'unknown',
        error: lastError?.message,
      },
      'email_send_failed'
    );
    throw lastError;
  }

  async close() {
    if (this._closing) return;
    this._closing = true;
    for (const [project, entry] of this._transporters.entries()) {
      try {
        entry.transporter.close();
        logger.info({ project }, 'smtp_pool_closed');
      } catch (err) {
        logger.warn({ project, error: err.message }, 'smtp_pool_close_error');
      }
    }
    this._transporters.clear();
  }
}

export const emailService = new EmailService();
