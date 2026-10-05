import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { resetDb, closePool, query, env, makeUser, makeGroup, solveToday, api } from './helpers.js';
import { processScheduled } from '../src/services/notificationService.js';
import { today, addDays } from '../src/utils/dates.js';

beforeAll(async () => { await resetDb(); env.REMINDER_HOUR = 0; env.SUMMARY_HOUR = 0; });
afterAll(closePool);

const notes = async (u, type) => (await u.get('/api/notifications?limit=100')).body.data.items.filter((n) => !type || n.type === type);

describe('revision system', () => {
  it('schedules revisions after solving, lists them when due and walks the schedule', async () => {
    const u = await makeUser('rev');
    const [q] = await solveToday(u, 1);
    expect((await u.get('/api/revisions/due')).body.data.items).toEqual([]);
    expect((await u.post(`/api/revisions/${q.id}/complete`)).status).toBe(200); // may revise early; stage 1 done
    // make stage 2 due today
    await query('UPDATE revisions SET due_date=$3 WHERE user_id=$1 AND question_id=$2 AND completed_at IS NULL', [u.id, q.id, today()]);
    const due = (await u.get('/api/revisions/due')).body.data;
    expect(due.items.map((i) => i.question_id)).toEqual([q.id]);
    expect(due.items[0].stage).toBe(2);
    const done = (await u.post(`/api/revisions/${q.id}/complete`)).body.data;
    expect(done.completed_stage).toBe(2);
    expect(done.next_revision_at).toBe(addDays(today(), env.REVISION_INTERVALS_DAYS[2]));
    const qq = (await u.get(`/api/questions/${q.id}`)).body.data.question;
    expect(qq.status).toBe('REVISED'); expect(qq.revision_count).toBe(2); expect(qq.last_revised_at).toBeTruthy();
    for (let i = 0; i < 2; i++) {
      const r = await u.post(`/api/revisions/${q.id}/complete`);
      if (i === 1) expect(r.body.data.schedule_finished).toBe(true);
    }
    expect((await u.post(`/api/revisions/${q.id}/complete`)).body.error.code).toBe('NO_REVISION_PENDING');
    expect((await u.get(`/api/questions/${q.id}`)).body.data.question.next_revision_at).toBeNull();
  });

  it('refuses to revise an unsolved question and treats NEEDS_REVISION as due now', async () => {
    const u = await makeUser('rev');
    const q = (await u.get('/api/questions')).body.data.items[30];
    expect((await u.post(`/api/revisions/${q.id}/complete`)).body.error.code).toBe('NOT_SOLVED_YET');
    await u.patch(`/api/progress/${q.id}`, { status: 'NEEDS_REVISION' });
    expect((await u.get('/api/revisions/due')).body.data.items.map((i) => i.question_id)).toContain(q.id);
    expect((await u.get('/api/questions?revisionDue=true')).body.data.total).toBe(1);
    expect((await u.get('/api/progress')).body.data.revision_due).toBe(1);
  });
});

describe('notifications, preferences, scheduler and nudges', () => {
  let a, s, v, g;
  beforeEach(async () => {
    await query('TRUNCATE users RESTART IDENTITY CASCADE');
    a = await makeUser('aditya'); s = await makeUser('sai'); v = await makeUser('vishal');
    g = await makeGroup(a, s, v);
    await solveToday(a, 2); // Aditya 2/2
    await solveToday(s, 1); // Sai 1/2, Vishal 0/2
  });

  it('notifies friends when a member completes the target (event hook) respecting preference', async () => {
    const fc = await notes(s, 'FRIEND_DAILY_COMPLETED');
    expect(fc.map((n) => n.message)).toEqual(["Aditya completed today's DSA target."]);
    expect(await notes(a, 'FRIEND_DAILY_COMPLETED')).toEqual([]);
  });

  it('detects who is pending and sends personal + friend notifications exactly once', async () => {
    const stats = await processScheduled();
    expect(stats.personal_reminders).toBe(2);
    expect((await notes(s, 'PERSONAL_DAILY_REMINDER'))[0].message).toBe('You still have 1 DSA question pending today.');
    expect((await notes(v, 'PERSONAL_DAILY_REMINDER'))[0].message).toBe('You still have 2 DSA questions pending today.');
    expect(await notes(a, 'PERSONAL_DAILY_REMINDER')).toEqual([]);
    const pend = (await notes(a, 'FRIEND_DAILY_PENDING')).map((n) => n.message).sort();
    expect(pend).toEqual(["Sai has 1 question remaining today.", "Vishal hasn't completed today's DSA target yet."]);
    const before = (await query('SELECT count(*)::int n FROM notifications')).rows[0].n;
    const second = await processScheduled();
    expect(second.personal_reminders + second.friend_pending + second.group_summaries + second.revision_due).toBe(0);
    expect((await query('SELECT count(*)::int n FROM notifications')).rows[0].n).toBe(before);
  });

  it('does not send notifications on Sunday', async () => {
    const stats = await processScheduled(new Date('2026-10-04T12:00:00.000Z'));
    expect(stats).toMatchObject({ date: '2026-10-04', personal_reminders: 0, friend_pending: 0, friend_completed: 0, revision_due: 0, group_summaries: 0 });
    expect((await query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);
  });

  it('honours notification preferences', async () => {
    await a.patch('/api/notification-preferences', { friend_pending: false });
    await v.patch('/api/notification-preferences', { personal_daily_reminder: false, daily_group_summary: false });
    await processScheduled();
    expect(await notes(a, 'FRIEND_DAILY_PENDING')).toEqual([]);
    expect(await notes(v, 'PERSONAL_DAILY_REMINDER')).toEqual([]);
    expect(await notes(v, 'DAILY_GROUP_SUMMARY')).toEqual([]);
    expect((await notes(s, 'FRIEND_DAILY_PENDING')).length).toBe(1); // Sai still hears that Vishal is pending
    expect((await notes(s, 'DAILY_GROUP_SUMMARY')).length).toBe(1);
    expect((await a.patch('/api/notification-preferences', { bogus: true })).status).toBe(400);
    expect((await a.get('/api/notification-preferences')).body.data.preferences.friend_pending).toBe(false);
  });

  it('writes a group summary with per-member status', async () => {
    await processScheduled();
    const msg = (await notes(a, 'DAILY_GROUP_SUMMARY'))[0].message;
    expect(msg).toContain('DSA SQUAD — TODAY');
    expect(msg).toContain('Aditya  2/2 ✅');
    expect(msg).toContain('Sai  1/2 ⚠️');
    expect(msg).toContain('Vishal  0/2 ❌');
    expect(msg).toContain('1 member completed');
  });

  it('sends due-revision notifications', async () => {
    const day = (await a.get('/api/daily')).body.data;
    await query('UPDATE revisions SET due_date=$2 WHERE user_id=$1', [a.id, today()]);
    await processScheduled();
    expect((await notes(a, 'REVISION_DUE'))[0].message).toBe('You have 2 revisions due today.');
    expect(day.assignments.length).toBe(2);
  });

  it('lets a friend nudge, with validation and rate limiting', async () => {
    const r = await a.post(`/api/users/${v.id}/nudge`, {});
    expect(r.status).toBe(201);
    expect((await notes(v, 'FRIEND_NUDGE'))[0].message).toBe("Aditya nudged you to finish today's DSA target.");
    const again = await a.post(`/api/users/${v.id}/nudge`, {});
    expect(again.status).toBe(429); expect(again.body.error.code).toBe('NUDGE_COOLDOWN');
    expect((await a.post(`/api/users/${a.id}/nudge`, {})).body.error.code).toBe('CANNOT_NUDGE_SELF');
    expect((await v.post(`/api/users/${a.id}/nudge`, {})).body.error.code).toBe('TARGET_ALREADY_COMPLETED');
    const stranger = await makeUser('stranger');
    expect((await stranger.post(`/api/users/${v.id}/nudge`, {})).body.error.code).toBe('NOT_IN_SAME_GROUP');
    await s.patch('/api/notification-preferences', { allow_nudges: false });
    expect((await v.post(`/api/users/${s.id}/nudge`, {})).body.error.code).toBe('NUDGES_DISABLED');
    expect((await a.post('/api/users/not-a-uuid/nudge', {})).status).toBe(400);
  });

  it('enforces the daily nudge cap per sender', async () => {
    env.NUDGE_DAILY_LIMIT = 1;
    try {
      expect((await a.post(`/api/users/${v.id}/nudge`, {})).status).toBe(201);
      const second = await a.post(`/api/users/${s.id}/nudge`, {});
      expect(second.body.error.code).toBe('NUDGE_DAILY_LIMIT');
    } finally { env.NUDGE_DAILY_LIMIT = 10; }
  });

  it('tracks read / unread and read-all', async () => {
    await processScheduled();
    let list = (await s.get('/api/notifications')).body.data;
    expect(list.unread_count).toBeGreaterThan(1);
    const first = list.items[0];
    expect((await s.patch(`/api/notifications/${first.id}/read`)).status).toBe(200);
    expect((await s.get('/api/notifications')).body.data.unread_count).toBe(list.unread_count - 1);
    expect((await a.patch(`/api/notifications/${first.id}/read`)).body.error.code).toBe('NOTIFICATION_NOT_FOUND'); // not someone else's
    expect((await s.get('/api/notifications?unread=true')).body.data.items.every((n) => !n.read_at)).toBe(true);
    await s.patch('/api/notifications/read-all');
    expect((await s.get('/api/notifications')).body.data.unread_count).toBe(0);
  });

  it('protects the cron endpoint with a secret', async () => {
    expect((await api().post('/api/jobs/notifications')).status).toBe(403);
    expect((await api().post('/api/jobs/notifications').set('x-cron-secret', 'wrong')).status).toBe(403);
    const ok = await api().post('/api/jobs/notifications').set('x-cron-secret', 'test-cron-secret');
    expect(ok.status).toBe(200);
    expect(ok.body.data.stats.personal_reminders).toBe(2);
  });
});

describe('platform', () => {
  it('reports health and uses the standard error envelope', async () => {
    const h = await api().get('/api/health');
    expect(h.body).toEqual({ success: true, status: 'healthy' });
    expect((await api().get('/api/nope')).status).toBe(401); // unauthenticated callers learn nothing about routes
    const u = await makeUser('probe');
    const nf = await u.get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Route GET /api/nope not found' } });
    const bad = await api().post('/api/auth/login').set('content-type', 'application/json').send('{oops');
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });
  it('only allows the configured frontend origin via CORS', async () => {
    const good = await api().get('/api/health').set('Origin', 'http://localhost:5173');
    expect(good.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await api().get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});
