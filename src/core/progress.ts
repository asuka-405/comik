import type { ChapterRow } from "./types";

/** Oldest first. Falls back to reverse source order when numbers tie or are unknown. */
export function readingOrder(chapters: ChapterRow[]): ChapterRow[] {
  return [...chapters].sort((a, b) => (a.number !== b.number ? a.number - b.number : b.sourceOrder - a.sourceOrder));
}

/**
 * What "Continue" should open: the chapter you stopped halfway through most recently,
 * otherwise the first unread chapter after the furthest one you finished, otherwise the first unread.
 */
export function resumeTarget(chapters: ChapterRow[]): { chapter: ChapterRow; started: boolean } | undefined {
  if (!chapters.length) return undefined;
  const ordered = readingOrder(chapters);
  const partial = ordered.filter((c) => !c.read && c.lastPage > 0).sort((a, b) => b.readAt - a.readAt)[0];
  if (partial) return { chapter: partial, started: true };
  let furthest = -1;
  ordered.forEach((c, i) => c.read && (furthest = i));
  const next = ordered.slice(furthest + 1).find((c) => !c.read) ?? ordered.find((c) => !c.read);
  if (next) return { chapter: next, started: furthest >= 0 };
  return undefined;
}

export interface LibraryStats {
  unread: number;
  total: number;
  lastReadAt: number;
  progress: number;
}

export function statsOf(chapters: ChapterRow[]): LibraryStats {
  let unread = 0;
  let lastReadAt = 0;
  for (const c of chapters) {
    if (!c.read) unread++;
    if (c.readAt > lastReadAt) lastReadAt = c.readAt;
  }
  const total = chapters.length;
  return { unread, total, lastReadAt, progress: total ? (total - unread) / total : 0 };
}
