import { useEffect, useMemo, useState } from 'react';
import { SCHEDULES, type ScheduleId } from '../data/schedules';
import {
  CATEGORY_LABELS,
  EVENT_CATEGORIES,
  SCHOOL_YEAR,
  type DayOverride,
  type EventCategory,
} from '../data/calendar';
import { currentFeed } from '../lib/resolveDay';
import { fromISODate } from '../lib/date';
import {
  fireTestNotification,
  notificationsSupported,
  permission,
  requestPermission,
} from '../lib/notifications';
import { plannedTimes, pushActive, pushConfigured } from '../lib/push';
import { InstallSettingsRow, useInstallState } from '../components/InstallPrompt';
import { SharePanel, shareUrl } from '../components/SharePanel';
import { Collapse } from '../components/Collapse';
import { BUILD_TIME, checkForUpdate } from '../lib/appUpdate';
import {
  GRADES,
  PERIOD_KIND_LABELS,
  activePeriods,
  type ExtraPeriod,
  type NotificationPrefs,
  type PeriodKind,
  type Settings,
} from '../lib/storage';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

export function SettingsScreen({
  settings,
  update,
  onOpenTour,
}: Props & { onOpenTour: () => void }) {
  return (
    <div className="px-5 pb-4">
      <header className="pt-3 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-dim">Everything is stored on this device only.</p>
      </header>

      <CreditsCard />

      <Section title="Tour" hint="Takes about thirty seconds.">
        <button onClick={onOpenTour} className="flex w-full items-center gap-3 p-4 text-left">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">
              {settings.tourSeen ? 'Take the tour again' : 'Take the tour'}
            </span>
            <span className="block text-xs text-faint">A quick look at all five tabs</span>
          </span>
          <span className="accent-blue shrink-0 text-sm font-medium text-accent">Start</span>
        </button>
      </Section>

      <ClassesSection settings={settings} update={update} />
      <ExtraPeriodsSection settings={settings} update={update} />

      <Section title="Home screen">
        <InstallSettingsRow />
      </Section>

      <GradeSection settings={settings} update={update} />
      <ShareSection />
      <UpdateSection />

      <NotificationsSection settings={settings} update={update} />
      <EventFilterSection settings={settings} update={update} />
      <GpaSection settings={settings} update={update} />
      <AppearanceSection settings={settings} update={update} />
      <OverridesSection settings={settings} update={update} />

      <p className="pt-8 text-center text-xs text-faint">
        Bell times from the official FUSD schedule.
      </p>
    </div>
  );
}

/**
 * The app updates itself, but an installed PWA gives no visible sign of that
 * and has no reload button — so show which build is running and offer a manual
 * nudge. Being able to say "it says Aug 15" is worth a lot when debugging.
 */
function UpdateSection() {
  const [state, setState] = useState<'idle' | 'checking' | 'current'>('idle');

  const built = new Date(BUILD_TIME);
  const builtLabel = Number.isNaN(built.getTime())
    ? 'development build'
    : built.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

  return (
    <Section
      title="App version"
      hint="The app checks for updates when you open it and refreshes itself. If a new version is found, it reloads once."
    >
      <div className="flex items-center gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Running build</span>
          <span className="block truncate text-xs text-faint">{builtLabel}</span>
        </span>
        <button
          onClick={async () => {
            setState('checking');
            await checkForUpdate();
            // If an update existed, the page reloads and this never runs.
            window.setTimeout(() => setState('current'), 1200);
          }}
          className="accent-blue shrink-0 text-sm font-medium text-accent"
        >
          {state === 'checking' ? 'Checking…' : state === 'current' ? 'Up to date' : 'Check now'}
        </button>
      </div>
    </Section>
  );
}

/**
 * Sits above everything else in Settings — it's the one thing here that isn't
 * a control, so burying it at the bottom would mean nobody ever reads it.
 */
function CreditsCard() {
  return (
    <section className="pb-7">
      <div className="accent-blue rounded-2xl border border-app bg-surface p-5 text-center">
        <p className="text-2xl" aria-hidden>
          🦅
        </p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-faint">
          Made by
        </p>
        <p className="mt-1.5 text-lg font-semibold leading-snug">Vihaan Shah</p>
        <p className="mt-1.5 text-sm leading-relaxed text-dim">
          with inspiration from Sitansh Katkam
          <br />
          using Claude Code
        </p>
        <p className="mt-3 border-t border-app pt-3 text-xs text-faint">
          Built for American High School · {SCHOOL_YEAR.label}
        </p>
      </div>
    </section>
  );
}

function GradeSection({ settings, update }: Props) {
  const current = settings.gradeLevel;
  return (
    <Section
      title="Your grade"
      hint="Switches the college checklist and which deadlines you see."
    >
      <div className="p-4">
        <p className="pb-2 text-sm text-dim">
          {current ? `You're in grade ${current}.` : 'Not set yet.'}
        </p>
        <div className="flex gap-2">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => update({ gradeLevel: g })}
              aria-pressed={current === g}
              className={[
                'accent-blue flex-1 rounded-xl py-2.5 text-base font-semibold transition-colors',
                current === g ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
              ].join(' ')}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function ShareSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Share" hint="Anyone at American High can use this — no account needed.">
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Show the QR code</span>
          <span className="block truncate text-xs text-faint">{shareUrl()}</span>
        </span>
        <span className="accent-blue shrink-0 text-sm font-medium text-accent">Open</span>
      </button>
      <SharePanel open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-7">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-app bg-surface">{children}</div>
      {hint && <p className="px-1 pt-2 text-xs text-faint">{hint}</p>}
    </section>
  );
}

/**
 * A section that stays shut until you want it.
 *
 * Settings had grown to about four and a half phone screens, which is a lot to
 * scroll past to change one thing — and for a freshman opening it for the first
 * time, a wall of controls reads as "this app is complicated".
 *
 * The rule applied here: collapse anything long that you set once and forget,
 * and never collapse it into silence. `summary` is the whole point — the card
 * has to answer its own question shut ("2 of 5 on") so that closing it hides
 * the controls, not the state. A card you must open to learn anything from is
 * worse than one that was always open.
 */
function CollapsibleSection({
  title,
  hint,
  label,
  summary,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Section title={title} hint={hint}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          <span className="block text-xs text-faint">{summary}</span>
        </span>
        <span
          className="shrink-0 text-faint transition-transform duration-300"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          aria-hidden
        >
          ▸
        </span>
      </button>

      <Collapse open={open}>
        <div className="border-t border-app">{children}</div>
      </Collapse>
    </Section>
  );
}

/** Shut, these cards still have to say where they stand. */
function extraPeriodSummary(settings: Settings): string {
  const on = settings.extraPeriods.filter((e) => e.enabled).map((e) => e.period);
  if (on.length === 0) return 'Off — just periods 1 to 6';
  return on.length === 1 ? `Period ${on[0]} on` : `Periods ${on.join(' and ')} on`;
}

function alertSummary(prefs: NotificationPrefs): string {
  const flags = [
    prefs.classStarting.on,
    prefs.tomorrowType.on,
    prefs.upcomingEvents.on,
    prefs.mealsAndBell.on,
    prefs.assignmentsDue.on,
  ];
  const on = flags.filter(Boolean).length;
  return on === 0 ? 'All off' : `${on} of ${flags.length} on`;
}

function ClassesSection({ settings, update }: Props) {
  const setClass = (
    period: number,
    patch: Partial<{ name: string; teacher: string; room: string; kind: PeriodKind }>,
  ) => {
    update({
      classes: settings.classes.map((c) => (c.period === period ? { ...c, ...patch } : c)),
    });
  };

  // Eight period rows is a wall of inputs to scroll past every time you open
  // Settings, and they're set once a semester.
  const periods = activePeriods(settings);
  const filled = periods.filter(
    (p) => settings.classes.find((c) => c.period === p)?.name.trim(),
  ).length;

  return (
    <CollapsibleSection
      title="My classes"
      hint="Mark a period Free or TA if it isn't a class — it'll be labelled properly on your schedule and left out of your GPA."
      label={filled === 0 ? 'Add your classes' : 'Edit your classes'}
      summary={`${filled} of ${periods.length} periods filled in`}
    >
      {periods.map((period, i) => {
        const cls = settings.classes.find((c) => c.period === period)!;
        const kind = cls.kind ?? 'class';
        const isClass = kind === 'class';
        return (
          <div key={period} className={['p-4', i === 0 ? '' : 'border-t border-app'].join(' ')}>
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-dim">
                {period}
              </span>
              <input
                value={cls.name}
                onChange={(e) => setClass(period, { name: e.target.value })}
                placeholder={isClass ? `Period ${period} class` : PERIOD_KIND_LABELS[kind]}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              />
            </div>

            <div className="mt-2 flex gap-1 pl-11">
              {(['class', 'free', 'ta'] as PeriodKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setClass(period, { kind: k })}
                  className={[
                    'accent-blue rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    kind === k ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
                  ].join(' ')}
                >
                  {PERIOD_KIND_LABELS[k]}
                </button>
              ))}
            </div>

            {isClass && (
              <div className="mt-2 flex gap-2 pl-11">
                <input
                  value={cls.teacher ?? ''}
                  onChange={(e) => setClass(period, { teacher: e.target.value })}
                  placeholder="Teacher"
                  className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint"
                />
                <input
                  value={cls.room ?? ''}
                  onChange={(e) => setClass(period, { room: e.target.value })}
                  placeholder="Room"
                  className="w-24 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint"
                />
              </div>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
}

/**
 * Zero and seventh period. Their times aren't in the district bell schedule —
 * it only publishes periods 1-6 — so rather than invent them, the student
 * enters their own.
 */
function ExtraPeriodsSection({ settings, update }: Props) {
  const set = (period: number, patch: Partial<ExtraPeriod>) =>
    update({
      extraPeriods: settings.extraPeriods.map((e) =>
        e.period === period ? { ...e, ...patch } : e,
      ),
    });

  return (
    <CollapsibleSection
      title="Zero & seventh period"
      hint="These aren't on the official bell schedule, so enter your own times. They'll show on every school day — double-check minimum and finals days."
      label="Set up extra periods"
      summary={extraPeriodSummary(settings)}
    >
      {settings.extraPeriods.map((e, i) => (
        <div key={e.period} className={['p-4', i === 0 ? '' : 'border-t border-app'].join(' ')}>
          <label className="flex cursor-pointer items-center gap-3">
            <span className="flex-1 font-medium">Period {e.period}</span>
            <input
              type="checkbox"
              checked={e.enabled}
              onChange={(ev) => set(e.period, { enabled: ev.target.checked })}
              className="peer sr-only"
            />
            {/* Colour comes from React state rather than `peer-checked:`. The
                Tailwind variant would not beat the base background on this
                element, and a switch that never visibly turns on is worse than
                one that doesn't animate. */}
            <span
              className={[
                'accent-blue relative h-6 w-11 shrink-0 rounded-full transition-colors',
                e.enabled ? 'bg-accent' : 'bg-surface-2',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                  e.enabled ? 'left-[22px]' : 'left-0.5',
                ].join(' ')}
              />
            </span>
          </label>

          {e.enabled && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="time"
                value={e.start}
                onChange={(ev) => set(e.period, { start: ev.target.value })}
                className="flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
              <span className="text-sm text-faint">to</span>
              <input
                type="time"
                value={e.end}
                onChange={(ev) => set(e.period, { end: ev.target.value })}
                className="flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
              />
            </div>
          )}
          {e.enabled && e.start >= e.end && (
            <p className="mt-2 text-xs text-accent accent-rose">
              The end time needs to be after the start time.
            </p>
          )}
        </div>
      ))}
    </CollapsibleSection>
  );
}

function NotificationsSection({ settings, update }: Props) {
  const [denied, setDenied] = useState(permission() === 'denied');
  const [testState, setTestState] = useState<'idle' | 'sent'>('idle');
  const supported = notificationsSupported();
  const prefs = settings.notifications;

  const setPrefs = (patch: Partial<NotificationPrefs>) =>
    update({ notifications: { ...prefs, ...patch } });

  /**
   * The permission prompt has to happen inside the click, so this runs before
   * the state change. If the user says no, the toggle stays off rather than
   * sitting there looking enabled and doing nothing.
   */
  const toggle = async (apply: (on: boolean) => void, next: boolean) => {
    if (next && permission() !== 'granted') {
      const result = await requestPermission();
      if (result !== 'granted') {
        setDenied(result === 'denied');
        return;
      }
      setDenied(false);
    }
    apply(next);
  };

  if (!supported) {
    return (
      <Section title="Notifications">
        <p className="p-4 text-sm text-dim">
          This browser doesn't support notifications. Install the app to your home screen and try
          again.
        </p>
      </Section>
    );
  }

  return (
    <CollapsibleSection
      title="Notifications"
      // DeliveryStatus stays outside the collapse on purpose: "Next alert:
      // Thursday 8:25 AM" is the one thing worth seeing without a tap.
      hint={<DeliveryStatus settings={settings} />}
      label="Manage alerts"
      summary={alertSummary(prefs)}
    >
      <Toggle
        label="Class starting soon"
        sub={`${prefs.classStarting.minutesBefore} minutes before each period`}
        checked={prefs.classStarting.on}
        onChange={(v) =>
          toggle((on) => setPrefs({ classStarting: { ...prefs.classStarting, on } }), v)
        }
      >
        {prefs.classStarting.on && (
          <NumberPicker
            value={prefs.classStarting.minutesBefore}
            options={[2, 5, 10, 15]}
            suffix="min"
            onChange={(minutesBefore) =>
              setPrefs({ classStarting: { ...prefs.classStarting, minutesBefore } })
            }
          />
        )}
      </Toggle>

      <Toggle
        label="Tomorrow's schedule"
        sub={`Evening before a block, rally, minimum or finals day`}
        checked={prefs.tomorrowType.on}
        onChange={(v) =>
          toggle((on) => setPrefs({ tomorrowType: { ...prefs.tomorrowType, on } }), v)
        }
      >
        {prefs.tomorrowType.on && (
          <NumberPicker
            value={prefs.tomorrowType.atHour}
            options={[17, 18, 19, 20, 21]}
            format={(h) => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'pm' : 'am'}`}
            onChange={(atHour) => setPrefs({ tomorrowType: { ...prefs.tomorrowType, atHour } })}
          />
        )}
      </Toggle>

      <Toggle
        label="Upcoming events"
        sub="Rallies, finals, breaks and deadlines"
        checked={prefs.upcomingEvents.on}
        onChange={(v) =>
          toggle((on) => setPrefs({ upcomingEvents: { ...prefs.upcomingEvents, on } }), v)
        }
      >
        {prefs.upcomingEvents.on && (
          <NumberPicker
            value={prefs.upcomingEvents.daysBefore}
            options={[1, 2, 3, 7]}
            suffix="days before"
            onChange={(daysBefore) =>
              setPrefs({ upcomingEvents: { ...prefs.upcomingEvents, daysBefore } })
            }
          />
        )}
      </Toggle>

      <Toggle
        label="Assignments due"
        sub="One digest, not a buzz per task"
        checked={prefs.assignmentsDue.on}
        onChange={(v) =>
          toggle((on) => setPrefs({ assignmentsDue: { ...prefs.assignmentsDue, on } }), v)
        }
      >
        {prefs.assignmentsDue.on && (
          <NumberPicker
            value={prefs.assignmentsDue.daysBefore}
            options={[0, 1, 2, 3]}
            format={(d) => (d === 0 ? 'same day' : d === 1 ? 'night before' : `${d} days`)}
            onChange={(daysBefore) =>
              setPrefs({ assignmentsDue: { ...prefs.assignmentsDue, daysBefore } })
            }
          />
        )}
      </Toggle>

      <Toggle
        label="Brunch, lunch & final bell"
        sub="A ping at each one"
        checked={prefs.mealsAndBell.on}
        onChange={(v) => toggle((on) => setPrefs({ mealsAndBell: { on } }), v)}
      />

      {denied && (
        <p className="border-t border-app p-4 text-sm text-dim">
          Notifications are blocked for this site. Turn them back on in your browser's site
          settings, then try again.
        </p>
      )}

      <div className="border-t border-app p-4">
        <button
          onClick={async () => {
            const ok = await fireTestNotification();
            if (ok) {
              setTestState('sent');
              window.setTimeout(() => setTestState('idle'), 2500);
            } else {
              setDenied(true);
            }
          }}
          className="text-sm font-medium text-accent accent-blue"
        >
          {testState === 'sent' ? 'Sent — check your notifications' : 'Send a test notification'}
        </button>
      </div>
    </CollapsibleSection>
  );
}

/**
 * Says plainly whether alerts survive the app being closed. Before push existed
 * this was a static apology; now it reports the real state, because "will this
 * actually wake me up" is the only thing anyone wants to know.
 */
function DeliveryStatus({ settings }: { settings: Settings }) {
  const [active, setActive] = useState<boolean | null>(null);
  const install = useInstallState();

  // Without this you can't tell a working setup from a broken one — you just
  // wait, and nothing happens, and you assume it's broken. Showing the next
  // scheduled alert makes "it's armed, just not due yet" visible.
  const next = useMemo(() => {
    const times = plannedTimes(settings);
    return times.length ? new Date(times[0]) : null;
  }, [settings]);

  const nextLabel =
    next &&
    next.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });

  useEffect(() => {
    let alive = true;
    void pushActive().then((v) => alive && setActive(v));
    return () => {
      alive = false;
    };
  }, [settings.notifications]);

  // The one case where turning a toggle on does nothing at all. Say so loudly
  // rather than letting someone miss a class waiting on an alert that iOS was
  // never going to deliver.
  if (install.kind === 'ios') {
    return (
      <>
        <span className="font-medium text-main">
          These won't work until you add the app to your Home Screen.
        </span>{' '}
        iPhone only delivers notifications to installed apps, never to a Safari tab. Tap Share,
        then “Add to Home Screen”, and open it from there.
      </>
    );
  }

  if (!pushConfigured()) {
    return (
      <>
        Running without a push server, so alerts only fire while the app is open or recently in
        the background.
      </>
    );
  }

  if (active) {
    return (
      <>
        <span className="font-medium text-main">Background delivery is on.</span>{' '}
        {next ? (
          <>
            Next alert: <span className="font-medium text-main">{nextLabel}</span>. Alerts arrive
            even if the app has been closed for days.
          </>
        ) : (
          <>
            Nothing is scheduled yet — turn on an alert above. Note that “Tomorrow’s schedule”
            only fires the evening before a block, rally, minimum or finals day.
          </>
        )}
      </>
    );
  }

  return (
    <>
      Turn on any alert above to enable background delivery. Until then they only fire while the
      app is open or recently in the background.
    </>
  );
}

function Toggle({
  label,
  sub,
  checked,
  onChange,
  children,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-t border-app first:border-t-0">
      <label className="flex cursor-pointer items-center gap-3 p-4">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{label}</span>
          {sub && <span className="block text-xs text-faint">{sub}</span>}
        </span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        {/* Colour comes from React state rather than `peer-checked:`. The
            Tailwind variant would not beat the base background on this
            element, and a switch that never visibly turns on is worse than
            one that doesn't animate. */}
        <span
          className={[
            'accent-blue relative h-6 w-11 shrink-0 rounded-full transition-colors',
            checked ? 'bg-accent' : 'bg-surface-2',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              checked ? 'left-[22px]' : 'left-0.5',
            ].join(' ')}
          />
        </span>
      </label>
      {children && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function NumberPicker({
  value,
  options,
  onChange,
  suffix,
  format,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
  suffix?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={[
            'accent-blue rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            o === value ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
          ].join(' ')}
        >
          {format ? format(o) : o}
        </button>
      ))}
      {suffix && <span className="text-xs text-faint">{suffix}</span>}
    </div>
  );
}

function EventFilterSection({ settings, update }: Props) {
  const hidden = settings.hiddenEventCategories;

  const toggle = (c: EventCategory) =>
    update({
      hiddenEventCategories: hidden.includes(c)
        ? hidden.filter((x) => x !== c)
        : [...hidden, c],
    });

  return (
    <CollapsibleSection
      title="Coming up"
      hint={`Events sync from the school's calendar. Last updated ${syncedOn()}.`}
      label="Choose what to show"
      summary={
        hidden.length === 0
          ? 'Showing every kind of event'
          : `Hiding ${hidden.length} of ${EVENT_CATEGORIES.length} kinds`
      }
    >
      <div className="flex flex-wrap gap-2 p-4">
        {EVENT_CATEGORIES.map((c) => {
          const on = !hidden.includes(c);
          return (
            <button
              key={c}
              onClick={() => toggle(c)}
              aria-pressed={on}
              className={[
                'accent-blue rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                on ? 'bg-accent text-white' : 'bg-surface-2 text-faint',
              ].join(' ')}
            >
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

function syncedOn(): string {
  const d = new Date(currentFeed().generatedAt);
  return Number.isNaN(d.getTime())
    ? 'never'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function GpaSection({ settings, update }: Props) {
  return (
    <Section
      title="GPA"
      hint="Schools differ on the honors bonus — check your transcript. AP is always +1. This is a personal tracker, not an official GPA."
    >
      <div className="p-4">
        <p className="pb-2 text-sm">Honors courses are worth</p>
        <div className="flex gap-2">
          {([0.5, 1] as const).map((b) => (
            <button
              key={b}
              onClick={() => update({ honorsBonus: b })}
              className={[
                'accent-blue flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors',
                settings.honorsBonus === b ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
              ].join(' ')}
            >
              +{b.toFixed(1)}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function AppearanceSection({ settings, update }: Props) {
  const options: Settings['theme'][] = ['system', 'light', 'dark'];
  return (
    <Section title="Appearance">
      <div className="flex gap-2 p-4">
        {options.map((t) => (
          <button
            key={t}
            onClick={() => update({ theme: t })}
            className={[
              'accent-blue flex-1 rounded-xl px-3 py-2.5 text-sm font-medium capitalize transition-colors',
              settings.theme === t ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
    </Section>
  );
}

function OverridesSection({ settings, update }: Props) {
  const [date, setDate] = useState('');
  const [choice, setChoice] = useState<string>('noSchool');

  const add = () => {
    if (!date) return;
    const next: DayOverride =
      choice === 'noSchool'
        ? { date, noSchool: true, label: 'Changed by you' }
        : { date, scheduleId: choice as ScheduleId, label: 'Changed by you' };
    update({
      customOverrides: [...settings.customOverrides.filter((o) => o.date !== date), next],
    });
    setDate('');
  };

  return (
    <CollapsibleSection
      title="Schedule changes"
      hint="If the school announces a change, add it here. Your entries override the built-in calendar and survive app updates."
      label="Add a schedule change"
      summary={
        settings.customOverrides.length === 0
          ? 'None added'
          : `${settings.customOverrides.length} saved`
      }
    >
      <div className="space-y-2 p-4">
        <input
          type="date"
          value={date}
          min={SCHOOL_YEAR.firstDay}
          max={SCHOOL_YEAR.lastDay}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm outline-none"
        />
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="w-full rounded-lg bg-surface-2 px-3 py-2.5 text-sm outline-none"
        >
          <option value="noSchool">No school</option>
          {Object.values(SCHEDULES).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={!date}
          className="accent-blue w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Add change
        </button>
      </div>

      {settings.customOverrides.length > 0 && (
        <ul className="border-t border-app">
          {[...settings.customOverrides]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((o) => (
              <li
                key={o.date}
                className="flex items-center gap-3 border-t border-app px-4 py-3 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {fromISODate(o.date).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  <p className="text-xs text-faint">
                    {o.noSchool ? 'No school' : SCHEDULES[o.scheduleId!].name}
                  </p>
                </div>
                <button
                  onClick={() =>
                    update({
                      customOverrides: settings.customOverrides.filter((x) => x.date !== o.date),
                    })
                  }
                  className="text-xs text-dim underline"
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
