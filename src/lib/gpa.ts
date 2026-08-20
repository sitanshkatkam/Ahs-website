/**
 * GPA maths.
 *
 * Two numbers, because they answer different questions:
 *   - unweighted: the plain 4.0 scale, every course equal.
 *   - weighted:   adds a bonus for AP and honours courses, which is what most
 *                 CA high schools print on a transcript.
 *
 * The honours bonus genuinely differs between schools (+0.5 at some, +1.0 at
 * others), so it is a setting rather than a constant. AP is +1.0 everywhere
 * this app is aimed at.
 *
 * This is a personal tracker, not an official transcript. UC's own GPA
 * calculation is a different thing again — 10th/11th grade a-g courses only,
 * with the honours bonus capped at 8 semesters — and is deliberately not
 * attempted here.
 */

import { isGraded, type CourseLevel, type GradeEntry, type Semester, type UserClass } from './storage';

/** Standard US 4.0 scale. A+ is not worth more than A on an unweighted scale. */
export const GRADE_POINTS: Record<string, number> = {
  'A+': 4.0,
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  'D-': 0.7,
  F: 0.0,
};

/** Offered in the grade picker, best first. */
export const LETTERS = Object.keys(GRADE_POINTS);

export const SEMESTERS: { id: Semester; label: string }[] = [
  { id: 's1', label: 'Semester 1' },
  { id: 's2', label: 'Semester 2' },
];

export const LEVEL_LABELS: Record<CourseLevel, string> = {
  regular: 'Regular',
  honors: 'Honors',
  ap: 'AP',
};

export function bonusFor(level: CourseLevel | undefined, honorsBonus: 0.5 | 1): number {
  if (level === 'ap') return 1;
  if (level === 'honors') return honorsBonus;
  return 0;
}

export type GpaResult = {
  /** null when nothing has been entered yet — distinct from a real 0.00. */
  unweighted: number | null;
  weighted: number | null;
  /** How many graded classes went into it. */
  count: number;
};

/**
 * Average the given grade entries. An F still counts; a missing grade doesn't.
 * A weighted average never drops below the unweighted one, since bonuses are
 * only ever added.
 */
export function computeGpa(
  entries: GradeEntry[],
  classes: UserClass[],
  honorsBonus: 0.5 | 1,
): GpaResult {
  let unweightedTotal = 0;
  let weightedTotal = 0;
  let count = 0;

  for (const entry of entries) {
    const points = GRADE_POINTS[entry.letter];
    if (points === undefined) continue;

    const cls = classes.find((c) => c.period === entry.period);
    // A free period or TA slot doesn't belong in a GPA, even if a grade was
    // entered before the period was reclassified.
    if (!isGraded(cls?.kind)) continue;
    // A failed course earns no bonus — you don't get honours credit for an F.
    const bonus = points > 0 ? bonusFor(cls?.level, honorsBonus) : 0;

    unweightedTotal += points;
    weightedTotal += points + bonus;
    count++;
  }

  if (count === 0) return { unweighted: null, weighted: null, count: 0 };
  return {
    unweighted: unweightedTotal / count,
    weighted: weightedTotal / count,
    count,
  };
}

/** GPA for one semester. */
export function semesterGpa(
  grades: GradeEntry[],
  semester: Semester,
  classes: UserClass[],
  honorsBonus: 0.5 | 1,
): GpaResult {
  return computeGpa(
    grades.filter((g) => g.semester === semester),
    classes,
    honorsBonus,
  );
}

/** GPA across every semester entered. */
export function cumulativeGpa(
  grades: GradeEntry[],
  classes: UserClass[],
  honorsBonus: 0.5 | 1,
): GpaResult {
  return computeGpa(grades, classes, honorsBonus);
}

export function formatGpa(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}
