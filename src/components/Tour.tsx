import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

/**
 * A short walkthrough of what's in the app.
 *
 * Five tabs' worth of features isn't discoverable by poking around, and most
 * people never open Settings. This runs once automatically and stays reachable
 * afterwards.
 *
 * The icons match the tab bar exactly, so each card points at the thing you'd
 * actually tap.
 */

type Step = {
  icon: string;
  title: string;
  body: string;
  points?: string[];
};

const STEPS: Step[] = [
  {
    icon: '◉',
    title: 'Today',
    body: 'The screen you’ll live on. It knows which of the ten bell schedules today runs — six-period, block, rally, minimum or finals.',
    points: [
      'A ring counting down the class you’re in',
      'Passing periods, with what’s next and the room',
      'What’s due soon, and what’s coming up',
    ],
  },
  {
    icon: '▦',
    title: 'Calendar',
    body: 'Every day of the year, colour-coded by schedule type. Tap any day to see its full bell schedule.',
    points: [
      'Blue six-period · green block · amber rally',
      'Violet minimum day · rose finals',
      'The week strip up top shows which periods meet',
    ],
  },
  {
    icon: '✎',
    title: 'Classes',
    body: 'Your grades for each class, and the GPA they add up to.',
    points: [
      'Add homework, tests and projects with due dates',
      'Weighted and unweighted GPA, updated as you type',
      'Mark a class AP or Honors for the right weighting',
    ],
  },
  {
    icon: '◆',
    title: 'College',
    body: 'Real dates, not guesses — from College Board, ACT, UC, CSU and the California Student Aid Commission.',
    points: [
      'Countdown to your next SAT or ACT',
      'Application and financial aid deadlines',
      'A checklist for your grade level',
    ],
  },
  {
    icon: '⚙',
    title: 'Set it up',
    body: 'A few things worth turning on in Settings.',
    points: [
      'Your classes, teachers and rooms',
      'Zero or seventh period, if you have one',
      'Alerts before class, or the night before a block day',
    ],
  },
  {
    icon: '↑',
    title: 'Add it to your home screen',
    body: 'You get a real icon, fullscreen, and it works with no signal. On iPhone it’s also the only way notifications can reach you.',
    points: [
      'Everything stays on your phone — no account, ever',
      'Share it with the QR button on the Today screen',
    ],
  },
];

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  // Always begin at the start, including when reopened from Settings.
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const last = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <Sheet open={open} onClose={onClose} label="What's in the app">
      <div className="accent-blue">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-faint">
            {step + 1} of {STEPS.length}
          </span>
          {!last && (
            <button onClick={onClose} className="text-sm text-dim">
              Skip
            </button>
          )}
        </div>

        {/* Keyed so the card animates on every step, not just the first. */}
        <div key={step} className="animate-rise pt-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-2xl text-accent">
            <span aria-hidden>{current.icon}</span>
          </div>

          <h2 className="mt-4 text-xl font-semibold">{current.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-dim">{current.body}</p>

          {current.points && (
            <ul className="mt-4 space-y-2">
              {current.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-dim">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Dots double as a progress indicator and a jump target. */}
        <div className="mt-6 flex justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setStep(i)}
              aria-label={`Go to ${s.title}`}
              aria-current={i === step ? 'step' : undefined}
              className="p-1.5"
            >
              <span
                className={[
                  'block h-1.5 rounded-full transition-all duration-300',
                  i === step ? 'w-5 bg-accent' : 'w-1.5 bg-surface-2',
                ].join(' ')}
              />
            </button>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="rounded-2xl border border-app px-5 py-3.5 font-medium text-dim"
            >
              Back
            </button>
          )}
          <button
            onClick={() => (last ? onClose() : setStep((s) => s + 1))}
            className="flex-1 rounded-2xl bg-accent py-3.5 font-semibold text-white"
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
