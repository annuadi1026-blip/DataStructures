import request from 'supertest';
import { createApp } from '../src/config/../app.js';
import { query, closePool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { seed } from '../scripts/seed.js';

export const app = createApp();
export const api = () => request(app);

export function assertTestDb() {
  if (!/test/i.test(env.DATABASE_URL.split('/').pop() || '')) {
    throw new Error('Refusing to run tests: DATABASE_URL must point at a database whose name contains "test"');
  }
}

export async function resetDb() {
  assertTestDb();
  await query('TRUNCATE users, notification_runs RESTART IDENTITY CASCADE');
  await seed({ quiet: true });
}
export { closePool, query, env };

let counter = 0;
export async function makeUser(name = 'user') {
  counter++;
  const username = `${name}${counter}`;
  const res = await api().post('/api/auth/register').send({
    email: `${username}@example.com`, username, displayName: name[0].toUpperCase() + name.slice(1), password: 'password1',
  });
  if (res.status !== 201) throw new Error('register failed ' + JSON.stringify(res.body));
  const token = res.body.data.token;
  const initialized = await api().put('/api/study-state/solo-start')
    .set('Authorization', `Bearer ${token}`).send({ starting_day: 1 });
  if (initialized.status !== 200) throw new Error('solo study state init failed ' + JSON.stringify(initialized.body));
  return { token, id: res.body.data.user.id, username, email: `${username}@example.com`, name: res.body.data.user.display_name,
    get: (url) => api().get(url).set('Authorization', `Bearer ${token}`),
    post: (url, body) => api().post(url).set('Authorization', `Bearer ${token}`).send(body),
    put: (url, body) => api().put(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url, body) => api().patch(url).set('Authorization', `Bearer ${token}`).send(body),
    del: (url, body) => api().delete(url).set('Authorization', `Bearer ${token}`).send(body) };
}

export async function solveToday(user, count = 2) {
  const day = (await user.get('/api/daily')).body.data;
  for (const a of day.assignments.slice(0, count)) {
    const r = await user.patch(`/api/progress/${a.id}`, { status: 'SOLVED' });
    if (r.status !== 200) throw new Error('solve failed ' + JSON.stringify(r.body));
  }
  return day.assignments;
}

export async function makeGroup(owner, ...others) {
  const g = (await owner.post('/api/groups', { name: 'DSA Squad' })).body.data.group;
  for (const o of others) {
    const r = await o.post('/api/groups/join', { code: g.invite.code });
    if (r.status !== 200) throw new Error('join failed ' + JSON.stringify(r.body));
  }
  return g;
}
