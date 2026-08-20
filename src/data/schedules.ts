/**
 * Bell schedules for American High School, Fremont — 2026-2027.
 *
 * Transcribed from the official district PDF ("AMERICAN HIGH SCHOOL BELL
 * SCHEDULE 2026-2027", linked from fremontunified.org/american). Every passing
 * period in the source is exactly 6 minutes, which is a useful sanity check if
 * you ever re-type these.
 *
 * Times are local wall-clock "HH:MM" on a 24-hour clock.
 */

export type SlotKind = 'period' | 'brunch' | 'lunch' | 'flex' | 'flexRally';

export type Slot = {
  kind: SlotKind;
  /** Which class meets in this slot. Absent for brunch/lunch/flex. */
  period?: number;
  /** Shown when no user class is configured for `period`. */
  label: string;
  start: string;
  end: string;
};

export type ScheduleId =
  | 'regular'
  | 'blockOdd'
  | 'blockEven'
  | 'rally'
  | 'rallyBlockOdd'
  | 'rallyBlockEven'
  | 'minimum'
  | 'finalsDay1'
  | 'finalsDay2'
  | 'finalsDay3';

export type ScheduleTemplate = {
  id: ScheduleId;
  /** Full name, e.g. "Block Day — 1 / 3 / 5". */
  name: string;
  /** Two or three words, for calendar cells and the Today pill. */
  short: string;
  /**
   * Ultra-compact label for the week strip, where a cell is ~44px wide. Colour
   * already carries the schedule family (block / rally / finals), so this only
   * needs to say which periods meet.
   */
  code: string;
  /** Palette key, resolved to CSS vars in the UI. */
  accent: 'blue' | 'green' | 'amber' | 'violet' | 'rose';
  slots: Slot[];
};

const p = (period: number, start: string, end: string): Slot => ({
  kind: 'period',
  period,
  label: `Period ${period}`,
  start,
  end,
});

const brunch = (start: string, end: string): Slot => ({
  kind: 'brunch',
  label: 'Brunch',
  start,
  end,
});

const lunch = (start: string, end: string): Slot => ({
  kind: 'lunch',
  label: 'Lunch',
  start,
  end,
});

const flex = (label: string, start: string, end: string): Slot => ({
  kind: 'flex',
  label,
  start,
  end,
});

const rallyFlex = (label: string, start: string, end: string): Slot => ({
  kind: 'flexRally',
  label,
  start,
  end,
});

export const SCHEDULES: Record<ScheduleId, ScheduleTemplate> = {
  regular: {
    id: 'regular',
    name: 'Six Period Day',
    short: 'Six Period',
    code: '6P',
    accent: 'blue',
    slots: [
      p(1, '08:30', '09:30'),
      p(2, '09:36', '10:34'),
      brunch('10:34', '10:44'),
      p(3, '10:50', '11:48'),
      p(4, '11:54', '12:52'),
      lunch('12:52', '13:22'),
      p(5, '13:28', '14:26'),
      p(6, '14:32', '15:30'),
    ],
  },

  blockOdd: {
    id: 'blockOdd',
    name: 'Block Day — 1 / 3 / 5',
    short: 'Block 1·3·5',
    code: '1·3·5',
    accent: 'green',
    slots: [
      p(1, '08:30', '10:10'),
      brunch('10:10', '10:20'),
      flex('Flex', '10:26', '11:12'),
      p(3, '11:18', '12:58'),
      lunch('12:58', '13:28'),
      p(5, '13:34', '15:14'),
    ],
  },

  blockEven: {
    id: 'blockEven',
    name: 'Block Day — 2 / 4 / 6',
    short: 'Block 2·4·6',
    code: '2·4·6',
    accent: 'green',
    slots: [
      p(2, '08:30', '10:10'),
      brunch('10:10', '10:20'),
      flex('Flex', '10:26', '11:12'),
      p(4, '11:18', '12:58'),
      lunch('12:58', '13:28'),
      p(6, '13:34', '15:14'),
    ],
  },

  rally: {
    id: 'rally',
    name: 'Six Period Rally Day',
    short: 'Rally',
    code: '6P',
    accent: 'amber',
    slots: [
      p(1, '08:30', '09:17'),
      p(2, '09:23', '10:08'),
      brunch('10:08', '10:18'),
      p(3, '10:24', '11:09'),
      p(4, '11:15', '12:00'),
      rallyFlex('Flex / Rally A', '12:06', '12:36'),
      rallyFlex('Flex / Rally B', '12:42', '13:12'),
      lunch('13:12', '13:42'),
      p(5, '13:48', '14:33'),
      p(6, '14:39', '15:24'),
    ],
  },

  rallyBlockOdd: {
    id: 'rallyBlockOdd',
    name: 'Block Rally Day — 1 / 3 / 5',
    short: 'Rally 1·3·5',
    code: '1·3·5',
    accent: 'amber',
    slots: [
      p(1, '08:30', '10:02'),
      brunch('10:02', '10:12'),
      p(3, '10:18', '11:50'),
      rallyFlex('Rally / Flex', '11:56', '12:26'),
      rallyFlex('Flex / Rally', '12:32', '13:02'),
      lunch('13:02', '13:32'),
      p(5, '13:38', '15:10'),
    ],
  },

  rallyBlockEven: {
    id: 'rallyBlockEven',
    name: 'Block Rally Day — 2 / 4 / 6',
    short: 'Rally 2·4·6',
    code: '2·4·6',
    accent: 'amber',
    slots: [
      p(2, '08:30', '10:02'),
      brunch('10:02', '10:12'),
      p(4, '10:18', '11:50'),
      rallyFlex('Rally / Flex', '11:56', '12:26'),
      rallyFlex('Flex / Rally', '12:32', '13:02'),
      lunch('13:02', '13:32'),
      p(6, '13:38', '15:10'),
    ],
  },

  minimum: {
    id: 'minimum',
    name: 'Minimum Day',
    short: 'Minimum',
    code: '6P',
    accent: 'violet',
    slots: [
      p(1, '08:30', '09:09'),
      p(2, '09:15', '09:53'),
      p(3, '09:59', '10:37'),
      brunch('10:37', '10:47'),
      p(4, '10:53', '11:31'),
      p(5, '11:37', '12:15'),
      p(6, '12:21', '12:59'),
      lunch('12:59', '13:29'),
    ],
  },

  // Finals run late-start, two two-hour blocks a day across three days.
  // The PDF prints the blocks as "1/3/5" and "2/4/6"; spread over the three
  // finals days that means periods 1&2, then 3&4, then 5&6. Confirmed correct.
  finalsDay1: {
    id: 'finalsDay1',
    name: 'Finals — Periods 1 & 2',
    short: 'Finals 1·2',
    code: '1·2',
    accent: 'rose',
    slots: [
      p(1, '09:00', '11:00'),
      lunch('11:00', '11:30'),
      p(2, '11:36', '13:36'),
    ],
  },

  finalsDay2: {
    id: 'finalsDay2',
    name: 'Finals — Periods 3 & 4',
    short: 'Finals 3·4',
    code: '3·4',
    accent: 'rose',
    slots: [
      p(3, '09:00', '11:00'),
      lunch('11:00', '11:30'),
      p(4, '11:36', '13:36'),
    ],
  },

  finalsDay3: {
    id: 'finalsDay3',
    name: 'Finals — Periods 5 & 6',
    short: 'Finals 5·6',
    code: '5·6',
    accent: 'rose',
    slots: [
      p(5, '09:00', '11:00'),
      lunch('11:00', '11:30'),
      p(6, '11:36', '13:36'),
    ],
  },
};

/** Periods a student can have a class in. */
export const PERIODS = [1, 2, 3, 4, 5, 6] as const;
