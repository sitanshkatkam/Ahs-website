import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { clubTimeLabel, meetsOn, scheduleLabel } from '../lib/clubs';
import { resolveDay } from '../lib/resolveDay';
import {
  WEEKDAY_LABELS,
  WEEK_LABELS,
  newId,
  type Club,
  type ClubFrequency,
  type Settings,
  type Weekday,
  type WeekOfMonth,
} from '../lib/storage';

type Props = {
  today: string;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

/**
 * Clubs: what you're in, when it meets, and where.
 *
 * Nothing here is derived from the school — a club roster is personal, and no
 * feed publishes "Robotics, Tuesdays in 512". So it is all typed in, which
 * means the add form has to be short enough that somebody actually finishes it.
 * Name is the only required field; a club with no time still earns its place in
 * the list, because knowing it exists and meets on Tuesdays is most of the
 * value.
 */
export function ClubsScreen({ today, settings, update }: Props) {
  const [editing, setEditing] = useState<Club | 'new' | null>(null);

  const schoolDay = resolveDay(today, settings.customOverrides, settings.extraPeriods)
    .isSchoolDay;

  // Meeting today floats to the top: on the day itself that is the only thing
  // anybody opens this screen to check.
  const meetingToday = settings.clubs.filter((c) => meetsOn(c, today, schoolDay));
  const rest = settings.clubs.filter((c) => !meetingToday.includes(c));

  const save = (club: Club) => {
    const exists = settings.clubs.some((c) => c.id === club.id);
    update({
      clubs: exists
        ? settings.clubs.map((c) => (c.id === club.id ? club : c))
        : [...settings.clubs, club],
    });
    setEditing(null);
  };

  const remove = (id: string) => {
    update({ clubs: settings.clubs.filter((c) => c.id !== id) });
    setEditing(null);
  };

  return (
    <div className="accent-violet px-5 pb-4">
      <header className="flex items-start justify-between pt-3 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clubs</h1>
          <p className="text-sm text-dim">
            {settings.clubs.length === 0
              ? 'Nothing added yet'
              : `${settings.clubs.length} club${settings.clubs.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          aria-label="Add a club"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-2xl font-light leading-none text-white"
        >
          +
        </button>
      </header>

      {settings.clubs.length === 0 ? (
        <div className="rounded-2xl border border-app bg-surface p-6 text-center">
          <p className="text-4xl" aria-hidden>
            🎭
          </p>
          <p className="mt-3 text-sm text-dim">
            Add the clubs you're in and this becomes the place to check what meets today.
          </p>
          <button
            onClick={() => setEditing('new')}
            className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            Add your first club
          </button>
        </div>
      ) : (
        <>
          {meetingToday.length > 0 && (
            <section className="pb-6">
              <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
                Meeting today
              </h2>
              <ul className="space-y-2">
                {meetingToday.map((c) => (
                  <ClubRow key={c.id} club={c} highlight onEdit={() => setEditing(c)} />
                ))}
              </ul>
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
                {meetingToday.length > 0 ? 'Everything else' : 'Your clubs'}
              </h2>
              <ul className="space-y-2">
                {rest.map((c) => (
                  <ClubRow key={c.id} club={c} onEdit={() => setEditing(c)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <ClubSheet
        club={editing}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={remove}
      />
    </div>
  );
}

function ClubRow({
  club,
  highlight,
  onEdit,
}: {
  club: Club;
  highlight?: boolean;
  onEdit: () => void;
}) {
  const time = clubTimeLabel(club);
  return (
    <li>
      <button
        onClick={onEdit}
        className={[
          'flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors',
          highlight ? 'border-accent bg-accent-soft' : 'border-app bg-surface',
        ].join(' ')}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{club.name}</span>
          <span className="block truncate text-xs text-faint">
            {scheduleLabel(club)}
            {club.room && ` · Room ${club.room}`}
          </span>
        </span>
        {time && <span className="tnum shrink-0 text-sm text-dim">{time}</span>}
        <span aria-hidden className="shrink-0 text-faint">
          ▸
        </span>
      </button>
    </li>
  );
}

/** Add or edit. `'new'` opens it empty; a Club opens it filled in. */
function ClubSheet({
  club,
  onClose,
  onSave,
  onDelete,
}: {
  club: Club | 'new' | null;
  onClose: () => void;
  onSave: (c: Club) => void;
  onDelete: (id: string) => void;
}) {
  const existing = club !== null && club !== 'new' ? club : null;

  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<ClubFrequency>('weekly');
  const [weekday, setWeekday] = useState<Weekday>(2);
  const [week, setWeek] = useState<WeekOfMonth>(1);
  const [time, setTime] = useState('');
  const [room, setRoom] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  /*
    Load the club being edited, during render rather than in an effect: showing
    the previous club's name in the field for a frame would be worse than a
    second render pass.

    Clearing `loadedFor` on close is the load-bearing half. Without it, two
    consecutive "new club" opens share the same key, the reload is skipped, and
    the second club silently inherits the first one's time and room — which is
    exactly the sort of thing a student would only notice a week later, wonder
    why Chess Club says Room 512, and stop trusting the app.
  */
  const key = club === 'new' ? 'new' : (existing?.id ?? null);
  if (club === null) {
    if (loadedFor !== null) setLoadedFor(null);
  } else if (key !== loadedFor) {
    setLoadedFor(key);
    setName(existing?.name ?? '');
    setFrequency(existing?.frequency ?? 'weekly');
    setWeekday(existing?.weekday ?? 2);
    setWeek(existing?.week ?? 1);
    setTime(existing?.time ?? '');
    setRoom(existing?.room ?? '');
  }

  const submit = () => {
    if (!name.trim()) return;
    onSave({
      id: existing?.id ?? newId(),
      name: name.trim(),
      frequency,
      weekday,
      week,
      ...(time ? { time } : {}),
      ...(room.trim() ? { room: room.trim() } : {}),
    });
  };

  return (
    <Sheet open={club !== null} onClose={onClose} label={existing ? 'Edit club' : 'New club'}>
      <div className="px-5 pb-6 pt-1">
        <h2 className="text-xl font-semibold">{existing ? 'Edit club' : 'New club'}</h2>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-widest text-faint">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Robotics"
          className="mt-1 w-full rounded-xl bg-surface-2 px-3 py-3 outline-none placeholder:text-faint"
        />

        <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-faint">
          How often
        </p>
        <div className="mt-2 flex gap-2">
          {(['daily', 'weekly', 'monthly'] as ClubFrequency[]).map((f) => (
            <button
              key={f}
              onClick={() => setFrequency(f)}
              aria-pressed={frequency === f}
              className={[
                'flex-1 rounded-xl py-2.5 text-sm font-medium capitalize transition-colors',
                frequency === f ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>

        {/* A daily club has no day to pick, so the control isn't shown. */}
        {frequency !== 'daily' && (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-faint">
              Which day
            </p>
            <div className="mt-2 flex gap-1">
              {WEEKDAY_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setWeekday(i as Weekday)}
                  aria-pressed={weekday === i}
                  aria-label={label}
                  className={[
                    'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                    weekday === i ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
                  ].join(' ')}
                >
                  {label.slice(0, 1)}
                </button>
              ))}
            </div>
          </>
        )}

        {frequency === 'monthly' && (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-faint">
              Which one
            </p>
            <div className="mt-2 flex gap-1">
              {([1, 2, 3, 4, 5] as WeekOfMonth[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  aria-pressed={week === w}
                  className={[
                    'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                    week === w ? 'bg-accent text-white' : 'bg-surface-2 text-dim',
                  ].join(' ')}
                >
                  {WEEK_LABELS[w]}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-5 flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-widest text-faint">
              Time
            </label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-widest text-faint">
              Room
            </label>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="512"
              className="mt-1 w-full rounded-xl bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-faint"
            />
          </div>
        </div>

        <p className="mt-2 text-xs text-faint">Time and room are optional.</p>

        <button
          onClick={submit}
          disabled={!name.trim()}
          className="mt-5 w-full rounded-2xl bg-accent py-3.5 font-semibold text-white disabled:opacity-40"
        >
          {existing ? 'Save' : 'Add club'}
        </button>

        {existing && (
          <button
            onClick={() => onDelete(existing.id)}
            className="mt-2 w-full rounded-2xl py-3 text-sm font-medium text-[color:var(--accent-rose)]"
          >
            Remove this club
          </button>
        )}
      </div>
    </Sheet>
  );
}
