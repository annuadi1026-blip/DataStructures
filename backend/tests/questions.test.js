import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, closePool, makeUser } from './helpers.js';

let u;
beforeAll(async () => { await resetDb(); u = await makeUser('qa'); });
afterAll(closePool);

describe('question bank (seeded from the PDF)', () => {
  it('contains exactly 269 questions in 17 topics with source badges', async () => {
    const res = await u.get('/api/questions');
    expect(res.body.data.total).toBe(269);
    expect(res.body.data.items.filter((q) => q.badges.includes('N')).length).toBe(150);
    expect(res.body.data.items.filter((q) => q.badges.includes('S')).length).toBe(178);
    expect(res.body.data.items.filter((q) => q.source === 'BOTH').length).toBe(59);
    const topics = (await u.get('/api/topics')).body.data.topics;
    expect(topics.length).toBe(17);
    expect(topics[0].topic).toBe('Arrays & Hashing');
  });

  it('preserves roadmap order and only real URLs', async () => {
    const items = (await u.get('/api/questions')).body.data.items;
    expect(items.slice(0, 4).map((q) => q.title)).toEqual(['Contains Duplicate', 'Valid Anagram', 'Two Sum', 'Group Anagrams']);
    const two = items.find((q) => q.title === 'Two Sum');
    expect(two.leetcode_url).toBe('https://leetcode.com/problems/two-sum/');
    expect(two.neetcode_url).toContain('neetcode.io');
    expect(two.striver_url).toContain('takeuforward.org');
    const inv = items.find((q) => q.title === 'Count Inversions');
    expect(inv.leetcode_url).toBeNull(); // the PDF has no LeetCode link for it
    expect(items.every((q) => q.difficulty === null)).toBe(true); // not in the PDF, so not invented
  });

  it('filters by topic, source, search text and status', async () => {
    expect((await u.get('/api/questions?topic=Tries')).body.data.total).toBe(8);
    expect((await u.get('/api/questions?source=STRIVER')).body.data.total).toBe(178);
    expect((await u.get('/api/questions?source=BOTH')).body.data.total).toBe(59);
    const s = (await u.get('/api/questions?q=two%20sum')).body.data.items.map((q) => q.title);
    expect(s).toContain('Two Sum');
    expect(s).toContain('Two Sum II Input Array Is Sorted');
    expect((await u.get('/api/questions?status=SOLVED')).body.data.total).toBe(0);
    expect((await u.get('/api/questions?status=NOT_STARTED')).body.data.total).toBe(269);
    expect((await u.get('/api/questions?source=BAD')).status).toBe(400);
  });

  it('serves one question but never exposes official approaches before an explicit submission', async () => {
    const items = (await u.get('/api/questions')).body.data.items;
    const two = items.find((q) => q.title === 'Two Sum');
    const q = await u.get(`/api/questions/${two.id}`);
    expect(q.body.data.question.topic).toBe('Arrays & Hashing');
    expect(q.body.data.question.official_solution_unlocked).toBe(false);
    const locked = await u.get(`/api/questions/${two.id}/approaches`);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('SOLUTION_LOCKED');
    expect(JSON.stringify(q.body)).not.toContain('Hash map (one pass)');
    await u.put(`/api/questions/${two.id}/my-solution`, { approach: 'I will use a map', code: '', timeComplexity: 'O(n)', spaceComplexity: 'O(n)', mistakes: '', learned: '' });
    expect((await u.get(`/api/questions/${two.id}/approaches`)).status).toBe(403); // drafts do not unlock
    const submission = await u.post(`/api/questions/${two.id}/submissions`, { approach: 'I will use a map', code: '', timeComplexity: 'O(n)', spaceComplexity: 'O(n)', mistakes: '', learned: '' });
    expect(submission.body.data.solution.submitted_at).toBeTruthy();
    expect((await u.get(`/api/questions/${two.id}`)).body.data.question.official_solution_unlocked).toBe(true);
    const ap = (await u.get(`/api/questions/${two.id}/approaches`)).body.data.approaches;
    expect(ap.map((a) => a.title)).toEqual(['Brute force', 'Sorting + two pointers', 'Hash map (one pass)']);
    expect(ap[2].time_complexity).toBe('O(n)');
    expect(ap[0].origin).toMatch(/not from the PDF/);
    expect((await u.get('/api/questions/999999')).body.error.code).toBe('QUESTION_NOT_FOUND');
    expect((await u.get('/api/questions/abc')).status).toBe(400);
  });

  it('does not let one user unlock official approaches for another user', async () => {
    const items = (await u.get('/api/questions')).body.data.items;
    const two = items.find((q) => q.title === 'Two Sum');
    const other = await makeUser('locked');
    await u.post(`/api/questions/${two.id}/submissions`, { approach: 'Hash map', code: '', timeComplexity: '', spaceComplexity: '', mistakes: '', learned: '' });
    expect((await u.get(`/api/questions/${two.id}/approaches`)).status).toBe(200);
    expect((await other.get(`/api/questions/${two.id}/approaches`)).status).toBe(403);
  });
});
