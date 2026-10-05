import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { asyncHandler, unauthorized } from '../utils/errors.js';

export const COOKIE_NAME = 'dsa_token';

export function signToken(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return req.cookies?.[COOKIE_NAME] || null;
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw unauthorized();
  let payload;
  try { payload = jwt.verify(token, env.JWT_SECRET); } catch { throw unauthorized('INVALID_TOKEN', 'Session is invalid or expired'); }
  const { rows } = await query('SELECT id, email, username, display_name, created_at, token_version FROM users WHERE id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || user.token_version !== payload.tv) throw unauthorized('INVALID_TOKEN', 'Session is invalid or expired');
  req.user = user;
  next();
});
