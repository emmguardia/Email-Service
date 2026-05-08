import Joi from 'joi';
import path from 'path';
import { config } from './config.js';

const FILENAME_RE = /^[a-zA-Z0-9 ._-]+$/;

const attachmentSchema = Joi.object({
  filename: Joi.string()
    .pattern(FILENAME_RE, 'safe filename (alnum, space, dot, underscore, dash)')
    .max(100)
    .required(),
  content: Joi.string()
    .base64()
    .max(Math.ceil(config.attachments.maxBytesPerFile * 4 / 3) + 4)
    .required(),
  contentType: Joi.string()
    .valid(...config.attachments.allowedMimeTypes)
    .required(),
});

export const emailRequestSchema = Joi.object({
  template_id: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .min(1)
    .max(50)
    .required(),

  to_email: Joi.string()
    .email({ minDomainSegments: 2, tlds: { allow: true } })
    .max(254)
    .required(),

  to_name: Joi.string()
    .min(1)
    .max(100)
    .required(),

  project: Joi.string()
    .valid(...config.allowedProjects)
    .required(),

  variables: Joi.object()
    .default({})
    .custom((value, helpers) => {
      const totalSize = JSON.stringify(value).length;
      if (totalSize > 10000) {
        return helpers.error('any.invalid', { message: 'variables payload too large (max 10KB)' });
      }
      return value;
    }, 'variables size validation'),

  subject: Joi.string()
    .max(200)
    .optional(),

  reply_to: Joi.string()
    .email({ minDomainSegments: 2, tlds: { allow: true } })
    .max(254)
    .optional(),

  attachments: Joi.array()
    .items(attachmentSchema)
    .max(config.attachments.maxCount)
    .optional()
    .custom((value, helpers) => {
      if (!Array.isArray(value)) return value;
      const totalBase64 = value.reduce((sum, a) => sum + a.content.length, 0);
      const totalBytes = Math.floor(totalBase64 * 3 / 4);
      if (totalBytes > config.attachments.maxBytesTotal) {
        return helpers.error('any.invalid', { message: 'total attachments size too large' });
      }
      return value;
    }, 'attachments total size validation'),
}).options({ stripUnknown: true });

export function validateTemplate(project, templateId) {
  if (!config.allowedProjects.includes(project)) {
    throw new Error('Project not allowed');
  }
  const allowedTemplates = config.allowedTemplates[project];
  if (!allowedTemplates || !allowedTemplates.includes(templateId)) {
    throw new Error('Template not allowed for this project');
  }
  return true;
}

export function validateTemplatePath(templateId, project) {
  if (!/^[a-z0-9-]+$/.test(templateId)) {
    throw new Error('Invalid template_id format');
  }
  if (!config.allowedProjects.includes(project)) {
    throw new Error(`Invalid project: ${project}`);
  }

  const baseDir = path.resolve(config.templatesDir);
  const candidate = path.resolve(baseDir, project, `${templateId}.html`);

  if (!candidate.startsWith(baseDir + path.sep) && candidate !== baseDir) {
    throw new Error('Invalid template path: resolution escapes templates directory');
  }
  return candidate;
}
