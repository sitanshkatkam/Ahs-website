import { afterEach, describe, expect, it } from 'vitest';
import {
  getAllEvents,
  setLiveFeed,
  getSlotState,
  resolveDay,
  slotTitle,
  upcomingEvents,
  upcomingSchoolDays,
} from './resolveDay';
import { SCHEDULES } from '../data/schedules';
import { SYNCED } from '../data/synced';
import { fromISODate } from './date';

/** Build a local Date on `iso` at "HH:MM[:SS]". */
function at(iso: string, hhmmss: string): Date {
  const [h, m, s = '0'] = hhmmss.split(':');
  const d = fromISODate(iso);
  d.setHours(Number(h), Number(m), Number(s), 0);
  return d;
}

describe('resolveDay', () => {
  it('runs the six-period schedule on a normal Monday', () => {
    // 2026-09-14 is a Monday with no override.
    const info = resolveDay('2026-09-14');
    expect(info.isSchoolDay).toBe(true);
    expect(info.template?.id).toBe('regular');
  });

  it('alternates block days through a normal week', () => {
    // Mon 9/14 through Fri 9/18, none of which are overridden.
    expect(resolveDay('2026-09-15').template?.id).toBe('blockOdd'); // Tue
    expect(resolveDay('2026-09-16').template?.id).toBe('blockEven'); // Wed
    expect(resolveDay('2026-09-17').template?.id).toBe('blockOdd'); // Thu
    expect(resolveDay('2026-09-18').template?.id).toBe('blockEven'); // Fri
  });

  it('treats weekends as non-school days', () => {
    expect(resolveDay('2026-09-19').isSchoolDay).toBe(false); // Saturday
    expect(resolveDay('2026-09-20').isSchoolDay).toBe(false); // Sunday
  });

  it('applies a bundled override that swaps the block parity', () => {
    // Tue 2026-08-25 would default to blockOdd; the PDF lists it as 2/4/6.
    expect(resolveDay('2026-08-25').template?.id).toBe('blockEven');
    // Wed 2026-08-26 would default to blockEven; the PDF lists it as 1/3/5.
    expect(resolveDay('2026-08-26').template?.id).toBe('blockOdd');
  });

  it('runs six periods on the first three days of school', () => {
    for (const d of ['2026-08-11', '2026-08-12', '2026-08-13']) {
      expect(resolveDay(d).template?.id).toBe('regular');
    }
    expect(resolveDay('2026-08-11').label).toBe('First days of school');
  });

  it('knows rally days', () => {
    expect(resolveDay('2026-08-14').template?.id).toBe('rally');
    expect(resolveDay('2026-10-06').template?.id).toBe('rallyBlockOdd');
    expect(resolveDay('2026-10-07').template?.id).toBe('rallyBlockEven');
    // Thursday, but the school's calendar labels it Even — parity does not
    // always follow the weekday, so this one is worth pinning down.
    expect(resolveDay('2027-03-11').template?.id).toBe('rallyBlockEven');
  });

  it('knows minimum and finals days', () => {
    expect(resolveDay('2026-08-28').template?.id).toBe('minimum');
    expect(resolveDay('2026-12-16').template?.id).toBe('finalsDay1');
    expect(resolveDay('2026-12-17').template?.id).toBe('finalsDay2');
    expect(resolveDay('2026-12-18').template?.id).toBe('finalsDay3');
  });

  it('closes school for holidays and breaks', () => {
    const labor = resolveDay('2026-09-07');
    expect(labor.isSchoolDay).toBe(false);
    expect(labor.label).toBe('Labor Day');

    // Winter break spans the new year.
    expect(resolveDay('2026-12-25').isSchoolDay).toBe(false);
    expect(resolveDay('2027-01-04').isSchoolDay).toBe(false);
    // ...and school resumes the next weekday.
    expect(resolveDay('2027-01-05').isSchoolDay).toBe(true);
  });

  it('marks dates outside the school year', () => {
    const summer = resolveDay('2027-07-15');
    expect(summer.isSchoolDay).toBe(false);
    expect(summer.outOfYear).toBe(true);
  });

  it('lets a user override beat the bundled calendar', () => {
    const overrides = [{ date: '2026-09-14', scheduleId: 'minimum' as const, label: 'Smoke day' }];
    const info = resolveDay('2026-09-14', overrides);
    expect(info.template?.id).toBe('minimum');
    expect(info.label).toBe('Smoke day');
  });

  it('lets a user override cancel school', () => {
    const info = resolveDay('2026-09-14', [{ date: '2026-09-14', noSchool: true, label: 'Snow' }]);
    expect(info.isSchoolDay).toBe(false);
    expect(info.label).toBe('Snow');
  });

  it('attaches events, including multi-day ones', () => {
    expect(resolveDay('2026-11-25').events.map((e) => e.title)).toContain('Fall Recess');
    expect(resolveDay('2026-10-07').events.map((e) => e.title)).toContain('Rally Week');
  });
});

describe('the synced school calendar feed', () => {
  it('agrees with the verified calendar on every day it labels', () => {
    // This is the regression net for the nightly sync: if the school changes a
    // schedule day, or the feed drifts from the PDF, this fails loudly instead
    // of quietly shipping a wrong schedule.
    const disagreements = SYNCED.scheduleOverrides
      .map((o) => ({ ...o, resolved: resolveDay(o.date).template?.id }))
      .filter((o) => o.resolved !== o.scheduleId);
    expect(disagreements).toEqual([]);
  });

  it('covers the whole school year', () => {
    expect(SYNCED.scheduleOverrides.length).toBeGreaterThan(40);
  });

  it('never closes school on its own', () => {
    // The feed has carried a flat error — it lists Memorial Day on 2027-03-31,
    // two months early. Closures come from the instructional calendar only, so
    // that day has to stay a normal block day.
    const march31 = resolveDay('2027-03-31');
    expect(march31.isSchoolDay).toBe(true);
    expect(march31.template?.id).toBe('blockEven');

    // ...and the real Memorial Day is still off.
    expect(resolveDay('2027-05-31').isSchoolDay).toBe(false);
  });

  it('merges synced events without duplicating curated ones', () => {
    const firstDay = getAllEvents().filter((e) => e.date === '2026-08-11');
    expect(firstDay).toHaveLength(1);
    expect(firstDay[0].title).toMatch(/first day of school/i);
  });

  it('brings in events the PDF never had', () => {
    const titles = getAllEvents().map((e) => e.title);
    expect(titles).toContain('Homecoming Dance');
    expect(titles).toContain('Winter Concert');
  });
});

describe('upcomingEvents', () => {
  it('hides categories the user switched off', () => {
    const all = upcomingEvents('2026-08-01', 50);
    const noSocial = upcomingEvents('2026-08-01', 50, ['social']);
    expect(all.some((e) => e.category === 'social')).toBe(true);
    expect(noSocial.some((e) => e.category === 'social')).toBe(false);
    expect(noSocial.length).toBeLessThan(all.length);
  });

  it('returns events in date order, soonest first', () => {
    const events = upcomingEvents('2026-08-01', 10);
    const dates = events.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('upcomingSchoolDays', () => {
  it('skips over a long break', () => {
    // Friday 2026-12-18 is the last day before winter break.
    const days = upcomingSchoolDays('2026-12-18', 2);
    expect(days[0].date).toBe('2026-12-18');
    expect(days[1].date).toBe('2027-01-05');
  });

  it('includes extra periods supplied by the caller', () => {
    // The Today screen previews the next school day's real slot list. Dropping
    // extraPeriods here would show someone with a zero period a day that
    // starts at 8:30 when theirs starts at 7:30.
    const zero = [{ period: 0, enabled: true, start: '07:30', end: '08:25' }];
    const [day] = upcomingSchoolDays('2026-09-14', 1, [], zero);
    expect(day.template?.slots[0].period).toBe(0);
    expect(day.template?.slots[0].start).toBe('07:30');
  });

  it('leaves the day alone when no extra periods are enabled', () => {
    const off = [{ period: 0, enabled: false, start: '07:30', end: '08:25' }];
    const [day] = upcomingSchoolDays('2026-09-14', 1, [], off);
    expect(day.template?.slots[0].period).toBe(1);
  });

  it('finds Monday from a Friday, for the after-school preview', () => {
    const [day] = upcomingSchoolDays('2026-09-19', 1); // Saturday
    expect(day.date).toBe('2026-09-21');
  });
});

describe('getSlotState', () => {
  const regular = SCHEDULES.regular;

  it('reports before-school ahead of the first bell', () => {
    const s = getSlotState(regular, at('2026-09-14', '07:15'));
    expect(s.phase).toBe('before');
    expect(s.next?.period).toBe(1);
    expect(s.secondsRemaining).toBe(75 * 60);
  });

  it('is in period 1 exactly at the bell', () => {
    const s = getSlotState(regular, at('2026-09-14', '08:30:00'));
    expect(s.phase).toBe('in');
    expect(s.current?.period).toBe(1);
    expect(s.progress).toBe(0);
    expect(s.secondsRemaining).toBe(60 * 60);
  });

  it('hands off to passing the instant period 1 ends', () => {
    const s = getSlotState(regular, at('2026-09-14', '09:30:00'));
    expect(s.phase).toBe('passing');
    expect(s.current).toBeNull();
    expect(s.next?.period).toBe(2);
    expect(s.secondsRemaining).toBe(6 * 60);
  });

  it('is mid-period with sane progress', () => {
    const s = getSlotState(regular, at('2026-09-14', '09:00:00'));
    expect(s.phase).toBe('in');
    expect(s.progress).toBeCloseTo(0.5, 5);
  });

  it('treats brunch and lunch as slots', () => {
    expect(getSlotState(regular, at('2026-09-14', '10:38')).current?.kind).toBe('brunch');
    expect(getSlotState(regular, at('2026-09-14', '13:00')).current?.kind).toBe('lunch');
  });

  it('reports after-school on the final bell', () => {
    const s = getSlotState(regular, at('2026-09-14', '15:30:00'));
    expect(s.phase).toBe('after');
    expect(s.current).toBeNull();
    expect(s.next).toBeNull();
  });

  it('handles the late-start finals schedule', () => {
    const s = getSlotState(SCHEDULES.finalsDay1, at('2026-12-16', '08:45'));
    expect(s.phase).toBe('before');
    expect(s.next?.period).toBe(1);
  });

  it('walks a whole block day without gaps in coverage', () => {
    const block = SCHEDULES.blockOdd;
    for (let m = 8 * 60 + 30; m < 15 * 60 + 14; m++) {
      const s = getSlotState(block, at('2026-09-15', `${Math.floor(m / 60)}:${m % 60}`));
      expect(['in', 'passing']).toContain(s.phase);
    }
  });
});

describe('extra periods', () => {
  const zero = [{ period: 0, enabled: true, start: '07:30', end: '08:25' }];
  const seventh = [{ period: 7, enabled: true, start: '15:36', end: '16:31' }];

  it('puts zero period ahead of first period, not on the end', () => {
    const day = resolveDay('2026-09-14', [], zero);
    const slots = day.template!.slots;
    expect(slots[0].period).toBe(0);
    expect(slots[1].period).toBe(1);
  });

  it('keeps every slot in chronological order', () => {
    const day = resolveDay('2026-09-14', [], [...zero, ...seventh]);
    const starts = day.template!.slots.map((s) => s.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it('appends seventh period after the last bell', () => {
    const day = resolveDay('2026-09-14', [], seventh);
    const slots = day.template!.slots;
    expect(slots[slots.length - 1].period).toBe(7);
  });

  it('applies to block days too, not just six-period days', () => {
    const day = resolveDay('2026-09-15', [], zero); // 1/3/5 block Tuesday
    expect(day.template!.slots[0].period).toBe(0);
    expect(day.template!.id).toBe('blockOdd');
  });

  it('is ignored when disabled', () => {
    const day = resolveDay('2026-09-14', [], [
      { period: 0, enabled: false, start: '07:30', end: '08:25' },
    ]);
    expect(day.template!.slots[0].period).toBe(1);
  });

  it('ignores a nonsense time range rather than corrupting the day', () => {
    const day = resolveDay('2026-09-14', [], [
      { period: 0, enabled: true, start: '09:00', end: '08:00' },
    ]);
    expect(day.template!.slots.some((s) => s.period === 0)).toBe(false);
  });

  it('does not leak into the shared schedule templates', () => {
    resolveDay('2026-09-14', [], zero);
    expect(SCHEDULES.regular.slots.some((s) => s.period === 0)).toBe(false);
  });

  it('lets getSlotState find a zero-period class', () => {
    const day = resolveDay('2026-09-14', [], zero);
    const s = getSlotState(day.template!, at('2026-09-14', '07:45'));
    expect(s.phase).toBe('in');
    expect(s.current?.period).toBe(0);
  });

  it('adds nothing on a day with no school', () => {
    expect(resolveDay('2026-09-19', [], zero).template).toBeNull();
  });
});

describe('slotTitle', () => {
  const classes = [
    { period: 1, name: 'AP Chemistry', room: '402' },
    { period: 3, name: '   ' },
  ];

  it('uses the configured class name', () => {
    expect(slotTitle(SCHEDULES.regular.slots[0], classes)).toBe('AP Chemistry');
  });

  it('falls back to the period label when unset or blank', () => {
    const p3 = SCHEDULES.regular.slots.find((s) => s.period === 3)!;
    expect(slotTitle(p3, classes)).toBe('Period 3');
  });

  it('leaves brunch and lunch alone', () => {
    const br = SCHEDULES.regular.slots.find((s) => s.kind === 'brunch')!;
    expect(slotTitle(br, classes)).toBe('Brunch');
  });

  it('says "Free period" rather than falling back to the period number', () => {
    // The old behaviour showed "Period 5", which reads like a missing entry
    // rather than a deliberately empty period.
    const p5 = SCHEDULES.regular.slots.find((s) => s.period === 5)!;
    expect(slotTitle(p5, [{ period: 5, name: '', kind: 'free' }])).toBe('Free period');
  });

  it('labels a TA period', () => {
    const p6 = SCHEDULES.regular.slots.find((s) => s.period === 6)!;
    expect(slotTitle(p6, [{ period: 6, name: '', kind: 'ta' }])).toBe('TA / Aide');
  });

  it('still prefers a name the student typed in', () => {
    const p5 = SCHEDULES.regular.slots.find((s) => s.period === 5)!;
    expect(slotTitle(p5, [{ period: 5, name: 'Library', kind: 'free' }])).toBe('Library');
  });
});

describe('live feed swapping', () => {
  const bundled = SYNCED;

  afterEach(() => setLiveFeed(bundled)); // never leak a test feed into other specs

  it('applies newer events fetched from the Worker', () => {
    setLiveFeed({
      ...bundled,
      generatedAt: new Date().toISOString(),
      events: [
        ...bundled.events,
        { date: '2027-02-20', title: 'Varsity Baseball vs. Irvington', category: 'sports' },
      ],
    });
    expect(getAllEvents().map((e) => e.title)).toContain('Varsity Baseball vs. Irvington');
    expect(resolveDay('2027-02-20').events).toHaveLength(1);
  });

  it('picks up a schedule day the school added after the build', () => {
    // 2027-04-23 is a Friday, so it would default to blockEven.
    expect(resolveDay('2027-04-23').template?.id).toBe('blockEven');
    setLiveFeed({
      ...bundled,
      scheduleOverrides: [
        ...bundled.scheduleOverrides,
        { date: '2027-04-23', scheduleId: 'minimum' },
      ],
    });
    expect(resolveDay('2027-04-23').template?.id).toBe('minimum');
  });

  it('still lets the verified calendar win over a live disagreement', () => {
    // The PDF pins 2026-08-24 as a 1/3/5 block. A feed saying otherwise loses.
    setLiveFeed({
      ...bundled,
      scheduleOverrides: [{ date: '2026-08-24', scheduleId: 'minimum' }],
    });
    expect(resolveDay('2026-08-24').template?.id).toBe('blockOdd');
  });

  it('cannot close school, however the feed is manipulated', () => {
    setLiveFeed({
      ...bundled,
      scheduleOverrides: [{ date: '2027-04-23', scheduleId: 'noSchool' as never }],
    });
    // An unknown schedule id must not resolve to a day off.
    expect(resolveDay('2027-04-23').isSchoolDay).toBe(true);
  });

  it('refuses malformed data rather than blanking the calendar', () => {
    const before = getAllEvents().length;
    expect(setLiveFeed(null)).toBe(false);
    expect(setLiveFeed({} as never)).toBe(false);
    expect(setLiveFeed({ events: 'nope' } as never)).toBe(false);
    expect(getAllEvents().length).toBe(before);
  });

  it('still de-duplicates curated events against a live feed', () => {
    setLiveFeed({
      ...bundled,
      events: [{ date: '2026-08-11', title: 'First Day of School', category: 'academic' }],
    });
    expect(getAllEvents().filter((e) => e.date === '2026-08-11')).toHaveLength(1);
  });
});
