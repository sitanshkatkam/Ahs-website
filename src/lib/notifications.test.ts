import { describe, expect, it } from 'vitest';
import { planNotifications } from './notifications';
import {
  DEFAULT_NOTIFICATIONS,
  type Assignment,
  type NotificationPrefs,
  type UserClass,
} from './storage';

const classes: UserClass[] = [
  { period: 1, name: 'AP Chemistry', room: '402' },
  { period: 3, name: 'US History' },
];

const prefs = (over: Partial<NotificationPrefs>): NotificationPrefs => ({
  ...structuredClone(DEFAULT_NOTIFICATIONS),
  ...over,
});

/** 2026-09-14 is a plain six-period Monday; 09-15 is a 1/3/5 block Tuesday. */
const MONDAY = '2026-09-14';

describe('planNotifications', () => {
  it('plans nothing when every toggle is off', () => {
    expect(planNotifications(MONDAY, DEFAULT_NOTIFICATIONS, classes)).toEqual([]);
  });

  it('plans nothing at all on a non-school day', () => {
    // Saturday, with every toggle on.
    const all = prefs({
      classStarting: { on: true, minutesBefore: 5 },
      mealsAndBell: { on: true },
    });
    expect(planNotifications('2026-09-19', all, classes)).toEqual([]);
  });

  it('fires class alerts the configured number of minutes early', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({ classStarting: { on: true, minutesBefore: 10 } }),
      classes,
    );
    expect(plan).toHaveLength(6);

    const first = plan[0];
    // Period 1 starts 08:30, so a 10-minute warning lands at 08:20.
    expect(first.at.getHours()).toBe(8);
    expect(first.at.getMinutes()).toBe(20);
    expect(first.title).toBe('AP Chemistry in 10 min');
    expect(first.body).toContain('Room 402');
  });

  it('falls back to the period label for unconfigured classes', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({ classStarting: { on: true, minutesBefore: 5 } }),
      classes,
    );
    expect(plan.find((n) => n.id.endsWith(':class:2'))?.title).toBe('Period 2 in 5 min');
  });

  it('covers brunch, lunch and the final bell', () => {
    const plan = planNotifications(MONDAY, prefs({ mealsAndBell: { on: true } }), classes);
    const ids = plan.map((n) => n.id);
    expect(ids).toContain(`${MONDAY}:meal:brunch`);
    expect(ids).toContain(`${MONDAY}:meal:lunch`);
    expect(ids).toContain(`${MONDAY}:bell:end`);

    const bell = plan.find((n) => n.id.endsWith(':bell:end'))!;
    expect(bell.at.getHours()).toBe(15);
    expect(bell.at.getMinutes()).toBe(30);
  });

  it('warns the evening before a block day', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({ tomorrowType: { on: true, atHour: 20 } }),
      classes,
    );
    const alert = plan.find((n) => n.id.endsWith(':tomorrow'))!;
    expect(alert.title).toBe('Tomorrow: Block Day — 1 / 3 / 5');
    expect(alert.body).toContain('Periods 1, 3, 5');
    expect(alert.at.getHours()).toBe(20);
  });

  it('stays quiet the evening before an ordinary six-period day', () => {
    // Sunday 2026-09-13 -> Monday is a plain regular day, so nothing to say.
    const plan = planNotifications(
      '2026-09-13',
      prefs({ tomorrowType: { on: true, atHour: 20 } }),
      classes,
    );
    expect(plan.filter((n) => n.id.endsWith(':tomorrow'))).toEqual([]);
  });

  it('flags an unexpected weekday off', () => {
    // 2026-09-07 is Labor Day, so the Sunday before should say so.
    const plan = planNotifications(
      '2026-09-06',
      prefs({ tomorrowType: { on: true, atHour: 20 } }),
      classes,
    );
    const alert = plan.find((n) => n.id.endsWith(':tomorrow'))!;
    expect(alert.title).toBe('No school tomorrow');
    expect(alert.body).toBe('Labor Day');
  });

  it('does not announce the weekend every Friday', () => {
    // Friday 2026-09-18 -> Saturday is not a weekday, so no alert.
    const plan = planNotifications(
      '2026-09-18',
      prefs({ tomorrowType: { on: true, atHour: 20 } }),
      classes,
    );
    expect(plan.filter((n) => n.id.endsWith(':tomorrow'))).toEqual([]);
  });

  it('reminds about events the configured number of days ahead', () => {
    // Rally Week starts 2026-10-05, so a 2-day lead time fires on 10-03.
    const plan = planNotifications(
      '2026-10-03',
      prefs({ upcomingEvents: { on: true, daysBefore: 2 } }),
      classes,
    );
    const alert = plan.find((n) => n.title === 'Rally Week')!;
    expect(alert.body).toBe('Coming up in 2 days');
    expect(alert.at.getHours()).toBe(17);
  });

  it('returns notifications in chronological order', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({
        classStarting: { on: true, minutesBefore: 5 },
        mealsAndBell: { on: true },
        tomorrowType: { on: true, atHour: 20 },
      }),
      classes,
    );
    const times = plan.map((n) => n.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('gives every notification a unique, date-prefixed id', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({
        classStarting: { on: true, minutesBefore: 5 },
        mealsAndBell: { on: true },
        tomorrowType: { on: true, atHour: 20 },
      }),
      classes,
    );
    const ids = plan.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${MONDAY}:`)).toBe(true);
  });

  it('digests everything due into one alert rather than one each', () => {
    const assignments: Assignment[] = [
      { id: 'a', period: 1, title: 'Lab report', due: '2026-09-15', type: 'homework', done: false },
      { id: 'b', period: 3, title: 'Essay draft', due: '2026-09-15', type: 'project', done: false },
    ];
    const plan = planNotifications(
      MONDAY,
      prefs({ assignmentsDue: { on: true, daysBefore: 1, atHour: 18 } }),
      classes,
      [],
      undefined,
      assignments,
    );
    const due = plan.filter((n) => n.id.includes(':due:'));
    expect(due).toHaveLength(1);
    expect(due[0].title).toBe('2 things due tomorrow');
    expect(due[0].body).toBe('Lab report · Essay draft');
    expect(due[0].at.getHours()).toBe(18);
  });

  it('names the class when only one thing is due', () => {
    const assignments: Assignment[] = [
      { id: 'a', period: 1, title: 'Lab report', due: '2026-09-15', type: 'homework', done: false },
    ];
    const plan = planNotifications(
      MONDAY,
      prefs({ assignmentsDue: { on: true, daysBefore: 1, atHour: 18 } }),
      classes,
      [],
      undefined,
      assignments,
    );
    const due = plan.find((n) => n.id.includes(':due:'))!;
    expect(due.title).toBe('Due tomorrow: Lab report');
    expect(due.body).toBe('AP Chemistry');
  });

  it('ignores assignments already ticked off', () => {
    const assignments: Assignment[] = [
      { id: 'a', period: 1, title: 'Done already', due: '2026-09-15', type: 'homework', done: true },
    ];
    const plan = planNotifications(
      MONDAY,
      prefs({ assignmentsDue: { on: true, daysBefore: 1, atHour: 18 } }),
      classes,
      [],
      undefined,
      assignments,
    );
    expect(plan.filter((n) => n.id.includes(':due:'))).toEqual([]);
  });

  it('still reminds about work on a day off', () => {
    // Sunday: no bell schedule, but homework due Monday still matters.
    const assignments: Assignment[] = [
      { id: 'a', period: 1, title: 'Reading', due: '2026-09-14', type: 'homework', done: false },
    ];
    const plan = planNotifications(
      '2026-09-13',
      prefs({ assignmentsDue: { on: true, daysBefore: 1, atHour: 18 } }),
      classes,
      [],
      undefined,
      assignments,
    );
    expect(plan.filter((n) => n.id.includes(':due:'))).toHaveLength(1);
  });

  it('respects a user override that cancels school', () => {
    const plan = planNotifications(
      MONDAY,
      prefs({ classStarting: { on: true, minutesBefore: 5 }, mealsAndBell: { on: true } }),
      classes,
      [{ date: MONDAY, noSchool: true, label: 'Air quality' }],
    );
    expect(plan).toEqual([]);
  });
});
