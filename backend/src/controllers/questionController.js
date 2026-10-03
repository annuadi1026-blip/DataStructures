import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import * as questions from '../services/questionService.js';
import * as solutions from '../services/solutionService.js';

export const list = asyncHandler(async (req, res) => {
  const items = await questions.list(req.user.id, req.query);
  ok(res, { total: items.length, items });
});
export const topics = asyncHandler(async (req, res) => ok(res, { topics: await questions.topics() }));
export const get = asyncHandler(async (req, res) => ok(res, { question: await questions.get(req.user.id, req.params.id) }));
export const approaches = asyncHandler(async (req, res) => ok(res, { approaches: await questions.approaches(req.user.id, req.params.id) }));
export const getMySolution = asyncHandler(async (req, res) => ok(res, { solution: await solutions.getMine(req.user.id, req.params.id) }));
export const saveMySolution = asyncHandler(async (req, res) => ok(res, { solution: await solutions.saveMine(req.user.id, req.params.id, req.body) }));
export const submitMySolution = asyncHandler(async (req, res) => ok(res, { solution: await solutions.submitMine(req.user.id, req.params.id, req.body) }));
export const share = asyncHandler(async (req, res) => ok(res, { solution: await solutions.share(req.user.id, req.params.id, req.body) }));
export const unshare = asyncHandler(async (req, res) => ok(res, { solution: await solutions.unshare(req.user.id, req.params.id, req.params.groupId) }));
