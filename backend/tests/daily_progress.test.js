import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, closePool, query, makeUser, solveToday } from './helpers.js';
import { ensureToday } from '../src/services/dailyService.js';
import { completeDatesFor, computeStreaks } from '../src/services/progressService.js';
import { today, addDays, dailyTarget, previousPracticeDay } from '../src/utils/dates.js';

beforeAll(resetDb);
afterAll(closePool);

describe('daily assignment engine', () => {
  it('uses the Monday–Saturday schedule and makes Sunday a holiday', async () => {
    const u = await makeUser('schedule');
    const week = [
      ['2026-10-05', 2], ['2026-10-06', 2], ['2026-10-07', 2], ['2026-10-08', 2],
      ['2026-10-09', 2], ['2026-10-10', 1], ['2026-10-11', 0],
    ];
    for (const [date, target] of week) {
      const day = await ensureToday(u.id, date);
      expect(day.target).toBe(target);
      expect(day.assignments).toHaveLength(target);
    }
    const { rows } = await query('SELECT assignment_date, count(*)::int AS n FROM study_day_daily_assignments WHERE user_id=$1 GROUP BY assignment_date ORDER BY assignment_date', [u.id]);
    expect(rows.map((r) => [r.assignment_date, r.n])).toEqual(week.slice(0, 6));
  });

  it('assigns exactly 2 questions in roadmap order and persists them', async () => {
    const u = await makeUser('day');
    const first = (await u.get('/api/daily')).body.data;
    expect(first.target).toBe(2);
    expect(first.assignments.map((a) => a.title)).toEqual(['Contains Duplicate', 'Valid Anagram']);
    expect(first.assignments.map((a) => a.position)).toEqual([1, 2]);
    const again = (await u.get('/api/daily')).body.data;
    expect(again.assignments.map((a) => a.id)).toEqual(first.assignments.map((a) => a.id));
    const byDate = (await u.get(`/api/daily/${today()}`)).body.data;
    expect(byDate.assignments.length).toBe(2);
    const { rows } = await query('SELECT count(*)::int n FROM study_day_daily_assignments WHERE user_id=$1', [u.id]);
    expect(rows[0].n).toBe(2);
  });

  it('concurrent requests still produce exactly 2 rows', async () => {
    const u = await makeUser('race');
    await Promise.all([1, 2, 3, 4, 5].map(() => u.get('/api/daily')));
    const { rows } = await query('SELECT count(*)::int n FROM study_day_daily_assignments WHERE user_id=$1', [u.id]);
    expect(rows[0].n).toBe(2);
  });

  it('includes incomplete scoped assignments in the earlier-days queue', async () => {
    const user = await makeUser('scopedPending');
    const date = dailyTarget(today()) > 0 ? today() : addDays(today(), 1);
    const earlierDate = previousPracticeDay(date);
    await ensureToday(user.id, date);
    const mapping = await query(
      'SELECT question_id FROM solo_study_day_questions WHERE user_id=$1 AND study_day=1 AND position=1', [user.id]);
    await query(`INSERT INTO study_day_daily_assignments
      (user_id,scope_type,scope_id,assignment_date,study_day,position,question_id)
      VALUES ($1,'SOLO',$1,$2,1,1,$3)`, [user.id,earlierDate,mapping.rows[0].question_id]);
    const historical = await user.get(`/api/daily/${earlierDate}`);
    expect(historical.status).toBe(200);
    expect(historical.body.data.assignments.map((item) => item.id)).toContain(mapping.rows[0].question_id);

    const current = (await user.get('/api/daily')).body.data;
    expect(current.pending_from_earlier_days.map((item) => item.id)).toContain(mapping.rows[0].question_id);

    await user.patch(`/api/progress/${mapping.rows[0].question_id}`, { status: 'SOLVED' });
    const completedHistory = await user.get(`/api/daily/${earlierDate}`);
    expect(completedHistory.body.data.assignments.find((item) => item.id === mapping.rows[0].question_id).completed).toBe(true);
    const completed = (await user.get('/api/daily')).body.data;
    expect(completed.pending_from_earlier_days.map((item) => item.id)).not.toContain(mapping.rows[0].question_id);
  });

  it('database refuses a third slot and a repeated question', async () => {
    const u = await makeUser('db');
    const day = (await u.get('/api/daily')).body.data;
    const questionId = day.assignments[0].id;
    await expect(query(`INSERT INTO daily_assignments (user_id, assignment_date, question_id, position) VALUES ($1,$2,$3,3)`, [u.id, today(),questionId])).rejects.toThrow();
    await query('INSERT INTO daily_assignments (user_id,assignment_date,question_id,position) VALUES ($1,$2,$3,1)', [u.id,today(),questionId]);
    const dup = await query('SELECT question_id FROM daily_assignments WHERE user_id=$1 LIMIT 1', [u.id]);
    await expect(query(`INSERT INTO daily_assignments (user_id, assignment_date, question_id, position) VALUES ($1,$2,$3,1)`, [u.id, addDays(today(), 1), dup.rows[0].question_id])).rejects.toThrow();
  });

  it('advances through the roadmap day by day without duplicates', async () => {
    const u = await makeUser('adv');
    const seen = new Set();
    const ids = [];
    let d = today();
    const titles = [];
    let expectedTotal = 0;
    for (let i = 0; i < 10; i++) {
      const day = await ensureToday(u.id, d);
      const target = dailyTarget(d);
      expect(day.target).toBe(target);
      expect(day.assignments.length).toBe(target);
      for (const a of day.assignments) { expect(seen.has(a.id)).toBe(false); seen.add(a.id); ids.push(a.id); titles.push(a.title); }
      expectedTotal += target;
      d = addDays(d, 1);
    }
    const roadmap = await query('SELECT id, title FROM questions ORDER BY roadmap_order, question_order LIMIT $1', [expectedTotal]);
    expect(ids).toEqual(roadmap.rows.map((q) => q.id));
    expect(titles).toEqual(roadmap.rows.map((q) => q.title));
    expect(seen.size).toBe(expectedTotal);
  });

  it('skips questions the user already solved and keeps users independent', async () => {
    const a = await makeUser('solo'); const b = await makeUser('other');
    const list = (await a.get('/api/questions')).body.data.items;
    const twoSum = list.find((q) => q.title === 'Two Sum');
    await a.patch(`/api/progress/${twoSum.id}`, { status: 'SOLVED' });
    const days = [];
    let d = today();
    for (let i = 0; i < 2; i++) { days.push(...(await ensureToday(a.id, d)).assignments.map((x) => x.title)); d = addDays(d, 1); }
    expect(days).toEqual(['Contains Duplicate', 'Valid Anagram', 'Group Anagrams', 'Top K Frequent Elements']);
    expect((await b.get('/api/daily')).body.data.assignments.map((x) => x.title)).toEqual(['Contains Duplicate', 'Valid Anagram']);
  });

  it('rejects future and malformed dates and does not generate past days', async () => {
    const u = await makeUser('dates');
    expect((await u.get(`/api/daily/${addDays(today(), 1)}`)).body.error.code).toBe('FUTURE_DATE');
    expect((await u.get('/api/daily/2026-13-45')).body.error.code).toBe('INVALID_DATE');
    const past = (await u.get(`/api/daily/${addDays(today(), -3)}`)).body.data;
    expect(past.assignments).toEqual([]);
  });
});

describe('progress tracking', () => {
  it('marks questions solved per user, updates today, totals and the daily flag', async () => {
    const u = await makeUser('prog'); const other = await makeUser('peer');
    let ov = (await u.get('/api/progress')).body.data;
    expect(ov.total_questions).toBe(269); expect(ov.total_solved).toBe(0); expect(ov.questions_remaining).toBe(269);
    const assigned = await solveToday(u, 1);
    ov = (await u.get('/api/progress')).body.data;
    expect(ov.today).toMatchObject({ completed: 1, target: 2, assigned: 2 });
    expect(ov.total_solved).toBe(1); expect(ov.questions_remaining).toBe(268);
    expect(ov.topics.reduce((a, t) => a + t.total, 0)).toBe(269);
    const q = (await u.get(`/api/questions/${assigned[0].id}`)).body.data.question;
    expect(q.status).toBe('SOLVED'); expect(q.solved_at).toBeTruthy(); expect(q.next_revision_at).toBeTruthy();
    expect((await other.get(`/api/questions/${assigned[0].id}`)).body.data.question.status).toBe('NOT_STARTED');
    await solveToday(u, 2);
    expect((await u.get('/api/progress')).body.data.today.completed).toBe(2);
    expect((await u.get('/api/progress')).body.data.current_streak).toBe(1);
  });

  it('supports every status and resets cleanly', async () => {
    const u = await makeUser('stat');
    const q = (await u.get('/api/questions')).body.data.items[10];
    for (const s of ['ATTEMPTED', 'SOLVED', 'NEEDS_REVISION']) {
      const r = await u.patch(`/api/progress/${q.id}`, { status: s });
      expect(r.body.data.question.status).toBe(s);
    }
    const reset = await u.patch(`/api/progress/${q.id}`, { status: 'NOT_STARTED' });
    expect(reset.body.data.question.solved_at).toBeNull();
    expect((await u.patch(`/api/progress/${q.id}`, { status: 'DONE' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await u.patch('/api/progress/99999', { status: 'SOLVED' })).body.error.code).toBe('QUESTION_NOT_FOUND');
  });

  it('does not downgrade a solved question to attempted', async () => {
    const u = await makeUser('keep');
    const q = (await u.get('/api/questions')).body.data.items[20];
    await u.patch(`/api/progress/${q.id}`, { status: 'SOLVED' });
    expect((await u.patch(`/api/progress/${q.id}`, { status: 'ATTEMPTED' })).body.data.question.status).toBe('SOLVED');
  });

  it('computes streaks from consecutive completed days', () => {
    const t = '2026-10-10';
    expect(computeStreaks(['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-05'], t)).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(['2026-10-09', '2026-10-08'], t)).toEqual({ current: 2, longest: 2 }); // today not finished yet
    expect(computeStreaks(['2026-10-07'], t)).toEqual({ current: 0, longest: 1 });
    expect(computeStreaks([], t)).toEqual({ current: 0, longest: 0 });
  });

  it('preserves a streak across Sunday without counting Sunday as a completed day', () => {
    expect(dailyTarget('2026-10-10')).toBe(1); // Saturday
    expect(dailyTarget('2026-10-11')).toBe(0); // Sunday
    expect(computeStreaks(['2026-10-09', '2026-10-10'], '2026-10-11')).toEqual({ current: 2, longest: 2 });
    expect(computeStreaks(['2026-10-09', '2026-10-10'], '2026-10-12')).toEqual({ current: 2, longest: 2 });
  });

  it('keeps Friday, Saturday and Monday in one streak with Sunday as a holiday', () => {
    const completed = ['2026-10-09', '2026-10-10', '2026-10-12'];
    expect(computeStreaks(completed, '2026-10-12')).toEqual({ current: 3, longest: 3 });
    expect(computeStreaks(completed, '2026-10-11')).toEqual({ current: 2, longest: 3 });
  });

  it('breaks the current streak at a pause while retaining the earlier longest run', () => {
    const completed = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12'];
    expect(computeStreaks(completed, '2026-10-12', ['2026-10-09'])).toEqual({ current: 1, longest: 2 });
  });

  it('requires legacy and scoped assignments for a date to all be complete', async () => {
    const user = await makeUser('mixedHistory');
    const date = '2026-10-05';
    const questions = (await user.get('/api/questions')).body.data.items.slice(0,3);
    await query(`INSERT INTO daily_assignments (user_id,assignment_date,question_id,position,completed,completed_at)
      VALUES ($1,$2,$3,1,true,now())`, [user.id,date,questions[0].id]);
    await query(`INSERT INTO study_day_daily_assignments
      (user_id,scope_type,scope_id,assignment_date,study_day,position,question_id,completed,completed_at)
      VALUES ($1,'SOLO',$1,$2,1,1,$3,true,now()),($1,'SOLO',$1,$2,1,2,$4,false,NULL)`,
      [user.id,date,questions[1].id,questions[2].id]);

    expect((await completeDatesFor([user.id])).get(user.id)).not.toContain(date);
    await query(`UPDATE study_day_daily_assignments SET completed=true,completed_at=now()
      WHERE user_id=$1 AND scope_type='SOLO' AND scope_id=$1 AND assignment_date=$2`, [user.id,date]);
    expect((await completeDatesFor([user.id])).get(user.id)).toContain(date);
  });
});
