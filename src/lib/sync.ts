import type { Settings } from './storage';

/**
 * Carrying a schedule between devices.
 *
 * The point of signing in: set your classes up once, then sign in on a new
 * phone and they are already there. Nothing else about the account does
 * anything, and nothing else is synced.
 *
 * What is deliberately left behind is as important as what travels. Grades and
 * assignments stay on the device that made them — they are the sensitive half,
 * nobody needs them in two places, and keeping them local is what lets the
 * privacy page go on saying they never leave your phone. Notification
 * preferences and theme stay local too, for a plainer reason: you want alerts
 * on your phone and not on a school Chromebook.
 */

/** The fields that travel. Everything not listed here is device-local. */
const SYNCED_KEYS = ['classes', 'gradeLevel', 'extraPeriods', 'customOverrides'] as const;

export type SyncedSchedule = Pick<Settings, (typeof SYNCED_KEYS)[number]>;

/** When this device last changed something that syncs. */
const STAMP_KEY = 'ahs-schedule:schedule-updated';

/** Debounce, so typing six class names is one upload rather than sixty. */
const PUSH_DELAY_MS = 2000;

let pushTimer: number | undefined;
let pending: Settings | null = null;

export function pickSynced(settings: Settings): SyncedSchedule {
  return {
    classes: settings.classes,
    gradeLevel: settings.gradeLevel,
    extraPeriods: settings.extraPeriods,
    customOverrides: settings.customOverrides,
  };
}

/** Did an edit touch anything that syncs? Avoids uploading a theme change. */
export function touchesSchedule(patch: Partial<Settings>): boolean {
  return SYNCED_KEYS.some((key) => key in patch);
}

export function localStamp(): number {
  try {
    return Number(localStorage.getItem(STAMP_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function markChanged(at = Date.now()): void {
  try {
    localStorage.setItem(STAMP_KEY, String(at));
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ */

async function put(settings: Settings): Promise<void> {
  try {
    await fetch('/api/sync', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: JSON.stringify(pickSynced(settings)), updated: localStamp() }),
    });
  } catch {
    // Offline, or signed out. The next change re-sends the whole schedule, so
    // a failed upload costs nothing beyond staying behind for a while.
  }
}

/** Upload soon. Repeated calls collapse into one. */
export function queuePush(settings: Settings): void {
  pending = settings;
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    const s = pending;
    pending = null;
    if (s) void put(s);
  }, PUSH_DELAY_MS);
}

/**
 * Send anything still waiting, right now. Called when the app goes away: a
 * student who edits a class and immediately switches apps would otherwise lose
 * the upload to the debounce.
 */
export function flushPush(): void {
  if (!pending) return;
  const s = pending;
  pending = null;
  window.clearTimeout(pushTimer);
  void put(s);
}

export type PullResult =
  | { kind: 'signed-out' }
  | { kind: 'nothing-stored' }
  | { kind: 'server-newer'; schedule: SyncedSchedule; updated: number }
  | { kind: 'local-newer' };

/**
 * Ask what the server has and decide who wins.
 *
 * Last-write-wins on the whole schedule. Two devices editing the same schedule
 * within the same minute is rare enough — a schedule is set once a semester —
 * that merging field by field would be a lot of machinery guarding against
 * something that barely happens. The trade is real though: if it does happen,
 * the older edit is silently dropped.
 */
export async function pullSchedule(): Promise<PullResult> {
  let res: Response;
  try {
    res = await fetch('/api/sync', { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return { kind: 'signed-out' };
  }

  if (!res.ok) return { kind: 'signed-out' };

  let body: { data?: string | null; updated?: number };
  try {
    body = await res.json();
  } catch {
    return { kind: 'signed-out' };
  }

  if (!body.data) return { kind: 'nothing-stored' };

  const serverStamp = body.updated ?? 0;
  if (serverStamp <= localStamp()) return { kind: 'local-newer' };

  try {
    const schedule = JSON.parse(body.data) as SyncedSchedule;
    // Trust the shape only as far as the one field everything else reads.
    if (!Array.isArray(schedule.classes)) return { kind: 'local-newer' };
    return { kind: 'server-newer', schedule, updated: serverStamp };
  } catch {
    return { kind: 'local-newer' };
  }
}
