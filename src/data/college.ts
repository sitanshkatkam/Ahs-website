/**
 * College-prep reference data for the 2026-2027 year.
 *
 * Sources, checked when this file was written:
 *   - SAT dates & registration deadlines — College Board 2026-27 schedule
 *   - ACT dates & deadlines — act.org national test dates 2026-27
 *   - UC / CSU application window — admission.universityofcalifornia.edu,
 *     calstate.edu (both 1 Oct – 30 Nov 2026 for fall 2027 entry)
 *   - FAFSA / Cal Grant — csac.ca.gov (2 March 2027 California deadline)
 *
 * Two honest caveats, surfaced in the UI rather than buried here:
 *   - Common App deadlines are set by each college, not centrally. The dates
 *     below are the common conventions, not guarantees.
 *   - Everything here can move. Always confirm on the official site before
 *     relying on it; each entry carries a link.
 */

export type TestKind = 'SAT' | 'ACT';

export type TestDate = {
  kind: TestKind;
  /** "YYYY-MM-DD" */
  date: string;
  /** Regular registration deadline. */
  register: string;
};

/** College Board, eight Saturdays. */
export const SAT_DATES: TestDate[] = [
  { kind: 'SAT', date: '2026-08-22', register: '2026-08-07' },
  { kind: 'SAT', date: '2026-09-12', register: '2026-08-28' },
  { kind: 'SAT', date: '2026-10-03', register: '2026-09-18' },
  { kind: 'SAT', date: '2026-11-07', register: '2026-10-23' },
  { kind: 'SAT', date: '2026-12-05', register: '2026-11-20' },
  { kind: 'SAT', date: '2027-03-06', register: '2027-02-19' },
  { kind: 'SAT', date: '2027-05-01', register: '2027-04-16' },
  { kind: 'SAT', date: '2027-06-05', register: '2027-05-21' },
];

/** ACT national test dates, seven a year. */
export const ACT_DATES: TestDate[] = [
  { kind: 'ACT', date: '2026-09-19', register: '2026-08-14' },
  { kind: 'ACT', date: '2026-10-17', register: '2026-09-11' },
  { kind: 'ACT', date: '2026-12-12', register: '2026-11-06' },
  { kind: 'ACT', date: '2027-02-27', register: '2027-01-22' },
  { kind: 'ACT', date: '2027-04-10', register: '2027-03-05' },
  { kind: 'ACT', date: '2027-06-12', register: '2027-05-07' },
  { kind: 'ACT', date: '2027-07-10', register: '2027-06-04' },
];

export const TEST_DATES: TestDate[] = [...SAT_DATES, ...ACT_DATES].sort((a, b) =>
  a.date.localeCompare(b.date),
);

export type Deadline = {
  date: string;
  title: string;
  detail: string;
  url: string;
  /** True when the date varies by college and this is only the convention. */
  approximate?: boolean;
  /** Which grade levels should see it. */
  grades: (9 | 10 | 11 | 12)[];
};

export const DEADLINES: Deadline[] = [
  {
    date: '2026-10-01',
    title: 'UC application opens',
    detail: 'Submission window for fall 2027 runs 1 Oct – 30 Nov. One application covers all nine campuses.',
    url: 'https://admission.universityofcalifornia.edu/',
    grades: [12],
  },
  {
    date: '2026-10-01',
    title: 'Cal State Apply opens',
    detail: 'CSU application filing period for fall 2027 runs 1 Oct – 30 Nov.',
    url: 'https://www.calstate.edu/apply',
    grades: [12],
  },
  {
    date: '2026-10-01',
    title: 'FAFSA opens',
    detail: 'Federal student aid application for the 2027-28 year. File early — some aid is first-come.',
    url: 'https://studentaid.gov/h/apply-for-aid/fafsa',
    grades: [12],
  },
  {
    date: '2026-11-01',
    title: 'Early Decision / Early Action',
    detail: 'The usual early deadline at private colleges. Each college sets its own — check every one on your list.',
    url: 'https://www.commonapp.org/',
    approximate: true,
    grades: [12],
  },
  {
    date: '2026-11-30',
    title: 'UC application due',
    detail: 'Hard deadline, 11:59pm. UC does not accept late applications for fall.',
    url: 'https://admission.universityofcalifornia.edu/apply-now.html',
    grades: [12],
  },
  {
    date: '2026-11-30',
    title: 'CSU application due',
    detail: 'Cal State Apply closes at 11:59pm for fall 2027.',
    url: 'https://www.calstate.edu/apply/pages/application-dates-deadlines.aspx',
    grades: [12],
  },
  {
    date: '2027-01-01',
    title: 'Regular Decision',
    detail: 'The most common Common App deadline. Varies by college — confirm each one.',
    url: 'https://www.commonapp.org/',
    approximate: true,
    grades: [12],
  },
  {
    date: '2027-03-02',
    title: 'Cal Grant & California aid deadline',
    detail: 'FAFSA plus the GPA verification form must be in by 2 March for Cal Grant. Missing it forfeits the main state grant.',
    url: 'https://www.csac.ca.gov/',
    grades: [12],
  },
  {
    date: '2027-05-01',
    title: 'College Decision Day',
    detail: 'National deadline to accept an offer and put down a deposit.',
    url: 'https://admission.universityofcalifornia.edu/',
    grades: [12],
  },
];

export type ChecklistItem = { id: string; text: string };

/**
 * Deliberately short. A checklist you can read in ten seconds gets used; a
 * forty-item one gets ignored.
 */
export const CHECKLISTS: Record<9 | 10 | 11 | 12, ChecklistItem[]> = {
  9: [
    { id: '9-grades', text: 'Take grades seriously now — 9th grade counts toward your GPA' },
    { id: '9-ag', text: 'Check you are on the a-g course track for UC and CSU' },
    { id: '9-activity', text: 'Join one or two activities you actually like' },
    { id: '9-reading', text: 'Read outside of class — it shows up on the SAT later' },
    { id: '9-counselor', text: 'Meet your counselor once and put a face to the name' },
  ],
  10: [
    { id: '10-psat', text: 'Take the PSAT for practice' },
    { id: '10-ap', text: 'Consider your first AP or honors course' },
    { id: '10-depth', text: 'Go deeper in one activity instead of wider in five' },
    { id: '10-summer', text: 'Line up something for summer — job, program, or project' },
    { id: '10-ag', text: 'Recheck a-g progress with your counselor' },
  ],
  11: [
    { id: '11-psat', text: 'Take the PSAT/NMSQT in October — this is the year it can qualify you' },
    { id: '11-test', text: 'Sit the SAT or ACT in spring, leaving room to retake in the fall' },
    { id: '11-gpa', text: '11th grade GPA carries the most weight — protect it' },
    { id: '11-list', text: 'Build a first college list: a few reaches, matches and safeties' },
    { id: '11-rec', text: 'Build a real relationship with two teachers for recommendations' },
    { id: '11-visit', text: 'Visit a campus, even just a local one, to calibrate what you like' },
    { id: '11-summer', text: 'Draft your personal statement over the summer, not in November' },
  ],
  12: [
    { id: '12-list', text: 'Finalise your college list and note every deadline' },
    { id: '12-essays', text: 'Finish essays before October — senior fall gets busy fast' },
    { id: '12-rec', text: 'Ask for recommendation letters at least a month ahead' },
    { id: '12-uc', text: 'Submit UC and CSU applications by 30 November' },
    { id: '12-fafsa', text: 'File the FAFSA as soon as it opens on 1 October' },
    { id: '12-calgrant', text: 'Submit the Cal Grant GPA verification by 2 March' },
    { id: '12-transcript', text: 'Send transcripts and test scores where they are required' },
    { id: '12-decide', text: 'Compare aid offers, then commit by 1 May' },
  ],
};
