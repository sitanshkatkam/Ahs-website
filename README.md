# American High Schedule

A small, installable app that answers one question fast: **what class do I have right now?**

Built for American High School in Fremont (FUSD), where the bell schedule rotates between
six-period days, two flavours of block day, rally days, minimum days and finals — and the
only official source is a PDF that's miserable to read on a phone.

No account. Your classes, grades and settings are stored only on your own device.
The one exception is opt-in notifications: turning those on sends an anonymous list
of *times* to a Cloudflare Worker so it knows when to wake your phone. It is never
told what any of them are for — the notification text is composed on-device.

---

## What it does

- **Today** — a live ring showing the current period, the room, and time left. It knows the
  difference between "in class", "passing period", "before school" and "done", and says so.
  Below it: what's due soon, and what's coming up.
- **Calendar** — a month grid colour-coded by schedule type; tap any day for its full bell
  schedule and events.
- **Classes** — weighted and unweighted GPA, per-class grades by semester, and an assignment
  list per class.
- **College** — countdown to the next SAT/ACT, application and aid deadlines, and a checklist
  for your grade level.
- **Settings** — your six classes, notification toggles, event filters, theme, and a place to
  add schedule changes the school announces mid-year.

## GPA

Two figures, because they answer different questions: **unweighted** on the plain 4.0 scale,
and **weighted** with a bonus for AP and honours courses. AP is +1.0. The honours bonus is a
setting, because schools genuinely differ (+0.5 at some, +1.0 at others) — check your own
transcript.

A failed course earns no weighting bonus, and an unentered grade is not a zero: the display
shows `—` until you enter something, so an empty tracker never looks like a 0.00.

This is a personal tracker, not an official transcript. UC's own GPA calculation is a
different thing again — 10th/11th grade a-g courses only, honours capped at 8 semesters — and
is deliberately not attempted.

## Notifications

Four independent toggles, all off by default:

| Toggle | Fires |
| --- | --- |
| Class starting soon | 2 / 5 / 10 / 15 min before each period |
| Tomorrow's schedule | evening before a block, rally, minimum or finals day |
| Upcoming events | 1 / 2 / 3 / 7 days before a calendar event |
| Assignments due | one digest, not a buzz per task |
| Brunch, lunch & final bell | at each one |

Delivery works two ways at once. A foreground scheduler handles the case where the app is
open, and **Web Push** covers everything else — alerts arrive even if the app has been closed
for days. Both paths tag notifications with the same stable id, so the two can't double-buzz.

### How push stays private

The app's promise is that nothing leaves your phone, and adding a server didn't change that.

The trick is that **the server is a dumb alarm clock**. Your device works out when it wants to
be woken — using the bundled bell schedule and your own settings — and uploads nothing but a
list of timestamps alongside the push subscription. When one comes due the Worker sends a
**payload-less push**: a bare poke carrying no data at all. The service worker wakes, reads
your classes and preferences from IndexedDB, and decides what to display locally.

So the server never learns your classes, teachers, rooms, grades, assignments, or even which
kind of alert is firing. It knows an opaque push endpoint and some times. That is also why
`worker/push.ts` implements only VAPID signing and no `aes128gcm` payload encryption — with no
payload, there's nothing to encrypt.

Re-registering happens on every app open, which tops the 30-day alarm horizon back up and
heals any write lost to a concurrent subscribe.

### Why Cloudflare and not Vercel

Vercel's Hobby plan caps cron at **once per day**, which cannot drive a "5 minutes before
class" alert. Cloudflare Workers gives one-minute cron triggers on the free plan, so the app
and its backend both live there.

One consequence worth knowing: the Workers free plan allows 1,000 KV writes a day, so the cron
reads a single aggregated key each tick and only writes during a daily housekeeping pass. A
write every minute would be 1,440 and would blow the quota.

## Where the schedule data comes from

Three sources, in descending order of authority.

**1. The PDFs** (linked from `fremontunified.org/american`) — hand-verified, and the base
layer:

- **AHS Bell Schedule 2026-2027** — every bell time, plus the dates for block, rally, minimum
  and finals days.
- **FUSD Instructional Calendar 2026-2027** — holidays, breaks and term boundaries.

Bell times live in [`src/data/schedules.ts`](src/data/schedules.ts); date exceptions in
[`src/data/calendar.ts`](src/data/calendar.ts). Only exceptions are listed — the normal week
is Monday six-period, Tuesday/Thursday 1·3·5 block, Wednesday/Friday 2·4·6 block.

Sanity check if you ever retype the times: **every passing period is exactly 6 minutes.**

**2. The school's public Google Calendar**, served live.

American High labels every day in that feed with its bell schedule, and publishes dances,
concerts, spirit week and (as seasons are scheduled) every game. Students see new entries
without waiting for a redeploy:

- The Worker fetches the feed hourly and serves the parsed result at **`/api/events`**. A
  browser can't read Google's `.ics` directly — it sends no CORS header — so this is also the
  only way clients can see it at all. One request an hour to Google, not one per app open.
- The app fetches that on open and keeps its own copy, so the calendar survives being offline.
- Three layers, in order: live response → last cached response → the copy bundled at build
  time in [`src/data/synced.json`](src/data/synced.json). The calendar is never empty.

Parsing lives in [`shared/feed.js`](shared/feed.js), imported by both the Worker and the
build script, so the live feed and the offline fallback can't classify the same event
differently. To refresh the bundled fallback:

```bash
npm run sync:calendar
```

That prints a diff against the PDF data.

It is deliberately **not** trusted blindly:

- It **never closes school.** The feed once listed Memorial Day on 3/31/27, two months early,
  and it omits Family Conferences, the Non-Student Day, Staff Development days and Spring
  Break entirely. Closures come from the instructional calendar only.
- Synced schedule days only fill dates `calendar.ts` doesn't already pin. On a conflict the
  PDF wins and the script prints the disagreement.
- `resolveDay.test.ts` asserts the feed agrees with the verified data on every day it labels,
  so drift fails the build rather than shipping.

That test is how the 3/11 rally parity error was caught — the PDF lists the date but not the
odd/even parity, and the weekday-based guess was wrong.

[`.github/workflows/sync-calendar.yml`](.github/workflows/sync-calendar.yml) re-runs the sync
nightly, runs the tests, and commits only if both pass.

The district feed is not synced — it contains only board and LCAAC meetings.

**3. Your own overrides**, added in Settings. These beat everything and survive app updates.

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

The tests cover the day resolver and the notification planner — the two places where date
logic actually goes wrong. UI is verified by hand.

In dev you can freeze the clock to inspect any moment of any day:

```
http://localhost:5173/?at=2026-09-15T11:40
```

## Deploying

Log in once — the OAuth flow needs a real terminal, so this one can't be automated:

```bash
npx wrangler login
```

Then everything else is one command. It creates the KV namespace, uploads the VAPID private
key as a secret, builds, and publishes. Re-running it is safe; each step no-ops if already done.

```bash
npm run deploy
```

Then make the share QR:

```bash
npm run qr    # uses appUrl from package.json
```

That writes `share/qr.svg` and `share/qr.png`. Anyone who scans it lands on the app and can
"Add to Home Screen" for a real icon, fullscreen, offline access, and push.

### Keys

`npm run deploy` reads `.vapid.json`, which is gitignored and holds the keypair. The public
half is also in `.env` and `wrangler.toml` — that one is public by design and safe to commit.
Losing `.vapid.json` means every existing subscription stops working and everyone has to
re-enable alerts, so keep a copy somewhere.

### Later: the Play Store

The same codebase wraps with Capacitor — `npx cap add android`, point it at `dist/`, and
submit. No rewrite. Worth doing only if you want the store listing itself; the PWA already
installs.

## Layout

```
src/
  data/schedules.ts    bell schedule templates
  data/calendar.ts     verified date exceptions, holidays, curated events
  data/synced.json     generated — the school's calendar feed
  data/college.ts      SAT/ACT dates, application deadlines, checklists
  lib/resolveDay.ts    the single source of truth every screen reads
  lib/gpa.ts           weighted and unweighted GPA
  lib/notifications.ts pure planner + a one-timeout scheduler
  lib/push.ts          subscribes and uploads the alarm timestamps
  lib/liveFeed.ts      fetches /api/events, caches it, hands it to resolveDay
  lib/idb.ts           settings mirror the service worker can read
  lib/storage.ts       versioned localStorage
  sw.ts                service worker: precache + the push handler
  screens/             Today, Calendar, Classes, College, Settings, Onboarding
worker/
  index.ts             API, cron alarm clock, calendar cache, static assets
  push.ts              VAPID signing in WebCrypto
shared/
  feed.js              ICS parsing, shared by the Worker and the build script
scripts/
  sync-calendar.mjs    pulls the feed, diffs it against the verified data
  deploy.mjs           KV + secret + build + publish
  make-qr.mjs          share QR for the deployed URL
```

`resolveDay(date)` is the function to understand first. Precedence, highest first:

1. your own overrides from Settings
2. the verified calendar in `calendar.ts`
3. the school's synced feed
4. the default weekly rotation
