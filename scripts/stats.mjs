/**
 * How many students are using the app.
 *
 *   npm run stats
 *
 * Counts only. Every query here returns a number and nothing else — there is no
 * shape of output in which this can print an email address, a name, or anything
 * that identifies one student, even by accident. That is deliberate: the point
 * is to know how adoption is going, and adoption is a number.
 *
 * Note what this deliberately does NOT measure. Nothing records when a student
 * opens the app, what they look at, or how long they stay. Answering "how many
 * people used it today" would mean writing a row every time someone opened
 * their schedule, which is exactly the kind of tracking a schedule app has no
 * business doing to teenagers. `signed_in_last_30d` below is the closest
 * honest thing available, and it means what it says: they signed in, not that
 * they came back.
 */

import { execSync } from 'node:child_process';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days) => now - days * DAY;

const sql = `
  SELECT
    (SELECT count(*) FROM users)                                    AS accounts,
    (SELECT count(*) FROM users WHERE created > ${ago(1)})          AS new_today,
    (SELECT count(*) FROM users WHERE created > ${ago(7)})          AS new_7d,
    (SELECT count(*) FROM users WHERE created > ${ago(30)})         AS new_30d,
    (SELECT count(*) FROM users WHERE last_seen > ${ago(30)})       AS signed_in_last_30d,
    (SELECT count(*) FROM sessions WHERE expires > ${now})          AS devices_signed_in,
    (SELECT count(*) FROM subscriptions)                            AS devices_with_alerts
`;

function query() {
  /*
    Two details that each cost an hour if you get them wrong:

    - `--command`, not `--file`. `--file` is for migrations and reports a
      summary ("rows read: 1") instead of the rows themselves.
    - One line, wrapped in quotes. A multi-line statement gets re-parsed by the
      shell and arrives mangled, and the `>` comparisons look like output
      redirection to cmd.exe unless the whole thing is quoted. There are no
      double quotes inside the SQL, so wrapping it is safe.
  */
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(
    `npx wrangler d1 execute ahs-schedule --remote --json --command "${oneLine}"`,
    { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  // wrangler prints a banner before the JSON.
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0];
}

const r = query();

const row = (label, value, note = '') =>
  `  ${String(value).padStart(6)}  ${label}${note ? `  ${note}` : ''}`;

console.log('');
console.log('  American High Schedule — adoption');
console.log('  ' + '-'.repeat(46));
console.log(row('accounts', r.accounts));
console.log(row('signed up today', r.new_today));
console.log(row('signed up in the last 7 days', r.new_7d));
console.log(row('signed up in the last 30 days', r.new_30d));
console.log('');
console.log(row('signed in within 30 days', r.signed_in_last_30d));
console.log(row('devices with a live session', r.devices_signed_in));
console.log(row('devices with notifications on', r.devices_with_alerts));
console.log('');
console.log('  Counts only — nothing here identifies a student.');
console.log('  "Signed in" is the last sign-in, not the last time the app was opened;');
console.log('  when the app is used is not recorded anywhere.');
console.log('');
