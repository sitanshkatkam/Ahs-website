import { useState } from 'react';
import { PERIODS } from '../data/schedules';
import { SCHOOL_YEAR } from '../data/calendar';
import { GRADES, type GradeLevel, type Settings, type UserClass } from '../lib/storage';

type Props = {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
};

export function Onboarding({ settings, update }: Props) {
  const [step, setStep] = useState(0);
  const [classes, setClasses] = useState<UserClass[]>(settings.classes);
  const [grade, setGrade] = useState<GradeLevel | undefined>(settings.gradeLevel);

  const finish = () => update({ classes, gradeLevel: grade, onboarded: true });

  return (
    <div className="accent-blue safe-top safe-bottom safe-x flex min-h-dvh flex-col px-6 pb-10 pt-16">
      {step === 0 ? (
        <div className="flex flex-1 flex-col justify-center text-center">
          <p className="text-5xl">🦅</p>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">American High</h1>
          <p className="mt-3 text-dim">
            Every bell schedule for the {SCHOOL_YEAR.label} year — block days, rally days,
            minimum days and finals — so you always know what period you're in.
          </p>
          <p className="mt-6 text-sm text-faint">No account. Nothing leaves your phone.</p>
        </div>
      ) : (
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Set up</h1>
          <p className="mt-1 text-sm text-dim">
            All of this is editable later in Settings.
          </p>

          {/* Grade first, and required: it decides which college deadlines and
              checklist you see, and it's a single tap. Classes are optional
              because they're a lot of typing on a phone. */}
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-faint">
            What grade are you in?
          </p>
          <div className="mt-2 flex gap-2">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                aria-pressed={grade === g}
                className={[
                  'flex-1 rounded-xl py-3 text-lg font-semibold transition-colors',
                  grade === g ? 'bg-accent text-white' : 'bg-surface text-dim',
                ].join(' ')}
              >
                {g}
              </button>
            ))}
          </div>

          <p className="mt-7 text-xs font-semibold uppercase tracking-widest text-faint">
            Your classes
          </p>
          <div className="mt-2 space-y-2">
            {PERIODS.map((period) => {
              const cls = classes.find((c) => c.period === period)!;
              const set = (patch: Partial<UserClass>) =>
                setClasses((prev) =>
                  prev.map((c) => (c.period === period ? { ...c, ...patch } : c)),
                );
              return (
                <div
                  key={period}
                  className="flex items-center gap-3 rounded-2xl border border-app bg-surface p-3"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-dim">
                    {period}
                  </span>
                  <input
                    value={cls.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder={`Period ${period}`}
                    className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
                  />
                  <input
                    value={cls.room ?? ''}
                    onChange={(e) => set({ room: e.target.value })}
                    placeholder="Room"
                    className="w-20 shrink-0 rounded-lg bg-surface-2 px-2 py-1.5 text-sm outline-none placeholder:text-faint"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pt-8">
        <button
          onClick={() => (step === 0 ? setStep(1) : finish())}
          disabled={step === 1 && grade === undefined}
          className="w-full rounded-2xl bg-accent py-4 font-semibold text-white disabled:opacity-40"
        >
          {step === 0 ? 'Get started' : 'Done'}
        </button>
        {step === 1 && (
          <p className="mt-3 text-center text-xs text-faint">
            {grade === undefined
              ? 'Pick your grade to continue — classes can wait.'
              : 'You can leave classes blank and add them later.'}
          </p>
        )}
      </div>
    </div>
  );
}
