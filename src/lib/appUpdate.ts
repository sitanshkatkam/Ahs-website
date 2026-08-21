/**
 * Makes new versions actually reach installed phones.
 *
 * The service worker takes over as soon as it installs (`skipWaiting` +
 * `clients.claim`), so applying an update was never the hard part — the page
 * reloads itself the moment the new worker claims it. Noticing that there *is*
 * one is the hard part. A browser only checks for a new worker on navigation,
 * and an installed PWA has no address bar and no reload button: "closing" it
 * usually just backgrounds the app, so it can sit on an old build for weeks.
 *
 * The first version of this checked on launch, on `visibilitychange`, and on a
 * slow timer. That misses the single most common case. Reopening an installed
 * PWA normally *resumes* it rather than loading it fresh — launch code doesn't
 * run again, the timer was suspended along with the rest of the page, and the
 * resume may not fire `visibilitychange` at all. So nothing checked, and the
 * only way to get a new version was to pull down and reload by hand.
 *
 * Now every resume signal triggers a check (see resume.ts), which is the same
 * fix the clock needed for the same reason.
 */

import { onResume } from './resume';

/**
 * Don't hammer `update()` if someone flicks between apps repeatedly. A check is
 * cheap — a conditional request for sw.js that answers 304 when nothing has
 * changed — so this is short enough that reopening the app almost always looks.
 */
const MIN_CHECK_INTERVAL_MS = 60 * 1000;

/** Backstop for a PWA left open on a desk all afternoon. */
const POLL_INTERVAL_MS = 15 * 60 * 1000;

let lastCheck = 0;
let reloading = false;
let started = false;
let deferredReload = false;

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

/**
 * Is the student in the middle of typing something?
 *
 * Reloading is normally free — every setting is written to localStorage the
 * moment it changes, so there is nothing unsaved to lose. Text being typed
 * right now is the exception, and onboarding is the worst case: six class names
 * and a grade live in React state until "Done" is pressed. Yanking the page out
 * from under that would look exactly like the app deleting their work, and a
 * first-run student is the one most likely to be on a stale build when an
 * update lands.
 */
export function isEditing(active: Element | null): boolean {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (active as HTMLElement).isContentEditable === true;
}

function applyUpdate(): void {
  if (reloading) return;

  // Hidden means nobody is looking, which is the best possible moment.
  if (document.visibilityState === 'visible' && isEditing(document.activeElement)) {
    deferredReload = true;
    return;
  }

  reloading = true;
  window.location.reload();
}

export function startUpdateWatcher(): void {
  if (started || !('serviceWorker' in navigator)) return;
  started = true;

  // The new worker calls skipWaiting, so it activates and claims this page as
  // soon as it installs. That fires controllerchange — at which point the code
  // running on screen is stale and the cached assets underneath it have moved.
  navigator.serviceWorker.addEventListener('controllerchange', applyUpdate);

  void checkNow(true);

  onResume(() => {
    // Anything held back becomes safe the moment the app goes away, so try
    // first and let applyUpdate decide.
    if (deferredReload) applyUpdate();

    /*
      No visibility gate here. Skipping the check while hidden looks like a
      sensible battery saving, but it isn't: these events fire around the
      moment an app is restored, and the visibility state can still read
      "hidden" while the resume is in progress — so the one check that mattered
      got dropped. A check is a conditional request that answers 304 when
      nothing changed, and the throttle above already stops it repeating.
      Several of these events fire for a single resume; that's what the
      throttle absorbs.
    */
    void checkNow();
  });

  // Whenever a field loses focus, a held-back reload becomes safe.
  window.addEventListener(
    'blur',
    () => {
      if (deferredReload) applyUpdate();
    },
    true,
  );

  window.setInterval(() => {
    if (document.visibilityState !== 'hidden') void checkNow();
  }, POLL_INTERVAL_MS);
}

/** Build stamp, so Settings can show what's actually running. */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';
