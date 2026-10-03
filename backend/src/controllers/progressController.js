import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import * as daily from '../services/dailyService.js';
import * as progress from '../services/progressService.js';
import * as revisions from '../services/revisionService.js';

export const today = asyncHandler(async (req, res) => ok(res, await daily.ensureToday(req.user.id)));
export const byDate = asyncHandler(async (req, res) => ok(res, await daily.getByDateParam(req.user.id, req.params.date)));
export const overview = asyncHandler(async (req, res) => ok(res, await progress.overview(req.user.id)));
export const topic = asyncHandler(async (req, res) => ok(res, await progress.topicDetail(req.user.id, req.params.topic)));
export const setStatus = asyncHandler(async (req, res) => ok(res, { question: await progress.setStatus(req.user.id, req.params.questionId, req.body.status) }));
export const dueRevisions = asyncHandler(async (req, res) => ok(res, { ...(await revisions.listDue(req.user.id)), upcoming: await revisions.listUpcoming(req.user.id) }));
export const completeRevision = asyncHandler(async (req, res) => ok(res, await revisions.complete(req.user.id, req.params.questionId)));
