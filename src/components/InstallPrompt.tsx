import { useEffect, useState } from 'react';
import {
  installState,
  onInstallAvailabilityChange,
  promptInstall,
  type InstallState,
} from '../lib/install';

/** Live install state, re-read whenever Chrome's prompt appears or fires. */
export function useInstallState(): InstallState {
  const [state, setState] = useState<InstallState>(() => installState());

  useEffect(() => {
    const refresh = () => setState(installState());
    const off = onInstallAvailabilityChange(refresh);
    // display-mode flips the moment it's launched from the home screen.
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', refresh);
    refresh();
    return () => {
      off();
      mq?.removeEventListener?.('change', refresh);
    };
  }, []);

  return state;
}

type Props = {
  dismissed: boolean;
  onDismiss: () => void;
};

/**
 * A single quiet row at the top of Today. Hidden once installed, and
 * dismissible — but see the note below on why it comes back for iPhone users
 * who turn on alerts.
 */
export function InstallPrompt({ dismissed, onDismiss }: Props) {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  if (state.kind === 'installed' || state.kind === 'unavailable') return null;
  if (dismissed) return null;

  if (state.kind === 'prompt') {
    return (
      <Card onDismiss={onDismiss}>
        <p className="text-sm font-medium">Add to your home screen</p>
        <p className="mt-0.5 text-xs text-dim">
          Real icon, fullscreen, works offline, and alerts arrive reliably.
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const accepted = await promptInstall();
            setBusy(false);
            if (accepted) onDismiss();
          }}
          className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Installing…' : 'Install'}
        </button>
      </Card>
    );
  }

  // iOS: no API for this, so the best we can do is point at the button.
  return (
    <Card onDismiss={onDismiss}>
      <p className="text-sm font-medium">Add to your Home Screen</p>
      <p className="mt-0.5 text-xs text-dim">
        Gets you a real icon and fullscreen — and on iPhone it's the only way notifications
        work at all.
      </p>
      {showSteps ? (
        <ol className="mt-3 space-y-1.5 text-xs text-dim">
          <li>
            1. Tap the Share button <span aria-hidden>􀈂</span> at the bottom of Safari
          </li>
          <li>2. Scroll down and tap “Add to Home Screen”</li>
          <li>3. Tap “Add”, then open AHS from your home screen</li>
        </ol>
      ) : (
        <button
          onClick={() => setShowSteps(true)}
          className="mt-3 rounded-full border border-app px-4 py-2 text-sm font-medium text-accent"
        >
          Show me how
        </button>
      )}
    </Card>
  );
}

function Card({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <section className="px-5 pb-1">
      <div className="animate-expand relative rounded-2xl border border-accent bg-surface p-4">
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 text-sm text-faint"
        >
          ✕
        </button>
        <div className="pr-6">{children}</div>
      </div>
    </section>
  );
}

/**
 * Settings row. Unlike the banner this is never dismissed — it's the place you
 * go looking when notifications aren't arriving.
 */
export function InstallSettingsRow() {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);

  if (state.kind === 'installed') {
    return (
      <p className="p-4 text-sm text-dim">
        <span className="font-medium text-main">Installed.</span> You're running from the home
        screen, which is what makes notifications reliable.
      </p>
    );
  }

  if (state.kind === 'prompt') {
    return (
      <div className="p-4">
        <p className="text-sm text-dim">
          Not installed. Adding it to your home screen gives you an icon, fullscreen, and
          dependable alerts.
        </p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall();
            setBusy(false);
          }}
          className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Installing…' : 'Install'}
        </button>
      </div>
    );
  }

  if (state.kind === 'ios') {
    return (
      <div className="p-4 text-sm text-dim">
        <p>
          Not installed. In Safari, tap Share, then <strong className="text-main">Add to Home
          Screen</strong>.
        </p>
        <p className="mt-2 text-xs text-faint">
          On iPhone this is required for notifications to work — Safari won't deliver them to a
          browser tab.
        </p>
      </div>
    );
  }

  return (
    <p className="p-4 text-sm text-dim">
      Open this on your phone to add it to your home screen.
    </p>
  );
}
