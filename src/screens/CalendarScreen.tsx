import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { SCHOOL_YEAR } from '../data/calendar';
import { addDays, formatTime, fromISODate, toISODate } from '../lib/date';
import { resolveDay, slotClass, slotTitle } from '../lib/resolveDay';
import type { Settings } from '../lib/storage';

type Props = {
  today: string;
  settings: Settings;
};

export function CalendarScreen({ today, settings }: Props) {
  const [cursor, setCursor] = useState(() => today.slice(0, 7)); // "YYYY-MM"
  const [selected, setSelected] = useState<string | null>(null);

  const weeks = useMemo(() => buildMonth(cursor), [cursor]);
  const monthLabel = fromISODate(`${cursor}-01`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="pb-2">
      <header className="flex items-center justify-between px-5 pt-3 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{monthLabel}</h1>
          <p className="text-sm text-dim">{SCHOOL_YEAR.label} school year</p>
        </div>
        <div className="flex gap-1">
          <NavButton label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>
            ‹
          </NavButton>
          <NavButton label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>
            ›
          </NavButton>
        </div>
      </header>

      <WeekStrip today={today} settings={settings} onSelect={setSelected} />

      <section className="px-4 pt-5">
        <div className="grid grid-cols-7 gap-1 pb-2 text-center text-[11px] font-medium uppercase tracking-wider text-faint">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i}>{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weeks.map((iso) => {
            if (!iso) return <div key={Math.random()} />;
            const info = resolveDay(iso, settings.customOverrides, settings.extraPeriods);
            const isToday = iso === today;
            return (
              <button
                key={iso}
                onClick={() => setSelected(iso)}
                className={[
                  'aspect-square rounded-xl border text-sm transition-colors',
                  info.template ? `accent-${info.template.accent}` : '',
                  // The whole cell carries the schedule's colour. The dot that
                  // used to do this job is gone: repeating the same colour in
                  // a 6px dot on top of a tinted square said nothing extra.
                  info.isSchoolDay ? 'bg-accent-soft' : '',
                  isToday
                    ? 'border-accent font-semibold'
                    : 'border-transparent hover:bg-surface-2',
                  info.isSchoolDay ? 'text-main' : 'text-faint',
                ].join(' ')}
              >
                <span className="grid h-full place-items-center">
                  {Number(iso.slice(8, 10))}
                </span>
              </button>
            );
          })}
        </div>

        <Legend />
      </section>

      <DaySheet iso={selected} settings={settings} onClose={() => setSelected(null)} />
    </div>
  );
}

function NavButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-full border border-app text-lg text-dim transition-colors hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

function WeekStrip({
  today,
  settings,
  onSelect,
}: {
  today: string;
  settings: Settings;
  onSelect: (iso: string) => void;
}) {
  // The current week, Sunday through Saturday.
  const start = addDays(today, -fromISODate(today).getDay());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  // A week is exactly seven cells, so it should fit the screen — no sideways
  // scrolling. Colour carries the schedule family and `code` says which periods
  // meet, which together survive a ~44px-wide cell.
  return (
    <div className="grid grid-cols-7 gap-1 px-4 pb-1">
      {days.map((iso) => {
        const info = resolveDay(iso, settings.customOverrides, settings.extraPeriods);
        const isToday = iso === today;
        return (
          <button
            key={iso}
            onClick={() => onSelect(iso)}
            className={[
              'flex min-w-0 flex-col items-center gap-0.5 rounded-xl border px-0.5 py-2 transition-colors',
              info.template ? `accent-${info.template.accent}` : 'accent-blue',
              isToday ? 'border-accent bg-surface-2' : 'border-app bg-surface hover:bg-surface-2',
            ].join(' ')}
          >
            <span className="text-[10px] uppercase tracking-wide text-faint">
              {fromISODate(iso)
                .toLocaleDateString(undefined, { weekday: 'short' })
                .slice(0, 3)}
            </span>
            <span className={['text-base leading-none', isToday ? 'font-semibold text-accent' : ''].join(' ')}>
              {Number(iso.slice(8, 10))}
            </span>
            <span
              className={[
                'w-full truncate text-center text-[9px] leading-tight',
                info.template ? 'text-accent' : 'text-faint',
              ].join(' ')}
            >
              {info.template ? info.template.code : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Legend() {
  const entries = [
    { label: 'Six Period', accent: 'blue' },
    { label: 'Block', accent: 'green' },
    { label: 'Rally', accent: 'amber' },
    { label: 'Minimum', accent: 'violet' },
    { label: 'Finals', accent: 'rose' },
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 px-1 pt-5 text-xs text-dim">
      {entries.map((e) => (
        <li key={e.label} className={`flex items-center gap-1.5 accent-${e.accent}`}>
          <span className="h-2 w-2 rounded-full bg-accent" />
          {e.label}
        </li>
      ))}
    </ul>
  );
}

function DaySheet({
  iso,
  settings,
  onClose,
}: {
  /** Null when closed — the sheet stays mounted so it can animate out. */
  iso: string | null;
  settings: Settings;
  onClose: () => void;
}) {
  // Keep rendering the last day through the closing animation, otherwise the
  // sheet empties itself on the way down.
  const [lastIso, setLastIso] = useState<string | null>(iso);
  useEffect(() => {
    if (iso) setLastIso(iso);
  }, [iso]);

  const shown = lastIso ?? iso;
  if (!shown) return <Sheet open={false} onClose={onClose} />;

  const info = resolveDay(shown, settings.customOverrides, settings.extraPeriods);
  const accent = info.template ? `accent-${info.template.accent}` : 'accent-blue';

  return (
    <Sheet open={iso !== null} onClose={onClose} scrollable label="Day detail">
      <div className={accent}>
        <p className="text-sm text-dim">
          {fromISODate(shown).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          {info.template ? info.template.name : info.outOfYear ? 'Out of session' : 'No school'}
        </h2>
        {info.label && <p className="mt-1 text-sm text-accent">{info.label}</p>}

        {info.events.length > 0 && (
          <ul className="mt-4 space-y-1">
            {info.events.map((e) => (
              <li key={e.title} className="text-sm text-dim">
                • {e.title}
              </li>
            ))}
          </ul>
        )}

        {info.template && (
          <ol className="mt-4 overflow-hidden rounded-2xl border border-app bg-surface">
            {info.template.slots.map((slot, i) => {
              const cls = slotClass(slot, settings.classes);
              return (
                <li
                  key={`${slot.label}-${slot.start}`}
                  className={[
                    'flex items-center gap-3 px-4 py-2.5',
                    i === 0 ? '' : 'border-t border-app',
                  ].join(' ')}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-dim">
                    {slot.period ?? '·'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {slotTitle(slot, settings.classes)}
                    {cls?.room && <span className="text-faint"> · {cls.room}</span>}
                  </span>
                  <span className="tnum shrink-0 text-xs text-dim">
                    {formatTime(slot.start)} – {formatTime(slot.end)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-xl border border-app py-3 text-sm font-medium text-dim transition-colors hover:bg-surface-2"
        >
          Close
        </button>
      </div>
    </Sheet>
  );
}

/** Month grid padded with nulls so the 1st lands on the right weekday. */
function buildMonth(yyyymm: string): (string | null)[] {
  const first = fromISODate(`${yyyymm}-01`);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(toISODate(new Date(first.getFullYear(), first.getMonth(), d)));
  }
  return cells;
}

function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
