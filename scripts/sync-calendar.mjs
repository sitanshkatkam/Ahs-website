/**
 * Refresh the bundled offline copy of the school's calendar.
 *
 *   npm run sync:calendar
 *
 * Since the Worker now serves this feed live at /api/events, this file is no
 * longer how students get new events — it only refreshes the fallback that
 * ships inside the app, used on a first load with no network. Parsing itself
 * lives in shared/feed.js so the bundled copy and the live one can never
 * disagree about what an event means.
 *
 * The feed is not authoritative. It has carried a flat error (Memorial Day on
 * 3/31/27) and omits several no-school days, so closures are ignored here and
 * conflicts with the hand-verified calendar are reported, never applied.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { FEED_URL, buildFeed } from '../shared/feed.js';

const OUT = path.join(process.cwd(), 'src', 'data', 'synced.json');
const FROM = '2026-08-01';
const TO = '2027-06-30';

async function main() {
  process.stdout.write('Fetching American High academics calendar… ');
  const res = await fetch(FEED_URL);
  if (!res.ok) throw new Error(`feed returned ${res.status} ${res.statusText}`);
  const ics = await res.text();
  console.log(`${(ics.length / 1024).toFixed(0)} KB`);

  const { scheduleOverrides, events, skippedClosures, recurring } = buildFeed(ics, {
    from: FROM,
    to: TO,
  });

  if (recurring.length) {
    console.warn(`  ! ${recurring.length} recurring event(s) skipped — RRULE is not expanded:`);
    for (const r of recurring) console.warn(`    ${r}`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'American High School — Academics (public Google Calendar)',
    schoolYear: `${FROM}..${TO}`,
    scheduleOverrides,
    events,
  };
  await fs.writeFile(OUT, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
  console.log(`  ${scheduleOverrides.length} schedule days`);
  console.log(`  ${events.length} events`);

  const counts = {};
  for (const e of events) counts[e.category] = (counts[e.category] ?? 0) + 1;
  console.log(
    `  by category: ${Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );

  if (skippedClosures.length) {
    console.log(
      `\n  ${skippedClosures.length} closure entries ignored (the instructional calendar is authoritative):`,
    );
    for (const c of skippedClosures) console.log(`    ${c.date}  ${c.summary}`);
  }

  await reportConflicts(scheduleOverrides);
}

/**
 * Compare the feed against the hand-verified data. Disagreements are printed,
 * never applied — the PDF wins at runtime. This is how the 3/11 rally parity
 * error surfaced in the first place.
 */
async function reportConflicts(overrides) {
  const src = await fs.readFile(path.join(process.cwd(), 'src', 'data', 'calendar.ts'), 'utf8');

  const bundled = new Map();
  for (const block of src.matchAll(/\.\.\.runs\(\s*(\[[\s\S]*?\])\s*,\s*'(\w+)'/g)) {
    for (const d of block[1].matchAll(/'(\d{4}-\d{2}-\d{2})'/g)) bundled.set(d[1], block[2]);
  }
  for (const block of src.matchAll(/\.\.\.noSchool\(([\s\S]*?)\)\s*,/g)) {
    for (const d of block[1].matchAll(/'(\d{4}-\d{2}-\d{2})'/g)) bundled.set(d[1], 'NO SCHOOL');
  }

  const conflicts = [];
  let agree = 0;
  let novel = 0;
  for (const o of overrides) {
    const mine = bundled.get(o.date);
    if (mine === undefined) novel++;
    else if (mine === o.scheduleId) agree++;
    else conflicts.push(`    ${o.date}  bundled=${mine}  feed=${o.scheduleId}`);
  }

  console.log(
    `\n  vs src/data/calendar.ts: ${agree} agree, ${novel} new, ${conflicts.length} conflict`,
  );
  if (conflicts.length) {
    console.log('  CONFLICTS (bundled data wins at runtime — review these):');
    for (const c of conflicts) console.log(c);
  }
}

main().catch((err) => {
  console.error(`\nsync-calendar failed: ${err.message}`);
  process.exit(1);
});
