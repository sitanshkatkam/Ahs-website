import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BUILD_TIME } from '../lib/appUpdate';
import { eraseLocalData } from '../lib/auth';

/**
 * The last line of defence.
 *
 * Without this, one thrown error anywhere in the tree unmounts everything and
 * leaves a white screen. In a browser tab that is merely bad; in an installed
 * PWA there is no address bar and no reload button, so a student's only route
 * out is deleting the app and installing it again. Across a whole school, on
 * every Android phone ever made, something will eventually throw — a stored
 * setting from an older version, an unexpected shape in the calendar feed.
 *
 * So the goal here is not to explain the error. It is to make sure there is
 * always a way forward that a fifteen-year-old can find in one tap.
 *
 * Two escapes, in order of how much they cost:
 *   - Reload. Fixes anything transient, loses nothing.
 *   - Start fresh. Erases this device's data, for the case where the stored
 *     data is itself what crashes on every load. Confirmed first, because it
 *     throws away classes and grades that exist nowhere else.
 */

type Props = { children: ReactNode };
type State = { error: Error | null; confirmingReset: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, confirmingReset: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No error-reporting service, and deliberately so — that would mean
    // sending student data off the device. The console is enough to debug a
    // phone plugged into a laptop, which is how this will actually be looked at.
    console.error('Unhandled error:', error, info.componentStack);
  }

  render() {
    const { error, confirmingReset } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="accent-blue safe-top safe-bottom safe-x flex min-h-dvh flex-col justify-center px-6 py-12">
        <p className="text-4xl" aria-hidden>
          🦅
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-dim">
          The app hit a problem it couldn't recover from on its own. Reloading usually fixes it.
        </p>

        <button
          onClick={() => window.location.reload()}
          className="mt-6 w-full rounded-2xl bg-accent py-4 font-semibold text-white"
        >
          Reload the app
        </button>

        {confirmingReset ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--accent-rose)]/40 bg-surface p-4">
            <p className="text-sm font-medium">Erase this device's data?</p>
            <p className="mt-1 text-xs text-dim">
              Your classes, grades and settings are stored only on this phone, so this deletes
              them. Do it if reloading keeps landing you back here.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => this.setState({ confirmingReset: false })}
                className="flex-1 rounded-xl bg-surface-2 py-2.5 text-sm font-medium text-dim"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await eraseLocalData();
                  window.location.replace('/');
                }}
                className="flex-1 rounded-xl bg-[color:var(--accent-rose)] py-2.5 text-sm font-semibold text-white"
              >
                Erase and restart
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => this.setState({ confirmingReset: true })}
            className="mt-3 w-full rounded-2xl border border-app py-3 text-sm font-medium text-dim"
          >
            Still broken? Start fresh
          </button>
        )}

        {/*
          The build stamp and the message, so a report says something useful.
          Shown rather than hidden behind a tap: someone who has got this far is
          already looking for something to tell you.
        */}
        <p className="mt-8 break-words text-center text-xs text-faint">
          {String(error.message || error).slice(0, 200)}
        </p>
        <p className="mt-1 text-center text-xs text-faint">Build {BUILD_TIME}</p>
      </div>
    );
  }
}
