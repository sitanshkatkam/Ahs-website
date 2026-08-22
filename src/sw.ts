/// <reference lib="webworker" />

/**
 * The service worker: Workbox precaching plus a push handler.
 *
 * The push itself carries no payload — the server sends a bare poke and knows
 * nothing about what it's for. Everything shown here comes from the alert list
 * the page left in IndexedDB, which is how "nothing leaves your phone" survives
 * having a backend at all.
 */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { markFired, readFired, readPlan } from './lib/idb';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// API calls must always hit the network; everything else falls back to the app
// shell so deep links work offline.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//],
  }),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * How far either side of "now" a stored alert still counts as the one this
 * poke is for. The page and the server agree on the timestamp exactly, so this
 * only has to absorb delivery lag and a phone clock that drifts from the
 * server's. One passing period is the natural limit: past that, "Period 3 in
 * 5 min" has stopped being true and is better left unsaid.
 */
const WINDOW_MS = 6 * 60 * 1000;

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush());
});

/**
 * A push that has nothing to say says nothing.
 *
 * This used to show "Checked your schedule — nothing due right now" instead,
 * on the theory that Chrome penalises a push that displays nothing. It does,
 * mildly and on a budget — but that cost lands on the app, whereas a
 * notification about the app's own bookkeeping lands on the user, at every
 * bell. The trade is only worth making for something they'd want to read.
 *
 * Both silent paths below should now be rare: the plan is written before the
 * server is ever told the times, so a poke without a matching alert means
 * either the foreground already showed it or the phone missed the window.
 */
async function handlePush(): Promise<void> {
  const plan = await readPlan();

  if (!plan || plan.length === 0) {
    // No plan on this device: the page has never registered here, or its write
    // was lost. Nothing can be composed, so ask whoever is open to re-send it.
    await requestResync();
    return;
  }

  const now = Date.now();
  const near = plan
    .filter((a) => Math.abs(a.at - now) <= WINDOW_MS)
    .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now));

  if (near.length === 0) {
    // The plan is stale relative to the alarms the server holds — which only
    // happens if a registration was interrupted midway. Rebuild it.
    await requestResync();
    return;
  }

  const fired = new Set(await readFired());
  const next = near.find((a) => !fired.has(a.id));

  // Every candidate already shown: the foreground scheduler beat us to it and
  // the dedupe is working. Staying quiet is the whole point of it.
  if (!next) return;

  await markFired(next.id);
  // `tag` collapses this with anything the foreground scheduler shows for the
  // same alert, so the two paths can't double-buzz.
  await self.registration.showNotification(next.title, {
    body: next.body,
    tag: next.id,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // Marks this as alerting rather than silent, which is part of how Android
    // decides whether a paired watch gets woken.
    vibrate: [200, 100, 200],
  } as NotificationOptions);
}

/** Ask any open tab to recompute the plan and re-upload its alarms. */
async function requestResync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'ahs:resync' });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = all.find((c) => 'focus' in c);
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow('/');
    })(),
  );
});
