import { Sheet } from './Sheet';
import type { SchoolEvent } from '../data/calendar';
import { fromISODate } from '../lib/date';

/**
 * Tap an event, see what it actually is.
 *
 * The lists only ever had room for a title and a date, so a student looking at
 * "Rally Week" or "Minimum Day" had nowhere to find out when it starts, where
 * it is, or what it means. All of that was already arriving in the school's
 * calendar feed and being thrown away.
 *
 * Everything here is optional, because the curated entries in calendar.ts carry
 * only a title and a date. A sheet with nothing but a heading would be a dead
 * end, so the caller checks `hasDetail` before making a row tappable.
 */

/** Is there anything worth opening a sheet for? */
export function hasDetail(e: SchoolEvent): boolean {
  return Boolean(e.description || e.location || e.time || e.endDate);
}

export function EventSheet({
  event,
  onClose,
}: {
  event: SchoolEvent | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={event !== null} onClose={onClose} label={event?.title ?? 'Event'}>
      {event && (
        <div className="px-5 pb-6 pt-1">
          <h2 className="text-xl font-semibold leading-snug">{event.title}</h2>

          <p className="mt-1 text-sm text-dim">
            {longDate(event.date)}
            {event.endDate && ` – ${longDate(event.endDate)}`}
            {event.time && ` · ${event.time}`}
          </p>

          {event.location && (
            <p className="mt-3 flex items-start gap-2 text-sm">
              <span aria-hidden>📍</span>
              <span className="min-w-0">{event.location}</span>
            </p>
          )}

          {event.description ? (
            // whitespace-pre-line: the school writes these with real line
            // breaks, and collapsing them turns a tidy list into a paragraph.
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-dim">
              {event.description}
            </p>
          ) : (
            <p className="mt-4 text-sm text-faint">
              The school hasn't added any details for this one.
            </p>
          )}

          <p className="mt-5 border-t border-app pt-3 text-xs text-faint">
            From American High's calendar. Times can change — check with the school.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function longDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
