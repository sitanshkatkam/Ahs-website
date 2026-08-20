import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIDDEN_INTERVAL_MS, RESUME_EVENTS, startClock, type ClockHost } from './useNow';

/**
 * These all describe the same bug from different angles: the countdown on the
 * Today screen would freeze until the app was manually reloaded. The cause was
 * a clock that stopped itself when the page went hidden and relied on a single
 * event to start again. So the thing worth testing isn't "does it tick" — it's
 * "can any sequence of missing or wrong events leave it stopped".
 */

function makeHost() {
  const listeners = new Map<string, Set<() => void>>();
  let hidden = false;

  const host: ClockHost = {
    isHidden: () => hidden,
    on: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    off: (type, fn) => listeners.get(type)?.delete(fn),
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now(),
  };

  return {
    host,
    /** Change visibility *without* firing anything — the failure mode. */
    setHidden: (v: boolean) => { hidden = v; },
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe('startClock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('ticks about once a second while visible', () => {
    const tick = vi.fn();
    const stop = startClock(tick, makeHost().host);
    vi.advanceTimersByTime(5000);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(6);
    stop();
  });

  it('does not re-render while hidden', () => {
    const tick = vi.fn();
    const h = makeHost();
    const stop = startClock(tick, h.host);
    h.setHidden(true);
    h.fire('visibilitychange');
    tick.mockClear();
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS * 2);
    expect(tick).not.toHaveBeenCalled();
    stop();
  });

  it('recovers when the app comes back and NO event fires at all', () => {
    // The regression. Previously the clock was stopped and nothing restarted
    // it, so the countdown sat frozen until the user pulled to reload.
    const tick = vi.fn();
    const h = makeHost();
    const stop = startClock(tick, h.host);

    h.setHidden(true);
    h.fire('visibilitychange');
    vi.advanceTimersByTime(60_000);

    h.setHidden(false); // resumed silently
    tick.mockClear();
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS + 1500);

    expect(tick).toHaveBeenCalled();
    stop();
  });

  it('recovers instantly on any one resume event, in isolation', () => {
    for (const event of RESUME_EVENTS) {
      const tick = vi.fn();
      const h = makeHost();
      const stop = startClock(tick, h.host);

      h.setHidden(true);
      h.fire('visibilitychange');
      vi.advanceTimersByTime(60_000);

      h.setHidden(false);
      tick.mockClear();
      h.fire(event);

      expect(tick, `${event} should resync immediately`).toHaveBeenCalledTimes(1);
      stop();
    }
  });

  it('survives a spurious hidden event fired while actually visible', () => {
    // Reported on iOS during app switching: visibilitychange arrives but the
    // page is on screen. Trusting the event would stop the clock for good.
    const tick = vi.fn();
    const h = makeHost();
    const stop = startClock(tick, h.host);

    h.fire('visibilitychange'); // never actually went hidden
    tick.mockClear();
    vi.advanceTimersByTime(3000);

    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });

  it('keeps exactly one pending timer, so resume storms cannot pile up', () => {
    const tick = vi.fn();
    const h = makeHost();
    const stop = startClock(tick, h.host);

    for (let i = 0; i < 20; i++) h.fire('focus');
    tick.mockClear();
    vi.advanceTimersByTime(1000);

    // One armed timer, not twenty.
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops cleanly and unregisters every listener', () => {
    const tick = vi.fn();
    const h = makeHost();
    const stop = startClock(tick, h.host);
    expect(h.listenerCount()).toBe(RESUME_EVENTS.length);

    stop();
    h.fire('focus');
    vi.advanceTimersByTime(10_000);

    expect(tick).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(0);
  });
});
