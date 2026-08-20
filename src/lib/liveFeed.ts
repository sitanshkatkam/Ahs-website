/**
 * Keeps the school's calendar current without a redeploy.
 *
 * The browser can't read Google's .ics directly — no CORS header — so the
 * Worker fetches it once an hour for everyone and serves the parsed result.
 * This grabs that on app open and hands it to resolveDay.
 *
 * Three layers, so the calendar is never empty:
 *   1. live response from /api/events
 *   2. the last good response, cached here
 *   3. the copy bundled at build time
 */

import { setLiveFeed } from './resolveDay';
import type { SyncedData } from '../data/synced';

const CACHE_KEY = 'ahs-schedule:feed';

/** Ignore a cached copy older than this; the bundled one is likelier to be sane. */
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readCache(): SyncedData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SyncedData;
    const age = Date.now() - new Date(parsed.generatedAt).getTime();
    if (!Number.isFinite(age) || age > MAX_CACHE_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(feed: SyncedData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(feed));
  } catch {
    // Quota or private mode. The in-memory copy still applies for this session.
  }
}

/**
 * Apply the newest calendar we can get hold of.
 *
 * Applies the cache synchronously first so the first paint already has last
 * week's events, then upgrades in the background when the network answers.
 * Returns true if the network copy landed.
 */
export async function loadLiveFeed(): Promise<boolean> {
  const cached = readCache();
  if (cached) setLiveFeed(cached);

  try {
    const res = await fetch('/api/events', {
      // The Worker already caches; this just avoids a stale browser entry.
      cache: 'no-cache',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;

    const feed = (await res.json()) as SyncedData;
    // Never let an empty or malformed response blank out a working calendar.
    if (!setLiveFeed(feed)) return false;

    writeCache(feed);
    return true;
  } catch {
    // Offline, or the Worker is down. Cached or bundled data is already in play.
    return false;
  }
}
