import { useEffect, useState } from 'react';
import {
  fetchAuthState,
  signIn,
  signInMessage,
  signOut,
  takeSignInResult,
  type AuthState,
} from '../lib/auth';

/**
 * The account card in Settings.
 *
 * Sign-in is offered, never demanded. The app has no login wall and this
 * component is the only place an account is mentioned — everything else works
 * signed out, which is the property that lets someone scan a poster and be
 * looking at their schedule five seconds later.
 *
 * The card renders nothing at all until the Worker says sign-in is configured,
 * so shipping this before the Google keys exist changes nothing on screen.
 */
export function AccountSection() {
  const [state, setState] = useState<AuthState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const result = takeSignInResult();
    if (result) setNote(signInMessage(result));
    void fetchAuthState().then(setState);
  }, []);

  // Unknown or unavailable: say nothing rather than flash a button that is
  // about to disappear.
  if (!state?.configured) return null;

  const account = state.account;

  return (
    <section className="pb-7">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Account
      </h2>

      <div className="overflow-hidden rounded-2xl border border-app bg-surface">
        {account ? (
          <div className="flex items-center gap-3 p-4">
            {account.picture ? (
              <img
                src={account.picture}
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-dim">
                {account.email.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{account.name ?? 'Signed in'}</p>
              <p className="truncate text-xs text-faint">{account.email}</p>
            </div>

            <button
              onClick={async () => {
                setBusy(true);
                await signOut();
                setState(await fetchAuthState());
                setBusy(false);
              }}
              disabled={busy}
              className="shrink-0 rounded-full border border-app px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? '…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <button onClick={signIn} className="flex w-full items-center gap-3 p-4 text-left">
            <GoogleMark />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Sign in with Google</span>
              <span className="block text-xs text-faint">Optional — nothing needs it yet</span>
            </span>
            <span aria-hidden className="shrink-0 text-faint">
              ▸
            </span>
          </button>
        )}
      </div>

      {note && <p className="px-1 pt-2 text-xs text-accent">{note}</p>}
      {!account && (
        <p className="px-1 pt-2 text-xs text-faint">
          Your classes and grades stay on this device either way. An account only stores your
          name and email address.
        </p>
      )}
    </section>
  );
}

/** Google's mark, inlined — the CSP on this app blocks remote images. */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden className="shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
