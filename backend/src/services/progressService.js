import { query, withTransaction } from '../config/db.js';
import { today, dailyTarget, isSunday, previousPracticeDay } from '../utils/dates.js';
import { notFound } from '../utils/errors.js';
import { questionExists, getQuestion } from '../models/questionModel.js';
import * as revisions from './revisionService.js';
import * as notifications from './notificationService.js';
import { dailyAssignmentCounts, getActiveStudyStatus, listPauseDates } from './studyStateService.js';

/** Set one user's status for one question. Everything is per-user; there is no global solved flag. */
export async function setStatus(userId, questionId, status) {
  if (!(await questionExists(questionId))) throw notFound('QUESTION_NOT_FOUND', 'Question not found');
  if (status === 'REVISED') {
    await revisions.complete(userId, questionId);
    return getQuestion(userId, questionId);
  }
  let becameSolved = false;
  await withTransaction(async (c) => {
    const cur = await c.query('SELECT * FROM user_question_progress WHERE user_id=$1 AND question_id=$2 FOR UPDATE', [userId, questionId]);
    const row = cur.rows[0];
    if (!row) {
      await c.query('INSERT INTO user_question_progress (user_id, question_id) VALUES ($1,$2)', [userId, questionId]);
    }
    const alreadySolved = !!row?.solved_at;
    if (status === 'NOT_STARTED') {
      await c.query(
        `UPDATE user_question_progress SET status='NOT_STARTED', attempted_at=NULL, solved_at=NULL, last_revised_at=NULL, next_revision_at=NULL, revision_count=0, updated_at=now()
         WHERE user_id=$1 AND question_id=$2`, [userId, questionId]);
      await c.query('DELETE FROM revisions WHERE user_id=$1 AND question_id=$2', [userId, questionId]);
      await c.query('UPDATE daily_assignments SET completed=false, completed_at=NULL WHERE user_id=$1 AND question_id=$2', [userId, questionId]);
      await c.query('UPDATE study_day_daily_assignments SET completed=false,completed_at=NULL WHERE user_id=$1 AND question_id=$2', [userId,questionId]);
    } else if (status === 'ATTEMPTED') {
      // Attempting something already solved would silently lose that fact, so keep SOLVED-family statuses.
      if (!alreadySolved) {
        await c.query(`UPDATE user_question_progress SET status='ATTEMPTED', attempted_at=COALESCE(attempted_at, now()), updated_at=now() WHERE user_id=$1 AND question_id=$2`, [userId, questionId]);
      }
    } else if (status === 'SOLVED') {
      await c.query(
        `UPDATE user_question_progress SET status='SOLVED', attempted_at=COALESCE(attempted_at, now()), solved_at=COALESCE(solved_at, now()), updated_at=now()
         WHERE user_id=$1 AND question_id=$2`, [userId, questionId]);
      const upd = await c.query(
        `UPDATE daily_assignments SET completed=true, completed_at=now() WHERE user_id=$1 AND question_id=$2 AND NOT completed RETURNING assignment_date`,
        [userId, questionId]);
      const scopedUpd = await c.query(
        'UPDATE study_day_daily_assignments SET completed=true,completed_at=COALESCE(completed_at,now()) WHERE user_id=$1 AND question_id=$2 AND assignment_date=$3 RETURNING assignment_date',
        [userId,questionId,today()]);
      becameSolved = upd.rowCount > 0 || scopedUpd.rowCount > 0;
      if (!alreadySolved) await revisions.scheduleFirstRevision(c, userId, questionId);
    } else if (status === 'NEEDS_REVISION') {
      await c.query(
        `UPDATE user_question_progress SET status='NEEDS_REVISION', attempted_at=COALESCE(attempted_at, now()), solved_at=COALESCE(solved_at, now()), updated_at=now()
         WHERE user_id=$1 AND question_id=$2`, [userId, questionId]);
      await c.query(`UPDATE daily_assignments SET completed=true, completed_at=COALESCE(completed_at, now()) WHERE user_id=$1 AND question_id=$2 AND NOT completed`, [userId, questionId]);
      await c.query('UPDATE study_day_daily_assignments SET completed=true,completed_at=COALESCE(completed_at,now()) WHERE user_id=$1 AND question_id=$2 AND assignment_date=$3', [userId,questionId,today()]);
      await revisions.scheduleRevisionNow(c, userId, questionId);
    }
  });
  if (becameSolved || status === 'NEEDS_REVISION') {
    // Best effort: finish the event hook before returning, but never fail the
    // user's progress update if notification delivery fails.
    try { await notifications.onProgressChanged(userId); }
    catch (e) { console.error('notify failed', e.message); }
  }
  return getQuestion(userId, questionId);
}

export function computeStreaks(dates, todayStr = today(), pauseDates = []) {
  const breaks = [...new Set(pauseDates.filter((date) => date <= todayStr))].sort();
  const breakSet = new Set(breaks);
  const set = new Set(dates.filter((date) => !isSunday(date) && !breakSet.has(date)));
  const lastBreak = breaks.at(-1) || null;
  let current = 0;
  let cursor = isSunday(todayStr) ? previousPracticeDay(todayStr) : todayStr;
  if (!set.has(cursor)) cursor = previousPracticeDay(cursor);
  while (set.has(cursor) && (!lastBreak || cursor > lastBreak)) {
    current++;
    const previous = previousPracticeDay(cursor);
    if (lastBreak && previous <= lastBreak) break;
    cursor = previous;
  }
  const sorted = [...set].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of sorted) {
    const brokenBetween = prev && breaks.some((pause) => pause > prev && pause <= d);
    run = prev && previousPracticeDay(d) === prev && !brokenBetween ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  return { current, longest };
}

/** Dates (per user) on which every assigned question was completed. */
export async function completeDatesFor(userIds) {
  const { rows } = await query(
    `SELECT user_id,assignment_date FROM (
       SELECT user_id,assignment_date FROM (
         SELECT user_id,assignment_date,completed FROM daily_assignments
         WHERE user_id=ANY($1::uuid[]) AND EXTRACT(DOW FROM assignment_date)<>0
         UNION ALL
         SELECT user_id,assignment_date,completed FROM study_day_daily_assignments
         WHERE user_id=ANY($1::uuid[]) AND EXTRACT(DOW FROM assignment_date)<>0
       ) assignments
       GROUP BY user_id,assignment_date
       HAVING count(*)=count(*) FILTER (WHERE completed)
     ) completed_days`, [userIds]);
  const map = new Map(userIds.map((u) => [u, []]));
  for (const r of rows) map.get(r.user_id).push(r.assignment_date);
  return map;
}

export async function topicProgress(userId) {
  const { rows } = await query(
    `SELECT q.topic, min(q.roadmap_order)::int AS roadmap_order, count(*)::int AS total,
            count(p.solved_at)::int AS solved,
            count(*) FILTER (WHERE p.status = 'ATTEMPTED')::int AS attempted
     FROM questions q LEFT JOIN user_question_progress p ON p.question_id=q.id AND p.user_id=$1
     GROUP BY q.topic ORDER BY min(q.roadmap_order)`, [userId]);
  return rows;
}

export async function overview(userId) {
  const today_ = today();
  const [topics, datesByUser, pauseDates, todayCounts, rev, activeStudy] = await Promise.all([
    topicProgress(userId),
    completeDatesFor([userId]),
    listPauseDates([userId]),
    dailyAssignmentCounts([userId],today_),
    revisions.listDue(userId, today_),
    getActiveStudyStatus(userId),
  ]);
  const total = topics.reduce((a, t) => a + t.total, 0);
  const solved = topics.reduce((a, t) => a + t.solved, 0);
  const attempted = topics.reduce((a, t) => a + t.attempted, 0);
  const dates = datesByUser.get(userId);
  const streaks = computeStreaks(dates, today_, pauseDates.get(userId));
  const initialized = !!activeStudy.initialized;
  const needsChooseSoloStart = activeStudy.mode === 'SOLO' && !initialized;
  return {
    today: { date: today_, target: initialized ? dailyTarget(today_) : 0,
      completed: initialized ? todayCounts.get(userId).completed : 0,
      assigned: initialized ? todayCounts.get(userId).assigned : 0,
      needs_choose_solo_start: needsChooseSoloStart },
    total_questions: total, total_solved: solved, total_attempted: attempted, questions_remaining: total - solved,
    current_streak: streaks.current, longest_streak: streaks.longest, revision_due: rev.items.length, topics,
  };
}

export async function topicDetail(userId, topic) {
  const { rows } = await query(
    `SELECT q.id, q.title, COALESCE(p.status,'NOT_STARTED') AS status FROM questions q
     LEFT JOIN user_question_progress p ON p.question_id=q.id AND p.user_id=$1 WHERE q.topic=$2 ORDER BY q.question_order`, [userId, topic]);
  if (!rows.length) throw notFound('TOPIC_NOT_FOUND', 'Topic not found');
  return { topic, total: rows.length, solved: rows.filter((r) => ['SOLVED', 'REVISED', 'NEEDS_REVISION'].includes(r.status)).length, questions: rows };
}
