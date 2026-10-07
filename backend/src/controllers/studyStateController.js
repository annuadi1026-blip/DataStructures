import { asyncHandler } from '../utils/errors.js';
import { ok } from '../utils/response.js';
import * as studyState from '../services/studyStateService.js';

export const get = asyncHandler(async (req,res) => ok(res, await studyState.getStudyState(req.user.id)));
export const selectActiveSquad = asyncHandler(async (req,res) => ok(res, await studyState.selectActiveGroup(req.user.id,req.body.group_id)));
export const chooseSoloStartingDay = asyncHandler(async (req,res) => ok(res, await studyState.chooseSoloStartingDay(req.user.id,req.body.starting_day)));
export const pause = asyncHandler(async (req,res) => ok(res, await studyState.setStudyPaused(req.user.id,true)));
export const resume = asyncHandler(async (req,res) => ok(res, await studyState.setStudyPaused(req.user.id,false)));
