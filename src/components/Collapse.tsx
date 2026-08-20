import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * An expanding panel that reliably closes again.
 *
 * The tidy CSS approach — `grid-template-rows: 0fr → 1fr` — opened fine but
 * refused to collapse back: an fr track's automatic minimum is its content, so
 * the row wouldn't shrink below it, and neither `overflow: hidden` nor
 * `min-height: 0` on the child changed that. Measuring the content and
 * animating an explicit max-height is less elegant but actually works in both
 * directions, which matters more.
 *
 * A ResizeObserver keeps the measurement honest when the content changes size
 * while open.
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;

    const measure = () => setHeight(el.scrollHeight);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * The classic three-step max-height dance, and it's worth spelling out why.
   *
   * A panel left at a transitioned pixel height depends on that transition
   * actually completing to be the right size — if it stalls, the content is
   * clipped forever. So the open state settles on `none`: no cap at all, the
   * correct height no matter what the animation did.
   *
   * `none` can't be interpolated though, so closing straight from it would
   * snap. Hence the middle step: re-apply the measured pixel height, wait a
   * frame for the browser to accept it as a starting point, then go to zero.
   *
   * The upshot is that the end states are always right and only the motion
   * between them depends on the transition.
   */
  const [maxHeight, setMaxHeight] = useState(open ? 'none' : '0px');

  /**
   * Whether this panel has ever been open. A panel that starts closed has
   * nothing to animate from, and running the dance below anyway paints it at
   * full height for a frame before collapsing — with five closed cards in
   * Settings that's a visible jolt on first paint. Worse, the two rAFs never
   * arrive at all in a background tab, so it would sit there fully expanded.
   */
  const everOpened = useRef(open);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;

    if (open) {
      everOpened.current = true;
      setMaxHeight(`${el.scrollHeight}px`);
      const t = window.setTimeout(() => setMaxHeight('none'), 300);
      return () => window.clearTimeout(t);
    }

    if (!everOpened.current) {
      setMaxHeight('0px');
      return;
    }

    setMaxHeight(`${el.scrollHeight}px`);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setMaxHeight('0px'));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open, height]);

  return (
    <div
      style={{
        maxHeight,
        overflow: 'hidden',
        transition: 'max-height 280ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
      aria-hidden={!open}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
