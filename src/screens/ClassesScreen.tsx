import { useMemo, useState } from 'react';
import { Sheet } from '../components/Sheet';
import { Collapse } from '../components/Collapse';
import { addDays, fromISODate } from '../lib/date';
import {
  LETTERS,
  LEVEL_LABELS,
  SEMESTERS,
  cumulativeGpa,
  formatGpa,
  semesterGpa,
} from '../lib/gpa';
import type {
  Assignment,
  AssignmentType,
  CourseLevel,
  Semester,
  Settings,
  UserClass,
} from '../lib/storage';
import { activePeriods, isGraded, newId } from '../lib/storage';

type Props = {
  today: string;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

export function ClassesScreen({ today, settings, update }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const classes = settings.classes;
  const named = classes.filter((c) => c.name.trim());

  return (
    <div className="accent-blue px-5 pb-4">
      <header className="flex items-start justify-between pt-3 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Classes</h1>
          <p className="text-sm text-dim">Assignments and grades</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          + Task
        </button>
      </header>

      <GpaCard settings={settings} />

      {named.length === 0 ? (
        <p className="rounded-2xl border border-app bg-surface p-6 text-center text-sm text-dim">
          Add your classes in Settings and they'll show up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {activePeriods(settings).map((period) => {
            const cls = classes.find((c) => c.period === period);
            // Free periods have nothing to grade or hand in.
            if (!cls || !isGraded(cls.kind) || !cls.name.trim()) return null;
            return (
              <ClassRow
                key={period}
                cls={cls}
                today={today}
                settings={settings}
                update={update}
                expanded={open === period}
                onToggle={() => setOpen(open === period ? null : period)}
              />
            );
          })}
        </ul>
      )}

      <AssignmentSheet
        open={adding}
        today={today}
        settings={settings}
        update={update}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}

function GpaCard({ settings }: { settings: Settings }) {
  const { grades, classes, honorsBonus } = settings;
  const cumulative = cumulativeGpa(grades, classes, honorsBonus);
  const s1 = semesterGpa(grades, 's1', classes, honorsBonus);
  const s2 = semesterGpa(grades, 's2', classes, honorsBonus);

  return (
    <section className="mb-5 rounded-2xl border border-app bg-surface p-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">
            Weighted GPA
          </p>
          <p className="tnum mt-1 text-4xl font-semibold text-accent">
            {formatGpa(cumulative.weighted)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">Unweighted</p>
          <p className="tnum mt-1 text-2xl font-semibold">{formatGpa(cumulative.unweighted)}</p>
        </div>
      </div>

      {cumulative.count === 0 ? (
        <p className="mt-3 text-xs text-faint">
          Enter a grade for any class below to start tracking.
        </p>
      ) : (
        <div className="mt-4 flex gap-4 border-t border-app pt-3 text-xs text-dim">
          <span>
            S1 <span className="tnum font-medium text-main">{formatGpa(s1.weighted)}</span>
          </span>
          <span>
            S2 <span className="tnum font-medium text-main">{formatGpa(s2.weighted)}</span>
          </span>
          <span className="ml-auto text-faint">
            {cumulative.count} grade{cumulative.count === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </section>
  );
}

function ClassRow({
  cls,
  today,
  settings,
  update,
  expanded,
  onToggle,
}: {
  cls: UserClass;
  today: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const open = settings.assignments.filter((a) => a.period === cls.period && !a.done);
  const overdue = open.filter((a) => a.due < today).length;

  const setLevel = (level: CourseLevel) =>
    update({
      classes: settings.classes.map((c) => (c.period === cls.period ? { ...c, level } : c)),
    });

  const setGrade = (semester: Semester, letter: string) => {
    const rest = settings.grades.filter(
      (g) => !(g.period === cls.period && g.semester === semester),
    );
    update({ grades: letter ? [...rest, { period: cls.period, semester, letter }] : rest });
  };

  const gradeFor = (semester: Semester) =>
    settings.grades.find((g) => g.period === cls.period && g.semester === semester)?.letter ?? '';

  return (
    <li className="overflow-hidden rounded-2xl border border-app bg-surface">
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-dim">
          {cls.period}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{cls.name}</span>
            {cls.level && cls.level !== 'regular' && (
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-dim">
                {LEVEL_LABELS[cls.level]}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-faint">
            {open.length === 0
              ? 'Nothing due'
              : `${open.length} open${overdue ? ` · ${overdue} overdue` : ''}`}
          </span>
        </span>
        <span className="tnum shrink-0 text-sm font-semibold text-dim">
          {gradeFor('s2') || gradeFor('s1') || '–'}
        </span>
        <span
          className="shrink-0 text-faint transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          aria-hidden
        >
          ▸
        </span>
      </button>

      <Collapse open={expanded}>
        <div className="border-t border-app px-4 pb-4 pt-3">
          <p className="pb-2 text-xs font-semibold uppercase tracking-widest text-faint">Level</p>
          <div className="flex gap-2">
            {(['regular', 'honors', 'ap'] as CourseLevel[]).map((lv) => (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                className={[
                  'flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                  (cls.level ?? 'regular') === lv
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-dim',
                ].join(' ')}
              >
                {LEVEL_LABELS[lv]}
              </button>
            ))}
          </div>

          <p className="pb-2 pt-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Grades
          </p>
          <div className="space-y-2">
            {SEMESTERS.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm text-dim">{s.label}</span>
                <select
                  value={gradeFor(s.id)}
                  onChange={(e) => setGrade(s.id, e.target.value)}
                  className="flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
                >
                  <option value="">Not set</option>
                  {LETTERS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <p className="pb-2 pt-4 text-xs font-semibold uppercase tracking-widest text-faint">
            Assignments
          </p>
          <AssignmentList
            period={cls.period}
            today={today}
            settings={settings}
            update={update}
          />
        </div>
      </Collapse>
    </li>
  );
}

export function AssignmentList({
  period,
  today,
  settings,
  update,
  limit,
}: {
  period?: number;
  today: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  limit?: number;
}) {
  const items = useMemo(() => {
    const all = settings.assignments
      .filter((a) => (period === undefined ? true : a.period === period))
      .filter((a) => !a.done)
      .sort((a, b) => a.due.localeCompare(b.due));
    return limit ? all.slice(0, limit) : all;
  }, [settings.assignments, period, limit]);

  const toggle = (id: string) =>
    update({
      assignments: settings.assignments.map((a) => (a.id === id ? { ...a, done: !a.done } : a)),
    });

  const remove = (id: string) =>
    update({ assignments: settings.assignments.filter((a) => a.id !== id) });

  if (items.length === 0) {
    return <p className="py-1 text-sm text-faint">Nothing due.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {items.map((a) => {
        const cls = settings.classes.find((c) => c.period === a.period);
        const late = a.due < today;
        return (
          <li key={a.id} className="flex items-center gap-3">
            <button
              onClick={() => toggle(a.id)}
              aria-label={`Mark ${a.title} done`}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-app text-transparent transition-colors hover:border-accent"
            >
              ✓
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{a.title}</span>
              <span className="block truncate text-xs text-faint">
                {typeLabel(a.type)}
                {period === undefined && cls?.name ? ` · ${cls.name}` : ''}
              </span>
            </span>
            <span
              className={['shrink-0 text-xs', late ? 'font-semibold text-accent' : 'text-dim'].join(
                ' ',
              )}
            >
              {dueLabel(today, a.due)}
            </span>
            <button
              onClick={() => remove(a.id)}
              aria-label={`Delete ${a.title}`}
              className="shrink-0 px-1 text-xs text-faint"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AssignmentSheet({
  open,
  today,
  settings,
  update,
  onClose,
}: {
  open: boolean;
  today: string;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const withNames = settings.classes.filter((c) => c.name.trim());
  const [period, setPeriod] = useState(withNames[0]?.period ?? 1);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(addDays(today, 1));
  const [type, setType] = useState<AssignmentType>('homework');

  const save = () => {
    if (!title.trim()) return;
    const a: Assignment = { id: newId(), period, title: title.trim(), due, type, done: false };
    update({ assignments: [...settings.assignments, a] });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} label="New assignment">
      <div className="accent-blue">
        <h2 className="text-xl font-semibold">New assignment</h2>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is it?"
          className="mt-4 w-full rounded-xl bg-surface px-4 py-3 outline-none placeholder:text-faint"
        />

        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value))}
          className="mt-2 w-full rounded-xl bg-surface px-4 py-3 text-sm outline-none"
        >
          {withNames.length === 0 && <option value={1}>Period 1</option>}
          {withNames.map((c) => (
            <option key={c.period} value={c.period}>
              P{c.period} · {c.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="mt-2 w-full rounded-xl bg-surface px-4 py-3 text-sm outline-none"
        />

        <div className="mt-2 flex gap-2">
          {(['homework', 'test', 'project'] as AssignmentType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={[
                'flex-1 rounded-xl py-2.5 text-sm font-medium capitalize transition-colors',
                type === t ? 'bg-accent text-white' : 'bg-surface text-dim',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={save}
          disabled={!title.trim()}
          className="mt-4 w-full rounded-2xl bg-accent py-4 font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
        <button onClick={onClose} className="mt-2 w-full py-2 text-sm text-dim">
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

export function typeLabel(t: AssignmentType): string {
  return t === 'homework' ? 'Homework' : t === 'test' ? 'Test' : 'Project';
}

export function dueLabel(today: string, due: string): string {
  const days = Math.round(
    (fromISODate(due).getTime() - fromISODate(today).getTime()) / 86_400_000,
  );
  if (days < -1) return `${-days}d late`;
  if (days === -1) return 'yesterday';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return `${days}d`;
  return fromISODate(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
