/**
 * What the service worker is allowed to know.
 *
 * The page reads and writes localStorage, which is synchronous and simple, but
 * a service worker cannot see localStorage at all. So the page leaves the
 * worker a copy of the one thing it needs here.
 *
 * That copy used to be the raw settings blob, and the worker re-derived the
 * day's alerts from it at push time. Two independent derivations of the same
 * thing is one too many: any disagreement between them — a settings write that
 * didn't land, a schedule the page had fetched and the worker hadn't — meant
 * the worker found nothing to say and said so, which is where the hourly
 * "checked your schedule" notification came from.
 *
 * Now the page computes the alerts once, uploads their timestamps to the
 * server, and leaves the very same list here. The worker looks up rather than
 * recomputes, so the two cannot drift apart.
 */

const DB_NAME = 'ahs-schedule';
const STORE = 'kv';
const PLAN_KEY = 'plan';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

/**
 * One alert, fully composed by the page. `at` is a plain epoch millisecond
 * rather than a Date so nothing depends on how a structured clone survives.
 */
export type StoredAlert = { id: string; at: number; title: string; body: string };

/** Hand the worker the alert list. Never throws. */
export async function mirrorPlan(plan: StoredAlert[]): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') return;
    await put(PLAN_KEY, plan);
  } catch {
    // Private mode, quota, or a blocked upgrade. Foreground alerts still work.
  }
}

export async function readPlan(): Promise<StoredAlert[] | undefined> {
  try {
    return await get<StoredAlert[]>(PLAN_KEY);
  } catch {
    return undefined;
  }
}

/**
 * Ids of notifications already shown, shared between the page and the worker so
 * the same alert can't fire twice.
 */
const FIRED_KEY = 'fired';

export async function readFired(): Promise<string[]> {
  // Deliberately swallowing: a throw here would abort the push handler before
  // it shows anything, which is worse than briefly forgetting what we sent.
  try {
    return (await get<string[]>(FIRED_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function markFired(id: string, keep: number = 200): Promise<void> {
  try {
    const ids = await readFired();
    if (ids.includes(id)) return;
    await put(FIRED_KEY, [...ids, id].slice(-keep));
  } catch {
    /* ignore */
  }
}
