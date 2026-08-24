import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Today } from './screens/Today';
import { CalendarScreen } from './screens/CalendarScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ClassesScreen } from './screens/ClassesScreen';
import { CollegeScreen } from './screens/CollegeScreen';
import { Onboarding } from './screens/Onboarding';
import { useNow } from './lib/useNow';
import { toISODate } from './lib/date';
import {
  flushPush,
  localStamp,
  markChanged,
  pullSchedule,
  queuePush,
  touchesSchedule,
} from './lib/sync';
import { loadSettings, saveSettings, type Settings } from './lib/storage';
import { NotificationScheduler, planNotifications } from './lib/notifications';
import { registerPush, unregisterPush } from './lib/push';
import { loadLiveFeed } from './lib/liveFeed';
import { Tour } from './components/Tour';

type Tab = 'today' | 'calendar' | 'classes' | 'college' | 'settings';

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<Tab>('today');
  const now = useNow();
  const today = toISODate(now);

  const update = useCallback((patch: Partial<Settings>, fromServer = false) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);

      // Only upload when the edit actually touched the schedule, and never
      // when the edit *came from* the server — that would bounce it straight
      // back and, worse, restamp it as a fresh local change.
      if (!fromServer && touchesSchedule(patch)) {
        markChanged();
        queuePush(next);
      }

      // registerPush recomputes the alert list and leaves a copy where the
      // service worker can read it, so the worker never has to re-derive it.
      // Switching every alert off should stop the server waking the phone,
      // not just stop it showing anything.
      if (anyAlertOn(next)) void registerPush(next);
      else void unregisterPush();
      return next;
    });
  }, []);

  // Theme: explicit choice wins, otherwise fall through to prefers-color-scheme.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Notifications. The scheduler re-plans whenever prefs, classes or overrides
  // change, and it re-reads the plan on each fire so a day rollover is picked up.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const schedulerRef = useRef<NotificationScheduler | null>(null);

  /*
    Pull the schedule down on open, and hand anything unsent up on the way out.

    The GET answers 401 when nobody is signed in, so this needs no knowledge of
    auth state — signed out, it simply does nothing.
  */
  useEffect(() => {
    void pullSchedule().then((result) => {
      if (result.kind === 'server-newer') {
        // fromServer: applying this must not look like a local edit, or it
        // would be stamped fresh and pushed straight back.
        update(result.schedule, true);
        markChanged(result.updated);
      } else if (result.kind === 'nothing-stored' || result.kind === 'local-newer') {
        // A first sign-in on a device that already has a schedule: seed the
        // server so the *next* device gets it.
        if (localStamp() === 0) markChanged();
        queuePush(settingsRef.current);
      }
    });

    // The debounce would otherwise eat an edit made just before switching apps.
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPush);
    };
  }, [update]);

  // The worker asks for this when a poke arrives and it has no plan to match
  // it against — the one case it can't fix on its own.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'ahs:resync') void registerPush(settingsRef.current);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // Pull the school's latest calendar. `feedVersion` only exists to re-render
  // the screens once it lands — the data itself lives inside resolveDay.
  const [feedVersion, setFeedVersion] = useState(0);
  useEffect(() => {
    void loadLiveFeed().then(() => {
      setFeedVersion((v) => v + 1);
      // Registration waits for the calendar rather than racing it. Doing it on
      // mount as well used to cost two server writes per app open and planned
      // the first one against the bundled schedule, so a day the school had
      // moved would fire its alerts at the old times. loadLiveFeed resolves
      // false rather than rejecting, so this runs even offline.
      void registerPush(settingsRef.current);
    });
  }, []);

  useEffect(() => {
    const scheduler = new NotificationScheduler(() => {
      const s = settingsRef.current;
      const day = toISODate(new Date());
      // Plan today and tomorrow so an evening alert for tomorrow, and tomorrow's
      // early-morning class alerts, are both already armed.
      return [
        ...planNotifications(
          day,
          s.notifications,
          s.classes,
          s.customOverrides,
          undefined,
          s.extraPeriods,
        ),
        ...planNotifications(
          nextDay(day),
          s.notifications,
          s.classes,
          s.customOverrides,
          undefined,
          s.extraPeriods,
        ),
      ];
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => {
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, []);

  // Re-plan whenever anything the plan depends on changes.
  const notifKey = useMemo(
    () =>
      JSON.stringify([
        settings.notifications,
        settings.classes,
        settings.customOverrides,
        settings.extraPeriods,
      ]),
    [
      settings.notifications,
      settings.classes,
      settings.customOverrides,
      settings.extraPeriods,
    ],
  );
  useEffect(() => {
    schedulerRef.current?.replan();
  }, [notifKey]);

  // Show the walkthrough once. Gated on `onboarded` so it can't stack on top
  // of the first-run setup screens.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (settings.onboarded && !settings.tourSeen) setTourOpen(true);
  }, [settings.onboarded, settings.tourSeen]);

  const closeTour = useCallback(() => {
    setTourOpen(false);
    update({ tourSeen: true });
  }, [update]);

  // A new screen should start at the top. The page itself scrolls (not an
  // inner container), so swapping tab content otherwise leaves you halfway
  // down someone else's screen. useLayoutEffect rather than useEffect so the
  // jump happens before paint instead of as a visible flash.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  if (!settings.onboarded) {
    return <Onboarding settings={settings} update={update} />;
  }

  return (
    <div className="safe-x mx-auto flex min-h-dvh max-w-md flex-col">
      <main className="safe-top flex-1 pb-32" key={feedVersion}>
        {/* Keyed on the tab so React remounts it and the rise-in replays,
            giving each switch a direction instead of a hard cut. */}
        <div key={tab} className="animate-rise">
          {tab === 'today' && (
            <Today
              today={today}
              now={now}
              settings={settings}
              update={update}
              onOpenCalendar={() => setTab('calendar')}
            />
          )}
          {tab === 'calendar' && <CalendarScreen today={today} settings={settings} />}
          {tab === 'classes' && (
            <ClassesScreen settings={settings} update={update} />
          )}
          {tab === 'college' && (
            <CollegeScreen today={today} settings={settings} update={update} />
          )}
          {tab === 'settings' && (
            <SettingsScreen
              settings={settings}
              update={update}
              onOpenTour={() => setTourOpen(true)}
            />
          )}
        </div>
      </main>

      <TabBar tab={tab} setTab={setTab} />
      <Tour open={tourOpen} onClose={closeTour} />
    </div>
  );
}

function anyAlertOn(s: Settings): boolean {
  const n = s.notifications;
  return (
    n.classStarting.on ||
    n.tomorrowType.on ||
    n.upcomingEvents.on ||
    n.mealsAndBell.on
  );
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + 1));
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '◉' },
  { id: 'calendar', label: 'Calendar', icon: '▦' },
  { id: 'classes', label: 'Classes', icon: '✎' },
  { id: 'college', label: 'College', icon: '◆' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

/**
 * A floating island rather than an edge-to-edge bar.
 *
 * The active state is a single pill that slides between tabs instead of five
 * that toggle — so the eye tracks one moving object and the switch reads as
 * movement rather than a blink. The outer wrapper ignores pointer events so
 * content can still be tapped either side of the island.
 */
function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const index = Math.max(
    0,
    TABS.findIndex((t) => t.id === tab),
  );

  return (
    <nav className="float-bottom safe-x pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md px-4">
      {/*
        The p-1 matters: it makes each tab exactly one fifth of the *padded*
        content box, which is the same width as the pill below. Without it the
        pill is a few pixels narrower than a tab and drifts further out of
        alignment with every step across.
      */}
      <ul className="accent-blue pointer-events-auto relative flex rounded-[22px] border border-app bg-surface/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl">
        <li
          aria-hidden
          className="absolute bottom-1 left-1 top-1 rounded-[18px] bg-surface-2"
          style={{
            width: `calc((100% - 0.5rem) / ${TABS.length})`,
            transform: `translateX(calc(${index} * 100%))`,
            transition: 'transform 340ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        />

        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <li key={t.id} className="relative flex-1">
              <button
                onClick={() => {
                  // Also covers re-tapping the tab you're already on, which
                  // wouldn't change `tab` and so wouldn't fire the effect —
                  // and "tap the active tab to jump to the top" is the
                  // behaviour people expect from a tab bar anyway.
                  setTab(t.id);
                  window.scrollTo({ top: 0, behavior: active ? 'smooth' : 'auto' });
                }}
                aria-current={active ? 'page' : undefined}
                className={[
                  'flex w-full flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors duration-200',
                  active ? 'text-accent' : 'text-faint',
                ].join(' ')}
              >
                <span
                  className="text-lg leading-none transition-transform duration-300"
                  style={{ transform: active ? 'translateY(-1px) scale(1.08)' : 'none' }}
                  aria-hidden
                >
                  {t.icon}
                </span>
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
