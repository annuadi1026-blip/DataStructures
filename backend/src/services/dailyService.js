import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { today, isValidDate } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { shapeQuestion } from '../models/questionModel.js';

const SELECT = `
  SELECT da.position, da.completed, da.completed_at, da.assignment_date,
         q.id, q.slug, q.title, q.topic, q.roadmap_order, q.question_order, q.in_neetcode, q.in_striver,
         q.difficulty, q.description, q.source_note,
         COALESCE(p.status,'NOT_STARTED') AS status, p.solved_at, p.last_revised_at, p.next_revision_at, COALESCE(p.revision_count,0) AS revision_count,
         (SELECT json_object_agg(s.kind, s.url) FROM question_sources s WHERE s.question_id = q.id) AS sources
  FROM daily_assignments da
  JOIN questions q ON q.id = da.question_id
  LEFT JOIN user_question_progress p ON p.question_id = q.id AND p.user_id = da.user_id`;

const shape = (r) => ({ ...shapeQuestion(r), position: r.position, completed: r.completed, completed_at: r.completed_at });

async function fetchDay(runner, userId, date) {
  const { rows } = await runner.query(`${SELECT} WHERE da.user_id=$1 AND da.assignment_date=$2 ORDER BY da.position`, [userId, date]);
  return rows.map(shape);
}

async function buildResponse(userId, date, assignments) {
  const [dayNo, missed] = await Promise.all([
    query('SELECT count(DISTINCT assignment_date)::int AS n FROM daily_assignments WHERE user_id=$1 AND assignment_date<=$2', [userId, date]),
    query(
      `SELECT q.id, q.title, q.topic, da.assignment_date FROM daily_assignments da JOIN questions q ON q.id = da.question_id
       WHERE da.user_id=$1 AND da.assignment_date<$2 AND NOT da.completed ORDER BY da.assignment_date, da.position`, [userId, date]),
  ]);
  return {
    date, day_number: dayNo.rows[0].n, target: env.DAILY_QUESTION_COUNT,
    completed_count: assignments.filter((a) => a.completed).length, assignments,
    pending_from_earlier_days: missed.rows,
  };
}

/**
 * Today's assignment. Created once, then persisted: later calls return the same rows.
 * The next questions are the lowest roadmap positions never assigned to this user and not already solved.
 * (If fewer than 2 remain at the very end of the roadmap, the remainder is assigned.)
 */
export async function ensureToday(userId, date = today()) {
  // Most visits already have today's two rows. Avoid opening a transaction and
  // taking an advisory lock for that read-only, steady-state path.
  const existingCount = await query(
    'SELECT count(*)::int AS n FROM daily_assignments WHERE user_id=$1 AND assignment_date=$2', [userId, date]);
  if (existingCount.rows[0].n >= env.DAILY_QUESTION_COUNT) return getForDate(userId, date);

  await withTransaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`daily:${userId}`]);
    const existing = await fetchDay(c, userId, date);
    const missing = env.DAILY_QUESTION_COUNT - existing.length;
    if (missing <= 0) return;
    const { rows: picks } = await c.query(
      `SELECT q.id FROM questions q
       WHERE NOT EXISTS (SELECT 1 FROM daily_assignments d WHERE d.user_id=$1 AND d.question_id=q.id)
         AND NOT EXISTS (SELECT 1 FROM user_question_progress p WHERE p.user_id=$1 AND p.question_id=q.id AND p.solved_at IS NOT NULL)
       ORDER BY q.roadmap_order, q.question_order LIMIT $2`, [userId, missing]);
    const taken = new Set(existing.map((e) => e.position));
    const free = [1, 2].filter((p) => !taken.has(p));
    for (let i = 0; i < picks.length; i++) {
      await c.query(
        `INSERT INTO daily_assignments (user_id, assignment_date, question_id, position) VALUES ($1,$2,$3,$4)`,
        [userId, date, picks[i].id, free[i]]);
    }
  });
  return getForDate(userId, date);
}

export async function getForDate(userId, date) {
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date must be YYYY-MM-DD');
  const assignments = await fetchDay({ query }, userId, date);
  return buildResponse(userId, date, assignments);
}

export async function getByDateParam(userId, date) {
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date must be YYYY-MM-DD');
  const t = today();
  if (date > t) throw badRequest('FUTURE_DATE', 'Assignments are only created for today');
  return date === t ? ensureToday(userId, date) : getForDate(userId, date);
}

/** completed assignment count today for many users: Map(userId -> n) */
export async function completedCounts(userIds, date) {
  const map = new Map(userIds.map((u) => [u, 0]));
  if (!userIds.length) return map;
  const { rows } = await query(
    `SELECT user_id, count(*)::int AS n FROM daily_assignments WHERE assignment_date=$2 AND completed AND user_id = ANY($1::uuid[]) GROUP BY user_id`,
    [userIds, date]);
  for (const r of rows) map.set(r.user_id, r.n);
  return map;
}
