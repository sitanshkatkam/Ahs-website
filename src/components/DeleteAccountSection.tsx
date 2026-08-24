import { useState } from 'react';
import { deleteAccount, eraseLocalData, type Account } from '../lib/auth';
import { unregisterPush } from '../lib/push';

/**
 * Delete account — the last thing in Settings.
 *
 * Deliberately harder to trigger than signing out. Signing out is a two-tap
 * confirm because the worst case is a minor inconvenience; this one throws away
 * six class names and a term of grades, neither of which exists anywhere else.
 * So it asks for the word to be typed.
 *
 * That is a real cost on a phone keyboard, and it is the point: the friction is
 * proportional to what is lost, and nobody deletes a term of grades with a
 * mis-tap while scrolling.
 */
export function DeleteAccountSection({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const armed = typed.trim().toUpperCase() === 'DELETE';

  const run = async () => {
    setBusy(true);
    setFailed(false);

    // Server first. If it fails, nothing local is touched — erasing the phone
    // on the strength of a request that never landed would destroy the data
    // and leave the account alive, which is the worst of both.
    const ok = await deleteAccount();
    if (!ok) {
      setBusy(false);
      setFailed(true);
      return;
    }

    // Stop the server waking a phone that no longer has an account on it.
    await unregisterPush();
    await eraseLocalData();

    // Straight to the root so the app restarts from onboarding rather than
    // re-rendering screens whose data has just been deleted underneath them.
    window.location.replace('/');
  };

  return (
    <section className="pb-7">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Delete account
      </h2>

      <div className="overflow-hidden rounded-2xl border border-[color:var(--accent-rose)]/40 bg-surface">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="w-full p-4 text-left text-sm font-medium text-[color:var(--accent-rose)]"
          >
            Delete my account
          </button>
        ) : (
          <div className="p-4">
            <p className="text-sm font-medium">This cannot be undone.</p>

            <ul className="mt-2 space-y-1 text-xs text-dim">
              <li>· Your account ({account.email}) is removed from the server</li>
              <li>· You are signed out on every device</li>
              <li>· Your classes and grades on this phone are erased</li>
              <li>· Notifications stop</li>
            </ul>

            <label className="mt-4 block text-xs text-faint" htmlFor="confirm-delete">
              Type <span className="font-semibold text-main">DELETE</span> to confirm
            </label>
            <input
              id="confirm-delete"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="DELETE"
              className="mt-1 w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-faint"
            />

            {failed && (
              <p className="mt-2 text-xs text-[color:var(--accent-rose)]">
                That didn't go through — nothing was deleted. Check your connection and try
                again.
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setOpen(false);
                  setTyped('');
                  setFailed(false);
                }}
                disabled={busy}
                className="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm font-medium text-dim disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={run}
                disabled={!armed || busy}
                className="flex-1 rounded-xl bg-[color:var(--accent-rose)] py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
