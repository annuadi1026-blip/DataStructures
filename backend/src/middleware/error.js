import { AppError } from '../utils/errors.js';
import { isProd, isTest } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }
  if (err?.code === '23505') { // unique violation
    return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'That record already exists' } });
  }
  if (err?.code && /^(08|53|57|28)/.test(String(err.code))) {
    if (!isTest) console.error('Database error:', err.code, err.message);
    return res.status(503).json({ success: false, error: { code: 'DATABASE_ERROR', message: 'Database is temporarily unavailable' } });
  }
  if (!isTest) console.error(err);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: isProd ? 'Something went wrong' : err.message } });
}
