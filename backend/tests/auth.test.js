import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, resetDb, closePool, query, makeUser } from './helpers.js';

beforeAll(resetDb);
afterAll(closePool);

describe('authentication', () => {
  it('registers a user, hashes the password and creates default notification preferences', async () => {
    const res = await api().post('/api/auth/register').send({ email: 'Neo@Example.com', username: 'neo', displayName: 'Neo', password: 'matrix123' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('neo@example.com');
    expect(res.body.data.user.password_hash).toBeUndefined();
    const { rows } = await query("SELECT password_hash FROM users WHERE username='neo'");
    expect(rows[0].password_hash).not.toContain('matrix123');
    expect(rows[0].password_hash.startsWith('$2')).toBe(true);
    const prefs = await query("SELECT * FROM notification_preferences WHERE user_id = (SELECT id FROM users WHERE username='neo')");
    expect(prefs.rows[0].allow_nudges).toBe(true);
  });

  it('rejects duplicate email and username', async () => {
    const dupEmail = await api().post('/api/auth/register').send({ email: 'neo@example.com', username: 'other', displayName: 'X', password: 'matrix123' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');
    const dupUser = await api().post('/api/auth/register').send({ email: 'o@example.com', username: 'NEO', displayName: 'X', password: 'matrix123' });
    expect(dupUser.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('validates input (weak password)', async () => {
    const res = await api().post('/api/auth/register').send({ email: 'w@example.com', username: 'weak', displayName: 'W', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with valid credentials and rejects invalid ones with the same error', async () => {
    const ok = await api().post('/api/auth/login').send({ email: 'neo@example.com', password: 'matrix123' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toBeTruthy();
    const badPw = await api().post('/api/auth/login').send({ email: 'neo@example.com', password: 'wrong-pass1' });
    const noUser = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'matrix123' });
    expect(badPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(badPw.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(noUser.body.error).toEqual(badPw.body.error);
  });

  it('protects authenticated routes', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/daily')).status).toBe(401);
    expect((await api().get('/api/daily').set('Authorization', 'Bearer garbage')).body.error.code).toBe('INVALID_TOKEN');
  });

  it('updates profile, changes password (revoking old tokens) and deletes the account', async () => {
    const u = await makeUser('trin');
    const upd = await u.patch('/api/users/me', { displayName: 'Trinity' });
    expect(upd.body.data.user.display_name).toBe('Trinity');
    const bad = await u.post('/api/users/me/password', { currentPassword: 'nope-nope1', newPassword: 'newpass123' });
    expect(bad.body.error.code).toBe('WRONG_PASSWORD');
    const ch = await u.post('/api/users/me/password', { currentPassword: 'password1', newPassword: 'newpass123' });
    expect(ch.status).toBe(200);
    expect((await u.get('/api/auth/me')).status).toBe(401); // old token revoked
    const fresh = await api().get('/api/auth/me').set('Authorization', `Bearer ${ch.body.data.token}`);
    expect(fresh.status).toBe(200);
    const del = await api().delete('/api/users/me').set('Authorization', `Bearer ${ch.body.data.token}`).send({ password: 'newpass123' });
    expect(del.status).toBe(200);
    expect((await query('SELECT 1 FROM users WHERE id=$1', [u.id])).rowCount).toBe(0);
  });
});
