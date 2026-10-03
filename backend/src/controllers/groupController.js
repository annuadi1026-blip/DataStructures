import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import * as groups from '../services/groupService.js';
import * as solutions from '../services/solutionService.js';

export const create = asyncHandler(async (req, res) => ok(res, { group: await groups.createGroup(req.user.id, req.body.name) }, 201));
export const list = asyncHandler(async (req, res) => ok(res, { groups: await groups.listGroups(req.user.id) }));
export const get = asyncHandler(async (req, res) => ok(res, { group: await groups.getGroup(req.user.id, req.params.id) }));
export const join = asyncHandler(async (req, res) => ok(res, { group: await groups.joinWithCode(req.user.id, req.body.code) }));
export const addMember = asyncHandler(async (req, res) => ok(res, { member: await groups.addMember(req.user.id, req.params.id, req.body.identifier) }, 201));
export const invite = asyncHandler(async (req, res) => ok(res, { invite: await groups.createInvite(req.user.id, req.params.id, req.body.email) }, 201));
export const removeMember = asyncHandler(async (req, res) => { await groups.removeMember(req.user.id, req.params.id, req.params.userId); ok(res, { removed: true }); });
export const progress = asyncHandler(async (req, res) => ok(res, await groups.groupProgress(req.user.id, req.params.id)));
export const shared = asyncHandler(async (req, res) => ok(res, { shared: await solutions.listShared(req.user.id, req.params.id, req.params.questionId) }));
