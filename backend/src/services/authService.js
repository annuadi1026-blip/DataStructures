import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { isTest } from '../config/env.js';
import { badRequest, conflict, unauthorized } from '../utils/errors.js';
import { signToken } from '../middleware/auth.js';

const COST = isTest ? 4 : 12;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

export const publicUser = (u) => ({ id: u.id, email: u.email, username: u.username, display_name: u.display_name, created_at: u.created_at });

export async function register({ email, username, displayName, password }) {
  const hash = await bcrypt.hash(password, COST);
  try {
    const user = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO users (email, username, display_name, password_hash) VALUES ($1,$2,$3,$4) RETURNING *`,
        [email.toLowerCase(), username, displayName, hash]);
      await c.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [rows[0].id]);
      return rows[0];
    });
    return { user: publicUser(user), token: signToken(user) };
  } catch (e) {
    if (e.code === '23505') {
      const field = /username/.test(e.constraint || '') ? 'username' : 'email';
      throw conflict(field === 'username' ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN', `That ${field} is already registered`);
    }
    throw e;
  }
}

export async function login({ email, password }) {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)', [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');
  return { user: publicUser(user), token: signToken(user) };
}

export async function getMe(userId) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  return publicUser(rows[0]);
}

export async function updateMe(userId, { email, username, displayName }) {
  try {
    const { rows } = await query(
      `UPDATE users SET email = COALESCE($2, email), username = COALESCE($3, username),
         display_name = COALESCE($4, display_name), updated_at = now() WHERE id = $1 RETURNING *`,
      [userId, email?.toLowerCase() ?? null, username ?? null, displayName ?? null]);
    return publicUser(rows[0]);
  } catch (e) {
    if (e.code === '23505') throw conflict(/username/.test(e.constraint || '') ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN', 'That email or username is already in use');
    throw e;
  }
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!(await bcrypt.compare(currentPassword, rows[0].password_hash))) throw badRequest('WRONG_PASSWORD', 'Current password is incorrect');
  const hash = await bcrypt.hash(newPassword, COST);
  // Bumping token_version signs the user out everywhere else.
  const upd = await query('UPDATE users SET password_hash=$2, token_version=token_version+1, updated_at=now() WHERE id=$1 RETURNING *', [userId, hash]);
  return { token: signToken(upd.rows[0]) };
}

export async function deleteAccount(userId, password) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!(await bcrypt.compare(password, rows[0].password_hash))) throw badRequest('WRONG_PASSWORD', 'Password is incorrect');
  await withTransaction(async (c) => {
    // Don't destroy a squad because its owner leaves: hand ownership to the longest-standing member.
    const owned = await c.query('SELECT id FROM groups WHERE owner_id = $1', [userId]);
    for (const g of owned.rows) {
      const next = await c.query('SELECT user_id FROM group_members WHERE group_id=$1 AND user_id<>$2 ORDER BY joined_at LIMIT 1', [g.id, userId]);
      if (next.rows[0]) {
        await c.query('UPDATE groups SET owner_id=$2 WHERE id=$1', [g.id, next.rows[0].user_id]);
        await c.query(`UPDATE group_members SET role='owner' WHERE group_id=$1 AND user_id=$2`, [g.id, next.rows[0].user_id]);
      }
    }
    await c.query('DELETE FROM users WHERE id = $1', [userId]);
  });
}
