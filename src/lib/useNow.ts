import { useEffect, useState } from 'react';
import { RESUME_EVENTS } from './resume';

/**
 * A ticking clock that cannot get stuck.
 *
 * The original version stopped its interval whenever the page went hidden and
 * only restarted it on the next `visibilitychange`. That deadlocks: if the
 * resume signal never arrives — a bfcache restore, an installed PWA waking from
 * suspension, or a spurious `hidden` fired while the app is actually on screen
 * — the timer is dead and the countdown freezes until a manual reload. Which is
 * exactly the "pull down to reload and it works again" symptom.
 *
 * Two things make that impossible now:
 *
 *   1. The chain never stops. A hidden page re-arms slowly and skips the
 *      re-render, which costs far less than a React render per second and, more
 *      to the point, leaves nothing that needs restarting. Even if every event
 *      below is missed, the clock heals itself within one slow tick.
 *   2. Every plausible resume signal resyncs immediately, and each one reads the
 *      real visibility state rather than trusting the event that woke it.
 *
 * The scheduling lives in `startClock` rather than inline in the hook so it can
 * be tested without a DOM — see useNow.test.ts.
 */

/** Backgrounded: stay alive, but cheaply. Also the worst-case heal time. */
export const HIDDEN_INTERVAL_MS = 15_000;

// Shared with the update watcher, which needs exactly the same signals for
// exactly the same reason. See resume.ts.
export { RESUME_EVENTS };

export type ClockHost = {
  isHidden: () => boolean;
  on: (type: string, fn: () => void) => void;
  off: (type: string, fn: () => void) => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  now: () => number;
};

/**
 * Calls `onTick` about once a second while visible. Returns a stop function.
 */
export function startClock(onTick: () => void, host: ClockHost): () => void {
  let timer: number | undefined;
  let stopped = false;

  /** Align to the second boundary so the countdown changes when it should. */
  const untilNextSecond = () => 1000 - (host.now() % 1000);

  const schedule = () => {
    if (stopped) return;
    if (timer !== undefined) host.clearTimeout(timer);
    timer = host.setTimeout(tick, host.isHidden() ? HIDDEN_INTERVAL_MS : untilNextSecond());
  };

  const tick = () => {
    timer = undefined;
    // Re-read visibility here instead of trusting whatever armed us: events get
    // missed, and some arrive with a state that's already out of date.
    if (!host.isHidden()) onTick();
    schedule();
  };

  const resync = () => {
    if (stopped) return;
    if (!host.isHidden()) onTick();
    schedule();
  };

  for (const e of RESUME_EVENTS) host.on(e, resync);
  schedule();

  return () => {
    stopped = true;
    if (timer !== undefined) host.clearTimeout(timer);
    for (const e of RESUME_EVENTS) host.off(e, resync);
  };
}

/**
 * Dev-only clock override, so a block day at 11:40am can be inspected without
 * waiting for one: `?at=2026-09-15T11:40`. Stripped from production builds.
 */
function devClock(): Date | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const at = new URLSearchParams(window.location.search).get('at');
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** visibilitychange is dispatched on the document; the rest land on window. */
const targetFor = (type: string): EventTarget =>
  type === 'visibilitychange' ? document : window;

export function useNow(): Date {
  const [now, setNow] = useState(() => devClock() ?? new Date());

  useEffect(() => {
    if (devClock()) return;

    return startClock(() => setNow(new Date()), {
      isHidden: () => document.visibilityState === 'hidden',
      on: (type, fn) => targetFor(type).addEventListener(type, fn),
      off: (type, fn) => targetFor(type).removeEventListener(type, fn),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      now: () => Date.now(),
    });
  }, []);

  return now;
}
