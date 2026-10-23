import { db } from "./db";
import { useSettings } from "./settings";
import { loadCustomSources } from "./sources/registry";
import { emitLocalChange } from "./bus";
import type { CategoryRow, ChapterRow, MangaRow } from "./types";
import type { CustomSourceRow } from "./db";

/** Portable JSON backup of everything that matters (no page blobs, they are re-downloadable). */
export interface Backup {
  app: "comik";
  version: 1;
  createdAt: number;
  manga: MangaRow[];
  chapters: ChapterRow[];
  categories: CategoryRow[];
  customSources: CustomSourceRow[];
  settings: Record<string, unknown>;
}

export async function createBackup(): Promise<Backup> {
  const manga = await db.manga.filter((m) => m.inLibrary || m.modifiedAt > 0).toArray();
  const ids = new Set(manga.map((m) => m.id));
  const chapters = (await db.chapters.toArray()).filter((c) => ids.has(c.mangaId) && (c.read || c.bookmark || c.lastPage > 0 || true));
  const { set: _set, ...settings } = useSettings.getState();
  return { app: "comik", version: 1, createdAt: Date.now(), manga, chapters, categories: await db.categories.toArray(), customSources: await db.customSources.toArray(), settings };
}

export function downloadBackup(b: Backup) {
  const blob = new Blob([JSON.stringify(b)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `comik-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function restoreBackup(file: File): Promise<{ manga: number; chapters: number }> {
  const data = JSON.parse(await file.text()) as Backup;
  if (data.app !== "comik" || !Array.isArray(data.manga)) throw new Error("Not a Comik backup file");
  const localManga = new Map((await db.manga.toArray()).map((m) => [m.id, m]));
  const localCh = new Map((await db.chapters.toArray()).map((c) => [c.id, c]));
  await db.transaction("rw", db.manga, db.chapters, db.categories, db.customSources, async () => {
    await db.manga.bulkPut(data.manga.filter((m) => !localManga.has(m.id) || m.modifiedAt >= localManga.get(m.id)!.modifiedAt));
    await db.chapters.bulkPut(data.chapters.filter((c) => !localCh.has(c.id) || c.modifiedAt >= localCh.get(c.id)!.modifiedAt));
    await db.categories.bulkPut(data.categories ?? []);
    await db.customSources.bulkPut(data.customSources ?? []);
  });
  if (data.settings) useSettings.setState(data.settings as never);
  await loadCustomSources();
  emitLocalChange();
  return { manga: data.manga.length, chapters: data.chapters.length };
}
