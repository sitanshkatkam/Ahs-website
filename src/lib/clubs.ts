import { fromISODate } from './date';
import { WEEKDAY_FULL, WEEK_LABELS, type Club } from './storage';

/**
 * When a club actually meets.
 *
 * Kept apart from the screen because it is the only part with a right answer.
 * "Third Thursday" is the kind of rule that looks obvious and then quietly
 * misfires in months that start on a Friday, so it is worked out here where it
 * can be tested against a calendar rather than eyeballed.
 */

/** Which occurrence of its weekday a date is — the 3rd Tuesday, and so on. */
export function weekOfMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/** Is this the last occurrence of its weekday in the month? */
export function isLastWeekdayOfMonth(date: Date): boolean {
  const next = new Date(date);
  next.setDate(next.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}

/**
 * Does this club meet on this date?
 *
 * `schoolDay` is passed in rather than looked up: clubs meet at school, so a
 * daily club does not meet on a Saturday or over winter break, and the caller
 * already knows whether the day is one.
 */
export function meetsOn(club: Club, iso: string, schoolDay: boolean): boolean {
  const date = fromISODate(iso);

  if (club.frequency === 'daily') return schoolDay;
  if (date.getDay() !== club.weekday) return false;
  if (club.frequency === 'weekly') return true;

  // Monthly. 5 means "last", which is not always the 5th — most months only
  // have four of any given weekday.
  return club.week === 5 ? isLastWeekdayOfMonth(date) : weekOfMonth(date) === club.week;
}

/** Clubs meeting on a date, earliest first, untimed ones last. */
export function meetingOn(clubs: Club[], iso: string, schoolDay: boolean): Club[] {
  return clubs
    .filter((c) => meetsOn(c, iso, schoolDay))
    .sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
}

/** "Every school day" · "Tuesdays" · "3rd Thursday of the month" */
export function scheduleLabel(club: Club): string {
  // Full weekday names on purpose: the abbreviated set gives "Tues", which is
  // not a word anybody writes.
  const day = WEEKDAY_FULL[club.weekday];
  if (club.frequency === 'daily') return 'Every school day';
  if (club.frequency === 'weekly') return `${day}s`;
  return `${WEEK_LABELS[club.week]} ${day} of the month`;
}

/** "3:15 PM" from "15:15". Empty when the club has no set time. */
export function clubTimeLabel(club: Club): string {
  if (!club.time) return '';
  const [h, m] = club.time.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}
