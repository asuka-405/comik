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

export function releasePages(chapterId: string) {
  objectUrls.get(chapterId)?.forEach(URL.revokeObjectURL);
  objectUrls.delete(chapterId);
}

/** Resolve a chapter into displayable pages: offline blobs first, otherwise source -> proxy URLs. */
export async function loadPages(manga: MangaRow, chapter: ChapterRow): Promise<ReaderPage[]> {
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

  let urls: string[] | undefined;
  const cached = await db.pageCache.get(chapter.id);
  if (cached && cached.urls.length && Date.now() - cached.fetchedAt < PAGE_TTL) urls = cached.urls;
  if (!urls) {
    const pages = await source.getPageList({ url: chapter.url, name: chapter.name, dateUpload: chapter.dateUpload }, { url: manga.url, title: manga.title });
    urls = pages.sort((a, b) => a.index - b.index).map((p) => p.url);
    if (manga.sourceId !== "local") await db.pageCache.put({ chapterId: chapter.id, urls, fetchedAt: Date.now() });
  }
  if (!urls.length) throw new Error("This chapter has no pages. It may be locked, removed or need a login.");

  const referer = source.imageReferer ?? source.baseUrl;
  return urls.map((u, index) => ({ index, src: imageUrl(u, referer, source.directImages), offline: false }));
}
