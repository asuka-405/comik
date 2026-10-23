import { create } from "zustand";
import { db, type DownloadRow } from "./db";
import { getSettings } from "./settings";
import { loadPages } from "./pages";
import type { ChapterRow, MangaRow } from "./types";

/**
 * Offline chapters. Pages are saved as blobs in IndexedDB; the reader prefers them over the network.
 * A small queue runs `downloadConcurrency` pages at a time, one chapter at a time.
 */

interface Queue {
  active: boolean;
  items: { manga: MangaRow; chapter: ChapterRow }[];
  current?: string;
}
export const useDownloads = create<Queue>(() => ({ active: false, items: [] }));

async function setRow(chapterId: string, patch: Partial<DownloadRow> & Pick<DownloadRow, "mangaId">) {
  const prev = await db.downloads.get(chapterId);
  await db.downloads.put({ chapterId, state: "queued", total: 0, done: 0, updatedAt: Date.now(), ...prev, ...patch });
}

export async function enqueueDownloads(manga: MangaRow, chapters: ChapterRow[]) {
  const existing = new Set((await db.downloads.bulkGet(chapters.map((c) => c.id))).filter((d) => d && (d.state === "done" || d.state === "queued" || d.state === "running")).map((d) => d!.chapterId));
  const fresh = chapters.filter((c) => !existing.has(c.id));
  for (const c of fresh) await setRow(c.id, { mangaId: manga.id, state: "queued", done: 0, total: 0, error: undefined });
  useDownloads.setState((s) => ({ items: [...s.items, ...fresh.map((chapter) => ({ manga, chapter }))] }));
  void pump();
}

async function pump() {
  if (useDownloads.getState().active) return;
  useDownloads.setState({ active: true });
  for (;;) {
    const next = useDownloads.getState().items[0];
    if (!next) break;
    useDownloads.setState({ current: next.chapter.id });
    await downloadOne(next.manga, next.chapter);
    useDownloads.setState((s) => ({ items: s.items.slice(1) }));
  }
  useDownloads.setState({ active: false, current: undefined });
}

async function downloadOne(manga: MangaRow, chapter: ChapterRow) {
  try {
    const pages = (await loadPages(manga, chapter)).filter((p) => !p.offline);
    await setRow(chapter.id, { mangaId: manga.id, state: "running", total: pages.length, done: 0 });
    let done = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pages.length) {
        const p = pages[cursor++]!;
        const res = await fetch(p.src);
        if (!res.ok) throw new Error(`Page ${p.index + 1} failed (${res.status})`);
        await db.pageBlobs.put({ key: `${chapter.id}#${p.index}`, chapterId: chapter.id, index: p.index, blob: await res.blob() });
        await setRow(chapter.id, { mangaId: manga.id, done: ++done });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, getSettings().downloadConcurrency) }, worker));
    await setRow(chapter.id, { mangaId: manga.id, state: "done" });
  } catch (e) {
    await setRow(chapter.id, { mangaId: manga.id, state: "error", error: (e as Error).message });
  }
}

export async function deleteDownloads(chapterIds: string[]) {
  await db.transaction("rw", db.downloads, db.pageBlobs, async () => {
    for (const id of chapterIds) {
      await db.pageBlobs.where("chapterId").equals(id).delete();
      await db.downloads.delete(id);
    }
  });
}

export async function storageUsage(): Promise<{ used: number; quota: number }> {
  const est = await navigator.storage?.estimate?.();
  return { used: est?.usage ?? 0, quota: est?.quota ?? 0 };
}
