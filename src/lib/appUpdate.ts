/**
 * Makes new versions actually reach installed phones.
 *
 * The service worker was already set up to take over as soon as it installs
 * (`skipWaiting` + `clients.claim`), but nothing ever asked the browser to look
 * for a new one. A browser only checks on navigation, and an installed PWA has
 * no address bar and no reload button — "closing" it usually just backgrounds
 * the app, so it can sit on an old build indefinitely.
 *
 * So: check on launch, check whenever the app comes back to the foreground,
 * check on a slow timer, and reload once the new worker takes control.
 */

/** Don't hammer `update()` if someone flicks between apps repeatedly. */
const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 60 * 1000;

let lastCheck = 0;
let reloading = false;
let started = false;

async function checkNow(force = false): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const now = Date.now();
  if (!force && now - lastCheck < MIN_CHECK_INTERVAL_MS) return;
  lastCheck = now;

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.update();
  } catch {
    // Offline, or the worker is gone. Nothing to do; we'll try again later.
  }
}

/** Ask the browser to look for a new build right now. */
export function checkForUpdate(): Promise<void> {
  return checkNow(true);
}

export function startUpdateWatcher(): void {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;

  // The new worker calls skipWaiting, so it activates and claims this page as
  // soon as it installs. That fires controllerchange — at which point the code
  // running on screen is stale and the cached assets underneath it have moved.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // Safe to reload without warning: every setting is written to localStorage
    // the moment it changes, so there's nothing unsaved to lose.
    window.location.reload();
  });

  void checkNow(true);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void checkNow();
  });

  // Covers a PWA that's left open on screen for hours.
  window.setInterval(() => {
    if (!document.hidden) void checkNow();
  }, POLL_INTERVAL_MS);
}

/** Build stamp, so Settings can show what's actually running. */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';
