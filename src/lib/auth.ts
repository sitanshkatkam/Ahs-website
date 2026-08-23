/**
 * Google sign-in, browser side.
 *
 * There is deliberately no token handling here. The session lives in an
 * HttpOnly cookie the Worker sets, which this code cannot read and neither can
 * anything else running on the page — so the client's whole job is to ask who
 * is signed in, send people to Google, and send them back out again.
 *
 * Signing in is optional and adds nothing the app needs. Classes, schedules,
 * grades and notifications all still live in localStorage on the device and
 * work exactly the same signed out.
 */

export type Account = {
  email: string;
  name: string | null;
  picture: string | null;
};

export type AuthState = {
  /** False until the Google keys are set on the Worker. */
  configured: boolean;
  account: Account | null;
};

const SIGNED_OUT: AuthState = { configured: false, account: null };

/**
 * Ask the Worker who we are. Never throws: sign-in is a bonus, so a flaky
 * network should leave the rest of Settings working rather than blanking it.
 */
export async function fetchAuthState(): Promise<AuthState> {
  try {
    const res = await fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return SIGNED_OUT;
    const body = (await res.json()) as Partial<AuthState>;
    return {
      configured: Boolean(body.configured),
      account: body.account ?? null,
    };
  } catch {
    return SIGNED_OUT;
  }
}

/**
 * A full-page navigation, not a popup. Popups are blocked often enough on
 * mobile to be unreliable, and an installed PWA has no visible address bar for
 * the student to recover from a blocked one.
 */
export function signIn(): void {
  window.location.href = '/api/auth/google/start';
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // The cookie expires on its own; nothing here is worth blocking on.
  }
}

/**
 * Why the last attempt ended, taken from the `?signin=` the Worker redirects
 * back with. Read once and then stripped, so a reload doesn't replay it.
 */
export function takeSignInResult(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get('signin');
  if (!value) return null;

  url.searchParams.delete('signin');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  return value;
}

/** What to actually show someone when a sign-in didn't work. */
export function signInMessage(result: string): string | null {
  switch (result) {
    case 'ok':
      return null;
    case 'cancelled':
      return 'Sign-in cancelled.';
    case 'expired':
      return 'That sign-in took too long. Try again.';
    case 'google-rejected':
    case 'bad-token':
      return "Google couldn't complete the sign-in. Try again.";
    default:
      return 'Sign-in failed. Try again.';
  }
}

/**
 * Delete the account on the server. Returns false if it didn't happen, so the
 * caller doesn't erase the phone on the strength of a request that failed.
 */
export async function deleteAccount(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/delete', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Everything the app has ever written on this device.
 *
 * "Delete my account" has to mean it. Almost none of a student's data is in
 * the account — classes, grades, assignments and settings never left the
 * phone — so deleting only the server row would leave all of it sitting here
 * and make the promise a lie.
 *
 * Listed explicitly rather than clearing localStorage wholesale, so this
 * cannot quietly take something a future feature stores alongside it.
 */
const LOCAL_KEYS = [
  'ahs-schedule:settings',
  'ahs-schedule:feed',
  'ahs-schedule:fired',
  'ahs-schedule:uploaded:d1',
  'ahs-schedule:schedule-updated',
];

export async function eraseLocalData(): Promise<void> {
  for (const key of LOCAL_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }

  // The mirrored alert plan and the fired-notification ids live here.
  try {
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('ahs-schedule');
  } catch {
    /* ignore */
  }
}
