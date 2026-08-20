/**
 * Parsing for American High's public Google Calendar feed.
 *
 * Deliberately plain JavaScript with no imports, because two very different
 * runtimes share it: the Node script that refreshes the bundled offline copy,
 * and the Cloudflare Worker that serves the live one. One implementation means
 * the live feed and the fallback can't classify the same event differently.
 *
 * The feed is useful but not authoritative. It has carried a flat error before
 * (Memorial Day listed on 3/31/27) and it omits several no-school days, so this
 * NEVER emits a closure — school holidays come from the instructional calendar
 * baked into src/data/calendar.ts.
 */

export const FEED_URL =
  'https://calendar.google.com/calendar/ical/c_kbm7n0oc9rn7uefs9rbutpmkv0%40group.calendar.google.com/public/basic.ics';

export const SCHOOL_TZ = 'America/Los_Angeles';

/** Unfold RFC 5545 continuation lines, then split into VEVENT blocks. */
function parseEvents(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  return [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)].map((m) => {
    const body = m[1];
    const field = (name) => {
      const re = new RegExp(`^${name}([^:\\r\\n]*):(.*)$`, 'm');
      const hit = re.exec(body);
      return hit ? { params: hit[1], value: hit[2].trim() } : null;
    };
    return {
      start: field('DTSTART'),
      end: field('DTEND'),
      summary: field('SUMMARY')?.value ?? '',
      location: field('LOCATION')?.value ?? '',
      rrule: field('RRULE')?.value ?? null,
    };
  });
}

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHOOL_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TZ,
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * Normalise a DTSTART/DTEND to a local calendar date, and a display time for
 * timed events. Handles the three shapes Google emits: floating local,
 * TZID-qualified local, and UTC with a trailing Z.
 */
function normalise(field) {
  if (!field) return null;
  const v = field.value;

  // All-day: DTSTART;VALUE=DATE:20260811
  if (/VALUE=DATE/.test(field.params) || /^\d{8}$/.test(v)) {
    return { date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  }

  // UTC: 20250910T230000Z
  if (v.endsWith('Z')) {
    const d = new Date(
      Date.UTC(
        +v.slice(0, 4),
        +v.slice(4, 6) - 1,
        +v.slice(6, 8),
        +v.slice(9, 11),
        +v.slice(11, 13),
        +v.slice(13, 15),
      ),
    );
    return { date: dateFmt.format(d), time: timeFmt.format(d), allDay: false };
  }

  // TZID-qualified or floating local: 20260811T083000
  const hh = +v.slice(9, 11);
  const mm = v.slice(11, 13);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return {
    date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`,
    time: `${h12}:${mm} ${suffix}`,
    allDay: false,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Anything that reads like a closure is left to the PDF-derived calendar. */
const CLOSURE = /no school|holiday|recess|winter break|spring break|vacation|non.?student/i;

/** An explicit "1/3/5" or "2/4/6" period list. */
const PERIOD_LIST = /\d\s*\/\s*\d\s*\/\s*\d/;

/** A schedule label, as opposed to an event that merely mentions a rally. */
const SCHEDULE_ISH = new RegExp(`schedule|block|period|minimum|final|${PERIOD_LIST.source}`, 'i');

function toScheduleId(summary) {
  if (!SCHEDULE_ISH.test(summary)) return null;

  // The explicit period list beats the words "odd"/"even". The school's feed
  // labels 8/25 and 8/27 "Even Day Odd 2/4/6" — contradictory in words, but
  // unambiguous in numbers, and the numbers are the ones that are right.
  const oddNums = /1\s*\/\s*3\s*\/\s*5/.test(summary);
  const evenNums = /2\s*\/\s*4\s*\/\s*6/.test(summary);
  const odd = oddNums || (!evenNums && /\bodd\b/i.test(summary));
  const even = evenNums || (!oddNums && /\beven\b/i.test(summary));

  if (/minimum/i.test(summary)) return 'minimum';

  if (/final/i.test(summary)) {
    if (/1\s*&\s*2/.test(summary)) return 'finalsDay1';
    if (/3\s*&\s*4/.test(summary)) return 'finalsDay2';
    if (/5\s*&\s*6/.test(summary)) return 'finalsDay3';
    return null; // an unlabelled "Finals Schedule" isn't specific enough
  }

  if (/rally/i.test(summary)) {
    if (/block/i.test(summary) || PERIOD_LIST.test(summary)) {
      if (odd) return 'rallyBlockOdd';
      if (even) return 'rallyBlockEven';
      return null;
    }
    // "Welcome Back Rally", "Spirit Week Night Rally" — events, not schedules.
    if (/six period|6 period/i.test(summary)) return 'rally';
    return null;
  }

  if (/block/i.test(summary) || PERIOD_LIST.test(summary)) {
    if (odd) return 'blockOdd';
    if (even) return 'blockEven';
    return null;
  }

  if (/six period|6 period/i.test(summary)) return 'regular';
  return null;
}

const SPORT =
  /\b(tennis|basketball|soccer|golf|baseball|softball|volleyball|badminton|football|swim|water polo|wrestling|track|cross country|mval|scrimmage)\b/i;
const ARTS = /\b(play|drama|band|choir|orchestra|concert|theat|art show|musical|ahspa)\b/i;
const SOCIAL = /\b(rally|dance|prom|homecoming|spirit|club|fair|night|picnic|senior|social)\b/i;
const ACADEMIC =
  /\b(quarter|semester|exam|ap |psat|sat|testing|conference|award|graduation|first day|last day|maze day|orientation)\b/i;

function categorise(summary) {
  if (SPORT.test(summary)) return 'sports';
  if (ARTS.test(summary)) return 'arts';
  if (ACADEMIC.test(summary)) return 'academic';
  if (SOCIAL.test(summary)) return 'social';
  return 'other';
}

/** Google escapes commas and semicolons in text fields. */
const unescape = (s) =>
  s
    .replace(/\\n/g, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Turn raw .ics text into the shape the app consumes.
 *  is returned rather than swallowed so the build script can
 * report what it ignored.
 */
export function buildFeed(ics, { from, to }) {
  const raw = parseEvents(ics);
  const scheduleOverrides = [];
  const events = [];
  const skippedClosures = [];
  const recurring = [];

  for (const e of raw) {
    if (e.rrule) {
      // Both recurring entries in this feed are long-expired Zoom meetings.
      // Surface anything live rather than silently dropping it.
      if (!/UNTIL=20(1|2[0-5])/.test(e.rrule)) recurring.push(unescape(e.summary));
      continue;
    }

    const start = normalise(e.start);
    if (!start || start.date < from || start.date > to) continue;

    const summary = unescape(e.summary);
    if (!summary) continue;

    if (CLOSURE.test(summary)) {
      skippedClosures.push({ date: start.date, summary });
      continue;
    }

    const scheduleId = toScheduleId(summary);
    if (scheduleId) {
      scheduleOverrides.push({ date: start.date, scheduleId });
      continue;
    }

    const end = normalise(e.end);
    // Google stores an exclusive end date for all-day events; step back a day
    // so a one-day event doesn't render as two.
    let endDate;
    if (end && end.date > start.date) {
      endDate = start.allDay ? addDays(end.date, -1) : end.date;
      if (endDate === start.date) endDate = undefined;
    }

    events.push({
      date: start.date,
      ...(endDate ? { endDate } : {}),
      title: summary,
      category: categorise(summary),
      ...(start.time ? { time: start.time } : {}),
      ...(e.location ? { location: unescape(e.location) } : {}),
    });
  }

  scheduleOverrides.sort((a, b) => a.date.localeCompare(b.date));
  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  return { scheduleOverrides, events, skippedClosures, recurring };
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

