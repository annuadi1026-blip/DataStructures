import { query } from '../config/db.js';
import { today, isValidDate, dailyTarget, isSunday } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';
import { shapeQuestion } from '../models/questionModel.js';
import { dailyCompletionCounts, getDailyStudyData } from './studyStateService.js';

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
  const scoped = await runner.query(
    `SELECT a.position,(a.completed OR p.solved_at IS NOT NULL) AS completed,
            COALESCE(a.completed_at,p.solved_at) AS completed_at,a.assignment_date,
            q.id,q.slug,q.title,q.topic,q.roadmap_order,q.question_order,q.in_neetcode,q.in_striver,
            q.difficulty,q.description,q.source_note,
            COALESCE(p.status,'NOT_STARTED') AS status,p.solved_at,p.last_revised_at,p.next_revision_at,
            COALESCE(p.revision_count,0) AS revision_count,
            (SELECT json_object_agg(s.kind,s.url) FROM question_sources s WHERE s.question_id=q.id) AS sources
     FROM study_day_daily_assignments a JOIN questions q ON q.id=a.question_id
     LEFT JOIN user_question_progress p ON p.question_id=a.question_id AND p.user_id=a.user_id
     WHERE a.user_id=$1 AND a.assignment_date=$2
     ORDER BY a.created_at,a.scope_type,a.scope_id,a.position`, [userId, date]);
  if (scoped.rowCount) return scoped.rows.map(shape);
  const { rows } = await runner.query(`${SELECT} WHERE da.user_id=$1 AND da.assignment_date=$2 ORDER BY da.position`, [userId, date]);
  return rows.map(shape);
}

async function buildResponse(userId, date, assignments) {
  const target = dailyTarget(date);
  const [dayNo, missed] = await Promise.all([
    query(`SELECT study_day AS n FROM study_day_daily_assignments
           WHERE user_id=$1 AND assignment_date<=$2
           ORDER BY assignment_date DESC,created_at DESC LIMIT 1`, [userId, date]),
    query(
      `SELECT q.id, q.title, q.topic, da.assignment_date FROM daily_assignments da JOIN questions q ON q.id = da.question_id
       WHERE da.user_id=$1 AND da.assignment_date<$2 AND NOT da.completed
         AND EXTRACT(DOW FROM da.assignment_date) <> 0 ORDER BY da.assignment_date, da.position`, [userId, date]),
  ]);
  return {
    date, day_number: dayNo.rows[0]?.n ?? null, target,
    completed_count: assignments.filter((a) => a.completed).length, assignments,
    pending_from_earlier_days: missed.rows,
  };
}

/**
 * Today's assignment. Created once, then persisted: later calls return the same rows.
 * The next questions are the lowest roadmap positions never assigned to this user and not already solved.
 * (If fewer than the day's target remain at the end of the roadmap, the remainder is assigned.)
 */
export async function ensureToday(userId, date = today()) {
  return getDailyStudyData(userId, date);
}

export async function getForDate(userId, date) {
  if (!isValidDate(date)) throw badRequest('INVALID_DATE', 'Date must be YYYY-MM-DD');
  if (isSunday(date)) return buildResponse(userId, date, []);
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
export async function completedCounts(userIds, date, forcedScope = null) {
  return dailyCompletionCounts(userIds, date, forcedScope);
}
