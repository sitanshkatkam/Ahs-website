import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendPoke = vi.hoisted(() => vi.fn(async () => 'ok' as const));
vi.mock('./push', async (original) => ({
  ...(await original<typeof import('./push')>()),
  sendPoke,
}));

import { nextAfter, tick, type Env } from './index';

/**
 * Subscriptions moved from a single KV blob to a row per device. The failure
 * this guards against is specific and silent: a device whose `next_at` falls
 * behind — because a tick was missed, or because the send budget ran out — must
 * still get advanced. If it doesn't, that row stays permanently overdue, is
 * never poked again, and one student's notifications stop forever with nothing
 * in any log to say so.
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

const envWith = (db: D1Database): Env =>
  ({
    DB: db,
    SUBS: {} as KVNamespace,
    ASSETS: {} as Fetcher,
    VAPID_PUBLIC_KEY: keys.pub,
    VAPID_PRIVATE_KEY: keys.priv,
    VAPID_SUBJECT: 'mailto:a@b.c',
  }) as Env;

const writes = (executed: Recorded[]) =>
  executed.filter((e) => /UPDATE|DELETE|INSERT/.test(e.sql));

beforeEach(() => sendPoke.mockClear());

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
    await tick(envWith(db), NOW);

    expect(sendPoke).toHaveBeenCalledTimes(1);
    expect(sendPoke.mock.calls[0][0]).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/one',
      keys: { p256dh: 'pub', auth: 'auth' },
    });
    expect(writes(executed)[0].params).toEqual([
      'https://fcm.googleapis.com/fcm/send/one',
      NOW + 30 * MIN,
    ]);
  });

  it('advances a badly overdue row instead of poking it', async () => {
    // The regression that would silence a phone for good. No poke — the alert
    // stopped being true half an hour ago — but the row must still move on.
    const { db, executed } = fakeDB([row({ next_at: NOW - 30 * MIN })]);
    await tick(envWith(db), NOW);

    expect(sendPoke).not.toHaveBeenCalled();
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

  it('caps a tick at the subrequest budget', async () => {
    const { db, executed } = fakeDB([]);
    await tick(envWith(db), NOW);
    const select = executed.find((e) => e.sql.includes('SELECT'))!;
    // Two subrequests go to the SELECT and the write-back; the rest are sends,
    // and the free plan allows 50 per invocation.
    expect(select.params[1]).toBeLessThanOrEqual(48);
  });

  it('drops a device the push service says is gone', async () => {
    sendPoke.mockResolvedValueOnce('gone' as never);
    const { db, executed } = fakeDB([row()]);
    await tick(envWith(db), NOW);

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
    await tick(envWith(db), NOW);
    expect(sendPoke).not.toHaveBeenCalled();
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
