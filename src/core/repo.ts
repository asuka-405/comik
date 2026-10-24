import { db, mangaId as mkMangaId, chapterId as mkChapterId } from "./db";
import { hash53 } from "./hash";
import { emitLocalChange } from "./bus";
import { backfillNumbers, recognizeChapterNumber } from "./chapterRecognition";
import type { CategoryRow, ChapterRow, MangaRow, SChapter, SManga } from "./types";

const now = () => Date.now();

/* --------------------------------- manga ---------------------------------- */

export async function upsertManga(sourceId: string, s: SManga): Promise<MangaRow> {
  const id = mkMangaId(sourceId, s.url);
  const existing = await db.manga.get(id);
  const row: MangaRow = {
    id,
    sourceId,
    url: s.url,
    title: s.title || existing?.title || "Untitled",
    kind: s.kind ?? existing?.kind,
    aliases: s.aliases?.length ? s.aliases : existing?.aliases,
    cover: s.cover || existing?.cover,
    author: s.author ?? existing?.author,
    artist: s.artist ?? existing?.artist,
    description: s.description ?? existing?.description,
    genres: s.genres?.length ? s.genres : (existing?.genres ?? []),
    status: s.status && s.status !== "unknown" ? s.status : (existing?.status ?? "unknown"),
    inLibrary: existing?.inLibrary ?? false,
    categoryIds: existing?.categoryIds ?? [],
    addedAt: existing?.addedAt ?? 0,
    lastUpdateAt: existing?.lastUpdateAt ?? 0,
    lastFetchedAt: existing?.lastFetchedAt ?? 0,
    accent: existing?.accent,
    readerMode: existing?.readerMode,
    chapterSort: existing?.chapterSort,
    chapterSortAsc: existing?.chapterSortAsc,
    chapterFilter: existing?.chapterFilter,
    modifiedAt: existing?.modifiedAt ?? 0,
  };
  // browsing never dirties sync state; only library members do
  await db.manga.put(row);
  return row;
}

export async function patchManga(id: string, patch: Partial<MangaRow>) {
  const m = await db.manga.get(id);
  if (!m) return;
  await db.manga.put({ ...m, ...patch, modifiedAt: now() });
  emitLocalChange();
}

export async function setInLibrary(id: string, value: boolean, categoryIds?: string[]) {
  const m = await db.manga.get(id);
  if (!m) return;
  await db.manga.put({
    ...m,
    inLibrary: value,
    addedAt: value ? m.addedAt || now() : m.addedAt,
    categoryIds: categoryIds ?? m.categoryIds,
    modifiedAt: now(),
  });
  emitLocalChange();
}

/** Move a shelf entry to another source while retaining the original record for unmatched chapters. */
export async function migrateManga(fromId: string, toId: string): Promise<number> {
  if (fromId === toId) throw new Error("Choose a different destination series.");
  const [from, to] = await Promise.all([db.manga.get(fromId), db.manga.get(toId)]);
  if (!from || !to) throw new Error("The source or destination series is no longer available.");

  const [fromChapters, toChapters] = await Promise.all([
    db.chapters.where("mangaId").equals(fromId).toArray(),
    db.chapters.where("mangaId").equals(toId).toArray(),
  ]);
  const byNumber = new Map<number, ChapterRow[]>();
  for (const chapter of fromChapters) {
    if (chapter.number < 0) continue;
    const matches = byNumber.get(chapter.number) ?? [];
    matches.push(chapter);
    byNumber.set(chapter.number, matches);
  }

  const timestamp = now();
  let transferred = 0;
  const migratedChapters = toChapters.map((chapter) => {
    const candidates = byNumber.get(chapter.number);
    if (!candidates?.length) return chapter;
    const prior = candidates.reduce((best, item) => item.modifiedAt > best.modifiedAt ? item : best);
    if (!prior.read && !prior.bookmark && prior.lastPage <= 0 && !prior.readAt) return chapter;
    transferred++;
    return {
      ...chapter,
      read: chapter.read || prior.read,
      bookmark: chapter.bookmark || prior.bookmark,
      lastPage: Math.max(chapter.lastPage, prior.lastPage),
      pageCount: Math.max(chapter.pageCount, prior.pageCount),
      readAt: Math.max(chapter.readAt, prior.readAt),
      modifiedAt: timestamp,
    };
  });
  const migrated = {
    ...to,
    inLibrary: true,
    addedAt: from.addedAt || to.addedAt || timestamp,
    categoryIds: [...new Set([...to.categoryIds, ...from.categoryIds])],
    accent: from.accent ?? to.accent,
    readerMode: from.readerMode ?? to.readerMode,
    chapterSort: from.chapterSort ?? to.chapterSort,
    chapterSortAsc: from.chapterSortAsc ?? to.chapterSortAsc,
    chapterFilter: from.chapterFilter ?? to.chapterFilter,
    modifiedAt: timestamp,
  };
  const archivedSource = { ...from, inLibrary: false, modifiedAt: timestamp };

  await db.transaction("rw", db.manga, db.chapters, async () => {
    await db.manga.bulkPut([migrated, archivedSource]);
    await db.chapters.bulkPut(migratedChapters);
  });
  emitLocalChange();
  return transferred;
}

/** Same title in the library from another source. Used to warn before adding a duplicate. */
export async function findDuplicates(title: string, exceptId?: string): Promise<MangaRow[]> {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const key = norm(title);
  if (!key) return [];
  return db.manga.filter((m) => m.inLibrary && m.id !== exceptId && norm(m.title) === key).toArray();
}

/* -------------------------------- chapters -------------------------------- */

export interface SyncResult {
  added: ChapterRow[];
  removed: number;
  total: number;
}

/**
 * Reconcile the source's chapter list with what's stored. Port of the idea behind
 * Mihon's SyncChaptersWithSource:
 *  - new URLs become rows (marked as "discovered" only after the first sync so the
 *    initial import doesn't flood the updates feed),
 *  - existing rows keep read / bookmark / progress,
 *  - rows the source dropped are removed unless the user cares about them,
 *  - when a source re-uploads a chapter under a new URL the read state follows the chapter number.
 */
export async function syncChapters(manga: MangaRow, remote: SChapter[]): Promise<SyncResult> {
  const t = now();
  const existing = await db.chapters.where("mangaId").equals(manga.id).toArray();
  const byUrl = new Map(existing.map((c) => [c.url, c]));
  const firstSync = existing.length === 0;

  // de-dupe identical URLs the source may repeat
  const seen = new Set<string>();
  const list = remote.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));

  const rawNumbers = list.map((c) => recognizeChapterNumber(c.name, manga.title, c.number));
  const numbers = backfillNumbers(rawNumbers);

  const readByNumber = new Map<number, ChapterRow>();
  for (const c of existing) if (c.read) readByNumber.set(c.number, c);

  const rows: ChapterRow[] = list.map((c, i) => {
    const prev = byUrl.get(c.url);
    const inheritedRead = !prev ? readByNumber.get(numbers[i]!) : undefined;
    return {
      id: mkChapterId(manga.id, c.url),
      mangaId: manga.id,
      url: c.url,
      name: c.name,
      number: numbers[i]!,
      scanlator: c.scanlator || undefined,
      dateUpload: c.dateUpload || prev?.dateUpload || 0,
      sourceOrder: i,
      read: prev?.read ?? !!inheritedRead,
      bookmark: prev?.bookmark ?? false,
      lastPage: prev?.lastPage ?? 0,
      pageCount: prev?.pageCount ?? 0,
      readAt: prev?.readAt ?? inheritedRead?.readAt ?? 0,
      fetchedAt: prev ? prev.fetchedAt : firstSync ? 0 : t,
      modifiedAt: prev ? (prev.name !== c.name ? t : prev.modifiedAt) : inheritedRead ? t : 0,
    };
  });

  // states that arrived from another device before this list existed
  const pending = await db.pendingStates.get(manga.id);
  if (pending) {
    for (const r of rows) {
      const st = pending.states[hash53(r.url)];
      if (st && st.m > r.modifiedAt) Object.assign(r, { read: !!st.r, bookmark: !!st.b, lastPage: st.p, readAt: st.t, modifiedAt: st.m });
    }
  }

  const keep = new Set(rows.map((r) => r.id));
  const dropped = existing.filter((c) => !keep.has(c.id));
  const downloaded = new Set((await db.downloads.where("mangaId").equals(manga.id).toArray()).filter((d) => d.state === "done").map((d) => d.chapterId));
  const toDelete = dropped.filter((c) => !c.read && !c.bookmark && !downloaded.has(c.id) && c.lastPage === 0).map((c) => c.id);
  const retained = dropped.filter((c) => !toDelete.includes(c.id));

  const added = rows.filter((r) => !byUrl.has(r.url));

  await db.transaction("rw", db.chapters, db.manga, db.pendingStates, async () => {
    if (pending) await db.pendingStates.delete(manga.id);
    if (toDelete.length) await db.chapters.bulkDelete(toDelete);
    await db.chapters.bulkPut([...rows, ...retained]);
    const newest = rows.reduce((m, r) => Math.max(m, r.dateUpload), 0);
    const fresh = await db.manga.get(manga.id);
    if (fresh) {
      await db.manga.put({
        ...fresh,
        lastFetchedAt: t,
        lastUpdateAt: added.length && !firstSync ? Math.max(t, newest) : Math.max(fresh.lastUpdateAt, newest),
      });
    }
  });
  if (manga.inLibrary) emitLocalChange();
  return { added: firstSync ? [] : added, removed: toDelete.length, total: rows.length };
}

export async function setRead(ids: string[], read: boolean) {
  const t = now();
  await db.transaction("rw", db.chapters, async () => {
    for (const id of ids) {
      const c = await db.chapters.get(id);
      if (!c) continue;
      await db.chapters.put({
        ...c,
        read,
        lastPage: read ? c.lastPage : 0,
        readAt: read ? t : 0,
        modifiedAt: t,
      });
    }
  });
  emitLocalChange();
}

/**
 * History is the set of chapters with a read time. Removing an entry clears that time and leaves the
 * chapter's read mark and page alone, so deleting history never un-reads anything.
 */
export async function removeFromHistory(chapterIds: string[]) {
  const t = now();
  await db.transaction("rw", db.chapters, async () => {
    for (const id of chapterIds) {
      const c = await db.chapters.get(id);
      if (c && c.readAt) await db.chapters.put({ ...c, readAt: 0, modifiedAt: t });
    }
  });
  emitLocalChange();
}

/** Clear history read at or after `since`; with no `since`, clear all of it. Returns how many entries went. */
export async function clearHistory(since?: number): Promise<number> {
  const ids = await historyIdsSince(since);
  await removeFromHistory(ids);
  return ids.length;
}

export function historyIdsSince(since = 1): Promise<string[]> {
  return db.chapters.where("readAt").aboveOrEqual(Math.max(since, 1)).primaryKeys() as Promise<string[]>;
}

export async function setBookmark(id: string, bookmark: boolean) {
  const c = await db.chapters.get(id);
  if (!c) return;
  await db.chapters.put({ ...c, bookmark, modifiedAt: now() });
  emitLocalChange();
}

export async function saveProgress(id: string, lastPage: number, pageCount: number, finished: boolean) {
  const c = await db.chapters.get(id);
  if (!c) return;
  const t = now();
  await db.chapters.put({
    ...c,
    lastPage,
    pageCount: pageCount || c.pageCount,
    read: c.read || finished,
    readAt: t,
    modifiedAt: t,
  });
  emitLocalChange();
}

/** Mark every chapter with a lower number as read ("mark previous as read"). */
export async function markPreviousRead(mangaId: string, number: number) {
  const list = await db.chapters.where("mangaId").equals(mangaId).toArray();
  await setRead(
    list.filter((c) => c.number < number && !c.read).map((c) => c.id),
    true,
  );
}

/* ------------------------------- categories ------------------------------- */

export async function createCategory(name: string): Promise<CategoryRow> {
  const all = await db.categories.toArray();
  const row = { id: crypto.randomUUID(), name: name.trim(), order: all.length, modifiedAt: now() };
  await db.categories.put(row);
  emitLocalChange();
  return row;
}

export async function renameCategory(id: string, name: string) {
  const c = await db.categories.get(id);
  if (c) await db.categories.put({ ...c, name: name.trim(), modifiedAt: now() });
  emitLocalChange();
}

export async function deleteCategory(id: string) {
  const c = await db.categories.get(id);
  if (!c) return;
  await db.categories.put({ ...c, deleted: true, modifiedAt: now() });
  const members = await db.manga.filter((m) => m.categoryIds.includes(id)).toArray();
  for (const m of members) await db.manga.put({ ...m, categoryIds: m.categoryIds.filter((x) => x !== id), modifiedAt: now() });
  emitLocalChange();
}

export async function setMangaCategories(mangaId: string, categoryIds: string[]) {
  await patchManga(mangaId, { categoryIds });
}

/** Swap a category with its neighbour. Orders are renumbered so gaps and duplicates cannot build up. */
export async function moveCategory(id: string, delta: -1 | 1) {
  const list = (await db.categories.orderBy("order").toArray()).filter((c) => !c.deleted);
  const from = list.findIndex((c) => c.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;
  [list[from], list[to]] = [list[to]!, list[from]!];
  const t = now();
  await db.categories.bulkPut(list.map((c, order) => (c.order === order ? c : { ...c, order, modifiedAt: t })));
  emitLocalChange();
}

export type CategoryEdit = { add?: string[]; remove?: string[]; set?: string[] };

/** Change the categories of several series at once. `set` replaces the list, `add` and `remove` adjust it. */
export async function editCategoriesOf(mangaIds: string[], edit: CategoryEdit) {
  const t = now();
  await db.transaction("rw", db.manga, async () => {
    for (const id of mangaIds) {
      const m = await db.manga.get(id);
      if (!m) continue;
      const next = new Set(edit.set ?? m.categoryIds);
      for (const c of edit.add ?? []) next.add(c);
      for (const c of edit.remove ?? []) next.delete(c);
      await db.manga.put({ ...m, categoryIds: [...next], modifiedAt: t });
    }
  });
  emitLocalChange();
}

export async function removeFromLibrary(mangaIds: string[]) {
  const t = now();
  await db.transaction("rw", db.manga, async () => {
    for (const id of mangaIds) {
      const m = await db.manga.get(id);
      if (m) await db.manga.put({ ...m, inLibrary: false, modifiedAt: t });
    }
  });
  emitLocalChange();
}

/** Mark every chapter of the given series read or unread. */
export async function setSeriesRead(mangaIds: string[], read: boolean) {
  const ids = (await db.chapters.where("mangaId").anyOf(mangaIds).primaryKeys()) as string[];
  await setRead(ids, read);
}
