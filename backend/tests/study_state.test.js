import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, closePool, query, makeUser, makeGroup, api } from './helpers.js';
import { getDailyStudyData, chooseSoloStartingDay, setStudyPaused, maxSupportedStartingDay } from '../src/services/studyStateService.js';
import { computeStreaks } from '../src/services/progressService.js';
import { lowestDerivedDay, proposedActiveGroupId } from '../src/services/studyStateMigration.js';
import { today, addDays, dailyTarget, weekday } from '../src/utils/dates.js';

beforeAll(resetDb);
afterAll(closePool);

let counter = 0;
async function uninitializedUser(name = 'state') {
  counter++;
  const username = `${name}${counter}`;
  const res = await api().post('/api/auth/register').send({
    email: `${username}@example.com`, username, displayName: name, password: 'password1',
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const token = res.body.data.token;
  return {
    id: res.body.data.user.id, token,
    get: (url) => api().get(url).set('Authorization', `Bearer ${token}`),
    post: (url, body = {}) => api().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url, body = {}) => api().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url, body = {}) => api().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    del: (url, body = {}) => api().delete(url).set('Authorization', `Bearer ${token}`).send(body),
  };
}

describe('solo and squad study state', () => {
  it('enables row-level security on all newly-created study-state tables', async () => {
    const { rows } = await query(`SELECT c.relname,c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [[
      'solo_study_states','group_study_day_questions','solo_study_day_questions',
      'study_day_daily_assignments','study_pause_days',
    ]]);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('leaves new solo state uninitialized and accepts an explicit starting day', async () => {
    const u = await uninitializedUser();
    const before = await u.get('/api/study-state');
    expect(before.body.data).toMatchObject({
      mode: 'SOLO', active_group: null, needs_choose_solo_start: true,
      needs_choose_active_squad: false, active_group_invalid: false,
    });
    expect(before.body.data.study).toMatchObject({ initialized: false, study_day: null, paused: false });
    const overview = await u.get('/api/progress');
    expect(overview.body.data.today).toMatchObject({ target: 0, assigned: 0, completed: 0, needs_choose_solo_start: true });
    const preStartDaily = await u.get('/api/daily');
    expect(preStartDaily.body.data).toMatchObject({ mode: 'SOLO', initialized: false, study_day: null,
      day_number: null, target: 0, needs_choose_solo_start: true, assignments: [] });
    expect((await query('SELECT study_initialized,current_study_day FROM solo_study_states WHERE user_id=$1', [u.id])).rows[0])
      .toMatchObject({ study_initialized: false, current_study_day: null });
    expect((await query('SELECT count(*)::int AS n FROM study_day_daily_assignments WHERE user_id=$1', [u.id])).rows[0].n).toBe(0);
    expect((await query('SELECT count(*)::int AS n FROM solo_study_day_questions WHERE user_id=$1', [u.id])).rows[0].n).toBe(0);

    expect((await u.put('/api/study-state/solo-start', { starting_day: 5 })).status).toBe(200);
    expect((await u.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO', needs_choose_solo_start: false,
      study: { initialized: true, study_day: 5 } });
    const day = (await u.get('/api/daily')).body.data;
    expect(day).toMatchObject({ mode: 'SOLO', study_day: 5, day_number: 5, initialized: true, needs_choose_solo_start: false });
    expect(day.assignments).toHaveLength(dailyTarget(today()));
    const again = (await u.get('/api/daily')).body.data;
    expect(again.assignments.map((q) => q.id)).toEqual(day.assignments.map((q) => q.id));
    expect((await u.put('/api/study-state/solo-start', { starting_day: 6 })).body.error.code).toBe('STUDY_STATE_ALREADY_INITIALIZED');
  });

  it('keeps existing initialized Solo and active Squad users on their server days without setup', async () => {
    const solo = await makeUser('existingSoloDay');
    expect((await solo.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO',
      needs_choose_solo_start: false, study: { initialized: true, study_day: 1 } });
    expect((await solo.get('/api/daily')).body.data).toMatchObject({ mode: 'SOLO', initialized: true, study_day: 1, target: 2 });

    const owner = await makeUser('existingSquadDay');
    const group = await makeGroup(owner);
    await query('UPDATE groups SET current_study_day=5,last_advanced_on=$2 WHERE id=$1', [group.id,today()]);
    expect((await owner.get('/api/study-state')).body.data).toMatchObject({ mode: 'SQUAD',
      needs_choose_solo_start: false, active_group: { id: group.id, study_day: 5 } });
    expect((await owner.get('/api/daily')).body.data).toMatchObject({ mode: 'SQUAD', study_day: 5,
      target: dailyTarget(today()), assignments: expect.any(Array) });
  });

  it('rejects invalid solo starting days and accepts Day 1 or another positive day', async () => {
    const dayOne = await uninitializedUser('dayOne');
    for (const starting_day of [0,-1,null,'2']) {
      expect((await dayOne.put('/api/study-state/solo-start', { starting_day })).status).toBe(400);
    }
    expect((await dayOne.get('/api/study-state')).body.data.needs_choose_solo_start).toBe(true);
    expect((await dayOne.put('/api/study-state/solo-start', { starting_day: 1 })).body.data.study_day).toBe(1);

    const laterDay = await uninitializedUser('laterDay');
    expect((await laterDay.put('/api/study-state/solo-start', { starting_day: 27 })).body.data.study_day).toBe(27);
  });

  it('derives the maximum solo starting day from remaining roadmap capacity', async () => {
    expect(maxSupportedStartingDay(269, '2026-10-06')).toBe(147);
    const user = await uninitializedUser('maximumDay');
    const tooLate = await user.put('/api/study-state/solo-start', { starting_day: 148 });
    expect(tooLate.status).toBe(400);
    expect(tooLate.body.error).toMatchObject({ code: 'INVALID_STARTING_DAY' });
    expect(tooLate.body.error.message).toContain('1 and 147');
    expect((await user.get('/api/study-state')).body.data.needs_choose_solo_start).toBe(true);

    const maximum = await user.put('/api/study-state/solo-start', { starting_day: 147 });
    expect(maximum.status).toBe(200);
    expect((await user.get('/api/daily')).body.data).toMatchObject({ study_day: 147, initialized: true });
    expect((await user.get('/api/daily')).body.data.assignments.length).toBeGreaterThan(0);
  });

  it('keeps different users’ solo days and question maps independent', async () => {
    const a = await uninitializedUser('soloA'); const b = await uninitializedUser('soloB'); const c = await uninitializedUser('soloC');
    await a.put('/api/study-state/solo-start', { starting_day: 3 });
    await b.put('/api/study-state/solo-start', { starting_day: 5 });
    await c.put('/api/study-state/solo-start', { starting_day: 3 });
    const [ad, bd, cd] = await Promise.all([a.get('/api/daily'), b.get('/api/daily'), c.get('/api/daily')]);
    expect(ad.body.data.study_day).toBe(3);
    expect(bd.body.data.study_day).toBe(5);
    expect(cd.body.data.study_day).toBe(3);
    expect(ad.body.data.assignments.map((q) => q.id)).not.toEqual(bd.body.data.assignments.map((q) => q.id));
    expect(ad.body.data.assignments.map((q) => q.id)).toEqual(cd.body.data.assignments.map((q) => q.id));
    await a.post('/api/study-state/pause');
    expect((await c.get('/api/study-state')).body.data.study.paused).toBe(false);
  });

  it('fills a partial weekday scope mapping without changing existing positions', async () => {
    const user = await makeUser('partialMap');
    await query('DELETE FROM solo_study_day_questions WHERE user_id=$1 AND study_day=1 AND position=2', [user.id]);
    const first = (await user.get('/api/daily')).body.data;
    expect(first.assignments).toHaveLength(dailyTarget(today()));
    expect(first.assignments.map((q) => q.position)).toEqual([1,2]);
    const mapping = await query(
      'SELECT position,question_id FROM solo_study_day_questions WHERE user_id=$1 AND study_day=1 ORDER BY position', [user.id]);
    expect(mapping.rows).toHaveLength(2);
    const again = (await user.get('/api/daily')).body.data;
    expect(again.assignments.map((q) => q.id)).toEqual(first.assignments.map((q) => q.id));
  });

  it('uses one stable squad mapping for all members with independent completion', async () => {
    const a = await makeUser('sharedA'); const b = await makeUser('sharedB');
    const g = await makeGroup(a, b);
    await query('UPDATE groups SET current_study_day=3,last_advanced_on=$2 WHERE id=$1', [g.id,today()]);
    const [ad, bd] = await Promise.all([a.get('/api/daily'), b.get('/api/daily')]);
    const aIds = ad.body.data.assignments.map((q) => q.id);
    expect(ad.body.data).toMatchObject({ mode: 'SQUAD', study_day: 3, target: 2 });
    expect(bd.body.data.study_day).toBe(3);
    expect(bd.body.data.assignments.map((q) => q.id)).toEqual(aIds);
    const duplicatePositions = await query(`SELECT count(*)::INTEGER AS n FROM (
      SELECT group_id,study_day,position FROM group_study_day_questions WHERE group_id=$1 AND study_day=3
      GROUP BY group_id,study_day,position HAVING count(*)>1) duplicates`, [g.id]);
    expect(duplicatePositions.rows[0].n).toBe(0);
    const firstQuestion = ad.body.data.assignments[0];

    // A legacy assignment for the same question remains untouched and does not
    // conflict with the scope-level squad assignment.
    await query(`INSERT INTO daily_assignments (user_id,assignment_date,question_id,position)
      VALUES ($1,$2,$3,1)`, [a.id,addDays(today(),-1),firstQuestion.id]);
    expect((await a.patch(`/api/progress/${firstQuestion.id}`, { status: 'SOLVED' })).status).toBe(200);
    expect((await a.get('/api/daily')).body.data.assignments[0].completed).toBe(true);
    expect((await b.get('/api/daily')).body.data.assignments[0].completed).toBe(false);
    expect((await query('SELECT count(*)::int AS n FROM daily_assignments WHERE user_id=$1 AND question_id=$2', [a.id,firstQuestion.id])).rows[0].n).toBe(1);
    const [againA, againB] = await Promise.all([a.get('/api/daily'), b.get('/api/daily')]);
    expect(againA.body.data.assignments.map((q) => q.id)).toEqual(aIds);
    expect(againB.body.data.assignments.map((q) => q.id)).toEqual(aIds);
  });

  it('counts individual squad completion from progress even before that member loads daily assignments', async () => {
    const owner = await makeUser('progressOwner'); const member = await makeUser('progressMember');
    const group = await makeGroup(owner,member);
    const daily = (await owner.get('/api/daily')).body.data;
    await query(`DELETE FROM study_day_daily_assignments WHERE user_id=$1 AND scope_type='SQUAD'
      AND scope_id=$2 AND assignment_date=$3`, [member.id,group.id,today()]);
    expect((await member.patch(`/api/progress/${daily.assignments[0].id}`, { status: 'SOLVED' })).status).toBe(200);
    const progress = (await owner.get(`/api/groups/${group.id}/progress`)).body.data;
    expect(progress.members.find((m) => m.id === member.id)).toMatchObject({ today_target: 2, today_completed: 1 });
    expect((await member.get('/api/daily')).body.data.assignments[0].completed).toBe(true);
    expect((await owner.get('/api/daily')).body.data.assignments[0].completed).toBe(false);
  });

  it('gives a new member the current squad day and preserves their solo state', async () => {
    const owner = await makeUser('dayFiveOwner');
    const g = await makeGroup(owner);
    await query('UPDATE groups SET current_study_day=5,last_advanced_on=$2 WHERE id=$1', [g.id,today()]);
    const ownerDay = (await owner.get('/api/daily')).body.data;
    expect(ownerDay.study_day).toBe(5);

    const joiner = await uninitializedUser('dayFiveJoiner');
    await joiner.put('/api/study-state/solo-start', { starting_day: 3 });
    const soloBefore = (await joiner.get('/api/daily')).body.data;
    expect(soloBefore.study_day).toBe(3);
    expect((await joiner.post('/api/groups/join', { code: g.invite.code })).status).toBe(200);
    const squadDay = (await joiner.get('/api/daily')).body.data;
    expect(squadDay.study_day).toBe(5);
    expect(squadDay.assignments.map((q) => q.id)).toEqual(ownerDay.assignments.map((q) => q.id));
    expect((await query('SELECT current_study_day FROM solo_study_states WHERE user_id=$1', [joiner.id])).rows[0].current_study_day).toBe(3);
    await joiner.put('/api/study-state/active-squad', { group_id: null });
    const soloAfter = (await joiner.get('/api/daily')).body.data;
    expect(soloAfter).toMatchObject({ mode: 'SOLO', study_day: 3 });
    expect(soloAfter.assignments.map((q) => q.id)).toEqual(soloBefore.assignments.map((q) => q.id));
  });

  it('starts a newly created squad at Day 1 without copying the creator solo day', async () => {
    const creator = await uninitializedUser('newSquadCreator');
    await creator.put('/api/study-state/solo-start', { starting_day: 8 });

    const created = await creator.post('/api/groups', { name: 'Fresh squad' });
    expect(created.status).toBe(201);
    const squad = await query('SELECT current_study_day,study_initialized FROM groups WHERE id=$1', [created.body.data.group.id]);
    expect(squad.rows[0]).toMatchObject({ current_study_day: 1, study_initialized: true });
    expect((await query('SELECT current_study_day FROM solo_study_states WHERE user_id=$1', [creator.id])).rows[0].current_study_day).toBe(8);
  });

  it('stores active squad server-side and preserves Solo state and other memberships when switching/leaving', async () => {
    const user = await makeUser('switch'); const ownerA = await makeUser('ownerA'); const ownerB = await makeUser('ownerB');
    const squadA = await makeGroup(user);
    const squadB = await makeGroup(ownerB);
    expect((await ownerB.post(`/api/groups/${squadB.id}/members`, { identifier: user.username })).status).toBe(201);
    expect((await user.get('/api/study-state')).body.data.active_group.id).toBe(squadA.id);

    await query('UPDATE groups SET current_study_day=5,last_advanced_on=$2 WHERE id=$1', [squadB.id,addDays(today(),-2)]);
    const soloBeforeSwitch = (await query(
      'SELECT current_study_day,study_initialized,study_paused,last_advanced_on FROM solo_study_states WHERE user_id=$1', [user.id])).rows[0];
    const mapCountBeforeSwitch = (await query('SELECT count(*)::INTEGER AS n FROM group_study_day_questions WHERE group_id=$1', [squadB.id])).rows[0].n;

    const selectedB = await user.put('/api/study-state/active-squad', { group_id: squadB.id });
    expect(selectedB.status).toBe(200);
    expect(selectedB.body.data).toMatchObject({
      mode: 'SQUAD', active_group: { id: squadB.id, study_day: 5 }, needs_choose_active_squad: false,
    });
    expect((await query('SELECT active_group_id FROM users WHERE id=$1', [user.id])).rows[0].active_group_id).toBe(squadB.id);
    expect((await query(
      'SELECT current_study_day,study_initialized,study_paused,last_advanced_on FROM solo_study_states WHERE user_id=$1', [user.id])).rows[0]).toEqual(soloBeforeSwitch);
    expect((await query('SELECT current_study_day,last_advanced_on FROM groups WHERE id=$1', [squadB.id])).rows[0])
      .toEqual({ current_study_day: 5, last_advanced_on: addDays(today(),-2) });
    expect((await query('SELECT count(*)::INTEGER AS n FROM group_study_day_questions WHERE group_id=$1', [squadB.id])).rows[0].n)
      .toBe(mapCountBeforeSwitch);

    await user.put('/api/study-state/active-squad', { group_id: null });
    expect((await user.get('/api/study-state')).body.data).toMatchObject({
      mode: 'SOLO', needs_choose_solo_start: false, needs_choose_active_squad: true,
    });
    // Joining another squad is not an active-squad choice when the user already
    // has multiple memberships and had explicitly returned to Solo Mode.
    const ownerC = await makeUser('ownerC'); const squadC = await makeGroup(ownerC);
    expect((await user.post('/api/groups/join', { code: squadC.invite.code })).status).toBe(200);
    expect((await user.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO', active_group: null });

    await user.put('/api/study-state/active-squad', { group_id: squadA.id });
    expect((await user.get('/api/study-state')).body.data.active_group.id).toBe(squadA.id);
    expect((await user.put('/api/study-state/active-squad', { group_id: null })).body.data.mode).toBe('SOLO');
    expect((await user.get('/api/daily')).body.data.study_day).toBe(1);
    expect((await user.put('/api/study-state/active-squad', { group_id: squadB.id })).status).toBe(200);
    expect((await user.del(`/api/groups/${squadB.id}/members/${user.id}`)).status).toBe(200);
    expect((await user.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO', active_group: null });
    expect((await user.get('/api/groups')).body.data.groups.map((x) => x.id).sort()).toEqual([squadA.id,squadC.id].sort());
    expect((await query('SELECT current_study_day FROM solo_study_states WHERE user_id=$1', [user.id])).rows[0].current_study_day).toBe(1);
    expect((await user.put('/api/study-state/active-squad', { group_id: squadB.id })).status).toBe(403);
  });

  it('clears active squad on leave while preserving solo state and squad progress history', async () => {
    const owner = await makeUser('leaveOwner'); const member = await makeUser('leaveMember');
    const squad = await makeGroup(owner, member);
    const day = (await member.get('/api/daily')).body.data;
    const solvedQuestion = day.assignments[0];
    expect((await member.patch(`/api/progress/${solvedQuestion.id}`, { status: 'SOLVED' })).status).toBe(200);

    const soloBefore = (await query(
      'SELECT current_study_day,study_initialized,study_paused FROM solo_study_states WHERE user_id=$1', [member.id])).rows[0];
    const mapBefore = (await query(
      'SELECT position,question_id FROM group_study_day_questions WHERE group_id=$1 AND study_day=1 ORDER BY position', [squad.id])).rows;
    const scopedAssignmentsBefore = (await query(
      `SELECT assignment_date,position,question_id FROM study_day_daily_assignments
       WHERE user_id=$1 AND scope_type='SQUAD' AND scope_id=$2 ORDER BY assignment_date,position`, [member.id,squad.id])).rows;

    expect((await member.del(`/api/groups/${squad.id}/members/${member.id}`)).status).toBe(200);
    expect((await query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [squad.id,member.id])).rowCount).toBe(0);
    expect((await query('SELECT active_group_id FROM users WHERE id=$1', [member.id])).rows[0].active_group_id).toBeNull();
    expect((await member.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO', active_group: null });
    expect((await query(
      'SELECT current_study_day,study_initialized,study_paused FROM solo_study_states WHERE user_id=$1', [member.id])).rows[0]).toEqual(soloBefore);
    expect((await query('SELECT position,question_id FROM group_study_day_questions WHERE group_id=$1 AND study_day=1 ORDER BY position', [squad.id])).rows).toEqual(mapBefore);
    expect((await query(
      `SELECT assignment_date,position,question_id FROM study_day_daily_assignments
       WHERE user_id=$1 AND scope_type='SQUAD' AND scope_id=$2 ORDER BY assignment_date,position`, [member.id,squad.id])).rows).toEqual(scopedAssignmentsBefore);
    expect((await query('SELECT status FROM user_question_progress WHERE user_id=$1 AND question_id=$2', [member.id,solvedQuestion.id])).rows[0].status).toBe('SOLVED');
    expect((await query('SELECT id FROM groups WHERE id=$1', [squad.id])).rowCount).toBe(1);
  });

  it('rejects an invalid active-group pointer at the database boundary', async () => {
    const user = await makeUser('invalidPointer');
    await expect(query('UPDATE users SET active_group_id=$2 WHERE id=$1', [user.id,'00000000-0000-4000-8000-000000000001']))
      .rejects.toMatchObject({ code: '23503' });
    expect((await user.get('/api/study-state')).body.data).toMatchObject({ mode: 'SOLO', active_group_invalid: false });
  });

  it('pauses a squad only for its admin, holds the day, resumes without skipping, and breaks streaks', async () => {
    const owner = await makeUser('pauseOwner'); const member = await makeUser('pauseMember');
    const g = await makeGroup(owner,member);
    expect((await member.get(`/api/groups/${g.id}/progress`)).status).toBe(200);
    const oldAdvanceDate = addDays(today(),-3);
    await query('UPDATE groups SET last_advanced_on=$2 WHERE id=$1', [g.id,oldAdvanceDate]);
    const once = (await member.get(`/api/groups/${g.id}/progress`)).body.data.group.current_study_day;
    const twice = (await member.get(`/api/groups/${g.id}/progress`)).body.data.group.current_study_day;
    expect(once).toBeGreaterThan(1);
    expect(twice).toBe(once);

    expect((await member.post('/api/study-state/pause')).status).toBe(403);
    expect((await member.post('/api/study-state/resume')).status).toBe(403);
    await expect(setStudyPaused(member.id,true,addDays(today(),1))).rejects.toMatchObject({ status: 403 });
    const heldDay = once;
    expect((await owner.post('/api/study-state/pause')).body.data).toMatchObject({ study_day: heldDay, paused: true });
    expect((await member.get(`/api/groups/${g.id}/progress`)).status).toBe(200);
    expect((await query('SELECT current_study_day FROM groups WHERE id=$1',[g.id])).rows[0].current_study_day).toBe(heldDay);
    const pausedDate = addDays(today(),1);
    expect((await member.get('/api/progress')).status).toBe(200);
    expect((await getDailyStudyData(member.id,pausedDate)).study_day).toBe(heldDay);
    expect((await query(`SELECT DISTINCT study_day FROM study_day_daily_assignments
      WHERE user_id=$1 AND scope_type='SQUAD' AND scope_id=$2 AND assignment_date=$3`, [member.id,g.id,pausedDate])).rows)
      .toEqual([{ study_day: heldDay }]);
    expect((await owner.post('/api/study-state/resume')).body.data).toMatchObject({ study_day: heldDay, paused: false });
    expect((await query('SELECT current_study_day FROM groups WHERE id=$1',[g.id])).rows[0].current_study_day).toBe(heldDay);
    const resumedDay = await getDailyStudyData(member.id,addDays(today(),3));
    expect(resumedDay.study_day).toBeGreaterThan(heldDay);
    expect(resumedDay.paused).toBe(false);
    expect((await query('SELECT count(*)::int AS n FROM study_pause_days WHERE group_id=$1', [g.id])).rows[0].n).toBeGreaterThan(0);
    expect(computeStreaks(['2026-10-05'],'2026-10-07',['2026-10-06'])).toEqual({ current: 0, longest: 1 });
  });

  it('pauses solo progression and resumes on the same day', async () => {
    const u = await makeUser('soloPause');
    expect((await u.post('/api/study-state/pause')).body.data).toMatchObject({ mode: 'SOLO', study_day: 1, paused: true });
    expect((await getDailyStudyData(u.id,addDays(today(),1))).study_day).toBe(1);
    expect((await setStudyPaused(u.id,false,addDays(today(),2))).study_day).toBe(1);
    expect((await getDailyStudyData(u.id,addDays(today(),3))).study_day).toBe(2);
  });

  it('records every day in a Friday-to-Monday pause and resumes from the held day', async () => {
    const user = await makeUser('pausePeriod');
    const daysUntilFriday = (5 - weekday(today()) + 7) % 7 || 7;
    const friday = addDays(today(),daysUntilFriday);
    const monday = addDays(friday,3);
    const tuesday = addDays(monday,1);

    await setStudyPaused(user.id,true,friday);
    const heldDay = (await query('SELECT current_study_day FROM solo_study_states WHERE user_id=$1',[user.id])).rows[0].current_study_day;
    await query("UPDATE solo_study_states SET pause_started_at=$2::date + time '12:00' WHERE user_id=$1", [user.id,friday]);
    await query('DELETE FROM study_pause_days WHERE user_id=$1', [user.id]);
    await setStudyPaused(user.id,false,monday);

    const pauseDates = (await query('SELECT pause_date FROM study_pause_days WHERE user_id=$1 ORDER BY pause_date',[user.id])).rows
      .map((row) => row.pause_date);
    expect(pauseDates).toEqual([friday,addDays(friday,1),addDays(friday,2),monday]);
    expect((await query('SELECT current_study_day FROM solo_study_states WHERE user_id=$1',[user.id])).rows[0].current_study_day).toBe(heldDay);
    expect((await getDailyStudyData(user.id,monday)).study_day).toBe(heldDay);
    expect((await getDailyStudyData(user.id,tuesday)).study_day).toBe(heldDay+1);
    expect(computeStreaks([addDays(friday,-2),addDays(friday,-1),friday,monday],monday,pauseDates))
      .toEqual({ current: 0, longest: 2 });
  });

  it('applies weekday/Saturday/Sunday schedule without advancing on Sunday', async () => {
    const u = await uninitializedUser('schedule');
    await chooseSoloStartingDay(u.id,1,'2026-10-10');
    await query(`INSERT INTO solo_study_day_questions (user_id,study_day,position,question_id)
      SELECT $1,1,2,q.id FROM questions q
      WHERE q.id<>(SELECT question_id FROM solo_study_day_questions WHERE user_id=$1 AND study_day=1 AND position=1)
      ORDER BY q.roadmap_order,q.question_order LIMIT 1`, [u.id]);
    expect(dailyTarget('2026-10-10')).toBe(1);
    expect((await getDailyStudyData(u.id,'2026-10-10'))).toMatchObject({ study_day: 1, target: 1 });
    expect(dailyTarget('2026-10-11')).toBe(0);
    expect((await getDailyStudyData(u.id,'2026-10-11')).assignments).toEqual([]);
    expect((await getDailyStudyData(u.id,'2026-10-11')).study_day).toBe(1);
    expect(dailyTarget('2026-10-12')).toBe(2);
    expect((await getDailyStudyData(u.id,'2026-10-12'))).toMatchObject({ study_day: 2, target: 2 });
  });

  it('uses the lowest derived member day and leaves multi-membership users without an active squad', () => {
    expect(lowestDerivedDay([5,5,3])).toBe(3);
    expect(lowestDerivedDay([3,0])).toBe(3);
    expect(lowestDerivedDay([0,0])).toBeNull();
    expect(proposedActiveGroupId(['one'])).toBe('one');
    expect(proposedActiveGroupId(['one','two'])).toBeNull();
  });
});
