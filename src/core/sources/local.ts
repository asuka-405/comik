import { unzipSync } from "fflate";
import { db, chapterId, mangaId } from "../db";
import { upsertManga, syncChapters, setInLibrary } from "../repo";
import type { SChapter, SManga, SPage, Source } from "../types";

export const LOCAL_ID = "local";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp" };

/** Natural sort so page2 < page10. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function extractImages(zip: Uint8Array): { name: string; blob: Blob }[] {
  const files = unzipSync(zip, { filter: (f) => IMAGE_EXT.test(f.name) && !f.name.includes("__MACOSX") });
  return Object.entries(files)
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([name, data]) => {
      const ext = name.split(".").pop()!.toLowerCase();
      return { name, blob: new Blob([data as BlobPart], { type: MIME[ext] ?? "image/jpeg" }) };
    });
}

/**
 * Import .cbz/.zip archives (one chapter each) or loose images (one chapter) under a series title.
 * Everything is stored in IndexedDB, nothing leaves the browser.
 */
export async function importLocal(files: File[], seriesTitle: string): Promise<string> {
  const title = seriesTitle.trim() || files[0]?.name.replace(/\.[^.]+$/, "") || "Local series";
  const url = `/${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`;
  const manga = await upsertManga(LOCAL_ID, { url, title, status: "unknown" });
  const archives = files.filter((f) => /\.(cbz|zip)$/i.test(f.name));
  const images = files.filter((f) => IMAGE_EXT.test(f.name));

  const existing = await db.chapters.where("mangaId").equals(manga.id).toArray();
  const chapters: SChapter[] = existing.sort((a, b) => a.sourceOrder - b.sourceOrder).map((c) => ({ url: c.url, name: c.name, dateUpload: c.dateUpload }));
  const stamp = Date.now();

  for (const f of archives.sort((a, b) => collator.compare(a.name, b.name))) {
    const chUrl = `/${f.name}`;
    await db.localFiles.put({ chapterId: chapterId(manga.id, chUrl), blob: f });
    if (!chapters.some((c) => c.url === chUrl)) chapters.unshift({ url: chUrl, name: f.name.replace(/\.[^.]+$/, ""), dateUpload: stamp });
  }
  if (images.length) {
    const chUrl = `/images-${stamp}`;
    // keep loose images together as one zip-less chapter
    const sorted = images.sort((a, b) => collator.compare(a.name, b.name));
    await db.localFiles.put({ chapterId: chapterId(manga.id, chUrl), blob: new Blob(sorted, { type: "application/x-comik-images" }) });
    await db.pageCache.put({ chapterId: chapterId(manga.id, chUrl), urls: [], fetchedAt: 0 });
    for (let i = 0; i < sorted.length; i++) await db.pageBlobs.put({ key: `${chapterId(manga.id, chUrl)}#${i}`, chapterId: chapterId(manga.id, chUrl), index: i, blob: sorted[i]! });
    chapters.unshift({ url: chUrl, name: title, dateUpload: stamp });
  }
  await syncChapters(manga, chapters);
  await setInLibrary(manga.id, true);
  return manga.id;
}

export const localSource: Source = {
  id: LOCAL_ID,
  name: "On this device",
  lang: "all",
  baseUrl: "local://",
  blurb: "CBZ and image files you imported",
  tint: "#9aa3b2",
  supportsLatest: false,
  directImages: true,

  async getPopular() {
    const rows = await db.manga.where("sourceId").equals(LOCAL_ID).toArray();
    return { mangas: rows.map((m): SManga => ({ url: m.url, title: m.title, cover: m.cover, kind: m.kind })), hasNext: false };
  },
  getLatest: async () => ({ mangas: [], hasNext: false }),
  async search(_p, query) {
    const rows = await db.manga.where("sourceId").equals(LOCAL_ID).toArray();
    const q = query.toLowerCase();
    return { mangas: rows.filter((m) => m.title.toLowerCase().includes(q)).map((m) => ({ url: m.url, title: m.title, cover: m.cover, kind: m.kind })), hasNext: false };
  },
  getFilterList: () => [],
  async getMangaDetails(m) {
    return m;
  },
  async getChapterList(m) {
    const rows = await db.chapters.where("mangaId").equals(mangaId(LOCAL_ID, m.url)).toArray();
    return rows.sort((a, b) => a.sourceOrder - b.sourceOrder).map((c) => ({ url: c.url, name: c.name, dateUpload: c.dateUpload }));
  },
  async getPageList(chapter, manga): Promise<SPage[]> {
    const cid = chapterId(mangaId(LOCAL_ID, manga.url), chapter.url);
    const blobs = await db.pageBlobs.where("chapterId").equals(cid).sortBy("index");
    if (blobs.length) return blobs.map((b, index) => ({ index, url: URL.createObjectURL(b.blob) }));
    const file = await db.localFiles.get(cid);
    if (!file) throw new Error("Archive is missing from this device");
    const imgs = extractImages(new Uint8Array(await file.blob.arrayBuffer()));
    return imgs.map((im, index) => ({ index, url: URL.createObjectURL(im.blob) }));
  },
};
