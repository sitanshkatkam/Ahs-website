import { CHECKLISTS, DEADLINES, TEST_DATES, type TestDate } from '../data/college';
import { fromISODate } from '../lib/date';
import { GRADES, type GradeLevel, type Settings } from '../lib/storage';

type Props = {
  today: string;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

export function CollegeScreen({ today, settings, update }: Props) {
  const grade = settings.gradeLevel;

  return (
    <div className="accent-violet px-5 pb-4">
      <header className="pt-3 pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">College</h1>
        <p className="text-sm text-dim">Tests, deadlines and what to do this year</p>
      </header>

      {grade === undefined ? (
        <GradePicker update={update} />
      ) : (
        <>
          <NextTest today={today} />
          <Deadlines today={today} grade={grade} />
          <Checklist grade={grade} update={update} />
          <Sources />
        </>
      )}
    </div>
  );
}

function GradePicker({ update }: { update: (p: Partial<Settings>) => void }) {
  return (
    <section className="rounded-2xl border border-app bg-surface p-6 text-center">
      <p className="text-lg font-medium">What grade are you in?</p>
      <p className="mt-1 text-sm text-dim">
        This picks the right checklist and hides deadlines that aren't yours yet.
      </p>
      <div className="mt-5 flex gap-2">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => update({ gradeLevel: g })}
            className="flex-1 rounded-xl bg-surface-2 py-3 text-lg font-semibold transition-colors hover:bg-accent hover:text-white"
          >
            {g}
          </button>
        ))}
      </div>
    </section>
  );
}

function NextTest({ today }: { today: string }) {
  const upcoming = TEST_DATES.filter((t) => t.date >= today).slice(0, 4);
  if (upcoming.length === 0) return null;

  const next = upcoming[0];
  const days = daysBetween(today, next.date);
  const regOpen = next.register >= today;

  return (
    <section className="mb-6">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Next test
      </h2>

      <div className="rounded-2xl border border-app bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">{next.kind}</span>
          <span className="text-sm text-dim">{longDate(next.date)}</span>
        </div>
        <p className="tnum mt-2 text-4xl font-semibold text-accent">
          {days}
          <span className="text-base font-normal text-dim"> {days === 1 ? 'day' : 'days'}</span>
        </p>
        <p className="mt-2 text-xs text-dim">
          {regOpen
            ? `Register by ${shortDate(next.register)}`
            : 'Regular registration has closed — late registration may still be open'}
        </p>
      </div>

      <ul className="mt-2 overflow-hidden rounded-2xl border border-app bg-surface">
        {upcoming.slice(1).map((t) => (
          <TestRow key={`${t.kind}-${t.date}`} test={t} today={today} />
        ))}
      </ul>
    </section>
  );
}

function TestRow({ test, today }: { test: TestDate; today: string }) {
  return (
    <li className="flex items-center gap-3 border-t border-app px-4 py-3 first:border-t-0">
      <span className="w-10 shrink-0 text-sm font-semibold text-dim">{test.kind}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{longDate(test.date)}</span>
        <span className="block text-xs text-faint">
          Register by {shortDate(test.register)}
        </span>
      </span>
      <span className="tnum shrink-0 text-xs text-dim">{daysBetween(today, test.date)}d</span>
    </li>
  );
}

function Deadlines({ today, grade }: { today: string; grade: GradeLevel }) {
  const items = DEADLINES.filter((d) => d.grades.includes(grade) && d.date >= today).slice(0, 6);

  if (items.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
          Deadlines
        </h2>
        <p className="rounded-2xl border border-app bg-surface p-5 text-sm text-dim">
          {grade === 12
            ? 'No application deadlines left this year.'
            : 'Application deadlines show up in 12th grade. Focus on the checklist below for now.'}
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-widest text-faint">
        Deadlines
      </h2>
      <ul className="overflow-hidden rounded-2xl border border-app bg-surface">
        {items.map((d) => (
          <li key={`${d.date}-${d.title}`} className="border-t border-app p-4 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{d.title}</span>
              <span className="tnum shrink-0 text-xs text-dim">
                {daysBetween(today, d.date)}d
              </span>
            </div>
            <p className="mt-0.5 text-xs text-accent">
              {longDate(d.date)}
              {d.approximate && ' · typical'}
            </p>
            <p className="mt-1.5 text-xs text-dim">{d.detail}</p>
            <a
              href={d.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1.5 inline-block text-xs text-accent underline"
            >
              Official site
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Checklist({
  grade,
  update,
}: {
  grade: GradeLevel;
  update: (p: Partial<Settings>) => void;
}) {
  const items = CHECKLISTS[grade];

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Grade {grade} checklist
        </h2>
        <button
          onClick={() => update({ gradeLevel: undefined })}
          className="text-xs text-dim underline"
        >
          Change grade
        </button>
      </div>
      <ul className="overflow-hidden rounded-2xl border border-app bg-surface">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-3 border-t border-app px-4 py-3 text-sm first:border-t-0"
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Sources() {
  return (
    <p className="px-1 text-xs leading-relaxed text-faint">
      Test dates from College Board and ACT; application dates from UC, CSU and the California
      Student Aid Commission. Dates can change and private-college deadlines vary — always
      confirm on the official site before you rely on one.
    </p>
  );
}

function daysBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000),
  );
}

function longDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function shortDate(iso: string): string {
  return fromISODate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
