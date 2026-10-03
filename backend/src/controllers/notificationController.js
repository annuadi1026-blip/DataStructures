import { asyncHandler, forbidden } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import * as notifications from '../services/notificationService.js';
import crypto from 'node:crypto';

export const list = asyncHandler(async (req, res) => ok(res, await notifications.list(req.user.id, req.query)));
export const markRead = asyncHandler(async (req, res) => ok(res, await notifications.markRead(req.user.id, req.params.id)));
export const markAllRead = asyncHandler(async (req, res) => ok(res, await notifications.markAllRead(req.user.id)));
export const getPrefs = asyncHandler(async (req, res) => ok(res, { preferences: await notifications.getPreferences(req.user.id) }));
export const setPrefs = asyncHandler(async (req, res) => ok(res, { preferences: await notifications.updatePreferences(req.user.id, req.body) }));
export const nudge = asyncHandler(async (req, res) => ok(res, { notification: await notifications.sendNudge(req.user.id, req.params.userId) }, 201));

/** Cron entry point. Requires CRON_SECRET; disabled entirely when the secret is not configured. */
export const runJob = asyncHandler(async (req, res) => {
  const given = Buffer.from(String(req.get('x-cron-secret') || ''));
  const want = Buffer.from(env.CRON_SECRET);
  if (!env.CRON_SECRET || given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw forbidden('BAD_CRON_SECRET', 'Invalid cron secret');
  ok(res, { stats: await notifications.processScheduled() });
});
