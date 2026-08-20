import { describe, expect, it } from 'vitest';
import { fingerprint, plannedAlerts, plannedTimes, startOfToday } from './push';
import { DEFAULT_SETTINGS, type Settings } from './storage';

/**
 * The hourly "checked your schedule — nothing due right now" notification came
 * from the page and the service worker each deriving the day's alerts on their
 * own and disagreeing. The page now derives them once and hands the list over,
 * so what matters is that the list the server is told about and the list the
 * worker reads are the same list.
 */

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  notifications: {
    ...DEFAULT_SETTINGS.notifications,
    classStarting: { on: true, minutesBefore: 5 },
    mealsAndBell: { on: true },
    tomorrowType: { on: true, atHour: 20 },
  },
};

// A Wednesday in the school year.
const FROM = new Date('2026-08-19T15:17:48-07:00');

describe('plannedAlerts', () => {
  it('is exactly what the server gets told', () => {
    const alerts = plannedAlerts(settings, FROM);
    expect(plannedTimes(settings, FROM)).toEqual(alerts.map((a) => a.at));
  });

  it('gives the worker something to show for every alarm the server holds', () => {
    // The precise failure being guarded against: a poke lands and the worker
    // finds no alert within its window, so it shows the placeholder.
    const alerts = plannedAlerts(settings, FROM);
    const WINDOW_MS = 6 * 60 * 1000;

    for (const at of plannedTimes(settings, FROM)) {
      const near = alerts.filter((a) => Math.abs(a.at - at) <= WINDOW_MS);
      expect(near.length, `no alert for the poke at ${new Date(at).toISOString()}`)
        .toBeGreaterThan(0);
      expect(near[0].title).toBeTruthy();
      expect(near[0].id).toBeTruthy();
    }
  });

  it('carries a real title and body, not a placeholder', () => {
    const [first] = plannedAlerts(settings, FROM);
    expect(first.title).toMatch(/Period|Brunch|Lunch|Tomorrow|school/i);
    expect(first.title).not.toMatch(/checked your schedule/i);
  });

  it('never lets two alerts share a timestamp', () => {
    // The server is told times, not ids. Two alerts on the same second would
    // arrive as one poke and the worker would have to guess between them.
    const times = plannedAlerts(settings, FROM).map((a) => a.at);
    expect(new Set(times).size).toBe(times.length);
  });

  it('is sorted and strictly in the future', () => {
    const alerts = plannedAlerts(settings, FROM);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) expect(a.at).toBeGreaterThan(FROM.getTime());
    expect([...alerts].sort((x, y) => x.at - y.at)).toEqual(alerts);
  });

  it('plans nothing when every toggle is off', () => {
    expect(plannedAlerts(DEFAULT_SETTINGS, FROM)).toEqual([]);
  });
});

/**
 * Every upload rewrites one shared record on the server, and the free tier
 * allows a thousand of those a day for the whole school. So the question these
 * cover isn't "is the plan right" — it's "does opening the app produce a write
 * when nothing has actually changed".
 */
describe('upload fingerprint', () => {
  const midnight = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

  it('planning from midnight is stable all day', () => {
    // The point of anchoring to midnight. Planning from the current moment
    // drops each alarm as it passes, so the list differs at 8:00 and 8:31 and
    // earns an upload the server has no use for.
    const at8 = new Date('2026-08-20T08:00:00');
    const at3 = new Date('2026-08-20T15:00:00');

    expect(plannedTimes(settings, at8)).not.toEqual(plannedTimes(settings, at3));

    const a = plannedTimes(settings, midnight('2026-08-20'));
    const b = plannedTimes(settings, midnight('2026-08-20'));
    expect(a).toEqual(b);
    expect(fingerprint(ENDPOINT, a)).toBe(fingerprint(ENDPOINT, b));
  });

  it('says nothing new when nothing changed', () => {
    const day = midnight('2026-08-20');
    const first = fingerprint(ENDPOINT, plannedTimes(settings, day));
    const reopened = fingerprint(ENDPOINT, plannedTimes(settings, day));
    expect(reopened).toBe(first);
  });

  it('changes when the day rolls over', () => {
    // One upload a day per device is the intended floor: the 30-day horizon
    // has moved and the server needs the new tail.
    const a = fingerprint(ENDPOINT, plannedTimes(settings, midnight('2026-08-20')));
    const b = fingerprint(ENDPOINT, plannedTimes(settings, midnight('2026-08-21')));
    expect(a).not.toBe(b);
  });

  it('changes when a toggle changes', () => {
    const day = midnight('2026-08-20');
    const quieter: Settings = {
      ...settings,
      notifications: { ...settings.notifications, mealsAndBell: { on: false } },
    };
    expect(fingerprint(ENDPOINT, plannedTimes(quieter, day)))
      .not.toBe(fingerprint(ENDPOINT, plannedTimes(settings, day)));
  });

  it('changes when the device re-subscribes with identical alarms', () => {
    const times = plannedTimes(settings, midnight('2026-08-20'));
    expect(fingerprint('https://fcm.googleapis.com/fcm/send/zzz', times))
      .not.toBe(fingerprint(ENDPOINT, times));
  });

  it('notices a single moved alarm anywhere in the list', () => {
    const times = plannedTimes(settings, midnight('2026-08-20'));
    expect(times.length).toBeGreaterThan(50);
    const middle = [...times];
    middle[Math.floor(middle.length / 2)] += 60_000;
    expect(fingerprint(ENDPOINT, middle)).not.toBe(fingerprint(ENDPOINT, times));
  });

  it('anchors to the start of the current day', () => {
    const d = startOfToday();
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(new Date().getDate());
  });
});
