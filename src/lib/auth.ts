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
