import { env } from '../config/env.js';
import { query } from '../config/db.js';

export const emailEnabled = () => env.EMAIL_PROVIDER === 'resend' && !!env.EMAIL_API_KEY;

/** Optional delivery channel. In-app notifications work without it. Failures are logged, never thrown. */
export async function emailNotification(notificationId) {
  if (!emailEnabled()) return false;
  try {
    const { rows } = await query(
      `SELECT n.id, n.message, n.emailed_at, u.email FROM notifications n JOIN users u ON u.id = n.recipient_id WHERE n.id=$1`, [notificationId]);
    const n = rows[0];
    if (!n || n.emailed_at) return false;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [n.email], subject: 'DSA Squad', text: n.message }),
    });
    if (!res.ok) { console.error('Email provider error', res.status); return false; }
    await query('UPDATE notifications SET emailed_at = now() WHERE id=$1', [notificationId]);
    return true;
  } catch (e) {
    console.error('Email send failed:', e.message);
    return false;
  }
}
