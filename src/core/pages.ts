import { db } from "./db";
import { getSource } from "./sources/registry";
import { imageUrl } from "./http";
import type { ChapterRow, MangaRow } from "./types";

const PAGE_TTL = 20 * 60_000;

export interface ReaderPage {
  index: number;
  /** URL ready to put in an <img>. */
  src: string;
  /** Page came from offline storage. */
  offline: boolean;
}

const objectUrls = new Map<string, string[]>();
const pendingPages = new Map<string, Promise<ReaderPage[]>>();
const refreshingPages = new Set<string>();

export function releasePages(chapterId: string) {
  objectUrls.get(chapterId)?.forEach(URL.revokeObjectURL);
  objectUrls.delete(chapterId);
}

/** Resolve a chapter into displayable pages: offline blobs first, otherwise source -> proxy URLs. */
export function loadPages(manga: MangaRow, chapter: ChapterRow): Promise<ReaderPage[]> {
  const pending = pendingPages.get(chapter.id);
  if (pending) return pending;
  const request = loadPagesOnce(manga, chapter).finally(() => pendingPages.delete(chapter.id));
  pendingPages.set(chapter.id, request);
  return request;
}

async function loadPagesOnce(manga: MangaRow, chapter: ChapterRow): Promise<ReaderPage[]> {
  const dl = await db.downloads.get(chapter.id);
  if (dl?.state === "done") {
    const blobs = await db.pageBlobs.where("chapterId").equals(chapter.id).sortBy("index");
    if (blobs.length) {
      const urls = blobs.map((b) => URL.createObjectURL(b.blob));
      objectUrls.set(chapter.id, urls);
      return urls.map((src, index) => ({ index, src, offline: true }));
    }
  }

  const source = getSource(manga.sourceId);
  if (!source) throw new Error("This source is no longer installed");
  const referer = source.imageReferer ?? source.baseUrl;

  const cached = await db.pageCache.get(chapter.id);
  if (cached?.urls.length) {
    if (Date.now() - cached.fetchedAt >= PAGE_TTL && !refreshingPages.has(chapter.id) && manga.sourceId !== "local") {
      refreshingPages.add(chapter.id);
      void source.getPageList({ url: chapter.url, name: chapter.name, dateUpload: chapter.dateUpload }, { url: manga.url, title: manga.title })
        .then((pages) => db.pageCache.put({ chapterId: chapter.id, urls: pages.sort((a, b) => a.index - b.index).map((page) => page.url), fetchedAt: Date.now() }))
        .catch(() => {})
        .finally(() => refreshingPages.delete(chapter.id));
    }
    return cached.urls.map((url, index) => ({ index, src: imageUrl(url, referer, source.directImages), offline: false }));
  }

  const pages = await source.getPageList({ url: chapter.url, name: chapter.name, dateUpload: chapter.dateUpload }, { url: manga.url, title: manga.title });
  const urls = pages.sort((a, b) => a.index - b.index).map((page) => page.url);
  if (manga.sourceId !== "local") await db.pageCache.put({ chapterId: chapter.id, urls, fetchedAt: Date.now() });
  if (!urls.length) throw new Error("This chapter has no pages. It may be locked, removed or need a login.");

  return urls.map((u, index) => ({ index, src: imageUrl(u, referer, source.directImages), offline: false }));
}
