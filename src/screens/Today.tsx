import { useState } from 'react';
import { ProgressRing } from '../components/ProgressRing';
import { SCHOOL_YEAR, type EventCategory } from '../data/calendar';
import type { Slot } from '../data/schedules';
import {
  addDays,
  countdownParts,
  formatTime,
  fromISODate,
  minutesOf,
  minutesOfDate,
} from '../lib/date';
import {
  getSlotState,
  resolveDay,
  slotClass,
  slotTitle,
  upcomingEvents,
  upcomingSchoolDays,
} from '../lib/resolveDay';
import type { Settings } from '../lib/storage';
import { Collapse } from '../components/Collapse';
import { InstallPrompt } from '../components/InstallPrompt';
import { SharePanel, ShareButton } from '../components/SharePanel';

type Props = {
  today: string;
  now: Date;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  onOpenCalendar: () => void;
};

export function Today({ today, now, settings, update, onOpenCalendar }: Props) {
  const [sharing, setSharing] = useState(false);
  const day = resolveDay(today, settings.customOverrides, settings.extraPeriods);
  const accentClass = day.template ? `accent-${day.template.accent}` : 'accent-blue';

  return (
    <div className={accentClass}>
      <header className="flex items-start gap-3 px-5 pt-3 pb-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-dim">{longDate(today)}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {day.template ? day.template.name : day.outOfYear ? 'Out of session' : 'No school'}
          </h1>
          {day.label && <p className="mt-1 text-sm text-accent">{day.label}</p>}
        </div>
        <div className="pt-1">
          <ShareButton onClick={() => setSharing(true)} />
        </div>
      </header>

      <SharePanel open={sharing} onClose={() => setSharing(false)} />

      <InstallPrompt
        dismissed={settings.installDismissed}
        onDismiss={() => update({ installDismissed: true })}
      />

      {day.isSchoolDay && day.template ? (
        <SchoolDay day={day} now={now} settings={settings} />
      ) : (
        <DayOff today={today} settings={settings} onOpenCalendar={onOpenCalendar} />
      )}

      <ComingUp today={today} hidden={settings.hiddenEventCategories} />
    </div>
  );
}

function SchoolDay({
  day,
  now,
  settings,
}: {
  day: ReturnType<typeof resolveDay>;
  now: Date;
  settings: Settings;
}) {
  const template = day.template!;
  const state = getSlotState(template, now);
  const nowMinutes = minutesOfDate(now);

  return (
    <>
      <section className="grid place-items-center pb-2">
        <ProgressRing progress={state.progress} dashed={state.phase === 'passing'}>
          <RingContent state={state} settings={settings} />
        </ProgressRing>
      </section>

      {/* Once the last bell has gone, today's list is history and the only
          live question is what tomorrow looks like — so the preview goes
          above it rather than at the bottom of the screen. */}
      {state.phase === 'after' && <NextDay today={day.date} settings={settings} />}

      <section className="px-5 pt-4">
        <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
          Today
        </h2>
        <ol className="overflow-hidden rounded-2xl border border-app bg-surface">
          {template.slots.map((slot, i) => (
            <SlotRow
              key={`${slot.label}-${slot.start}`}
              slot={slot}
              settings={settings}
              isCurrent={state.current === slot}
              isPast={minutesOf(slot.end) <= nowMinutes}
              isFirst={i === 0}
            />
          ))}
        </ol>
      </section>
    </>
  );
}

/**
 * The number big, everything after it small. Above five minutes the unit word
 * carries the meaning ("47 min"), below it the m:ss format speaks for itself.
 */
function Countdown({ seconds, trailing }: { seconds: number; trailing?: string }) {
  const { value, unit } = countdownParts(seconds);
  const tail = [unit, trailing].filter(Boolean).join(' ');
  return (
    <>
      {value}
      {tail ? <span className="text-base font-normal text-dim"> {tail}</span> : null}
    </>
  );
}

function RingContent({
  state,
  settings,
}: {
  state: ReturnType<typeof getSlotState>;
  settings: Settings;
}) {
  if (state.phase === 'before' && state.next) {
    return (
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-faint">Starts in</p>
        <p className="tnum mt-1 text-4xl font-semibold">
          <Countdown seconds={state.secondsRemaining} />
        </p>
        <p className="mt-2 text-sm text-dim">{slotTitle(state.next, settings.classes)}</p>
      </div>
    );
  }

  if (state.phase === 'passing' && state.next) {
    const cls = slotClass(state.next, settings.classes);
    return (
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-faint">Passing</p>
        <p className="tnum mt-1 text-4xl font-semibold">
          <Countdown seconds={state.secondsRemaining} />
        </p>
        <p className="mt-2 line-clamp-2 text-sm text-dim">
          → {slotTitle(state.next, settings.classes)}
          {cls?.room ? ` · ${cls.room}` : ''}
        </p>
      </div>
    );
  }

  if (state.phase === 'in' && state.current) {
    const cls = slotClass(state.current, settings.classes);
    return (
      <div>
        <p className="line-clamp-2 text-lg font-semibold leading-snug">
          {slotTitle(state.current, settings.classes)}
        </p>
        <p className="tnum mt-1 text-4xl font-semibold text-accent">
          <Countdown seconds={state.secondsRemaining} trailing="left" />
        </p>
        <p className="mt-1 text-xs text-dim">
          {cls?.room ? `Room ${cls.room} · ` : ''}
          ends {formatTime(state.current.end)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-3xl font-semibold">Done</p>
      <p className="mt-2 text-sm text-dim">School's out for today.</p>
    </div>
  );
}

/**
 * What the next school day looks like.
 *
 * The Today screen used to go dead at 3:30pm — a ring saying "School's out"
 * and a list of periods that already happened — which is exactly the window
 * when someone is packing a bag and wants to know whether tomorrow is a block
 * day. The header alone answers that; the full slot list is one tap away
 * because most of the time nobody needs it.
 */
function NextDay({ today, settings }: { today: string; settings: Settings }) {
  const [open, setOpen] = useState(false);

  // Strictly after today: on a school day we've just finished, today is still
  // a school day and would otherwise match itself.
  const next = upcomingSchoolDays(
    addDays(today, 1),
    1,
    settings.customOverrides,
    settings.extraPeriods,
  )[0];

  if (!next?.template) return null;
  const template = next.template;
  const first = template.slots[0];

  return (
    <section className={`accent-${template.accent} px-5 pt-4`}>
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        {nextDayLabel(today, next.date)}
      </h2>

      <div className="overflow-hidden rounded-2xl border border-app bg-surface">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-accent">{template.name}</p>
            <p className="truncate text-xs text-dim">
              First bell {formatTime(first.start)} · {slotTitle(first, settings.classes)}
            </p>
            {next.label && <p className="truncate text-xs text-faint">{next.label}</p>}
          </div>
          <span
            aria-hidden
            className="shrink-0 text-xs text-dim transition-transform duration-200"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          >
            ▾
          </span>
        </button>

        <Collapse open={open}>
          <ol className="border-t border-app">
            {template.slots.map((slot, i) => (
              <SlotRow
                key={`${slot.label}-${slot.start}`}
                slot={slot}
                settings={settings}
                isCurrent={false}
                isPast={false}
                isFirst={i === 0}
              />
            ))}
          </ol>
        </Collapse>
      </div>
    </section>
  );
}

function SlotRow({
  slot,
  settings,
  isCurrent,
  isPast,
  isFirst,
}: {
  slot: Slot;
  settings: Settings;
  isCurrent: boolean;
  isPast: boolean;
  isFirst: boolean;
}) {
  const cls = slotClass(slot, settings.classes);
  const isBreak = slot.kind === 'brunch' || slot.kind === 'lunch';

  return (
    <li
      className={[
        'flex items-center gap-3 px-4 py-3',
        isFirst ? '' : 'border-t border-app',
        isCurrent ? 'bg-surface-2' : '',
        isPast && !isCurrent ? 'opacity-45' : '',
      ].join(' ')}
    >
      <div
        className={[
          'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold',
          isCurrent ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
        ].join(' ')}
      >
        {slot.period ?? '·'}
      </div>

      <div className="min-w-0 flex-1">
        <p className={['truncate', isBreak ? 'text-dim' : 'font-medium'].join(' ')}>
          {slotTitle(slot, settings.classes)}
        </p>
        {(cls?.teacher || cls?.room) && (
          <p className="truncate text-xs text-faint">
            {[cls.teacher, cls.room && `Room ${cls.room}`].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      <p className="tnum shrink-0 text-right text-xs text-dim">
        {formatTime(slot.start)}
        <br />
        {formatTime(slot.end)}
      </p>
    </li>
  );
}

function DayOff({
  today,
  settings,
  onOpenCalendar,
}: {
  today: string;
  settings: Settings;
  onOpenCalendar: () => void;
}) {
  const next = upcomingSchoolDays(addDays(today, 1), 1, settings.customOverrides)[0];
  const beforeYear = today < SCHOOL_YEAR.firstDay;

  return (
    <>
    <section className="px-5">
      <div className="rounded-2xl border border-app bg-surface p-6 text-center">
        <p className="text-4xl">{beforeYear ? '☀️' : '🌙'}</p>
        <p className="mt-3 text-lg font-medium">
          {beforeYear ? `School starts ${shortDate(SCHOOL_YEAR.firstDay)}` : 'Nothing scheduled'}
        </p>
        {/* The "next up" summary that used to live here is now the card
            below, which says the same thing plus the bell times. */}
        {!next && (
          <p className="mt-1 text-sm text-dim">
            That's the whole {SCHOOL_YEAR.label} year.
          </p>
        )}
        <button
          onClick={onOpenCalendar}
          className="mt-4 rounded-full border border-app px-4 py-2 text-sm font-medium text-dim transition-colors hover:bg-surface-2"
        >
          Open calendar
        </button>
      </div>
    </section>
    <NextDay today={today} settings={settings} />
    </>
  );
}

function ComingUp({ today, hidden }: { today: string; hidden: EventCategory[] }) {
  const events = upcomingEvents(today, 5, hidden);
  if (events.length === 0) return null;

  return (
    <section className="px-5 pt-6">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Coming up
      </h2>
      <ul className="overflow-hidden rounded-2xl border border-app bg-surface">
        {events.map((e, i) => (
          <li
            key={`${e.date}-${e.title}`}
            className={['flex items-center gap-3 px-4 py-3', i === 0 ? '' : 'border-t border-app'].join(
              ' ',
            )}
          >
            <span className="text-lg" aria-hidden>
              {categoryIcon(e.category)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{e.title}</p>
              <p className="text-xs text-faint">
                {shortDate(e.date)}
                {e.endDate ? ` – ${shortDate(e.endDate)}` : ''}
              </p>
            </div>
            <span className="tnum shrink-0 text-xs text-dim">{daysAway(today, e.date)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function categoryIcon(c: string): string {
  switch (c) {
    case 'social':
      return '🎉';
    case 'deadline':
      return '📝';
    case 'break':
      return '🌴';
    case 'sports':
      return '🏆';
    case 'arts':
      return '🎭';
    case 'other':
      return '📌';
    default:
      return '📚';
  }
}

function daysAway(from: string, to: string): string {
  const ms = fromISODate(to).getTime() - fromISODate(from).getTime();
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return 'now';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}

/** "Tomorrow" when it really is, otherwise name the day so Friday afternoon
 *  doesn't promise Saturday classes. */
function nextDayLabel(from: string, to: string): string {
  const days = Math.round(
    (fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000,
  );
  if (days === 1) return 'Tomorrow';
  const weekday = fromISODate(to).toLocaleDateString(undefined, { weekday: 'long' });
  // Past a week out, the weekday alone is ambiguous — say which one.
  return days <= 6 ? weekday : `${weekday}, ${shortDate(to)}`;
}

function longDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function shortDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
