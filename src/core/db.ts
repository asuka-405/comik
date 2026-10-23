import Dexie, { type Table } from "dexie";
import type { CategoryRow, ChapterRow, MangaRow } from "./types";

export interface PageCacheRow {
  chapterId: string;
  urls: string[];
  fetchedAt: number;
}

export interface PageBlobRow {
  key: string; // `${chapterId}#${index}`
  chapterId: string;
  index: number;
  blob: Blob;
}

export interface DownloadRow {
  chapterId: string;
  mangaId: string;
  state: "queued" | "running" | "done" | "error";
  total: number;
  done: number;
  error?: string;
  updatedAt: number;
}

export interface CustomSourceRow {
  id: string;
  kind: "madara" | "themesia" | "selector";
  name: string;
  baseUrl: string;
  lang: string;
  /** Free-form template config (selector overrides). */
  config: Record<string, string>;
  createdAt: number;
}

export interface LocalMangaFile {
  /** `${chapterId}` of an imported archive */
  chapterId: string;
  blob: Blob;
}

class ComikDB extends Dexie {
  manga!: Table<MangaRow, string>;
  chapters!: Table<ChapterRow, string>;
  categories!: Table<CategoryRow, string>;
  pageCache!: Table<PageCacheRow, string>;
  pageBlobs!: Table<PageBlobRow, string>;
  downloads!: Table<DownloadRow, string>;
  customSources!: Table<CustomSourceRow, string>;
  localFiles!: Table<LocalMangaFile, string>;
  pendingStates!: Table<PendingStates, string>;

  constructor() {
    super("comik");
    this.version(1).stores({
      manga: "id, sourceId, lastUpdateAt, modifiedAt, title",
      chapters: "id, mangaId, readAt, fetchedAt, modifiedAt",
      categories: "id, order",
      pageCache: "chapterId",
      pageBlobs: "key, chapterId",
      downloads: "chapterId, mangaId, state",
      customSources: "id",
      localFiles: "chapterId",
      pendingStates: "mangaId",
    });
  }
}

export const db = new ComikDB();

export const mangaId = (sourceId: string, url: string) => `${sourceId}::${url}`;
export const chapterId = (mId: string, url: string) => `${mId}||${url}`;

/** Per-chapter read state received from sync before the chapter list exists locally. */
export interface ChapterState {
  r: 0 | 1;
  b: 0 | 1;
  p: number;
  t: number;
  m: number;
}
export interface PendingStates {
  mangaId: string;
  states: Record<string, ChapterState>;
}
