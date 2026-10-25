import Dexie, { type Table } from "dexie";
import type { Backup } from "./backup";
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
  kind?: "text";
}

/** An anime connector the person installed: code that tells Comik how to read one licensed site. */
export interface ConnectorRow {
  /** The id from the connector's manifest. */
  id: string;
  name: string;
  version: string;
  code: string;
  /** Where the code was downloaded from, so it can be updated. Empty for pasted code. */
  sourceUrl: string;
  /** The validated manifest, kept so the connector can be listed without running its code. */
  manifest: Record<string, unknown>;
  /** Hosts the connector may contact, from its manifest. */
  domains: string[];
  nsfw: boolean;
  enabled: boolean;
  /** Values the person typed for the connector's own settings (API keys, region ...). */
  settings: Record<string, string>;
  /** When the person confirmed they have permission from the site's operator. */
  attestedAt: number;
  installedAt: number;
  updatedAt: number;
}

export interface AccountArchiveRow {
  id: string;
  createdAt: number;
  previousUid: string | null;
  backup: Backup;
  downloads: DownloadRow[];
  pageCache: PageCacheRow[];
  pageBlobs: PageBlobRow[];
  localFiles: LocalMangaFile[];
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
  accountArchives!: Table<AccountArchiveRow, string>;
  connectors!: Table<ConnectorRow, string>;

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
    this.version(2).stores({ accountArchives: "id, createdAt" });
    this.version(3).stores({ connectors: "id" });
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
