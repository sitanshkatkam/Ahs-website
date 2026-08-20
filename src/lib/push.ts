/**
 * Client half of Web Push.
 *
 * The device works out when it wants to be woken and sends only that list of
 * timestamps to the server, along with the push subscription. The server never
 * learns what any of them are for.
 *
 * Uploading is the expensive half. Every POST rewrites a single shared record
 * on the server, and the free tier allows a thousand of those a day across all
 * students — so an unconditional upload on every app open puts a ceiling of a
 * couple of hundred users on the whole school. Almost all of those uploads say
 * nothing new. `registerPush` now fingerprints what it last sent and stays
 * quiet when the answer hasn't changed.
 */

import { planNotifications } from './notifications';
import { toISODate } from './date';
import { mirrorPlan, type StoredAlert } from './idb';
import type { Settings } from './storage';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/** How far ahead to schedule. Refreshed whenever the app is opened. */
const HORIZON_DAYS = 30;
const MAX_TIMES = 400;

/**
 * Where the last successful upload's fingerprint lives.
 *
 * The suffix is a backend generation, not a schema version. Subscriptions moved
 * from a single KV blob to a row per device in D1; bumping this makes every
 * phone upload once more so none can be left believing the server already knows
 * about it when its row was never created.
 */
const SENT_KEY = 'ahs-schedule:uploaded:d1';

/**
 * Midnight, not now.
 *
 * Planning from the current moment means the list shrinks every time a bell
 * rings, so it would look different at 8:00 and 8:31 and earn an upload it
 * doesn't need — the server ignores past alarms anyway. Anchoring to the start
 * of the day makes the plan stable until either the day rolls over or the
 * student actually changes something.
 */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** FNV-1a. Not security — just a short stable stand-in for a long list. */
export function fingerprint(endpoint: string, times: number[]): string {
  let h = 0x811c9dc5;
  const input = `${endpoint}|${times.join(',')}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function lastSent(): string | null {
  try {
    return localStorage.getItem(SENT_KEY);
  } catch {
    return null;
  }
}

function rememberSent(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(SENT_KEY);
    else localStorage.setItem(SENT_KEY, value);
  } catch {
    // Private mode. Worst case we upload every time, as it used to.
  }
}

export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY);
}

function urlBase64ToArrayBuffer(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  // Freshly allocated, so this is a plain ArrayBuffer rather than a shared one.
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

/**
 * Every alert this device wants in the next month, fully composed.
 *
 * This is the single derivation of the schedule that everything else hangs
 * off: the timestamps go to the server as bare numbers, and the identical list
 * goes to IndexedDB for the service worker to read back when a poke arrives.
 * The worker used to redo this work itself, and the two answers could differ.
 */
export function plannedAlerts(settings: Settings, from = new Date()): StoredAlert[] {
  const byTime = new Map<number, StoredAlert>();
  const now = from.getTime();
  let cursor = toISODate(from);

  for (let i = 0; i < HORIZON_DAYS; i++) {
    for (const n of planNotifications(
      cursor,
      settings.notifications,
      settings.classes,
      settings.customOverrides,
      undefined,
      settings.assignments,
      settings.extraPeriods,
    )) {
      const t = n.at.getTime();
      // Keyed by time because the server is only told times: two alerts on the
      // same second would be one poke, and the worker could show the wrong one.
      if (t > now && !byTime.has(t)) {
        byTime.set(t, { id: n.id, at: t, title: n.title, body: n.body });
      }
    }
    const [y, m, d] = cursor.split('-').map(Number);
    cursor = toISODate(new Date(y, m - 1, d + 1));
  }

  return [...byTime.values()].sort((a, b) => a.at - b.at).slice(0, MAX_TIMES);
}

/** Just the timestamps, which is all the server is ever told. */
export function plannedTimes(settings: Settings, from = new Date()): number[] {
  return plannedAlerts(settings, from).map((a) => a.at);
}

function anyToggleOn(settings: Settings): boolean {
  const n = settings.notifications;
  return (
    n.classStarting.on ||
    n.tomorrowType.on ||
    n.upcomingEvents.on ||
    n.mealsAndBell.on ||
    n.assignmentsDue.on
  );
}

/**
 * Register (or refresh) background delivery. Safe to call on every app open.
 * Returns false when push isn't available or permission hasn't been granted —
 * the foreground scheduler keeps working either way.
 */
export async function registerPush(settings: Settings): Promise<boolean> {
  if (!pushConfigured()) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  try {
    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (!anyToggleOn(settings)) return false; // don't ask for a subscription nobody wants
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(VAPID_PUBLIC_KEY!),
      });
    }

    const alerts = anyToggleOn(settings) ? plannedAlerts(settings, startOfToday()) : [];

    // Always mirror, even when the upload is skipped: IndexedDB is local and
    // free, and it's what the service worker reads to build the notification.
    await mirrorPlan(alerts);

    const times = alerts.map((a) => a.at);
    const stamp = fingerprint(sub.endpoint, times);

    // The endpoint is part of the fingerprint, so a re-subscribed device always
    // uploads even if its alarms are identical.
    if (stamp === lastSent()) return true;

    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), times }),
    });

    // Only on success: a failed upload has to be retried on the next open.
    if (res.ok) rememberSent(stamp);
    return res.ok;
  } catch {
    return false;
  }
}

/** Stop background delivery and forget the subscription server-side. */
export async function unregisterPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
    await mirrorPlan([]);
    // Forget the fingerprint, or turning alerts back on would look unchanged
    // and never re-upload.
    rememberSent(null);
  } catch {
    /* best effort */
  }
}

/** Whether this device currently has a live push subscription. */
export async function pushActive(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
