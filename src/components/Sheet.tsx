import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The bottom sheet used for the QR code, the day detail, and adding a task.
 *
 * Three near-identical copies of this markup existed before, and none of them
 * animated — they blinked into existence, which reads as a bug rather than a
 * transition. One component now owns the motion, the backdrop, scroll locking,
 * and Escape-to-close.
 *
 * Exit animation is why `open` is a prop rather than the caller doing
 * `{isOpen && <Sheet/>}`: something has to stay mounted long enough to
 * animate out.
 *
 * It renders through a portal into <body> deliberately. `position: fixed`
 * resolves against the nearest ancestor with a transform rather than the
 * viewport, and the tab wrapper carries an animation — so rendering in place
 * put the sheet at top:-1200px as soon as the page was scrolled. A portal makes
 * that class of bug impossible instead of relying on no ancestor ever gaining
 * a transform.
 */

const DURATION_MS = 300;

/** iOS-style ease-out: fast to start, long settle. Feels like weight. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

type Props = {
  open: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  /** Day detail can be long; the others size to content. */
  scrollable?: boolean;
  label?: string;
};

export function Sheet({ open, onClose, children, scrollable, label }: Props) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Mount off-screen first, then flip on the next frame so the browser has
      // a "from" state to animate out of. Without this it jumps straight in.
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), DURATION_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape closes, and the page behind shouldn't scroll while this is up.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity"
        style={{ opacity: shown ? 1 : 0, transitionDuration: `${DURATION_MS}ms` }}
      />

      <div
        ref={panelRef}
        className={[
          'safe-bottom relative rounded-t-3xl border-t border-app bg-app px-5 pb-8 pt-3',
          scrollable ? 'max-h-[80vh] overflow-y-auto' : '',
        ].join(' ')}
        style={{
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform ${DURATION_MS}ms ${EASE}`,
        }}
      >
        {/* Grab handle. Purely a signifier that this thing came from below. */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-surface-2" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
