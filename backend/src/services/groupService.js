import crypto from 'node:crypto';
import { query, withTransaction } from '../config/db.js';
import { today, dailyTarget } from '../utils/dates.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { completedCounts } from './dailyService.js';
import { completeDatesFor, computeStreaks } from './progressService.js';

const MAX_MEMBERS = 30;

export async function getMembership(userId, groupId) {
  const { rows } = await query('SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
  return rows[0] || null;
}
export async function assertMember(userId, groupId) {
  const m = await getMembership(userId, groupId);
  if (!m) throw forbidden('NOT_A_GROUP_MEMBER', 'You are not a member of this group');
  return m;
}
async function assertOwner(userId, groupId) {
  const m = await assertMember(userId, groupId);
  if (m.role !== 'owner') throw forbidden('NOT_GROUP_OWNER', 'Only the group owner can do that');
}
const code = () => crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars

export async function createGroup(userId, name) {
  return withTransaction(async (c) => {
    const g = await c.query('INSERT INTO groups (name, owner_id) VALUES ($1,$2) RETURNING *', [name, userId]);
    await c.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')`, [g.rows[0].id, userId]);
    const inv = await c.query(
      `INSERT INTO group_invites (group_id, code, created_by, expires_at) VALUES ($1,$2,$3, now() + interval '30 days') RETURNING code, expires_at`,
      [g.rows[0].id, code(), userId]);
    return { ...g.rows[0], my_role: 'owner', invite: inv.rows[0] };
  });
}

export async function listGroups(userId) {
  const { rows } = await query(
    `SELECT g.id, g.name, g.owner_id, gm.role AS my_role, g.created_at,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS member_count
     FROM groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1 ORDER BY g.created_at`, [userId]);
  return rows;
}

export async function getGroup(userId, groupId) {
  const me = await assertMember(userId, groupId);
  const g = await query('SELECT id, name, owner_id, created_at FROM groups WHERE id=$1', [groupId]);
  if (!g.rows[0]) throw notFound('GROUP_NOT_FOUND', 'Group not found');
  const members = await query(
    `SELECT u.id, u.username, u.display_name, gm.role, gm.joined_at FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id=$1 ORDER BY gm.joined_at`, [groupId]);
  let invite = null;
  if (me.role === 'owner') {
    const inv = await query(`SELECT code, expires_at, uses, max_uses FROM group_invites WHERE group_id=$1 AND expires_at > now() AND uses < max_uses ORDER BY created_at DESC LIMIT 1`, [groupId]);
    invite = inv.rows[0] || null;
  }
  return { ...g.rows[0], my_role: me.role, members: members.rows, invite };
}

async function addUserToGroup(c, groupId, userId) {
  const n = await c.query('SELECT count(*)::int AS n FROM group_members WHERE group_id=$1', [groupId]);
  if (n.rows[0].n >= MAX_MEMBERS) throw badRequest('GROUP_FULL', `A group can have at most ${MAX_MEMBERS} members`);
  const r = await c.query(`INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [groupId, userId]);
  if (!r.rowCount) throw conflict('ALREADY_A_MEMBER', 'Already a member of this group');
}

/** Owner adds an existing user directly by email or username. */
export async function addMember(ownerId, groupId, identifier) {
  await assertOwner(ownerId, groupId);
  const u = await query('SELECT id, username, display_name FROM users WHERE lower(email)=lower($1) OR lower(username)=lower($1)', [identifier]);
  if (!u.rows[0]) throw notFound('USER_NOT_FOUND', 'No user with that email or username');
  await withTransaction((c) => addUserToGroup(c, groupId, u.rows[0].id));
  return u.rows[0];
}

export async function createInvite(userId, groupId, email) {
  await assertMember(userId, groupId); // any member can invite friends
  const { rows } = await query(
    `INSERT INTO group_invites (group_id, code, invited_email, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + interval '14 days')
     RETURNING code, expires_at, max_uses`, [groupId, code(), email?.toLowerCase() ?? null, userId]);
  return rows[0];
}

export async function joinWithCode(userId, inviteCode) {
  return withTransaction(async (c) => {
    const inv = await c.query('SELECT * FROM group_invites WHERE code = $1 FOR UPDATE', [inviteCode.toUpperCase()]);
    const i = inv.rows[0];
    if (!i || i.expires_at < new Date() || i.uses >= i.max_uses) throw notFound('INVITE_INVALID', 'Invite code is invalid or expired');
    if (i.invited_email) {
      const u = await c.query('SELECT email FROM users WHERE id=$1', [userId]);
      if (u.rows[0].email.toLowerCase() !== i.invited_email.toLowerCase()) throw forbidden('INVITE_FOR_ANOTHER_USER', 'This invite was issued to a different email address');
    }
    await addUserToGroup(c, i.group_id, userId);
    await c.query('UPDATE group_invites SET uses = uses + 1 WHERE id = $1', [i.id]);
    const g = await c.query('SELECT id, name FROM groups WHERE id=$1', [i.group_id]);
    return g.rows[0];
  });
}

/** Remove someone (owner), or leave (self). If the owner leaves, ownership moves on; the last member leaving deletes the group. */
export async function removeMember(actorId, groupId, targetId) {
  const me = await assertMember(actorId, groupId);
  const self = actorId === targetId;
  if (!self && me.role !== 'owner') throw forbidden('NOT_GROUP_OWNER', 'Only the group owner can remove other members');
  const target = await getMembership(targetId, groupId);
  if (!target) throw notFound('MEMBER_NOT_FOUND', 'That user is not in this group');
  await withTransaction(async (c) => {
    await c.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, targetId]);
    await c.query('DELETE FROM shared_solutions WHERE group_id=$1 AND user_id=$2', [groupId, targetId]);
    if (target.role === 'owner') {
      const next = await c.query('SELECT user_id FROM group_members WHERE group_id=$1 ORDER BY joined_at LIMIT 1', [groupId]);
      if (next.rows[0]) {
        await c.query('UPDATE groups SET owner_id=$2 WHERE id=$1', [groupId, next.rows[0].user_id]);
        await c.query(`UPDATE group_members SET role='owner' WHERE group_id=$1 AND user_id=$2`, [groupId, next.rows[0].user_id]);
      } else await c.query('DELETE FROM groups WHERE id=$1', [groupId]);
    }
  });
}

/** Group dashboard: counts only. Solutions/code are never included here. */
export async function groupProgress(userId, groupId) {
  await assertMember(userId, groupId);
  const date = today();
  const target = dailyTarget(date);
  const g = await query('SELECT id, name FROM groups WHERE id=$1', [groupId]);
  const mem = await query(
    `SELECT u.id, u.username, u.display_name, gm.role FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY u.display_name`, [groupId]);
  const ids = mem.rows.map((m) => m.id);
  const [counts, dates, solved, topics, prefs] = await Promise.all([
    completedCounts(ids, date),
    completeDatesFor(ids),
    query(`SELECT user_id, count(*)::int AS n FROM user_question_progress WHERE user_id = ANY($1::uuid[]) AND solved_at IS NOT NULL GROUP BY user_id`, [ids]),
    query(`SELECT p.user_id, q.topic, min(q.roadmap_order)::int AS ord, count(*)::int AS solved
           FROM user_question_progress p JOIN questions q ON q.id=p.question_id
           WHERE p.user_id = ANY($1::uuid[]) AND p.solved_at IS NOT NULL GROUP BY p.user_id, q.topic`, [ids]),
    query('SELECT user_id, allow_nudges FROM notification_preferences WHERE user_id = ANY($1::uuid[])', [ids]),
  ]);
  const totals = await query('SELECT topic, count(*)::int AS total, min(roadmap_order)::int AS ord FROM questions GROUP BY topic ORDER BY min(roadmap_order)');
  const solvedMap = new Map(solved.rows.map((r) => [r.user_id, r.n]));
  const nudgeMap = new Map(prefs.rows.map((r) => [r.user_id, r.allow_nudges]));
  const members = mem.rows.map((m) => {
    const done = counts.get(m.id) || 0;
    const streaks = computeStreaks(dates.get(m.id) || [], date);
    const perTopic = new Map(topics.rows.filter((t) => t.user_id === m.id).map((t) => [t.topic, t.solved]));
    return {
      ...m, today_completed: done, today_target: target,
      status: target === 0 ? 'HOLIDAY' : done >= target ? 'DONE' : done > 0 ? 'PARTIAL' : 'NONE',
      total_solved: solvedMap.get(m.id) || 0, current_streak: streaks.current, longest_streak: streaks.longest,
      can_be_nudged: target > 0 && m.id !== userId && (nudgeMap.get(m.id) ?? true) && done < target,
      topics: totals.rows.map((t) => ({ topic: t.topic, total: t.total, solved: perTopic.get(t.topic) || 0 })),
    };
  });
  return {
    group: g.rows[0], date, target, members,
    members_completed: members.filter((m) => m.status === 'DONE').length, total_questions: totals.rows.reduce((a, t) => a + t.total, 0),
  };
}

export async function shareAGroup(a, b) {
  const { rowCount } = await query(
    `SELECT 1 FROM group_members x JOIN group_members y ON x.group_id = y.group_id WHERE x.user_id=$1 AND y.user_id=$2 LIMIT 1`, [a, b]);
  return rowCount > 0;
}
