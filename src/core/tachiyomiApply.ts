import { db, chapterId as mkChapterId } from "./db";
import { emitLocalChange } from "./bus";
import { recognizeChapterNumber } from "./chapterRecognition";
import { createCategory, upsertManga } from "./repo";
import { pathOf } from "./http";
import type { ImportPlan, ParsedBackup } from "./tachiyomi";
import type { ChapterRow, MangaRow, MangaStatus, ReaderMode, Source } from "./types";

/* ---------------------------------- applying --------------------------------- */

const STATUS: Record<number, MangaStatus> = { 1: "ongoing", 2: "completed", 3: "completed", 4: "completed", 5: "cancelled", 6: "hiatus" };
const VIEWER: Record<number, ReaderMode> = { 1: "paged-ltr", 2: "paged-rtl", 3: "paged-vertical", 4: "webtoon", 5: "webtoon" };

/** Tachiyomi stores paths relative to the site. A few sources store full URLs, so normalise both. */
const relativeUrl = (url: string, source: Source) => {
  // Comik's MangaDex source identifies series and chapters by bare id, Tachiyomi by "/manga/<id>" and "/chapter/<id>".
  if (source.id.startsWith("mangadex-")) return url.replace(/^\/(?:manga|chapter)\//, "");
  return /^https?:\/\//i.test(url) ? pathOf(url, source.baseUrl) : url;
};

export interface ImportResult {
  series: number;
  chapters: number;
  read: number;
  categories: number;
}

export async function applyImport(backup: ParsedBackup, plan: ImportPlan, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const t = Date.now();

  // Categories: reuse one with the same name, create the rest.
  const existing = (await db.categories.toArray()).filter((c) => !c.deleted && (c.kind ?? "comic") === "comic");
  const categoryIds = new Map<string, string>();
  let createdCategories = 0;
  for (const category of [...backup.categories].sort((a, b) => a.order - b.order)) {
    if (!category.name) continue;
    const same = existing.find((c) => c.name.trim().toLowerCase() === category.name.trim().toLowerCase());
    if (same) categoryIds.set(category.id, same.id);
    else {
      const created = await createCategory(category.name, "comic");
      categoryIds.set(category.id, created.id);
      createdCategories++;
    }
  }

  let chapterCount = 0;
  let readCount = 0;
  let done = 0;
  for (const { backup: item, source } of plan.matched) {
    const url = relativeUrl(item.url, source);
    const row = await upsertManga(source.id, {
      url,
      title: item.title,
      cover: item.thumbnailUrl || undefined,
      author: item.author || undefined,
      artist: item.artist || undefined,
      description: item.description || undefined,
      genres: item.genres,
      status: STATUS[item.status] ?? "unknown",
    });
    const mapped = item.categories.map((id) => categoryIds.get(id)).filter((id): id is string => !!id);
    const library: MangaRow = {
      ...row,
      inLibrary: true,
      addedAt: row.addedAt || item.dateAdded || t,
      categoryIds: [...new Set([...row.categoryIds, ...mapped])],
      readerMode: row.readerMode ?? VIEWER[item.viewer],
      modifiedAt: t,
    };

    const previous = new Map((await db.chapters.where("mangaId").equals(row.id).toArray()).map((c) => [c.id, c]));
    const chapters: ChapterRow[] = item.chapters.map((c) => {
      const chapterUrl = relativeUrl(c.url, source);
      const id = mkChapterId(row.id, chapterUrl);
      const old = previous.get(id);
      const readAt = item.history.get(c.url) ?? 0;
      const number = c.chapterNumber >= 0 ? c.chapterNumber : recognizeChapterNumber(c.name, item.title);
      const read = c.read || !!old?.read;
      if (read) readCount++;
      return {
        id,
        mangaId: row.id,
        url: chapterUrl,
        name: c.name,
        number: old?.number ?? number,
        scanlator: c.scanlator || undefined,
        dateUpload: c.dateUpload || old?.dateUpload || 0,
        sourceOrder: c.sourceOrder,
        read,
        bookmark: c.bookmark || !!old?.bookmark,
        lastPage: Math.max(c.lastPageRead, old?.lastPage ?? 0),
        pageCount: old?.pageCount ?? 0,
        readAt: Math.max(readAt, old?.readAt ?? 0),
        // Not "new": these chapters already existed when the backup was made.
        fetchedAt: old?.fetchedAt ?? 0,
        modifiedAt: t,
      };
    });
    await db.transaction("rw", db.manga, db.chapters, async () => {
      await db.manga.put({ ...library, libraryFlag: library.inLibrary ? 1 : 0 });
      await db.chapters.bulkPut(chapters);
    });
    chapterCount += chapters.length;
    onProgress?.(++done, plan.matched.length);
    // Yield now and then so a large library does not freeze the page.
    if (done % 20 === 0) await new Promise((resolve) => setTimeout(resolve));
  }
  emitLocalChange();
  return { series: plan.matched.length, chapters: chapterCount, read: readCount, categories: createdCategories };
}
