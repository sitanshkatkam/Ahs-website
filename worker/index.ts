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

import { sendPoke, VapidSigner, type PushSubscriptionRecord } from './push';
import {
  authConfigured,
  currentAccount,
  handleCallback,
  pruneSessions,
  signOut,
  startAuth,
} from './auth';
// @ts-expect-error - plain JS shared with the Node build script, no types
import { FEED_URL, buildFeed } from '../shared/feed.js';

export type Env = {
  DB: D1Database;
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
 * How many pushes one tick will attempt.
 *
 * The free plan allows 50 subrequests per invocation, and the SELECT and the
 * write-back are two of them, so this leaves a little headroom. Anything over
 * the budget stays due and is picked up by the next tick a minute later —
 * which is why STALE_MS below is generous enough to let a backlog drain.
 */
const POKE_BUDGET = 45;

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
      return json({ error: 'not found' }, 404);
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
    .bind(nowMs, POKE_BUDGET)
    .all<DueRow>();

  const due = results ?? [];

  if (due.length > 0) {
    const signer = new VapidSigner(
      env.VAPID_PRIVATE_KEY,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_SUBJECT,
    );
    const writes: D1PreparedStatement[] = [];

    // Sequential rather than Promise.all: the free plan allows 10ms of CPU per
    // invocation, and fanning out hundreds of TLS handshakes at once is the
    // fastest way to blow through it.
    for (const row of due) {
      let gone = false;

      // Oldest first, so a backlog drains in the order people were promised.
      if (nowMs - row.next_at <= STALE_MS) {
        const result = await sendPoke(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          signer,
        );
        gone = result === 'gone';
      }

      if (gone) {
        writes.push(
          env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?1').bind(row.endpoint),
        );
        continue;
      }

      writes.push(
        env.DB.prepare('UPDATE subscriptions SET next_at = ?2 WHERE endpoint = ?1').bind(
          row.endpoint,
          nextAfter(parseTimes(row.times), nowMs),
        ),
      );
    }

    // One batch, so the whole tick costs a single extra subrequest.
    if (writes.length > 0) await env.DB.batch(writes);
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
