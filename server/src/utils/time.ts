import { BUSINESS_TIMEZONE } from '../config/env.js';

/**
 * India Standard Time has a fixed +05:30 offset with no daylight saving, so a
 * wall-clock date/time entered by staff maps to exactly one instant.
 */
const BUSINESS_UTC_OFFSET = '+05:30';

/** Single place to read "now" — the server clock is the source of truth. */
export function now(): Date {
  return new Date();
}

/** Converts a business-local date ('YYYY-MM-DD') and time ('HH:mm') to an instant. */
export function businessDateTimeToDate(date: string, time: string): Date {
  const d = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${BUSINESS_UTC_OFFSET}`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date/time: ${date} ${time}`);
  return d;
}

const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Business-local calendar date of an instant, as 'YYYY-MM-DD'. */
export function businessDate(d: Date = now()): string {
  return dateParts.format(d);
}

/** Start of the business-local day containing `date` ('YYYY-MM-DD'), as an instant. */
export function startOfBusinessDay(date: string): Date {
  return businessDateTimeToDate(date, '00:00');
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole minutes between two instants, rounded to the nearest minute (never negative). */
export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

const displayFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

/** e.g. "03/10/2026, 06:00 PM" in business time. */
export function formatBusinessDateTime(d: Date): string {
  return displayFormat.format(d).toUpperCase();
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m || !h) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}
