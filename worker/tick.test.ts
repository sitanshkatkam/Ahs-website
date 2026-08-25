import { beforeAll, describe, expect, it } from 'vitest';

import { nextAfter, tick, type Env } from './index';

/**
 * Two silent failures are guarded here.
 *
 * A device whose `next_at` falls behind — because a tick was missed, or a shard
 * failed — must still get advanced. Otherwise that row stays permanently
 * overdue, is never poked again, and one student's notifications stop forever
 * with nothing in any log to say so.
 *
 * And sends must be spread across shards. One Worker invocation may make 50
 * subrequests and each push is one, so an unsharded tick stops at ~45 students
 * and the rest are dropped without an error — which, when a whole school's
 * bells ring at once, is most of the school.
 */

const MIN = 60_000;
const NOW = Date.parse('2026-08-20T15:25:00Z');

type Recorded = { sql: string; params: unknown[] };

function fakeDB(rows: Record<string, unknown>[]) {
  const executed: Recorded[] = [];
  const make = (sql: string, params: unknown[] = []): Record<string, unknown> => ({
    sql,
    params,
    bind: (...p: unknown[]) => make(sql, p),
    all: async () => {
      executed.push({ sql, params });
      return { results: rows };
    },
    run: async () => {
      executed.push({ sql, params });
      return {};
    },
  });

  const db = {
    prepare: (sql: string) => make(sql),
    batch: async (stmts: { sql: string; params: unknown[] }[]) => {
      for (const s of stmts) executed.push({ sql: s.sql, params: s.params });
      return [];
    },
  };

  return { db: db as unknown as D1Database, executed };
}

/** Stands in for the SENDER service binding. */
function fakeSender(opts: { gone?: string[]; fail?: boolean } = {}) {
  const calls: { subs: { endpoint: string }[] }[] = [];
  const fetcher = {
    fetch: async (req: Request) => {
      if (opts.fail) throw new Error('shard unreachable');
      const body = (await req.json()) as { subs: { endpoint: string }[] };
      calls.push(body);
      const gone = (opts.gone ?? []).filter((e) => body.subs.some((s) => s.endpoint === e));
      return new Response(JSON.stringify({ sent: body.subs.length - gone.length, gone }));
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, calls };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/one',
  p256dh: 'pub',
  auth: 'auth',
  times: JSON.stringify([NOW - 10 * MIN, NOW - MIN, NOW + 30 * MIN, NOW + 90 * MIN]),
  next_at: NOW - MIN,
  ...over,
});

/**
 * A real P-256 pair. tick() builds a VapidSigner whenever anyone is due, and
 * the constructor imports the key eagerly — a placeholder string throws inside
 * a promise nobody awaits here, which surfaces as an unhandled rejection.
 */
let keys: { pub: string; priv: string };

beforeAll(async () => {
  const b64url = (b: ArrayBuffer | Uint8Array) => {
    const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
    let out = '';
    for (const x of arr) out += String.fromCharCode(x);
    return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  keys = {
    pub: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)),
    priv: jwk.d!,
  };
});

const envWith = (db: D1Database, sender?: Fetcher): Env =>
  ({
    DB: db,
    SENDER: sender ?? fakeSender().fetcher,
    SUBS: {} as KVNamespace,
    ASSETS: {} as Fetcher,
    VAPID_PUBLIC_KEY: keys.pub,
    VAPID_PRIVATE_KEY: keys.priv,
    VAPID_SUBJECT: 'mailto:a@b.c',
  }) as Env;

const writes = (executed: Recorded[]) =>
  executed.filter((e) => /UPDATE|DELETE|INSERT/.test(e.sql));

describe('nextAfter', () => {
  it('finds the first moment still ahead', () => {
    expect(nextAfter([1, 2, 3, 40, 50], 3)).toBe(40);
  });

  it('returns null once the list is spent, so the row leaves the index', () => {
    expect(nextAfter([1, 2, 3], 99)).toBeNull();
    expect(nextAfter([], 0)).toBeNull();
  });
});

describe('tick', () => {
  it('pokes a device whose alarm just came due', async () => {
    const { db, executed } = fakeDB([row()]);
    const sender = fakeSender();
    await tick(envWith(db, sender.fetcher), NOW);

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0].subs).toEqual([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/one', p256dh: 'pub', auth: 'auth' },
    ]);
    expect(writes(executed)[0].params).toEqual([
      'https://fcm.googleapis.com/fcm/send/one',
      NOW + 30 * MIN,
    ]);
  });

  it('advances a badly overdue row instead of poking it', async () => {
    // The regression that would silence a phone for good. No poke — the alert
    // stopped being true half an hour ago — but the row must still move on.
    const { db, executed } = fakeDB([row({ next_at: NOW - 30 * MIN })]);
    const sender = fakeSender();
    await tick(envWith(db, sender.fetcher), NOW);

    // Nothing sent — but the row is still advanced below.
    expect(sender.calls).toHaveLength(0);
    expect(writes(executed)).toHaveLength(1);
    expect(writes(executed)[0].params[1]).toBe(NOW + 30 * MIN);
  });

  it('queries with no lower bound, so nothing can fall out of range', async () => {
    const { db, executed } = fakeDB([]);
    await tick(envWith(db), NOW);

    const select = executed.find((e) => e.sql.includes('SELECT'))!;
    expect(select.sql).toContain('next_at <= ?1');
    expect(select.sql).not.toMatch(/next_at\s*>\s*\?/);
    expect(select.sql).toContain('ORDER BY next_at ASC');
  });

  it('splits a bell-sized crowd into shards under the subrequest limit', async () => {
    // 300 students due at once: one invocation could send ~45 before Cloudflare
    // refused the rest, so the work has to be spread across shards.
    const many = Array.from({ length: 300 }, (_, i) =>
      row({ endpoint: `https://fcm.googleapis.com/fcm/send/s${i}` }),
    );
    const { db } = fakeDB(many);
    const sender = fakeSender();
    await tick(envWith(db, sender.fetcher), NOW);

    expect(sender.calls.length).toBeGreaterThan(1);
    for (const call of sender.calls) expect(call.subs.length).toBeLessThanOrEqual(45);

    const delivered = sender.calls.reduce((n, c) => n + c.subs.length, 0);
    expect(delivered).toBe(300);
  });

  it('advances every row even when a shard fails outright', async () => {
    // A shard that throws must not strand its devices permanently overdue, and
    // must not take the other shards down with it.
    const many = Array.from({ length: 60 }, (_, i) =>
      row({ endpoint: `https://fcm.googleapis.com/fcm/send/f${i}` }),
    );
    const { db, executed } = fakeDB(many);
    await tick(envWith(db, fakeSender({ fail: true }).fetcher), NOW);

    const updates = writes(executed);
    expect(updates).toHaveLength(60);
    for (const u of updates) expect(u.params[1]).toBe(NOW + 30 * MIN);
  });

  it('drops a device the push service says is gone', async () => {
    const { db, executed } = fakeDB([row()]);
    const sender = fakeSender({ gone: ['https://fcm.googleapis.com/fcm/send/one'] });
    await tick(envWith(db, sender.fetcher), NOW);

    const w = writes(executed);
    expect(w).toHaveLength(1);
    expect(w[0].sql).toContain('DELETE');
    expect(w[0].params).toEqual(['https://fcm.googleapis.com/fcm/send/one']);
  });

  it('clears next_at when a device has no alarms left', async () => {
    const { db, executed } = fakeDB([
      row({ times: JSON.stringify([NOW - 5 * MIN]), next_at: NOW - MIN }),
    ]);
    await tick(envWith(db), NOW);
    expect(writes(executed)[0].params[1]).toBeNull();
  });

  it('survives a row whose times column is corrupt', async () => {
    const { db, executed } = fakeDB([row({ times: 'not json' })]);
    await expect(tick(envWith(db), NOW)).resolves.toBeUndefined();
    expect(writes(executed)[0].params[1]).toBeNull();
  });

  it('does nothing at all when nobody is due', async () => {
    const { db, executed } = fakeDB([]);
    const sender = fakeSender();
    await tick(envWith(db, sender.fetcher), NOW);
    expect(sender.calls).toHaveLength(0);
    expect(writes(executed)).toHaveLength(0);
  });

  it('prunes abandoned devices once a day, not every minute', async () => {
    const quiet = fakeDB([]);
    await tick(envWith(quiet.db), Date.parse('2026-08-20T12:30:00Z'));
    expect(writes(quiet.executed)).toHaveLength(0);

    const housekeeping = fakeDB([]);
    await tick(envWith(housekeeping.db), Date.parse('2026-08-20T00:30:00Z'));
    const prune = writes(housekeeping.executed);
    // Two sweeps share the daily slot: abandoned devices and expired sessions.
    expect(prune).toHaveLength(2);
    expect(prune.map((p) => p.sql).join(' ')).toContain('next_at IS NULL');
    expect(prune.map((p) => p.sql).join(' ')).toContain('DELETE FROM sessions');
  });
});
