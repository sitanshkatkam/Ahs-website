/**
 * All user state lives in localStorage. No account, no server, no sync.
 *
 * The stored blob carries a schema version so a future release can migrate
 * someone's classes forward instead of silently wiping them.
 */

import type { DayOverride, EventCategory } from '../data/calendar';

/** Course level, which is what drives the weighted-GPA bonus. */
export type CourseLevel = 'regular' | 'honors' | 'ap';

/**
 * Not every period is a graded class. A blank name used to fall back to
 * "Period 4", which is wrong for someone who simply has that period free.
 */
export type PeriodKind = 'class' | 'free' | 'ta';

export const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  class: 'Class',
  free: 'Free',
  ta: 'TA / Aide',
};

/** Free periods and TA slots don't earn a grade. */
export function isGraded(kind: PeriodKind | undefined): boolean {
  return (kind ?? 'class') === 'class';
}

export type UserClass = {
  period: number;
  name: string;
  teacher?: string;
  room?: string;
  level?: CourseLevel;
  kind?: PeriodKind;
};

/**
 * Zero period and 7th period sit outside the published bell schedule, so their
 * times aren't in the district PDF and can't be inferred — the student enters
 * their own. This also makes the app usable by anyone whose day doesn't look
 * like a standard six-period one.
 */
export type ExtraPeriod = {
  /** 0 or 7. */
  period: number;
  enabled: boolean;
  start: string;
  end: string;
};

export const DEFAULT_EXTRA_PERIODS: ExtraPeriod[] = [
  { period: 0, enabled: false, start: '07:30', end: '08:25' },
  { period: 7, enabled: false, start: '15:36', end: '16:31' },
];

export type AssignmentType = 'homework' | 'test' | 'project';

export type Assignment = {
  id: string;
  /** Which class it belongs to. */
  period: number;
  title: string;
  /** "YYYY-MM-DD" */
  due: string;
  type: AssignmentType;
  done: boolean;
};

export type Semester = 's1' | 's2';

/** One letter grade for one class in one semester. */
export type GradeEntry = {
  period: number;
  semester: Semester;
  letter: string;
};

/** School year a student is in. Drives the college checklist and deadlines. */
export type GradeLevel = 9 | 10 | 11 | 12;

export const GRADES: GradeLevel[] = [9, 10, 11, 12];

export type NotificationPrefs = {
  classStarting: { on: boolean; minutesBefore: number };
  tomorrowType: { on: boolean; atHour: number };
  upcomingEvents: { on: boolean; daysBefore: number };
  mealsAndBell: { on: boolean };
  assignmentsDue: { on: boolean; daysBefore: number; atHour: number };
};

export type Settings = {
  version: number;
  classes: UserClass[];
  theme: 'system' | 'light' | 'dark';
  onboarded: boolean;
  notifications: NotificationPrefs;
  customOverrides: DayOverride[];
  /** Categories excluded from the Coming Up feed. */
  hiddenEventCategories: EventCategory[];

  // --- v2 ---
  assignments: Assignment[];
  grades: GradeEntry[];
  /** Asked during onboarding; switchable in Settings. */
  gradeLevel?: GradeLevel;
  /** Whether the home-screen banner has been waved away. */
  installDismissed: boolean;
  /** The feature tour runs once, then only on request. */
  tourSeen: boolean;
  /** Zero / seventh period, with times the student supplies. */
  extraPeriods: ExtraPeriod[];
  /**
   * Extra grade points for an honors course. Schools differ — AHS students
   * should check their own transcript. AP is always +1.
   */
  honorsBonus: 0.5 | 1;
};

export const SCHEMA_VERSION = 5;

const KEY = 'ahs-schedule:settings';

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  classStarting: { on: false, minutesBefore: 5 },
  tomorrowType: { on: false, atHour: 20 },
  upcomingEvents: { on: false, daysBefore: 1 },
  mealsAndBell: { on: false },
  assignmentsDue: { on: false, daysBefore: 1, atHour: 18 },
};

export const DEFAULT_SETTINGS: Settings = {
  version: SCHEMA_VERSION,
  // Entries exist for 0 and 7 too, so enabling an extra period keeps whatever
  // was typed into it before. The UI only renders the active ones.
  classes: [0, 1, 2, 3, 4, 5, 6, 7].map((period) => ({ period, name: '' })),
  theme: 'system',
  onboarded: false,
  notifications: DEFAULT_NOTIFICATIONS,
  customOverrides: [],
  hiddenEventCategories: [],
  assignments: [],
  grades: [],
  honorsBonus: 1,
  installDismissed: false,
  tourSeen: false,
  extraPeriods: DEFAULT_EXTRA_PERIODS,
};

/** Periods the student actually has: the core six, plus any enabled extras. */
export function activePeriods(settings: Settings): number[] {
  const extras = settings.extraPeriods.filter((e) => e.enabled).map((e) => e.period);
  return [...extras, 1, 2, 3, 4, 5, 6].sort((a, b) => a - b);
}

export function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return migrate(parsed);
  } catch {
    // A corrupt blob shouldn't brick the app on launch.
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / quota. Nothing useful to do, and losing a preference
    // shouldn't throw in the middle of a render.
  }
}

/** Fill in anything a older/partial blob is missing. */
function migrate(parsed: Partial<Settings>): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const classes = Array.isArray(parsed.classes) ? parsed.classes : base.classes;

  return {
    version: SCHEMA_VERSION,
    // Guarantee exactly one entry per period, in order.
    classes: base.classes.map(
      (fallback) => classes.find((c) => c?.period === fallback.period) ?? fallback,
    ),
    theme: parsed.theme ?? base.theme,
    onboarded: parsed.onboarded ?? base.onboarded,
    notifications: {
      classStarting: {
        ...base.notifications.classStarting,
        ...parsed.notifications?.classStarting,
      },
      tomorrowType: { ...base.notifications.tomorrowType, ...parsed.notifications?.tomorrowType },
      upcomingEvents: {
        ...base.notifications.upcomingEvents,
        ...parsed.notifications?.upcomingEvents,
      },
      mealsAndBell: { ...base.notifications.mealsAndBell, ...parsed.notifications?.mealsAndBell },
      assignmentsDue: {
        ...base.notifications.assignmentsDue,
        ...parsed.notifications?.assignmentsDue,
      },
    },
    customOverrides: Array.isArray(parsed.customOverrides) ? parsed.customOverrides : [],
    hiddenEventCategories: Array.isArray(parsed.hiddenEventCategories)
      ? parsed.hiddenEventCategories
      : [],
    assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    grades: Array.isArray(parsed.grades) ? parsed.grades : [],
    gradeLevel: parsed.gradeLevel,
    honorsBonus: parsed.honorsBonus === 0.5 ? 0.5 : 1,
    installDismissed: parsed.installDismissed ?? false,
    // Defaults false, so people already using the app see the tour once too.
    tourSeen: parsed.tourSeen ?? false,
    // Keep one entry per known extra period, preserving anything already set.
    extraPeriods: DEFAULT_EXTRA_PERIODS.map(
      (d) => parsed.extraPeriods?.find((e) => e?.period === d.period) ?? d,
    ),
  };
}

/** Ids only need to be unique on one device. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Fired-notification ids, so a reload or a second tab can't double-fire. */
const FIRED_KEY = 'ahs-schedule:fired';

export function loadFiredIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function saveFiredIds(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}
