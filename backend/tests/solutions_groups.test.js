import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, closePool, query, makeUser, makeGroup, api } from './helpers.js';

beforeAll(resetDb);
afterAll(closePool);

const body = { approach: 'Use a HashMap', code: 'function twoSum(){}', timeComplexity: 'O(n)', spaceComplexity: 'O(n)', mistakes: 'Forgot duplicates', learned: 'Complement lookup' };

describe('how I solved it + privacy', () => {
  it('requires a meaningful explicit submission before recording an unlock', async () => {
    const u = await makeUser('submit');
    const empty = await u.post('/api/questions/3/submissions', { approach: '', code: '', timeComplexity: '', spaceComplexity: '', mistakes: '', learned: '' });
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe('SUBMISSION_REQUIRED');
    const submitted = await u.post('/api/questions/3/submissions', { ...body, approach: 'My submitted approach' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.solution.submitted_at).toBeTruthy();
    expect((await u.get('/api/questions/3/approaches')).status).toBe(200);
  });

  it('saves, updates and returns a private solution', async () => {
    const u = await makeUser('sol');
    const empty = (await u.get('/api/questions/3/my-solution')).body.data.solution;
    expect(empty.exists).toBe(false);
    const saved = (await u.put('/api/questions/3/my-solution', body)).body.data.solution;
    expect(saved).toMatchObject({ exists: true, approach: 'Use a HashMap', time_complexity: 'O(n)', mistakes: 'Forgot duplicates', learned: 'Complement lookup' });
    await u.put('/api/questions/3/my-solution', { ...body, approach: 'Edited' });
    expect((await u.get('/api/questions/3/my-solution')).body.data.solution.approach).toBe('Edited');
    expect((await u.put('/api/questions/3/my-solution', { code: 'x'.repeat(40000) })).status).toBe(400);
    expect((await u.put('/api/questions/99999/my-solution', body)).body.error.code).toBe('QUESTION_NOT_FOUND');
  });

  it("never exposes another user's solution, even to group-mates, unless shared", async () => {
    const a = await makeUser('priv'); const b = await makeUser('snoop');
    const g = await makeGroup(a, b);
    await a.put('/api/questions/3/my-solution', body);
    expect((await b.get('/api/questions/3/my-solution')).body.data.solution.exists).toBe(false);
    expect((await b.get(`/api/groups/${g.id}/questions/3/shared`)).body.data.shared).toEqual([]);
  });

  it('shares only chosen parts with a group, and stops sharing', async () => {
    const a = await makeUser('sharer'); const b = await makeUser('reader'); const outsider = await makeUser('out');
    const g = await makeGroup(a, b);
    expect((await a.put('/api/questions/5/share', { groupId: g.id })).body.error.code).toBe('SOLUTION_REQUIRED');
    await a.put('/api/questions/5/my-solution', body);
    expect((await a.put('/api/questions/5/share', { groupId: g.id, approach: true, code: false, explanation: true, notes: false })).status).toBe(200);
    const seen = (await b.get(`/api/groups/${g.id}/questions/5/shared`)).body.data.shared[0];
    expect(seen.approach).toBe('Use a HashMap');
    expect(seen.code).toBeNull(); expect(seen.mistakes).toBeNull();
    expect(seen.learned).toBe('Complement lookup');
    expect((await outsider.get(`/api/groups/${g.id}/questions/5/shared`)).status).toBe(403);
    expect((await outsider.put('/api/questions/5/share', { groupId: g.id })).status).toBe(403);
    await a.del(`/api/questions/5/share/${g.id}`);
    expect((await b.get(`/api/groups/${g.id}/questions/5/shared`)).body.data.shared).toEqual([]);
  });
});

describe('groups and authorization', () => {
  it('creates, lists, joins by invite code and shows members', async () => {
    const owner = await makeUser('owner'); const friend = await makeUser('friend');
    const g = await makeGroup(owner, friend);
    expect(g.invite.code).toBeTruthy();
    const view = (await friend.get(`/api/groups/${g.id}`)).body.data.group;
    expect(view.members.map((m) => m.role).sort()).toEqual(['member', 'owner']);
    expect(view.invite).toBeNull(); // only owners see the invite code
    expect((await owner.get(`/api/groups/${g.id}`)).body.data.group.invite.code).toBe(g.invite.code);
    expect((await friend.get('/api/groups')).body.data.groups[0]).toMatchObject({ name: 'DSA Squad', member_count: 2, my_role: 'member' });
    expect((await friend.post('/api/groups/join', { code: g.invite.code })).body.error.code).toBe('ALREADY_A_MEMBER');
    expect((await friend.post('/api/groups/join', { code: 'NOPE1234' })).body.error.code).toBe('INVITE_INVALID');
  });

  it('blocks non-members and enforces owner-only removal', async () => {
    const owner = await makeUser('boss'); const m1 = await makeUser('mem'); const m2 = await makeUser('mem'); const out = await makeUser('stranger');
    const g = await makeGroup(owner, m1, m2);
    expect((await out.get(`/api/groups/${g.id}`)).body.error.code).toBe('NOT_A_GROUP_MEMBER');
    expect((await out.get(`/api/groups/${g.id}/progress`)).status).toBe(403);
    expect((await out.post(`/api/groups/${g.id}/invites`, {})).status).toBe(403);
    expect((await m1.del(`/api/groups/${g.id}/members/${m2.id}`)).body.error.code).toBe('NOT_GROUP_OWNER');
    expect((await owner.del(`/api/groups/${g.id}/members/${m2.id}`)).status).toBe(200);
    expect((await m2.get(`/api/groups/${g.id}`)).status).toBe(403);
    expect((await m1.del(`/api/groups/${g.id}/members/${m1.id}`)).status).toBe(200); // leave
    const added = await owner.post(`/api/groups/${g.id}/members`, { identifier: m2.username });
    expect(added.status).toBe(201);
    expect((await m2.post(`/api/groups/${g.id}/members`, { identifier: out.username })).status).toBe(403);
    expect((await owner.post(`/api/groups/${g.id}/members`, { identifier: 'nobody-here' })).body.error.code).toBe('USER_NOT_FOUND');
  });

  it('hands ownership to another member when the owner leaves', async () => {
    const owner = await makeUser('leaver'); const m = await makeUser('heir');
    const g = await makeGroup(owner, m);
    await owner.del(`/api/groups/${g.id}/members/${owner.id}`);
    const view = (await m.get(`/api/groups/${g.id}`)).body.data.group;
    expect(view.my_role).toBe('owner');
  });

  it('shows group progress without leaking solutions', async () => {
    const a = await makeUser('gp'); const b = await makeUser('gp');
    const g = await makeGroup(a, b);
    await a.put('/api/questions/1/my-solution', body);
    const day = (await a.get('/api/daily')).body.data;
    await a.patch(`/api/progress/${day.assignments[0].id}`, { status: 'SOLVED' });
    const p = (await b.get(`/api/groups/${g.id}/progress`)).body.data;
    const ma = p.members.find((m) => m.id === a.id); const mb = p.members.find((m) => m.id === b.id);
    expect(ma).toMatchObject({ today_completed: 1, status: 'PARTIAL', total_solved: 1, can_be_nudged: true });
    expect(mb).toMatchObject({ today_completed: 0, status: 'NONE', can_be_nudged: false });
    expect(JSON.stringify(p)).not.toContain('HashMap');
  });
});
