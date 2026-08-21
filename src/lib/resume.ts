/**
 * "The app is in front of the user again."
 *
 * Harder to detect than it sounds, and two separate features were each getting
 * it wrong in the same way. `visibilitychange` alone is not enough: an
 * installed PWA restored from the back/forward cache or woken from a frozen
 * state may not fire it, and iOS has been seen firing it with a stale state
 * during app switching. Anything that only listens for that one event can sit
 * there believing the app is still in the background.
 *
 * These overlap heavily on purpose. Handlers must be idempotent — several of
 * them can fire for a single resume — and must read the real visibility state
 * rather than trusting whichever event woke them.
 */
export const RESUME_EVENTS = ['visibilitychange', 'pageshow', 'focus', 'resume', 'online'];

/** visibilitychange is dispatched on the document; the rest land on window. */
const targetFor = (type: string): EventTarget =>
  type === 'visibilitychange' ? document : window;

/** Subscribe to every resume signal. Returns an unsubscribe function. */
export function onResume(handler: () => void): () => void {
  for (const type of RESUME_EVENTS) targetFor(type).addEventListener(type, handler);
  return () => {
    for (const type of RESUME_EVENTS) targetFor(type).removeEventListener(type, handler);
  };
}
