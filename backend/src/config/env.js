import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env first, then the repo-root .env as a fallback.
dotenv.config({ path: path.resolve(here, '../../.env') });
dotenv.config({ path: path.resolve(here, '../../../.env') });

const intList = (v, fallback) =>
  (v || fallback).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  DATABASE_SSL: (process.env.DATABASE_SSL || '').toLowerCase(), // 'true' | 'false' | '' (auto)
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  REVISION_INTERVALS_DAYS: intList(process.env.REVISION_INTERVALS_DAYS, '1,3,7,21'),
  DAILY_QUESTION_COUNT: 2, // product rule: always exactly two
  CRON_SECRET: process.env.CRON_SECRET || '',
  REMINDER_HOUR: parseInt(process.env.REMINDER_HOUR || '18', 10), // local hour after which reminders start
  SUMMARY_HOUR: parseInt(process.env.SUMMARY_HOUR || '21', 10),
  NUDGE_COOLDOWN_MINUTES: parseInt(process.env.NUDGE_COOLDOWN_MINUTES || '180', 10),
  NUDGE_DAILY_LIMIT: parseInt(process.env.NUDGE_DAILY_LIMIT || '10', 10),
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER || '').toLowerCase(), // '' or 'resend'
  EMAIL_API_KEY: process.env.EMAIL_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'DSA Squad <onboarding@resend.dev>',
};

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export function assertConfig() {
  const missing = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (isProd && env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');
}
