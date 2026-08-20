/**
 * The single source of truth for "what does this day look like".
 *
 * Every screen goes through `resolveDay`. Precedence, highest first:
 *   1. user overrides (added in Settings)
 *   2. bundled DAY_OVERRIDES
 *   3. WEEKDAY_DEFAULT
 * and anything outside the school year is simply not a school day.
 */

import {
  DAY_OVERRIDES,
  EVENTS,
  SCHOOL_YEAR,
  WEEKDAY_DEFAULT,
  type DayOverride,
  type EventCategory,
  type SchoolEvent,
} from '../data/calendar';
import { SYNCED, type SyncedData } from '../data/synced';
import { SCHEDULES, type ScheduleTemplate, type Slot } from '../data/schedules';
import type { ExtraPeriod, UserClass } from './storage';
import { fromISODate, isoRange, minutesOf, minutesOfDate } from './date';

export type DayInfo = {
  date: string;
  template: ScheduleTemplate | null;
  isSchoolDay: boolean;
  /** "Fall Recess", "First days of school", … when the source names the day. */
  label?: string;
  /** Set when the day falls outside the published school year. */
  outOfYear: boolean;
  events: SchoolEvent[];
};

const bundledByDate = new Map<string, DayOverride>();
for (const o of DAY_OVERRIDES) bundledByDate.set(o.date, o);

/** "First Day of School" and "First day of school" are the same event. */
const normaliseTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The school's calendar, either the copy bundled at build time or a fresher one
 * fetched from the Worker at runtime. Swapping it rebuilds the derived lookups
 * below, so every screen picks up new events without a redeploy.
 */
let feed: SyncedData = SYNCED;

let syncedByDate = new Map<string, string>();
let eventsByDate = new Map<string, SchoolEvent[]>();
let allEvents: SchoolEvent[] = [];

function rebuild(): void {
  // Schedule days from the feed are used only where the verified calendar is
  // silent — it has been wrong before, so it never wins a conflict.
  syncedByDate = new Map(feed.scheduleOverrides.map((o) => [o.date, o.scheduleId]));

  // Curated events plus synced ones, with near-duplicates dropped. The curated
  // entry wins, since it carries the wording and category we chose.
  const merged = [...EVENTS];
  for (const s of feed.events) {
    const key = normaliseTitle(s.title);
    const dupe = merged.some((e) => {
      if (e.date !== s.date) return false;
      const k = normaliseTitle(e.title);
      return k === key || k.includes(key) || key.includes(k);
    });
    if (!dupe) merged.push(s);
  }
  allEvents = merged.sort(
    (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
  );

  eventsByDate = new Map();
  for (const e of allEvents) {
    for (const d of isoRange(e.date, e.endDate ?? e.date)) {
      const list = eventsByDate.get(d);
      if (list) list.push(e);
      else eventsByDate.set(d, [e]);
    }
  }
}

rebuild();

/**
 * Swap in a feed fetched from the Worker. Ignores anything that doesn't look
 * like a feed, so a bad response can't wipe the calendar.
 */
export function setLiveFeed(next: SyncedData | null | undefined): boolean {
  if (!next || !Array.isArray(next.events) || !Array.isArray(next.scheduleOverrides)) {
    return false;
  }
  feed = next;
  rebuild();
  return true;
}

export function currentFeed(): SyncedData {
  return feed;
}

export function getAllEvents(): SchoolEvent[] {
  return allEvents;
}

/**
 * Splice the student's own zero/seventh period into a bell schedule.
 *
 * Their times aren't in the district PDF, so they come from Settings. Slots are
 * re-sorted rather than just appended, which keeps a zero period ahead of first
 * period and leaves `getSlotState` free to assume chronological order.
 */
export function withExtraPeriods(
  template: ScheduleTemplate,
  extras: ExtraPeriod[],
): ScheduleTemplate {
  const enabled = extras.filter((e) => e.enabled && e.start < e.end);
  if (enabled.length === 0) return template;

  const added: Slot[] = enabled.map((e) => ({
    kind: 'period',
    period: e.period,
    label: `Period ${e.period}`,
    start: e.start,
    end: e.end,
  }));

  const slots = [...template.slots, ...added].sort((a, b) => a.start.localeCompare(b.start));
  return { ...template, slots };
}

export function resolveDay(
  date: string,
  userOverrides: DayOverride[] = [],
  extraPeriods: ExtraPeriod[] = [],
): DayInfo {
  const events = eventsByDate.get(date) ?? [];
  const outOfYear = date < SCHOOL_YEAR.firstDay || date > SCHOOL_YEAR.lastDay;

  if (outOfYear) {
    return { date, template: null, isSchoolDay: false, outOfYear: true, events };
  }

  const override = userOverrides.find((o) => o.date === date) ?? bundledByDate.get(date);

  if (override?.noSchool) {
    return {
      date,
      template: null,
      isSchoolDay: false,
      label: override.label,
      outOfYear: false,
      events,
    };
  }

  // user override > verified calendar > school feed > weekly rotation
  const scheduleId =
    override?.scheduleId ??
    (syncedByDate.get(date) as ScheduleTemplate['id'] | undefined) ??
    WEEKDAY_DEFAULT[fromISODate(date).getDay()] ??
    null;

  if (!scheduleId) {
    return { date, template: null, isSchoolDay: false, outOfYear: false, events };
  }

  return {
    date,
    template: withExtraPeriods(SCHEDULES[scheduleId], extraPeriods),
    isSchoolDay: true,
    label: override?.label,
    outOfYear: false,
    events,
  };
}

export type Phase = 'before' | 'in' | 'passing' | 'after';

export type SlotState = {
  phase: Phase;
  /** The slot happening right now. Null during passing periods and off-hours. */
  current: Slot | null;
  /** The next slot today. Null once the day is over. */
  next: Slot | null;
  /** Seconds until `current` ends, or until `next` starts when between slots. */
  secondsRemaining: number;
  /** 0-1 through the current slot (or through the current passing period). */
  progress: number;
};

/**
 * Where we are in the day. `now` is a Date so callers can pass a fake clock.
 *
 * The gap between two slots is a real state ('passing'), not a hole — showing
 * "Passing → Period 3" beats showing nothing for six minutes eight times a day.
 */
export function getSlotState(template: ScheduleTemplate, now: Date): SlotState {
  const mins = minutesOfDate(now);
  const slots = template.slots;
  const first = slots[0];
  const last = slots[slots.length - 1];

  if (mins < minutesOf(first.start)) {
    return {
      phase: 'before',
      current: null,
      next: first,
      secondsRemaining: (minutesOf(first.start) - mins) * 60,
      progress: 0,
    };
  }

  if (mins >= minutesOf(last.end)) {
    return { phase: 'after', current: null, next: null, secondsRemaining: 0, progress: 1 };
  }

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const start = minutesOf(slot.start);
    const end = minutesOf(slot.end);

    if (mins >= start && mins < end) {
      return {
        phase: 'in',
        current: slot,
        next: slots[i + 1] ?? null,
        secondsRemaining: (end - mins) * 60,
        progress: (mins - start) / (end - start),
      };
    }

    // In the gap between this slot and the next one.
    const next = slots[i + 1];
    if (next && mins >= end && mins < minutesOf(next.start)) {
      const gapStart = end;
      const gapEnd = minutesOf(next.start);
      return {
        phase: 'passing',
        current: null,
        next,
        secondsRemaining: (gapEnd - mins) * 60,
        progress: (mins - gapStart) / (gapEnd - gapStart),
      };
    }
  }

  return { phase: 'after', current: null, next: null, secondsRemaining: 0, progress: 1 };
}

/**
 * The user's class name for a slot.
 *
 * A blank name used to fall back to "Period 4" unconditionally, which reads as
 * a missing entry rather than a deliberate gap. If the period is marked free or
 * TA, say that instead.
 */
export function slotTitle(slot: Slot, classes: UserClass[]): string {
  if (slot.period === undefined) return slot.label;

  const cls = classes.find((c) => c.period === slot.period);
  const kind = cls?.kind ?? 'class';

  if (cls?.name.trim()) return cls.name.trim();
  if (kind === 'free') return 'Free period';
  if (kind === 'ta') return 'TA / Aide';
  return slot.label;
}

/** Free periods are places to *be*, not classes to be reminded about. */
export function isFreeSlot(slot: Slot, classes: UserClass[]): boolean {
  if (slot.period === undefined) return false;
  return classes.find((c) => c.period === slot.period)?.kind === 'free';
}

/** The configured class for a slot, if the user has entered one. */
export function slotClass(slot: Slot, classes: UserClass[]): UserClass | undefined {
  if (slot.period === undefined) return undefined;
  return classes.find((c) => c.period === slot.period && c.name.trim());
}

/** The next `count` school days at or after `from`, skipping non-school days. */
export function upcomingSchoolDays(
  from: string,
  count: number,
  userOverrides: DayOverride[] = [],
  extraPeriods: ExtraPeriod[] = [],
): DayInfo[] {
  const out: DayInfo[] = [];
  let cursor = from;
  // 60 is a comfortable ceiling: the longest break in the year is 15 days.
  for (let i = 0; i < 60 && out.length < count; i++) {
    // extraPeriods has to be threaded through: the Today screen previews the
    // next school day's actual slot list, and without it someone with a zero
    // period would be shown a day that starts an hour later than theirs does.
    const info = resolveDay(cursor, userOverrides, extraPeriods);
    if (info.isSchoolDay) out.push(info);
    cursor = nextDate(cursor);
  }
  return out;
}

function nextDate(iso: string): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Upcoming events at or after `from`, soonest first. */
export function upcomingEvents(
  from: string,
  limit: number,
  hiddenCategories: EventCategory[] = [],
): SchoolEvent[] {
  return allEvents.filter(
    (e) => (e.endDate ?? e.date) >= from && !hiddenCategories.includes(e.category),
  )
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}
