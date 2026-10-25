/**
 * Per-title reading numbers (unread, total, last read, what Continue opens) kept in their own small table, so the
 * shelf can draw from a few hundred tiny rows instead of reading every chapter of every title on each open.
 * Rows are recomputed in the background for the titles whose chapters changed. Nothing here talks to the network.
 */
import { db } from "./db";
import { resumeTarget, statsOf, type LibraryStats } from "./progress";
import type { ChapterRow } from "./types";

export interface ShelfStatsRow extends LibraryStats {
  mangaId: string;
  /** What Continue opens for this title, if anything. */
  resume?: { id: string; number: number; lastPage: number; started: boolean };
}

export function shelfStatsOf(mangaId: string, chapters: ChapterRow[]): ShelfStatsRow {
  const target = resumeTarget(chapters);
  return {
    mangaId,
    ...statsOf(chapters),
    ...(target ? { resume: { id: target.chapter.id, number: target.chapter.number, lastPage: target.chapter.lastPage, started: target.started } } : {}),
  };
}

const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let installed = false;

/** Recompute the rows for every title marked dirty. Safe to call at any time; one run at a time is enough. */
let running: Promise<void> | undefined;
export function flushShelfStats(): Promise<void> {
  running ??= (async () => {
    try {
      while (dirty.size) {
        const ids = [...dirty].slice(0, 40);
        for (const id of ids) dirty.delete(id);
        const rows: ShelfStatsRow[] = [];
        // A title with no chapters still gets a (zero) row, so the shelf does not keep asking for one.
        for (const id of ids) rows.push(shelfStatsOf(id, await db.chapters.where("mangaId").equals(id).toArray()));
        await db.shelfStats.bulkPut(rows);
        // Let the interface breathe between batches on a large library.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error("Could not update shelf numbers", error);
    } finally {
      running = undefined;
      if (dirty.size) schedule();
    }
  })();
  return running;
}

function schedule(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(() => void flushShelfStats(), delay);
}

export function markShelfStatsDirty(...mangaIds: string[]) {
  for (const id of mangaIds) dirty.add(id);
  if (dirty.size) schedule();
}

/**
 * Watch the chapters table so any write, from the reader, a refresh, sync or a restore, marks its title dirty, and
 * fill in rows for shelf titles that have none yet (first launch after this version, or after a reset).
 */
export function startShelfStats() {
  if (installed) return;
  installed = true;
  db.chapters.hook("creating", (_key, chapter) => { markShelfStatsDirty(chapter.mangaId); });
  db.chapters.hook("updating", (_changes, _key, chapter) => { markShelfStatsDirty(chapter.mangaId); });
  db.chapters.hook("deleting", (_key, chapter) => { markShelfStatsDirty(chapter.mangaId); });
  void backfillShelfStats();
}

export async function backfillShelfStats() {
  try {
    const [shelf, have] = await Promise.all([db.manga.where("libraryFlag").equals(1).primaryKeys(), db.shelfStats.toCollection().primaryKeys()]);
    const known = new Set(have);
    markShelfStatsDirty(...shelf.filter((id) => !known.has(id)));
  } catch (error) {
    console.error("Could not prepare shelf numbers", error);
  }
}
