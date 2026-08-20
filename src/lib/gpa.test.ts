import { describe, expect, it } from 'vitest';
import { computeGpa, cumulativeGpa, formatGpa, semesterGpa } from './gpa';
import type { GradeEntry, UserClass } from './storage';

const classes: UserClass[] = [
  { period: 1, name: 'AP Chemistry', level: 'ap' },
  { period: 2, name: 'AP Calculus AB', level: 'ap' },
  { period: 3, name: 'US History', level: 'regular' },
  { period: 4, name: 'English 11H', level: 'honors' },
  { period: 5, name: 'Spanish 3', level: 'regular' },
  { period: 6, name: 'Symphonic Band' }, // level unset
];

const g = (period: number, letter: string, semester: 's1' | 's2' = 's1'): GradeEntry => ({
  period,
  letter,
  semester,
});

describe('computeGpa', () => {
  it('returns null rather than 0 when nothing is entered', () => {
    const r = computeGpa([], classes, 1);
    expect(r.unweighted).toBeNull();
    expect(r.weighted).toBeNull();
    expect(r.count).toBe(0);
  });

  it('averages straight As to 4.0 unweighted', () => {
    const r = computeGpa([g(3, 'A'), g(5, 'A')], classes, 1);
    expect(r.unweighted).toBe(4);
    expect(r.weighted).toBe(4);
  });

  it('adds a full point for AP', () => {
    const r = computeGpa([g(1, 'A')], classes, 1);
    expect(r.unweighted).toBe(4);
    expect(r.weighted).toBe(5);
  });

  it('honours the configurable honors bonus', () => {
    expect(computeGpa([g(4, 'A')], classes, 1).weighted).toBe(5);
    expect(computeGpa([g(4, 'A')], classes, 0.5).weighted).toBe(4.5);
  });

  it('treats an unset level as regular', () => {
    const r = computeGpa([g(6, 'A')], classes, 1);
    expect(r.weighted).toBe(4);
  });

  it('handles plus and minus grades', () => {
    const r = computeGpa([g(3, 'A-'), g(5, 'B+')], classes, 1);
    expect(r.unweighted).toBeCloseTo((3.7 + 3.3) / 2, 10);
  });

  it('does not treat A+ as above 4.0', () => {
    expect(computeGpa([g(3, 'A+')], classes, 1).unweighted).toBe(4);
  });

  it('counts an F as zero rather than skipping it', () => {
    const r = computeGpa([g(3, 'A'), g(5, 'F')], classes, 1);
    expect(r.count).toBe(2);
    expect(r.unweighted).toBe(2);
  });

  it('gives no weighting bonus for a failed AP course', () => {
    const r = computeGpa([g(1, 'F')], classes, 1);
    expect(r.unweighted).toBe(0);
    expect(r.weighted).toBe(0);
  });

  it('ignores unrecognised letters', () => {
    const r = computeGpa([g(3, 'A'), g(5, 'Pass')], classes, 1);
    expect(r.count).toBe(1);
    expect(r.unweighted).toBe(4);
  });

  it('never puts weighted below unweighted', () => {
    const r = computeGpa([g(1, 'B'), g(3, 'C'), g(4, 'A')], classes, 1);
    expect(r.weighted!).toBeGreaterThanOrEqual(r.unweighted!);
  });

  it('works out a realistic mixed semester', () => {
    // AP A, AP B, regular A, honors A, regular B, unset A
    const r = computeGpa(
      [g(1, 'A'), g(2, 'B'), g(3, 'A'), g(4, 'A'), g(5, 'B'), g(6, 'A')],
      classes,
      1,
    );
    // unweighted: (4+3+4+4+3+4)/6 = 22/6
    expect(r.unweighted).toBeCloseTo(22 / 6, 10);
    // bonuses: AP +1, AP +1, honors +1  → 25/6
    expect(r.weighted).toBeCloseTo(25 / 6, 10);
  });
});

describe('semesterGpa and cumulativeGpa', () => {
  const grades = [g(3, 'A', 's1'), g(5, 'B', 's1'), g(3, 'B', 's2'), g(5, 'B', 's2')];

  it('separates the two semesters', () => {
    expect(semesterGpa(grades, 's1', classes, 1).unweighted).toBe(3.5);
    expect(semesterGpa(grades, 's2', classes, 1).unweighted).toBe(3);
  });

  it('averages everything for the cumulative figure', () => {
    const r = cumulativeGpa(grades, classes, 1);
    expect(r.count).toBe(4);
    expect(r.unweighted).toBeCloseTo((4 + 3 + 3 + 3) / 4, 10);
  });
});

describe('formatGpa', () => {
  it('shows two decimals, and a dash for nothing', () => {
    expect(formatGpa(null)).toBe('—');
    expect(formatGpa(4)).toBe('4.00');
    expect(formatGpa(22 / 6)).toBe('3.67');
  });
});

describe('non-class periods', () => {
  const withFree: UserClass[] = [
    ...classes,
    { period: 0, name: 'Jazz Band', level: 'regular' },
    { period: 7, name: 'Study Hall', kind: 'free' },
  ];

  it('leaves a free period out of the GPA even if a grade lingers', () => {
    // Reclassifying a period as free shouldn't silently keep counting an old grade.
    const r = computeGpa([g(3, 'A'), { period: 7, semester: 's1', letter: 'F' }], withFree, 1);
    expect(r.count).toBe(1);
    expect(r.unweighted).toBe(4);
  });

  it('leaves a TA period out too', () => {
    const cls: UserClass[] = [{ period: 2, name: 'Office aide', kind: 'ta' }];
    expect(computeGpa([g(2, 'A')], cls, 1).count).toBe(0);
  });

  it('counts a zero-period class normally', () => {
    const r = computeGpa([{ period: 0, semester: 's1', letter: 'A' }], withFree, 1);
    expect(r.count).toBe(1);
    expect(r.unweighted).toBe(4);
  });
});
