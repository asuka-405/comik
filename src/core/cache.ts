/**
 * A small answer cache for source listings. Discover keeps what a site returned for an hour, so opening a
 * source, switching tabs or coming back later does not ask the site again. It lives in IndexedDB, so it survives
 * restarts, and an in-memory layer in front of it makes repeat reads instant.
 */
import { db } from "./db";

export const DISCOVER_TTL = 60 * 60_000;
/** Keep rows a while past their lifetime in case the site is down and a stale answer is better than none. */
const KEEP = 24 * 60 * 60_000;
const MAX_ROWS = 600;

const memory = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export interface CacheOptions {
  /** Skip the stored answer and ask again. The new answer replaces it. */
  force?: boolean;
  /** Serve a stored answer older than the lifetime when asking fails. */
  staleOnError?: boolean;
}

/** Return the stored answer for `key` if it is younger than `ttl`, otherwise run `load` and store what it returns. */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
  const now = Date.now();
  let hit = memory.get(key);
  if (!hit) {
    try {
      const row = await db.apiCache.get(key);
      if (row) { hit = { at: row.at, value: row.value }; memory.set(key, hit); }
    } catch { /* storage unavailable: behave as if empty */ }
  }
  if (hit && !options.force && now - hit.at < ttl) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const run = (async () => {
    try {
      const value = await load();
      const entry = { at: Date.now(), value };
      memory.set(key, entry);
      void db.apiCache.put({ key, at: entry.at, value }).catch(() => undefined);
      return value;
    } catch (error) {
      // A site that is down or asks for a check still lets the person browse what they saw before.
      if (options.staleOnError && hit) return hit.value as T;
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Forget cached answers whose key starts with `prefix`, such as every Discover page of one source. */
export async function forgetCached(prefix: string): Promise<void> {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
  try { await db.apiCache.where("key").startsWith(prefix).delete(); } catch { /* nothing stored */ }
}

/** Drop rows that are long expired and cap the table. Run once when the app starts. */
export async function pruneCache(): Promise<void> {
  try {
    await db.apiCache.where("at").below(Date.now() - KEEP).delete();
    const extra = (await db.apiCache.count()) - MAX_ROWS;
    if (extra > 0) {
      const oldest = await db.apiCache.orderBy("at").limit(extra).primaryKeys();
      await db.apiCache.bulkDelete(oldest);
    }
  } catch { /* the cache is an optimisation only */ }
}
