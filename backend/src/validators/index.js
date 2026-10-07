import { z } from 'zod';

const id = z.coerce.number().int().positive();
const uuid = z.string().uuid();
const text = (max) => z.string().max(max);
const STATUSES = ['NOT_STARTED', 'ATTEMPTED', 'SOLVED', 'NEEDS_REVISION', 'REVISED'];

export const password = z.string().min(8, 'must be at least 8 characters').max(128)
  .regex(/[A-Za-z]/, 'must contain a letter').regex(/[0-9]/, 'must contain a digit');
const username = z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_]+$/, 'letters, digits and underscores only');

export const schemas = {
  register: { body: z.object({ email: z.string().trim().email().max(254), username, displayName: z.string().trim().min(1).max(60), password }) },
  login: { body: z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) }) },
  updateMe: { body: z.object({ email: z.string().trim().email().max(254).optional(), username: username.optional(), displayName: z.string().trim().min(1).max(60).optional() }).refine((o) => Object.keys(o).length > 0, 'Nothing to update') },
  changePassword: { body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }) },
  deleteMe: { body: z.object({ password: z.string().min(1).max(128) }) },

  idParam: { params: z.object({ id }) },
  questionList: { query: z.object({
    q: z.string().trim().max(100).optional(), topic: z.string().max(80).optional(),
    source: z.enum(['NEETCODE', 'STRIVER', 'BOTH']).optional(), status: z.enum(STATUSES).optional(),
    solved: z.enum(['true', 'false']).optional(), revisionDue: z.enum(['true', 'false']).optional() }) },
  dateParam: { params: z.object({ date: z.string() }) },
  topicParam: { params: z.object({ topic: z.string().min(1).max(80) }) },
  setStatus: { params: z.object({ questionId: id }), body: z.object({ status: z.enum(STATUSES) }) },
  questionIdParam: { params: z.object({ questionId: id }) },

  saveSolution: { params: z.object({ id }), body: z.object({
    approach: text(10000).default(''), code: text(30000).default(''), timeComplexity: text(200).default(''),
    spaceComplexity: text(200).default(''), mistakes: text(10000).default(''), learned: text(10000).default('') }) },
  submitSolution: { params: z.object({ id }), body: z.object({
    approach: text(10000).default(''), code: text(30000).default(''), timeComplexity: text(200).default(''),
    spaceComplexity: text(200).default(''), mistakes: text(10000).default(''), learned: text(10000).default('') }) },
  shareSolution: { params: z.object({ id }), body: z.object({ groupId: uuid, approach: z.boolean().default(true), code: z.boolean().default(true), explanation: z.boolean().default(true), notes: z.boolean().default(false) }) },
  unshare: { params: z.object({ id, groupId: uuid }) },

  createGroup: { body: z.object({ name: z.string().trim().min(2).max(60) }) },
  groupId: { params: z.object({ id: uuid }) },
  joinGroup: { body: z.object({ code: z.string().trim().min(4).max(32) }) },
  activeSquad: { body: z.object({ group_id: uuid.nullable() }) },
  soloStartingDay: { body: z.object({ starting_day: z.number().int().min(1) }) },
  addMember: { params: z.object({ id: uuid }), body: z.object({ identifier: z.string().trim().min(1).max(254) }) },
  createInvite: { params: z.object({ id: uuid }), body: z.object({ email: z.string().trim().email().max(254).optional() }).default({}) },
  removeMember: { params: z.object({ id: uuid, userId: uuid }) },
  groupQuestion: { params: z.object({ id: uuid, questionId: id }) },

  notificationList: { query: z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) },
  notificationId: { params: z.object({ id }) },
  prefs: { body: z.object({
    personal_daily_reminder: z.boolean().optional(), friend_pending: z.boolean().optional(), friend_completed: z.boolean().optional(),
    allow_nudges: z.boolean().optional(), daily_group_summary: z.boolean().optional() }).refine((o) => Object.keys(o).length > 0, 'Nothing to update') },
  userIdParam: { params: z.object({ userId: uuid }) },
};
