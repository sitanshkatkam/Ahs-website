/**
 * Opt-in local notifications.
 *
 * `planNotifications` is pure — given a date and the user's preferences it
 * returns everything that should fire that day. The scheduler below holds a
 * single timeout for the *next* item and re-plans after each one, so there is
 * never a pile of live timers to leak.
 *
 * Delivery goes through the service worker registration rather than
 * `new Notification()`, which throws on Android Chrome.
 *
 * Honest limitation: a page-driven timer only runs while the page is alive.
 * When the phone has been locked for hours the OS may have frozen us, and the
 * alert arrives late or not at all. Real push needs a server; see the README.
 */

import type { DayOverride, SchoolEvent } from '../data/calendar';
import { EVENTS } from '../data/calendar';
import { addDays, fromISODate, minutesOf, toISODate } from './date';
import { resolveDay } from './resolveDay';
import {
  loadFiredIds,
  saveFiredIds,
  type Assignment,
  type ExtraPeriod,
  type NotificationPrefs,
  type UserClass,
} from './storage';

export type PlannedNotification = {
  /** Stable across re-plans, so an alert can't fire twice. */
  id: string;
  at: Date;
  title: string;
  body: string;
};

/** Event reminders land after school rather than mid-period. */
const EVENT_ALERT_HOUR = 17;

function atTime(dateISO: string, hhmm: string, offsetMinutes = 0): Date {
  const d = fromISODate(dateISO);
  d.setMinutes(minutesOf(hhmm) + offsetMinutes, 0, 0);
  return d;
}

function classLabel(period: number, classes: UserClass[]): string {
  const cls = classes.find((c) => c.period === period && c.name.trim());
  return cls ? cls.name.trim() : `Period ${period}`;
}

function classWhere(period: number, classes: UserClass[]): string {
  const cls = classes.find((c) => c.period === period);
  return cls?.room?.trim() ? ` · Room ${cls.room.trim()}` : '';
}

/**
 * Everything that should fire on `dateISO`.
 * Not filtered by "is it in the past" — the scheduler does that.
 */
export function planNotifications(
  dateISO: string,
  prefs: NotificationPrefs,
  classes: UserClass[],
  overrides: DayOverride[] = [],
  events: SchoolEvent[] = EVENTS,
  assignments: Assignment[] = [],
  extraPeriods: ExtraPeriod[] = [],
): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const day = resolveDay(dateISO, overrides, extraPeriods);

  if (day.isSchoolDay && day.template) {
    const slots = day.template.slots;

    if (prefs.classStarting.on) {
      for (const slot of slots) {
        if (slot.period === undefined) continue;
        // "Free period in 5 minutes" is noise, not a reminder.
        if (classes.find((c) => c.period === slot.period)?.kind === 'free') continue;
        out.push({
          id: `${dateISO}:class:${slot.period}`,
          at: atTime(dateISO, slot.start, -prefs.classStarting.minutesBefore),
          title: `${classLabel(slot.period, classes)} in ${prefs.classStarting.minutesBefore} min`,
          body: `Period ${slot.period}${classWhere(slot.period, classes)} · starts ${to12h(slot.start)}`,
        });
      }
    }

    if (prefs.mealsAndBell.on) {
      for (const slot of slots) {
        if (slot.kind === 'brunch') {
          out.push({
            id: `${dateISO}:meal:brunch`,
            at: atTime(dateISO, slot.start),
            title: 'Brunch',
            body: `Until ${to12h(slot.end)}`,
          });
        }
        if (slot.kind === 'lunch') {
          out.push({
            id: `${dateISO}:meal:lunch`,
            at: atTime(dateISO, slot.start),
            title: 'Lunch',
            body: `Until ${to12h(slot.end)}`,
          });
        }
      }
      const last = slots[slots.length - 1];
      out.push({
        id: `${dateISO}:bell:end`,
        at: atTime(dateISO, last.end),
        title: "That's the final bell",
        body: `${day.template.name} · done for the day`,
      });
    }
  }

  // Evening heads-up, but only when tomorrow is worth a heads-up: a schedule
  // that isn't the plain six-period day, or an unexpected day off.
  if (prefs.tomorrowType.on) {
    const tomorrowISO = addDays(dateISO, 1);
    const tomorrow = resolveDay(tomorrowISO, overrides, extraPeriods);
    const weekday = fromISODate(tomorrowISO).getDay();
    const isWeekday = weekday >= 1 && weekday <= 5;

    if (tomorrow.isSchoolDay && tomorrow.template && tomorrow.template.id !== 'regular') {
      const periods = tomorrow.template.slots
        .filter((s) => s.period !== undefined)
        .map((s) => s.period)
        .join(', ');
      out.push({
        id: `${dateISO}:tomorrow`,
        at: atTime(dateISO, `${String(prefs.tomorrowType.atHour).padStart(2, '0')}:00`),
        title: `Tomorrow: ${tomorrow.template.name}`,
        body: `Periods ${periods} · first bell ${to12h(tomorrow.template.slots[0].start)}`,
      });
    } else if (!tomorrow.isSchoolDay && isWeekday && !tomorrow.outOfYear) {
      out.push({
        id: `${dateISO}:tomorrow`,
        at: atTime(dateISO, `${String(prefs.tomorrowType.atHour).padStart(2, '0')}:00`),
        title: 'No school tomorrow',
        body: tomorrow.label ?? 'Enjoy it.',
      });
    }
  }

  if (prefs.assignmentsDue.on) {
    const targetDue = addDays(dateISO, prefs.assignmentsDue.daysBefore);
    const due = assignments.filter((a) => !a.done && a.due === targetDue);
    if (due.length > 0) {
      const when =
        prefs.assignmentsDue.daysBefore === 0
          ? 'today'
          : prefs.assignmentsDue.daysBefore === 1
            ? 'tomorrow'
            : `in ${prefs.assignmentsDue.daysBefore} days`;
      const at = atTime(dateISO, `${String(prefs.assignmentsDue.atHour).padStart(2, '0')}:00`);
      // One digest rather than a pile of separate buzzes.
      out.push({
        id: `${dateISO}:due:${targetDue}`,
        at,
        title:
          due.length === 1 ? `Due ${when}: ${due[0].title}` : `${due.length} things due ${when}`,
        body:
          due.length === 1
            ? classLabel(due[0].period, classes)
            : due.map((a) => a.title).join(' · '),
      });
    }
  }

  if (prefs.upcomingEvents.on) {
    const targetDate = addDays(dateISO, prefs.upcomingEvents.daysBefore);
    for (const e of events) {
      if (e.date !== targetDate) continue;
      const when =
        prefs.upcomingEvents.daysBefore === 0
          ? 'today'
          : prefs.upcomingEvents.daysBefore === 1
            ? 'tomorrow'
            : `in ${prefs.upcomingEvents.daysBefore} days`;
      out.push({
        id: `${dateISO}:event:${e.date}:${e.title}`,
        at: atTime(dateISO, `${String(EVENT_ALERT_HOUR).padStart(2, '0')}:00`),
        title: e.title,
        body: `Coming up ${when}`,
      });
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export function notificationsSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
  );
}

export function permission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

/**
 * Must be called from inside a user gesture — browsers reject the prompt
 * otherwise, and the toggle would silently do nothing.
 */
export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

async function show(title: string, body: string, tag: string): Promise<void> {
  if (permission() !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Explicitly an alerting notification. Android decides whether a paired
      // watch is worth waking partly on this; a notification that asks for no
      // vibration can be delivered silently and never reach the wrist.
      vibrate: [200, 100, 200],
    } as NotificationOptions);
  } catch {
    // Service worker not ready (dev server, private mode). Nothing to do.
  }
}

/** Trim the fired-id log to the last couple of days. */
function pruneFired(ids: string[], today: string): string[] {
  const cutoff = addDays(today, -2);
  return ids.filter((id) => id.slice(0, 10) >= cutoff);
}

export class NotificationScheduler {
  private timer: number | undefined;
  private getPlan: () => PlannedNotification[];

  constructor(getPlan: () => PlannedNotification[]) {
    this.getPlan = getPlan;
  }

  start(): void {
    this.replan();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    this.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = () => {
    if (!document.hidden) this.replan();
  };

  private clear() {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Find the next unfired notification and arm a single timeout for it.
   * Anything already past its time is dropped rather than fired late — a
   * "Period 3 in 5 minutes" alert at 2pm is worse than no alert.
   */
  replan = (): void => {
    this.clear();
    if (permission() !== 'granted') return;

    const now = Date.now();
    const fired = new Set(loadFiredIds());
    const next = this.getPlan()
      .filter((n) => !fired.has(n.id) && n.at.getTime() > now)
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0];

    if (!next) return;

    // setTimeout saturates past ~24.8 days; cap well below that and re-arm.
    const delay = Math.min(next.at.getTime() - now, 6 * 60 * 60 * 1000);

    this.timer = window.setTimeout(() => {
      if (Date.now() >= next.at.getTime() - 1000) {
        void show(next.title, next.body, next.id);
        const ids = pruneFired([...loadFiredIds(), next.id], toISODate(new Date()));
        saveFiredIds(ids);
      }
      this.replan();
    }, Math.max(0, delay));
  };
}

/** Used by the Settings debug button to prove the whole path works. */
export async function fireTestNotification(): Promise<boolean> {
  if (permission() !== 'granted') return false;
  /*
    A fresh tag every time, which matters more than it looks. A notification
    reusing an existing tag *replaces* it silently — no sound, no vibration,
    and nothing pushed to a paired watch. With a fixed tag only the first test
    ever alerted, so anyone tapping this repeatedly to debug a watch was being
    told, quite convincingly, that notifications were broken.
  */
  await show(
    'Test alert',
    'Notifications are working. This is the only one like it.',
    `test-${Date.now()}`,
  );
  return true;
}
