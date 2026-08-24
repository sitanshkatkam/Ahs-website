import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

/**
 * "Scan this" sheet, for handing the app to a friend at lunch.
 *
 * The QR is a static SVG generated at deploy time (`npm run qr`) rather than
 * encoded in the browser — a QR library would be a pointless ~50KB in the
 * bundle for one fixed URL. It's precached, so this works with no signal.
 */

/**
 * The address to hand out, from package.json via vite's define.
 *
 * Deliberately not window.location.origin. That returned whatever host the app
 * happened to be open on — localhost during development, and the long
 * workers.dev address in production — so the QR and the copied link disagreed
 * with the posters. A fixed short link also survives the app moving to a custom
 * domain later without reprinting anything.
 */
export function shareUrl(): string {
  return typeof __APP_URL__ === 'string' && __APP_URL__ ? __APP_URL__ : '';
}

const SHARE_TEXT =
  'American High schedule app — every bell schedule, block days and rally days, plus your classes.';

export function SharePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = shareUrl();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, or permission). The URL is on
      // screen and selectable, so this isn't a dead end.
      setCopied(false);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'American High Schedule', text: SHARE_TEXT, url });
    } catch {
      // Includes the user simply cancelling the sheet — nothing to report.
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label="Share the app">
      <div className="accent-blue">
        <h2 className="text-xl font-semibold">Share the app</h2>
        <p className="mt-1 text-sm text-dim">
          Point a camera at this. It works for anyone at American High.
        </p>

        {/* White plate regardless of theme: a dark-on-dark QR won't scan. */}
        <div className="mt-5 grid place-items-center">
          <div className="rounded-2xl bg-white p-3">
            <img
              src="/qr.svg"
              alt={`QR code linking to ${url}`}
              width={220}
              height={220}
              className="block h-[220px] w-[220px]"
            />
          </div>
        </div>

        <p className="mt-4 break-all text-center text-sm text-dim">{url}</p>

        <div className="mt-5 flex gap-2">
          {canShare && (
            <button
              onClick={share}
              className="flex-1 rounded-2xl bg-accent py-3.5 font-semibold text-white"
            >
              Share
            </button>
          )}
          <button
            onClick={copy}
            className={[
              'rounded-2xl border border-app py-3.5 font-medium transition-colors',
              canShare ? 'flex-1' : 'w-full',
              copied ? 'text-accent' : 'text-dim',
            ].join(' ')}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-faint">
          Tell them to tap “Add to Home Screen” after it opens — on iPhone that's what makes
          notifications work.
        </p>

        <button onClick={onClose} className="mt-3 w-full py-2 text-sm text-dim">
          Close
        </button>
      </div>
    </Sheet>
  );
}

/** Small round trigger for the Today header. */
export function ShareButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Share the app"
      title="Share the app"
      className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-app px-3.5 text-sm font-medium text-dim transition-colors hover:bg-surface-2"
    >
      {/* A QR glyph, drawn rather than an emoji so it matches the UI weight.
          The word carries the meaning; the icon just says which kind of share. */}
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M1 1h5v5H1V1zm1.5 1.5v2h2v-2h-2zM10 1h5v5h-5V1zm1.5 1.5v2h2v-2h-2zM1 10h5v5H1v-5zm1.5 1.5v2h2v-2h-2z" />
        <path d="M8 8h1.5v1.5H8V8zm2.5 0H12v1.5h-1.5V8zm3 0H15v1.5h-1.5V8zM8 10.5h1.5V12H8v-1.5zm3.5 0H13V12h-1.5v-1.5zm2 2.5H15v1.5h-1.5V13zm-3 0H12v1.5h-1.5V13zM8 13h1.5v1.5H8V13z" />
      </svg>
      Share
    </button>
  );
}
