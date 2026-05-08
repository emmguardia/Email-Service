import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  logger.error(
    {
      error_type: err.name,
      error_message: err.message,
      path: req.path,
      method: req.method,
      request_id: req.id,
      stack: err.stack,
    },
    'unhandled_exception'
  );

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred',
    request_id: req.id,
  });
}
