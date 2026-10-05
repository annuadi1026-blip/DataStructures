import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { today, hourInTz } from '../utils/dates.js';
import { notFound, forbidden, conflict, tooMany } from '../utils/errors.js';
import { completedCounts } from './dailyService.js';
import { emailNotification } from './emailService.js';

const TARGET = env.DAILY_QUESTION_COUNT;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Insert a notification. A dedupe_key makes the insert idempotent per recipient, so repeated job runs never double-send. */
export async function create({ recipientId, senderId = null, type, message, relatedUserId = null, relatedQuestionId = null, dedupeKey = null }) {
  const { rows } = await query(
    `INSERT INTO notifications (recipient_id, sender_id, type, message, related_user_id, related_question_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`,
    [recipientId, senderId, type, message, relatedUserId, relatedQuestionId, dedupeKey]);
  if (rows[0]) emailNotification(rows[0].id).catch(() => {});
  return rows[0] || null;
}

export async function list(userId, { unread, limit }) {
  const [items, unreadCount] = await Promise.all([
    query(
      `SELECT n.id, n.type, n.message, n.sender_id, n.related_user_id, n.related_question_id, n.read_at, n.created_at,
              s.display_name AS sender_name
       FROM notifications n LEFT JOIN users s ON s.id = n.sender_id
       WHERE n.recipient_id=$1 ${unread === 'true' ? 'AND n.read_at IS NULL' : ''} ORDER BY n.created_at DESC, n.id DESC LIMIT $2`, [userId, limit]),
    query('SELECT count(*)::int AS n FROM notifications WHERE recipient_id=$1 AND read_at IS NULL', [userId]),
  ]);
  return { unread_count: unreadCount.rows[0].n, items: items.rows };
}

export async function markRead(userId, id) {
  const { rows } = await query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id=$1 AND recipient_id=$2 RETURNING id, read_at', [id, userId]);
  if (!rows[0]) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  return rows[0];
}
export async function markAllRead(userId) {
  const r = await query('UPDATE notifications SET read_at = now() WHERE recipient_id=$1 AND read_at IS NULL', [userId]);
  return { updated: r.rowCount };
}

export async function getPreferences(userId) {
  await query('INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  const { rows } = await query('SELECT personal_daily_reminder, friend_pending, friend_completed, allow_nudges, daily_group_summary FROM notification_preferences WHERE user_id=$1', [userId]);
  return rows[0];
}
export async function updatePreferences(userId, patch) {
  await getPreferences(userId);
  const keys = Object.keys(patch);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', '); // keys are zod-validated against a fixed set
  await query(`UPDATE notification_preferences SET ${sets}, updated_at = now() WHERE user_id = $1`, [userId, ...keys.map((k) => patch[k])]);
  return getPreferences(userId);
}

/** Other members (sharing at least one group) who want a given kind of friend notification. */
async function friendRecipients(userId, prefColumn) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.display_name FROM group_members a
     JOIN group_members b ON b.group_id = a.group_id AND b.user_id <> a.user_id
     JOIN users u ON u.id = b.user_id
     LEFT JOIN notification_preferences p ON p.user_id = u.id
     WHERE a.user_id = $1 AND COALESCE(p.${prefColumn}, true)`, [userId]);
  return rows;
}

/** Event hook: runs right after a user completes an assignment. */
export async function onProgressChanged(userId) {
  const date = today();
  const done = (await completedCounts([userId], date)).get(userId);
  if (done < TARGET) return;
  const u = await query('SELECT display_name FROM users WHERE id=$1', [userId]);
  for (const r of await friendRecipients(userId, 'friend_completed')) {
    await create({ recipientId: r.id, senderId: userId, type: 'FRIEND_DAILY_COMPLETED', relatedUserId: userId,
      message: `${u.rows[0].display_name} completed today's DSA target.`, dedupeKey: `fdc:${date}:${userId}` });
  }
}

export async function sendNudge(senderId, targetId) {
  const date = today();
  if (senderId === targetId) throw conflict('CANNOT_NUDGE_SELF', 'You cannot nudge yourself');
  const t = await query('SELECT id FROM users WHERE id=$1', [targetId]);
  if (!t.rows[0]) throw notFound('USER_NOT_FOUND', 'User not found');
  const { shareAGroup } = await import('./groupService.js');
  if (!(await shareAGroup(senderId, targetId))) throw forbidden('NOT_IN_SAME_GROUP', 'You can only nudge members of your groups');
  const prefs = await getPreferences(targetId);
  if (!prefs.allow_nudges) throw forbidden('NUDGES_DISABLED', 'This member has turned off nudges');
  if ((await completedCounts([targetId], date)).get(targetId) >= TARGET) throw conflict('TARGET_ALREADY_COMPLETED', "They've already finished today's target");

  const cool = await query(
    `SELECT created_at FROM notifications WHERE type='FRIEND_NUDGE' AND sender_id=$1 AND recipient_id=$2 AND created_at > now() - ($3 || ' minutes')::interval ORDER BY created_at DESC LIMIT 1`,
    [senderId, targetId, String(env.NUDGE_COOLDOWN_MINUTES)]);
  if (cool.rows[0]) {
    const wait = Math.ceil(env.NUDGE_COOLDOWN_MINUTES - (Date.now() - new Date(cool.rows[0].created_at).getTime()) / 60000);
    throw tooMany('NUDGE_COOLDOWN', `You nudged them recently. Try again in ${Math.max(wait, 1)} minutes`);
  }
  const daily = await query(`SELECT count(*)::int AS n FROM notifications WHERE type='FRIEND_NUDGE' AND sender_id=$1 AND created_at > now() - interval '24 hours'`, [senderId]);
  if (daily.rows[0].n >= env.NUDGE_DAILY_LIMIT) throw tooMany('NUDGE_DAILY_LIMIT', 'Daily nudge limit reached');

  const s = await query('SELECT display_name FROM users WHERE id=$1', [senderId]);
  const n = await create({ recipientId: targetId, senderId, type: 'FRIEND_NUDGE', relatedUserId: senderId,
    message: `${s.rows[0].display_name} nudged you to finish today's DSA target.` });
  return { id: n.id, message: n.message };
}

/**
 * Scheduled processor. Pure function of database state + clock, and idempotent (dedupe keys),
 * so it is safe to call from any cron, repeatedly, even after the host slept or restarted.
 */
export async function processScheduled(now = new Date()) {
  const date = today();
  const hour = hourInTz(now);
  const runKey = `${date}T${String(hour).padStart(2, '0')}`;
  await query(`INSERT INTO notification_runs (run_key) VALUES ($1) ON CONFLICT (run_key) DO UPDATE SET started_at = now(), finished_at = NULL`, [runKey]);
  const stats = { date, hour, personal_reminders: 0, friend_pending: 0, friend_completed: 0, revision_due: 0, group_summaries: 0 };
  const made = (n) => (n ? 1 : 0);

  const users = (await query(
    `SELECT u.id, u.display_name, COALESCE(p.personal_daily_reminder,true) AS pdr, COALESCE(p.friend_pending,true) AS fp,
            COALESCE(p.friend_completed,true) AS fc, COALESCE(p.daily_group_summary,true) AS dgs
     FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id`)).rows;
  const done = await completedCounts(users.map((u) => u.id), date);

  // 1. Personal reminder + 2. friends-pending (evening onward)
  if (hour >= env.REMINDER_HOUR) {
    for (const u of users) {
      const d = done.get(u.id) || 0;
      if (d >= TARGET) continue;
      if (u.pdr) {
        const n = await create({ recipientId: u.id, type: 'PERSONAL_DAILY_REMINDER', dedupeKey: `pdr:${date}`,
          message: `You still have ${plural(TARGET - d, 'DSA question')} pending today.` });
        stats.personal_reminders += made(n);
      }
      for (const r of await friendRecipients(u.id, 'friend_pending')) {
        const n = await create({ recipientId: r.id, senderId: u.id, type: 'FRIEND_DAILY_PENDING', relatedUserId: u.id, dedupeKey: `fdp:${date}:${u.id}`,
          message: d === 0 ? `${u.display_name} hasn't completed today's DSA target yet.` : `${u.display_name} has ${plural(TARGET - d, 'question')} remaining today.` });
        stats.friend_pending += made(n);
      }
    }
  }
  // 3. Catch-up for friend-completed (normally sent by the event hook)
  for (const u of users) {
    if ((done.get(u.id) || 0) < TARGET) continue;
    for (const r of await friendRecipients(u.id, 'friend_completed')) {
      const n = await create({ recipientId: r.id, senderId: u.id, type: 'FRIEND_DAILY_COMPLETED', relatedUserId: u.id, dedupeKey: `fdc:${date}:${u.id}`,
        message: `${u.display_name} completed today's DSA target.` });
      stats.friend_completed += made(n);
    }
  }
  // 4. Revisions due (tied to the personal-reminder preference)
  const due = await query(
    `SELECT r.user_id, count(*)::int AS n, min(r.question_id) AS first_q FROM revisions r
     WHERE r.completed_at IS NULL AND r.due_date <= $1::date GROUP BY r.user_id`, [date]);
  const pdr = new Map(users.map((u) => [u.id, u.pdr]));
  for (const r of due.rows) {
    if (!pdr.get(r.user_id)) continue;
    const n = await create({ recipientId: r.user_id, type: 'REVISION_DUE', relatedQuestionId: r.first_q, dedupeKey: `rev:${date}`,
      message: `You have ${plural(r.n, 'revision')} due today.` });
    stats.revision_due += made(n);
  }
  // 5. Daily group summary (late evening)
  if (hour >= env.SUMMARY_HOUR) {
    const groups = (await query('SELECT id, name FROM groups')).rows;
    for (const g of groups) {
      const mem = (await query(`SELECT u.id, u.display_name FROM group_members gm JOIN users u ON u.id=gm.user_id WHERE gm.group_id=$1 ORDER BY u.display_name`, [g.id])).rows;
      const lines = mem.map((m) => {
        const d = done.get(m.id) || 0;
        return `${m.display_name}  ${d}/${TARGET} ${d >= TARGET ? '✅' : d > 0 ? '⚠️' : '❌'}`;
      });
      const completed = mem.filter((m) => (done.get(m.id) || 0) >= TARGET).length;
      const message = `${g.name.toUpperCase()} — TODAY\n\n${lines.join('\n')}\n\n${plural(completed, 'member')} completed today's target.`;
      for (const m of mem) {
        if (!users.find((u) => u.id === m.id)?.dgs) continue;
        const n = await create({ recipientId: m.id, type: 'DAILY_GROUP_SUMMARY', dedupeKey: `dgs:${date}:${g.id}`, message });
        stats.group_summaries += made(n);
      }
    }
  }
  await query('UPDATE notification_runs SET finished_at = now(), stats = $2 WHERE run_key = $1', [runKey, stats]);
  return stats;
}
