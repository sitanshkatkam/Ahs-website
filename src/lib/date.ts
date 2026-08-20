/**
 * Date helpers.
 *
 * Everything in this app keys off a local calendar date written as
 * "YYYY-MM-DD". Never use `Date#toISOString` to produce one — it converts to
 * UTC first, which in Pacific time silently shifts the date back a day for
 * anything before 5pm. `toISODate` formats from the local field accessors.
 */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" as local midnight (not UTC). */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive range of ISO dates. */
export function isoRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const d = fromISODate(startISO);
  const end = fromISODate(endISO);
  while (d <= end) {
    out.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Minutes since local midnight for a "HH:MM" string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since local midnight for a Date. */
export function minutesOfDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** "13:28" -> "1:28 PM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * How much of the countdown to show.
 *
 * Seconds ticking down from 90 minutes is just noise — it draws the eye every
 * second and tells you nothing you didn't already know. So the display stays on
 * whole minutes until the last five, which is the point where seconds start to
 * matter because you're deciding whether to run.
 *
 * The unit is returned separately so the caller can set it smaller than the
 * number; "47" wants to be big, "min" does not.
 */
export const SECONDS_UI_THRESHOLD = 5 * 60;

export type CountdownParts = { value: string; unit: string | null };

export function countdownParts(totalSeconds: number): CountdownParts {
  const s = Math.max(0, Math.floor(totalSeconds));

  // Under five minutes: m:ss, so 0:45 reads as a countdown rather than a
  // quantity. Flooring throughout means "5 min" hands over to "4:59".
  if (s < SECONDS_UI_THRESHOLD) {
    return { value: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, unit: null };
  }

  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return { value: `${h}h ${m}m`, unit: null };
  return { value: String(m), unit: 'min' };
}

/** The same thing as one string, for anywhere that can't style the unit. */
export function formatCountdown(totalSeconds: number): string {
  const { value, unit } = countdownParts(totalSeconds);
  return unit ? `${value} ${unit}` : value;
}

export function addDays(iso: string, n: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
