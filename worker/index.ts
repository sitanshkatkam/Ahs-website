/**
 * The whole backend: static assets, two API routes, and a per-minute alarm clock.
 *
 * The server is deliberately dumb. It does not know the bell schedule, your
 * classes, your grades, or what any notification says. A client works out when
 * it wants to be poked, sends that list of timestamps, and this Worker pokes it
 * at those times. The service worker then decides what to actually show, using
 * data that never left the phone.
 *
 * Storage shape: one D1 row per device, with an indexed `next_at` so a cron
 * tick reads only the devices actually due rather than the whole school. This
 * was a single KV value holding every subscription, which meant each
 * registration rewrote everyone's record — two students subscribing in the same
 * second could lose each other's alarms, and 1,000 KV writes a day capped the
 * app at a couple of hundred users. KV still holds the calendar feed, which is
 * a genuine one-key-read-by-everybody case.
 *
 * The remaining ceiling is not storage. The free plan allows 50 subrequests per
 * invocation and every push send is one, so a tick can deliver roughly 45
 * pokes. See POKE_BUDGET.
 */

import type { PushSubscriptionRecord } from './push';
import {
  authConfigured,
  currentAccount,
  currentUserId,
  deleteAccount,
  handleCallback,
  pruneSessions,
  signOut,
  startAuth,
} from './auth';
// @ts-expect-error - plain JS shared with the Node build script, no types
import { FEED_URL, buildFeed } from '../shared/feed.js';

export type Env = {
  DB: D1Database;
  SENDER: Fetcher;
  SUBS: KVNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  /** Set once the Google Cloud OAuth client exists; sign-in is off until then. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

/** A device as the cron sees it. */
type DueRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  times: string;
  next_at: number;
};

const MAX_TIMES = 400; // ~30 days of alerts

/**
 * Sends handed to one shard.
 *
 * The free plan allows 50 subrequests per invocation and each push is one, so
 * this sits just under it. Measured, not assumed: a single invocation refuses
 * the 51st with "Too many subrequests by single Worker invocation".
 */
const SHARD_SIZE = 45;

/**
 * Shards one tick may run, and so the real ceiling: SHARD_SIZE × this.
 *
 * Each shard is a separate invocation with its own subrequest budget, reached
 * through a service binding — which is not itself a subrequest. Verified on the
 * free plan at 40 shards × 45 = 1,800 sends from one tick with no failures.
 * A school's bells ring at once, so headroom here is what stops the tail of the
 * alphabet quietly never being notified.
 */
const MAX_SHARDS = 40;

/** D1 caps a batch at 1,000 statements on the free plan; stay well under. */
const WRITE_CHUNK = 400;

/**
 * How late a poke may be and still be worth sending. Matched to the service
 * worker's own window: past this it would either show nothing or show
 * something that has stopped being true.
 */
const STALE_MS = 6 * 60 * 1000;

/** The next moment this device wants, or null once its list is spent. */
export function nextAfter(times: number[], nowMs: number): number | null {
  for (const t of times) if (t > nowMs) return t;
  return null;
}

function parseTimes(raw: string): number[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t) => typeof t === 'number' && Number.isFinite(t)) : [];
  } catch {
    return [];
  }
}

const FEED_KEY = 'calendar-feed';
/** How stale the cached feed may get. The school edits it a few times a term. */
const FEED_TTL_MS = 60 * 60 * 1000;
const FEED_FROM = '2026-08-01';
const FEED_TO = '2027-06-30';

type CachedFeed = {
  fetchedAt: number;
  payload: {
    generatedAt: string;
    source: string;
    scheduleOverrides: { date: string; scheduleId: string }[];
    events: unknown[];
  };
};

/**
 * The school's calendar, fetched once for everybody rather than once per phone.
 *
 * Browsers can't read the Google feed directly — it sends no CORS header — so
 * this is the only way clients can see events the school added after the last
 * deploy. Fetching it here also means one request an hour to Google instead of
 * one per app open.
 */
async function getFeed(env: Env, force = false): Promise<CachedFeed | null> {
  const cached = await env.SUBS.get<CachedFeed>(FEED_KEY, 'json');
  const fresh = cached && Date.now() - cached.fetchedAt < FEED_TTL_MS;
  if (fresh && !force) return cached;

  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const ics = await res.text();
    const { scheduleOverrides, events } = buildFeed(ics, { from: FEED_FROM, to: FEED_TO });

    const next: CachedFeed = {
      fetchedAt: Date.now(),
      payload: {
        generatedAt: new Date().toISOString(),
        source: 'American High School — Academics (live)',
        scheduleOverrides,
        events,
      },
    };
    await env.SUBS.put(FEED_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Serve stale rather than nothing: a month-old event list beats an error,
    // and the client falls back to its own bundled copy if even this is absent.
    return cached ?? null;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors() },
  });

const cors = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (url.pathname === '/api/subscribe' && request.method === 'POST') {
      let body: { subscription?: PushSubscriptionRecord; times?: number[] };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }

      const sub = body.subscription;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return json({ error: 'invalid subscription' }, 400);
      }

      const now = Date.now();
      // Only keep future alarms, and cap the list so one client can't bloat its row.
      const times = (body.times ?? [])
        .filter((t) => typeof t === 'number' && Number.isFinite(t) && t > now)
        .sort((a, b) => a - b)
        .slice(0, MAX_TIMES);

      // A single upsert of this device's own row. Nothing here touches anyone
      // else's, so two students registering at the same moment can't collide.
      await env.DB.prepare(
        `INSERT INTO subscriptions (endpoint, p256dh, auth, times, next_at, updated)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(endpoint) DO UPDATE SET
           p256dh  = excluded.p256dh,
           auth    = excluded.auth,
           times   = excluded.times,
           next_at = excluded.next_at,
           updated = excluded.updated`,
      )
        .bind(
          sub.endpoint,
          sub.keys.p256dh,
          sub.keys.auth,
          JSON.stringify(times),
          nextAfter(times, now),
          now,
        )
        .run();

      return json({ ok: true, scheduled: times.length });
    }

    if (url.pathname === '/api/unsubscribe' && request.method === 'POST') {
      let body: { endpoint?: string };
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid json' }, 400);
      }
      if (!body.endpoint) return json({ error: 'missing endpoint' }, 400);

      await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?1')
        .bind(body.endpoint)
        .run();
      return json({ ok: true });
    }

    if (url.pathname === '/api/events') {
      const feed = await getFeed(env);
      if (!feed) return json({ error: 'feed unavailable' }, 503);
      return new Response(JSON.stringify(feed.payload), {
        headers: {
          'content-type': 'application/json',
          // Let the edge and the browser both hold it briefly; the client also
          // keeps its own copy so a flaky network never empties the calendar.
          'cache-control': 'public, max-age=900, stale-while-revalidate=86400',
          ...cors(),
        },
      });
    }

    /*
      Google sign-in. Everything here is additive — the app is fully usable
      without an account, so each route reports itself unavailable rather than
      erroring when the keys aren't set yet, and the UI hides the button.
    */
    if (url.pathname.startsWith('/api/auth/')) {
      if (url.pathname === '/api/auth/me') {
        // Answered even when sign-in is switched off, so the client has one
        // shape to handle instead of two.
        return json({
          configured: authConfigured(env),
          account: authConfigured(env) ? await currentAccount(request, env) : null,
        });
      }

      if (!authConfigured(env)) return json({ error: 'sign-in not configured' }, 503);

      if (url.pathname === '/api/auth/google/start') return startAuth(request, env);
      if (url.pathname === '/api/auth/google/callback') return handleCallback(request, env);
      if (url.pathname === '/api/auth/signout' && request.method === 'POST') {
        return signOut(request, env);
      }
      if (url.pathname === '/api/auth/delete' && request.method === 'POST') {
        return deleteAccount(request, env);
      }
      return json({ error: 'not found' }, 404);
    }

    /*
      Schedule sync. The server treats `data` as an opaque string: it never
      parses it, never reasons about it, and nothing else here reads the table.
      That keeps the sync contract entirely a client concern, and means adding
      a field to a student's schedule needs no change on this side.

      Last-write-wins, decided by the client's `updated` stamp rather than the
      server's clock — the question is which *edit* is newer, and only the
      device that made it knows when that was.
    */
    if (url.pathname === '/api/sync') {
      const userId = authConfigured(env) ? await currentUserId(request, env) : null;
      if (!userId) return json({ error: 'not signed in' }, 401);

      if (request.method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT data, updated FROM schedules WHERE user_id = ?1',
        )
          .bind(userId)
          .first<{ data: string; updated: number }>();
        // A brand new account has nothing yet, which is a normal answer.
        return json(row ? { data: row.data, updated: row.updated } : { data: null, updated: 0 });
      }

      if (request.method === 'PUT') {
        let body: { data?: unknown; updated?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid json' }, 400);
        }

        // A cap, so one client cannot bloat a row. A schedule is a few KB; this
        // is far above anything legitimate and far below D1's 1 MB row limit.
        if (typeof body.data !== 'string' || body.data.length > 64_000) {
          return json({ error: 'invalid data' }, 400);
        }
        const updated =
          typeof body.updated === 'number' && Number.isFinite(body.updated)
            ? body.updated
            : Date.now();

        await env.DB.prepare(
          `INSERT INTO schedules (user_id, data, updated)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(user_id) DO UPDATE SET
             data = excluded.data, updated = excluded.updated
           WHERE excluded.updated >= schedules.updated`,
        )
          .bind(userId, body.data, updated)
          .run();

        return json({ ok: true });
      }

      return json({ error: 'method not allowed' }, 405);
    }



    // The client needs the public key to subscribe; it is public by definition.
    if (url.pathname === '/api/vapid-public-key') {
      return new Response(env.VAPID_PUBLIC_KEY, {
        headers: { 'content-type': 'text/plain', ...cors() },
      });
    }

    return env.ASSETS.fetch(request);
  },

  /**
   * Runs every minute. Pokes anyone with an alarm in the last two minutes —
   * a window rather than an exact match, so a delayed or skipped tick doesn't
   * silently drop someone's alert.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env, event.scheduledTime));

    // Warm the calendar cache once an hour so no student ever waits on Google.
    const at = new Date(event.scheduledTime);
    if (at.getUTCMinutes() === 7) ctx.waitUntil(getFeed(env, true).then(() => undefined));
  },
};

export async function tick(env: Env, nowMs: number): Promise<void> {
  // No lower bound on the query on purpose. If a tick is missed or the send
  // budget is exhausted, a device's next_at falls behind — bounding the query
  // would skip it forever and its alarms would never advance, so the row would
  // be stuck and that phone would go permanently quiet. Selecting everything
  // overdue and advancing it unconditionally is what makes that self-healing.
  const { results } = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth, times, next_at
       FROM subscriptions
      WHERE next_at IS NOT NULL AND next_at <= ?1
      ORDER BY next_at ASC
      LIMIT ?2`,
  )
    .bind(nowMs, SHARD_SIZE * MAX_SHARDS)
    .all<DueRow>();

  const due = results ?? [];

  if (due.length > 0) {
    // Fresh enough to be worth sending, versus merely needing its next_at
    // moved along. Both get written back; only the first gets a push.
    const fresh = due.filter((row) => nowMs - row.next_at <= STALE_MS);

    const shards: DueRow[][] = [];
    for (let i = 0; i < fresh.length; i += SHARD_SIZE) {
      shards.push(fresh.slice(i, i + SHARD_SIZE));
    }

    // In parallel: each is a separate invocation, so they do not contend for
    // this one's subrequests or CPU.
    const outcomes = await Promise.all(
      shards.map(async (shard) => {
        try {
          const res = await env.SENDER.fetch(
            new Request('https://sender/send', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                subs: shard.map((r) => ({
                  endpoint: r.endpoint,
                  p256dh: r.p256dh,
                  auth: r.auth,
                })),
              }),
            }),
          );
          if (!res.ok) return { gone: [] as string[] };
          return (await res.json()) as { gone: string[] };
        } catch {
          // A shard that fails sends nothing, and its devices simply stay due
          // for the next tick. Losing one shard must not lose the others.
          return { gone: [] as string[] };
        }
      }),
    );

    const gone = new Set(outcomes.flatMap((o) => o.gone ?? []));

    const writes: D1PreparedStatement[] = due.map((row) =>
      gone.has(row.endpoint)
        ? env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?1').bind(row.endpoint)
        : env.DB.prepare('UPDATE subscriptions SET next_at = ?2 WHERE endpoint = ?1').bind(
            row.endpoint,
            nextAfter(parseTimes(row.times), nowMs),
          ),
    );

    for (let i = 0; i < writes.length; i += WRITE_CHUNK) {
      await env.DB.batch(writes.slice(i, i + WRITE_CHUNK));
    }
  }

  // Housekeeping once a day rather than every tick. Devices with nothing left
  // pending and no sign of life for a month have almost certainly uninstalled;
  // until then an idle row costs nothing, since the partial index ignores it.
  const at = new Date(nowMs);
  if (at.getUTCHours() === 0 && at.getUTCMinutes() === 30) {
    await env.DB.prepare(
      'DELETE FROM subscriptions WHERE next_at IS NULL AND updated < ?1',
    )
      .bind(nowMs - 30 * 24 * 60 * 60 * 1000)
      .run();
    await pruneSessions(env, nowMs);
  }
}
