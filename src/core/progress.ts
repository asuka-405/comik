import type { ChapterRow } from "./types";

/**
 * Several groups often upload the same chapter. Keep one per chapter number so unread counts and
 * "next chapter" are not inflated: prefer the one already read, then bookmarked, then newest upload.
 * Chapters without a known number are never merged.
 */
export function dedupeByNumber(chapters: ChapterRow[]): ChapterRow[] {
  const best = new Map<number, ChapterRow>();
  const rank = (c: ChapterRow) => (c.read ? 4e15 : 0) + (c.lastPage > 0 ? 2e15 : 0) + (c.bookmark ? 1e15 : 0) + c.dateUpload;
  const out: ChapterRow[] = [];
  for (const c of chapters) {
    if (c.number < 0) { out.push(c); continue; }
    const cur = best.get(c.number);
    if (!cur || rank(c) > rank(cur)) best.set(c.number, c);
  }
  return [...out, ...best.values()];
}

/** Oldest first. Falls back to reverse source order when numbers tie or are unknown. */
export function readingOrder(chapters: ChapterRow[]): ChapterRow[] {
  return [...chapters].sort((a, b) => (a.number !== b.number ? a.number - b.number : b.sourceOrder - a.sourceOrder));
}

export function chaptersAround(chapters: ChapterRow[], anchorId: string): { before: ChapterRow[]; after: ChapterRow[] } {
  const ordered = readingOrder(chapters);
  const index = ordered.findIndex((chapter) => chapter.id === anchorId);
  if (index < 0) return { before: [], after: [] };
  return { before: ordered.slice(0, index), after: ordered.slice(index + 1) };
}

export function nextUnreadChapters(chapters: ChapterRow[], anchorId: string | undefined, count: 10 | 25): ChapterRow[] {
  const ordered = readingOrder(chapters);
  const anchor = anchorId
    ? ordered.findIndex((chapter) => chapter.id === anchorId)
    : ordered.reduce((last, chapter, index) => chapter.read ? index : last, -1);
  return ordered.slice(anchor + 1).filter((chapter) => !chapter.read).slice(0, count);
}

/**
 * What "Continue" should open: the chapter you stopped halfway through most recently,
 * otherwise the first unread chapter after the furthest one you finished, otherwise the first unread.
 */
export function resumeTarget(chapters: ChapterRow[]): { chapter: ChapterRow; started: boolean } | undefined {
  if (!chapters.length) return undefined;
  const ordered = readingOrder(dedupeByNumber(chapters));
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

export function statsOf(all: ChapterRow[]): LibraryStats {
  const chapters = dedupeByNumber(all);
  let unread = 0;
  let lastReadAt = 0;
  for (const c of chapters) {
    if (!c.read) unread++;
    if (c.readAt > lastReadAt) lastReadAt = c.readAt;
  }
  const total = chapters.length;
  return { unread, total, lastReadAt, progress: total ? (total - unread) / total : 0 };
}
