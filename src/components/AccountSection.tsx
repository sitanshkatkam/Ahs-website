import { useEffect, useState } from 'react';
import { fetchAuthState, signIn, signOut, type AuthState } from '../lib/auth';
import { GoogleMark } from './GoogleMark';

/**
 * The account row at the foot of Settings.
 *
 * It sits last on purpose. Signing out is rare, mildly destructive and easy to
 * hit by accident, so it belongs where nobody lands by mistake — the same place
 * every other app puts it.
 *
 * Signing in is still offered here for anyone who set the app up before
 * accounts existed; new students meet it during onboarding instead.
 */
export function AccountSection() {
  const [state, setState] = useState<AuthState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchAuthState().then(setState);
  }, []);

  // Nothing to say until the Worker confirms sign-in is switched on.
  if (!state?.configured) return null;

  const account = state.account;

  if (!account) {
    return (
      <Frame>
        <button onClick={signIn} className="flex w-full items-center gap-3 p-4 text-left">
          <GoogleMark />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Sign in with Google</span>
            <span className="block text-xs text-faint">Syncs nothing yet — your data is local</span>
          </span>
          <span aria-hidden className="shrink-0 text-faint">
            ▸
          </span>
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
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
      </div>

      {/*
        Two taps, because signing out of an installed PWA means finding the
        button again through a browser redirect — more friction to undo than
        the tap that caused it.
      */}
      {confirming ? (
        <div className="flex gap-2 border-t border-app p-3">
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm font-medium text-dim"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await signOut();
              setState(await fetchAuthState());
              setConfirming(false);
              setBusy(false);
            }}
            disabled={busy}
            className="flex-1 rounded-xl bg-[color:var(--accent-rose)] py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Signing out…' : 'Yes, sign out'}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full border-t border-app p-4 text-left text-sm font-medium text-[color:var(--accent-rose)]"
        >
          Sign out
        </button>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section className="pb-7">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Account
      </h2>
      <div className="overflow-hidden rounded-2xl border border-app bg-surface">{children}</div>
      <p className="px-1 pt-2 text-xs text-faint">
        Signing out doesn't delete anything. Your classes, grades and settings live on this
        device, not in the account.
      </p>
    </section>
  );
}
