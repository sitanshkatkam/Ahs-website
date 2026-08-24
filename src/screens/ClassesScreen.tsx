import { useState } from 'react';
import { Collapse } from '../components/Collapse';
import {
  LETTERS,
  LEVEL_LABELS,
  SEMESTERS,
  cumulativeGpa,
  formatGpa,
  semesterGpa,
} from '../lib/gpa';
import type { CourseLevel, Semester, Settings, UserClass } from '../lib/storage';
import { activePeriods, isGraded } from '../lib/storage';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

export function ClassesScreen({ settings, update }: Props) {
  const [open, setOpen] = useState<number | null>(null);

  const classes = settings.classes;
  const named = classes.filter((c) => c.name.trim());

  return (
    <div className="accent-blue px-5 pb-4">
      <header className="flex items-start justify-between pt-3 pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Classes</h1>
          <p className="text-sm text-dim">Your grades this year</p>
        </div>
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
                settings={settings}
                update={update}
                expanded={open === period}
                onToggle={() => setOpen(open === period ? null : period)}
              />
            );
          })}
        </ul>
      )}

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
  settings,
  update,
  expanded,
  onToggle,
}: {
  cls: UserClass;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
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
          {(cls.teacher || cls.room) && (
            <span className="block truncate text-xs text-faint">
              {[cls.teacher, cls.room && `Room ${cls.room}`].filter(Boolean).join(' · ')}
            </span>
          )}
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
        </div>
      </Collapse>
    </li>
  );
}
