/**
 * Home-screen install detection.
 *
 * Two very different platforms:
 *   - Android/Chrome fires `beforeinstallprompt`, which we stash and replay
 *     later from a button. It fires early — often before React mounts — so the
 *     listener is registered at module load, not in a component.
 *   - iOS Safari has no programmatic install at all. The only option is to tell
 *     the user where the button is.
 *
 * This is worth nagging about on iPhone specifically: Web Push only works there
 * once the app is on the home screen, so an un-installed iOS user silently gets
 * no alerts however many toggles they turn on.
 */

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // stop Chrome's own mini-infobar; we place it ourselves
    deferred = e as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

export function onInstallAvailabilityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Replay the stashed Chrome prompt. Returns true if they accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  listeners.forEach((fn) => fn());
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch {
    return false;
  }
}

/** Already running from the home screen? */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // Safari's own non-standard flag, still the only signal on iOS.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ claims to be a Mac; touch points give it away.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export type InstallState =
  | { kind: 'installed' }
  | { kind: 'prompt' } // Chrome/Android: we can show a real Install button
  | { kind: 'ios' } // Safari: instructions only
  | { kind: 'unavailable' }; // desktop browser, or criteria not met yet

export function installState(): InstallState {
  if (isInstalled()) return { kind: 'installed' };
  if (canPromptInstall()) return { kind: 'prompt' };
  if (isIOS()) return { kind: 'ios' };
  return { kind: 'unavailable' };
}
