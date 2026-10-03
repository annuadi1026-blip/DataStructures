import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { isProd } from '../config/env.js';
import { COOKIE_NAME } from '../middleware/auth.js';
import * as auth from '../services/authService.js';

const cookieOpts = { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', maxAge: 7 * 24 * 3600 * 1000, path: '/' };
const setCookie = (res, token) => res.cookie(COOKIE_NAME, token, cookieOpts);

export const register = asyncHandler(async (req, res) => {
  const r = await auth.register(req.body); setCookie(res, r.token); ok(res, r, 201);
});
export const login = asyncHandler(async (req, res) => {
  const r = await auth.login(req.body); setCookie(res, r.token); ok(res, r);
});
export const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOpts, maxAge: undefined });
  ok(res, { loggedOut: true });
};
export const me = asyncHandler(async (req, res) => ok(res, { user: await auth.getMe(req.user.id) }));
export const updateMe = asyncHandler(async (req, res) => ok(res, { user: await auth.updateMe(req.user.id, req.body) }));
export const changePassword = asyncHandler(async (req, res) => {
  const r = await auth.changePassword(req.user.id, req.body); setCookie(res, r.token); ok(res, r);
});
export const deleteMe = asyncHandler(async (req, res) => {
  await auth.deleteAccount(req.user.id, req.body.password);
  res.clearCookie(COOKIE_NAME, { ...cookieOpts, maxAge: undefined });
  ok(res, { deleted: true });
});
