/**
 * The 2026-2027 school calendar for American High School.
 *
 * Two sources, both linked from fremontunified.org/american:
 *   - "AMERICAN HIGH SCHOOL BELL SCHEDULE 2026-2027" — which days run which
 *     bell schedule, and the block/rally/minimum/finals date lists.
 *   - "2026-2027 FUSD Instructional Calendar" — holidays and breaks.
 *
 * Only *exceptions* live here. Anything not listed follows WEEKDAY_DEFAULT.
 * Users can add their own overrides in Settings; those win over this file, so
 * a mid-year schedule change doesn't require an app update.
 */

import type { ScheduleId } from './schedules';
import { isoRange } from '../lib/date';

export const SCHOOL_YEAR = {
  label: '2026–2027',
  firstDay: '2026-08-11',
  lastDay: '2027-06-01',
} as const;

/**
 * The normal weekly rotation: Mondays run all six periods, and the rest of the
 * week alternates block days. Individual dates below override this.
 */
export const WEEKDAY_DEFAULT: Record<number, ScheduleId | null> = {
  0: null, // Sunday
  1: 'regular', // Monday
  2: 'blockOdd', // Tuesday
  3: 'blockEven', // Wednesday
  4: 'blockOdd', // Thursday
  5: 'blockEven', // Friday
  6: null, // Saturday
};

export type DayOverride = {
  /** "YYYY-MM-DD" */
  date: string;
  scheduleId?: ScheduleId;
  noSchool?: boolean;
  /** Shown on the Today pill and in the calendar day sheet. */
  label?: string;
};

const range = isoRange;

const noSchool = (dates: string[], label: string): DayOverride[] =>
  dates.map((date) => ({ date, noSchool: true, label }));

const runs = (dates: string[], scheduleId: ScheduleId, label?: string): DayOverride[] =>
  dates.map((date) => ({ date, scheduleId, label }));

export const DAY_OVERRIDES: DayOverride[] = [
  // ---- First week of school: all six periods, then a rally Friday ----
  ...runs(['2026-08-11', '2026-08-12', '2026-08-13'], 'regular', 'First days of school'),
  ...runs(['2026-08-14'], 'rally'),

  // ---- Block days that fall outside the normal Tue/Thu · Wed/Fri rotation ----
  ...runs(
    [
      '2026-08-24',
      '2026-08-26',
      '2026-11-09',
      '2026-11-16',
      '2026-11-18',
      '2026-12-14',
      '2027-02-01',
      '2027-02-03',
      '2027-02-08',
      '2027-02-10',
      '2027-03-08',
      '2027-03-10',
      '2027-03-22',
      '2027-03-24',
      '2027-05-24',
    ],
    'blockOdd',
  ),
  ...runs(
    [
      '2026-08-25',
      '2026-08-27',
      '2026-11-10',
      '2026-11-17',
      '2026-11-19',
      '2026-12-15',
      '2027-02-02',
      '2027-02-04',
      '2027-02-09',
      '2027-02-11',
      '2027-03-09',
      '2027-03-23',
      '2027-03-25',
      '2027-05-25',
    ],
    'blockEven',
  ),

  // ---- Rally days ----
  // The bell-schedule PDF lists the block rally dates but not their parity.
  // Parity here is taken from the school's own Academics calendar feed, which
  // labels each one — note 2027-03-11 is Even despite being a Thursday.
  ...runs(['2026-10-05'], 'rally'),
  ...runs(['2026-10-06', '2026-10-08'], 'rallyBlockOdd'),
  ...runs(
    ['2026-10-07', '2026-10-09', '2027-03-11', '2027-04-16', '2027-05-21'],
    'rallyBlockEven',
  ),

  // ---- Minimum days ----
  ...runs(['2026-08-28', '2026-10-22', '2027-02-05', '2027-06-01'], 'minimum'),

  // ---- Semester finals (late start) ----
  ...runs(['2026-12-16'], 'finalsDay1', 'Finals'),
  ...runs(['2026-12-17'], 'finalsDay2', 'Finals'),
  ...runs(['2026-12-18'], 'finalsDay3', 'Finals'),
  ...runs(['2027-05-26'], 'finalsDay1', 'Finals'),
  ...runs(['2027-05-27'], 'finalsDay2', 'Finals'),
  ...runs(['2027-05-28'], 'finalsDay3', 'Finals'),

  // ---- No school ----
  ...noSchool(['2026-09-07'], 'Labor Day'),
  ...noSchool(['2026-10-23'], 'Family Conferences'),
  ...noSchool(['2026-11-11'], 'Veterans Day'),
  ...noSchool(['2026-11-20'], 'Family Conferences'),
  ...noSchool(range('2026-11-23', '2026-11-27'), 'Fall Recess'),
  ...noSchool(range('2026-12-21', '2027-01-04'), 'Winter Break'),
  ...noSchool(['2027-01-18'], 'M.L. King Jr. Day'),
  ...noSchool(['2027-02-12'], 'Non-Student Day'),
  ...noSchool(['2027-02-15'], "Presidents' Day"),
  ...noSchool(['2027-03-12'], 'Staff Development Day'),
  ...noSchool(range('2027-03-15', '2027-03-19'), 'Spring Break'),
  ...noSchool(['2027-03-26'], 'Staff Development Day'),
  ...noSchool(['2027-05-31'], 'Memorial Day'),
];

export type EventCategory =
  | 'academic'
  | 'social'
  | 'deadline'
  | 'break'
  | 'sports'
  | 'arts'
  | 'other';

/** Order used by the Settings filter chips. */
export const EVENT_CATEGORIES: EventCategory[] = [
  'academic',
  'deadline',
  'break',
  'social',
  'sports',
  'arts',
  'other',
];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  academic: 'Academic',
  deadline: 'Finals',
  break: 'Days off',
  social: 'Rallies & dances',
  sports: 'Sports',
  arts: 'Music & drama',
  other: 'Other',
};

export type SchoolEvent = {
  date: string;
  /** Inclusive; omit for single-day events. */
  endDate?: string;
  title: string;
  category: EventCategory;
};

/**
 * Curated events, from the instructional calendar PDF. Things the school's
 * Google Calendar feed also publishes (first/last day, rallies, concerts) are
 * deliberately not repeated here — the feed supplies those, and duplicates are
 * merged away in resolveDay.
 */
export const EVENTS: SchoolEvent[] = [
  { date: '2026-09-07', title: 'Labor Day — no school', category: 'break' },
  { date: '2026-10-05', endDate: '2026-10-09', title: 'Rally Week', category: 'social' },
  { date: '2026-10-09', title: 'End of 1st Quarter', category: 'academic' },
  { date: '2026-10-22', title: 'Minimum Day', category: 'academic' },
  { date: '2026-10-23', title: 'Family Conferences — no school', category: 'break' },
  { date: '2026-11-11', title: 'Veterans Day — no school', category: 'break' },
  { date: '2026-11-20', title: 'Family Conferences — no school', category: 'break' },
  { date: '2026-11-23', endDate: '2026-11-27', title: 'Fall Recess', category: 'break' },
  {
    date: '2026-12-16',
    endDate: '2026-12-18',
    title: 'Semester 1 Finals (late start)',
    category: 'deadline',
  },
  { date: '2026-12-18', title: 'End of 1st Semester', category: 'academic' },
  { date: '2026-12-21', endDate: '2027-01-04', title: 'Winter Break', category: 'break' },
  { date: '2027-01-18', title: 'M.L. King Jr. Day — no school', category: 'break' },
  { date: '2027-02-05', title: 'Minimum Day', category: 'academic' },
  { date: '2027-02-12', title: 'Non-Student Day — no school', category: 'break' },
  { date: '2027-02-15', title: "Presidents' Day — no school", category: 'break' },
  { date: '2027-03-11', title: 'End of 3rd Quarter · Rally', category: 'academic' },
  { date: '2027-03-12', title: 'Staff Development — no school', category: 'break' },
  { date: '2027-03-15', endDate: '2027-03-19', title: 'Spring Break', category: 'break' },
  { date: '2027-03-26', title: 'Staff Development — no school', category: 'break' },
  { date: '2027-04-16', title: 'Spring Rally', category: 'social' },
  { date: '2027-05-21', title: 'Rally', category: 'social' },
  { date: '2027-05-31', title: 'Memorial Day — no school', category: 'break' },
  {
    date: '2027-05-26',
    endDate: '2027-05-28',
    title: 'Semester 2 Finals (late start)',
    category: 'deadline',
  },
  { date: '2027-06-01', title: 'Last day of school · Minimum Day', category: 'academic' },
];
