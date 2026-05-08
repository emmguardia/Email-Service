import { jwtHandler } from '../utils/security.js';
import { logger } from '../utils/logger.js';

export function verifyJWTToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7);

    try {
      const payload = jwtHandler.verify(token);
      req.tokenPayload = payload;
      req.project = payload.project;
      next();
    } catch (error) {
      logger.warn({ error: error.message, request_id: req.id }, 'auth_failed');
      return res.status(401).json({ error: 'Authentication failed' });
    }
  } catch (error) {
    logger.error({ error: error.message, request_id: req.id }, 'auth_middleware_error');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export function verifyProjectAccess(req, res, next) {
  const tokenProject = req.tokenPayload?.project;
  const requestedProject = req.body?.project ?? req.params?.project;

  if (requestedProject && tokenProject !== requestedProject) {
    logger.warn(
      {
        token_project: tokenProject,
        requested_project: requestedProject,
        request_id: req.id,
      },
      'project_access_denied'
    );
    return res.status(403).json({ error: 'Access denied' });
  }

  next();
}
