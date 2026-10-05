import { env } from '../config/env.js';

/** 'YYYY-MM-DD' for an instant, in the application timezone. */
export function dateInTz(d = new Date(), tz = env.APP_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const today = () => dateInTz(new Date());

export function hourInTz(d = new Date(), tz = env.APP_TIMEZONE) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d), 10) % 24;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;

/** Day of week for a calendar date, where Sunday is 0. */
export const weekday = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();
export const isSunday = (dateStr) => weekday(dateStr) === 0;

/** Product schedule: two questions Mon–Fri, one on Saturday, Sunday off. */
export function dailyTarget(dateStr) {
  const day = weekday(dateStr);
  return day === 0 ? 0 : day === 6 ? 1 : 2;
}

export function previousPracticeDay(dateStr) {
  let cursor = addDays(dateStr, -1);
  while (isSunday(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}
