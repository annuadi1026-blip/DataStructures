import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { today, addDays } from '../utils/dates.js';
import { conflict, notFound } from '../utils/errors.js';

/** Called inside the transaction that marks a question solved: schedules stage 1 of the revision plan. */
export async function scheduleFirstRevision(c, userId, questionId) {
  const due = addDays(today(), env.REVISION_INTERVALS_DAYS[0]);
  await c.query(
    `INSERT INTO revisions (user_id, question_id, stage, due_date) VALUES ($1,$2,1,$3) ON CONFLICT (user_id, question_id, stage) DO NOTHING`,
    [userId, questionId, due]);
  await c.query('UPDATE user_question_progress SET next_revision_at = $3 WHERE user_id=$1 AND question_id=$2', [userId, questionId, due]);
}

/** "Needs revision" means due now: make sure an open revision exists with due date today. */
export async function scheduleRevisionNow(c, userId, questionId) {
  const open = await c.query('SELECT id FROM revisions WHERE user_id=$1 AND question_id=$2 AND completed_at IS NULL ORDER BY stage LIMIT 1', [userId, questionId]);
  if (open.rows[0]) {
    await c.query('UPDATE revisions SET due_date = LEAST(due_date, $2::date) WHERE id=$1', [open.rows[0].id, today()]);
  } else {
    const max = await c.query('SELECT COALESCE(MAX(stage),0)::int AS s FROM revisions WHERE user_id=$1 AND question_id=$2', [userId, questionId]);
    await c.query('INSERT INTO revisions (user_id, question_id, stage, due_date) VALUES ($1,$2,$3,$4)', [userId, questionId, max.rows[0].s + 1, today()]);
  }
  await c.query('UPDATE user_question_progress SET next_revision_at = $3 WHERE user_id=$1 AND question_id=$2', [userId, questionId, today()]);
}

export async function listDue(userId, date = today()) {
  const { rows } = await query(
    `SELECT r.question_id, r.stage, r.due_date, q.title, q.topic, q.slug, (r.due_date < $2::date) AS overdue
     FROM revisions r JOIN questions q ON q.id = r.question_id
     WHERE r.user_id=$1 AND r.completed_at IS NULL AND r.due_date <= $2::date
     ORDER BY r.due_date, q.roadmap_order, q.question_order`, [userId, date]);
  return { date, total_stages: env.REVISION_INTERVALS_DAYS.length, items: rows };
}

export async function listUpcoming(userId) {
  const { rows } = await query(
    `SELECT r.question_id, r.stage, r.due_date, q.title, q.topic FROM revisions r JOIN questions q ON q.id=r.question_id
     WHERE r.user_id=$1 AND r.completed_at IS NULL AND r.due_date > $2::date ORDER BY r.due_date LIMIT 50`, [userId, today()]);
  return rows;
}

/** Complete the earliest open revision of a question and schedule the next stage (if any). */
export async function complete(userId, questionId) {
  return withTransaction(async (c) => {
    const prog = await c.query('SELECT status, solved_at FROM user_question_progress WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [userId, questionId]);
    if (!prog.rows[0] || !prog.rows[0].solved_at) throw conflict('NOT_SOLVED_YET', 'Solve the question before revising it');
    const open = await c.query(
      'SELECT id, stage FROM revisions WHERE user_id=$1 AND question_id=$2 AND completed_at IS NULL ORDER BY stage LIMIT 1 FOR UPDATE', [userId, questionId]);
    if (!open.rows[0]) throw notFound('NO_REVISION_PENDING', 'No revision is pending for this question');
    const { id, stage } = open.rows[0];
    await c.query('UPDATE revisions SET completed_at = now() WHERE id=$1', [id]);
    let next = null;
    const intervals = env.REVISION_INTERVALS_DAYS;
    if (stage < intervals.length) {
      next = addDays(today(), intervals[stage]);
      await c.query('INSERT INTO revisions (user_id, question_id, stage, due_date) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [userId, questionId, stage + 1, next]);
    }
    await c.query(
      `UPDATE user_question_progress SET status='REVISED', last_revised_at=now(), revision_count=revision_count+1, next_revision_at=$3, updated_at=now()
       WHERE user_id=$1 AND question_id=$2`, [userId, questionId, next]);
    return { question_id: questionId, completed_stage: stage, next_revision_at: next, schedule_finished: next === null };
  });
}
