import { describe, expect, it } from 'vitest';
import { clubTimeLabel, meetingOn, meetsOn, scheduleLabel, weekOfMonth } from './clubs';
import type { Club } from './storage';

/**
 * "Third Thursday" is the rule that looks obvious and then quietly misfires.
 * Whether a date is the 3rd Thursday depends on what weekday the month started
 * on, and "last Friday" is the 4th in some months and the 5th in others — so
 * these check real months rather than a convenient one.
 *
 * September 2026 starts on a Tuesday and has five Wednesdays; October 2026 has
 * four. That pair is what most of the monthly cases are built on.
 */

const club = (over: Partial<Club> = {}): Club => ({
  id: 'c1',
  name: 'Robotics',
  frequency: 'weekly',
  weekday: 2, // Tuesday
  week: 1,
  ...over,
});

describe('weekOfMonth', () => {
  it('counts occurrences of the weekday, not calendar weeks', () => {
    expect(weekOfMonth(new Date(2026, 8, 1))).toBe(1); // Tue 1 Sep
    expect(weekOfMonth(new Date(2026, 8, 8))).toBe(2);
    expect(weekOfMonth(new Date(2026, 8, 15))).toBe(3);
    expect(weekOfMonth(new Date(2026, 8, 29))).toBe(5);
  });
});

describe('meetsOn', () => {
  it('a daily club meets on school days only', () => {
    const c = club({ frequency: 'daily' });
    expect(meetsOn(c, '2026-09-16', true)).toBe(true);
    // Same date, but the school is closed — no club either.
    expect(meetsOn(c, '2026-09-16', false)).toBe(false);
  });

  it('a weekly club meets on its weekday regardless of which week', () => {
    const c = club({ frequency: 'weekly', weekday: 2 });
    for (const iso of ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']) {
      expect(meetsOn(c, iso, true), iso).toBe(true);
    }
    expect(meetsOn(c, '2026-09-16', true)).toBe(false); // a Wednesday
  });

  it('a monthly club meets only on its own occurrence', () => {
    // 3rd Thursday of September 2026 is the 17th.
    const c = club({ frequency: 'monthly', weekday: 4, week: 3 });
    expect(meetsOn(c, '2026-09-17', true)).toBe(true);
    expect(meetsOn(c, '2026-09-03', true)).toBe(false); // 1st Thursday
    expect(meetsOn(c, '2026-09-10', true)).toBe(false); // 2nd
    expect(meetsOn(c, '2026-09-24', true)).toBe(false); // 4th
  });

  it('"last" is the 5th in some months and the 4th in others', () => {
    // The case a naive `week === 5` check gets wrong half the year.
    const c = club({ frequency: 'monthly', weekday: 3, week: 5 }); // last Wednesday

    // September 2026 has five Wednesdays: 2, 9, 16, 23, 30.
    expect(meetsOn(c, '2026-09-30', true)).toBe(true);
    expect(meetsOn(c, '2026-09-23', true)).toBe(false);

    // October 2026 has four: 7, 14, 21, 28. The last is the 4th occurrence.
    expect(meetsOn(c, '2026-10-28', true)).toBe(true);
    expect(meetsOn(c, '2026-10-21', true)).toBe(false);
  });

  it('a monthly club still ignores the wrong weekday entirely', () => {
    const c = club({ frequency: 'monthly', weekday: 4, week: 1 });
    expect(meetsOn(c, '2026-09-01', true)).toBe(false); // 1st Tuesday, not Thursday
  });
});

describe('meetingOn', () => {
  it('sorts by time and puts untimed clubs last', () => {
    const clubs: Club[] = [
      club({ id: 'a', name: 'No time', weekday: 2 }),
      club({ id: 'b', name: 'Late', weekday: 2, time: '15:30' }),
      club({ id: 'c', name: 'Early', weekday: 2, time: '07:30' }),
    ];
    expect(meetingOn(clubs, '2026-09-01', true).map((c) => c.name)).toEqual([
      'Early',
      'Late',
      'No time',
    ]);
  });

  it('leaves out clubs that do not meet', () => {
    const clubs: Club[] = [
      club({ id: 'a', weekday: 2 }),
      club({ id: 'b', name: 'Wednesday club', weekday: 3 }),
    ];
    expect(meetingOn(clubs, '2026-09-01', true).map((c) => c.id)).toEqual(['a']);
  });
});

describe('labels', () => {
  it('describes the schedule the way a student would say it', () => {
    expect(scheduleLabel(club({ frequency: 'daily' }))).toBe('Every school day');
    expect(scheduleLabel(club({ frequency: 'weekly', weekday: 2 }))).toBe('Tuesdays');
    expect(scheduleLabel(club({ frequency: 'monthly', weekday: 4, week: 3 }))).toBe(
      '3rd Thursday of the month',
    );
    expect(scheduleLabel(club({ frequency: 'monthly', weekday: 5, week: 5 }))).toBe(
      'Last Friday of the month',
    );
  });

  it('formats the time in twelve-hour form', () => {
    expect(clubTimeLabel(club({ time: '15:15' }))).toBe('3:15 PM');
    expect(clubTimeLabel(club({ time: '07:05' }))).toBe('7:05 AM');
    expect(clubTimeLabel(club({ time: '12:00' }))).toBe('12:00 PM');
    expect(clubTimeLabel(club({ time: '00:30' }))).toBe('12:30 AM');
  });

  it('has nothing to say when no time is set', () => {
    expect(clubTimeLabel(club())).toBe('');
  });
});
