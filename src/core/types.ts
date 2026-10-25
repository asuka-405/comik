/** Wire-level shapes a source returns. Mirrors the concepts Mihon sources use (SManga / SChapter / Page). */

export type MangaStatus = "unknown" | "ongoing" | "completed" | "hiatus" | "cancelled";
export type MediaKind = "comic" | "novel" | "anime";
/** A title with no kind is a comic: only novels and anime were added later. */
export const mediaOf = (item: { kind?: MediaKind }): MediaKind => item.kind ?? "comic";

export interface SManga {
  /** Source-relative identity. Stable across sessions (usually a path or id). */
  url: string;
  title: string;
  kind?: MediaKind;
  externalUrl?: string;
  episodeCount?: number;
  externalLinks?: { site: string; url: string }[];
  /** Alternate titles supplied by the source, used for cross-source migration matching. */
  aliases?: string[];
  cover?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  status?: MangaStatus;
}

export interface SChapter {
  url: string;
  name: string;
  /** Epoch ms. 0 when unknown. */
  dateUpload: number;
  scanlator?: string;
  /** Number the source reports, if it has one. Recognition fills the rest. */
  number?: number;
}

export interface SPage {
  index: number;
  /** Direct image URL. */
  url: string;
  /** Per-page extra headers for the image fetch (rare). */
  headers?: Record<string, string>;
}

export interface MangasPage {
  mangas: SManga[];
  hasNext: boolean;
}

/* ---------------------------------- filters --------------------------------- */

export type TriState = 0 | 1 | 2; // 0 ignore, 1 include, 2 exclude

export type Filter =
  | { type: "header"; key: string; name: string }
  | { type: "separator"; key: string }
  | { type: "text"; key: string; name: string; state: string }
  | { type: "checkbox"; key: string; name: string; state: boolean }
  | { type: "tristate"; key: string; name: string; state: TriState }
  | { type: "select"; key: string; name: string; options: string[]; values?: string[]; state: number }
  | { type: "sort"; key: string; name: string; options: string[]; values?: string[]; state: { index: number; ascending: boolean } }
  | { type: "group"; key: string; name: string; filters: Filter[] };

/* ---------------------------------- source ---------------------------------- */

export interface Source {
  id: string;
  name: string;
  lang: string;
  baseUrl: string;
  /** One-line description for the catalogue picker. */
  blurb?: string;
  /** Accent used for the source chip. Any CSS colour. */
  tint?: string;
  supportsLatest: boolean;
  mediaType?: MediaKind;
  /** Referer to send when fetching this source's images. Defaults to baseUrl. */
  imageReferer?: string;
  /** Images load fine straight from the browser (no hotlink protection / CORS needed for canvas). */
  directImages?: boolean;
  isNsfw?: boolean;

  getPopular(page: number): Promise<MangasPage>;
  getLatest(page: number): Promise<MangasPage>;
  search(page: number, query: string, filters: Filter[]): Promise<MangasPage>;
  getFilterList(): Filter[];
  getMangaDetails(manga: SManga): Promise<SManga>;
  getChapterList(manga: SManga): Promise<SChapter[]>;
  getPageList(chapter: SChapter, manga: SManga): Promise<SPage[]>;
  getNovelText?(chapter: SChapter, manga: SManga): Promise<string>;
}

/* ---------------------------------- stored ---------------------------------- */

export interface MangaRow {
  /** `${sourceId}::${url}` */
  id: string;
  sourceId: string;
  url: string;
  title: string;
  kind?: MediaKind;
  externalUrl?: string;
  episodeCount?: number;
  externalLinks?: { site: string; url: string }[];
  aliases?: string[];
  cover?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres: string[];
  status: MangaStatus;
  /** Kept apart from the shelf, history and community suggestions, in the Vault. */
  vault?: boolean;
  inLibrary: boolean;
  categoryIds: string[];
  addedAt: number;
  /** When the chapter list last changed upstream. */
  lastUpdateAt: number;
  /** Last time we synced the chapter list. */
  lastFetchedAt: number;
  accent?: string;
  /** Per-series reader overrides. */
  readerMode?: ReaderMode;
  chapterSort?: "number" | "source" | "date";
  chapterSortAsc?: boolean;
  chapterFilter?: { unread?: boolean; downloaded?: boolean; bookmarked?: boolean };
  /** Bump whenever a synced field changes. */
  modifiedAt: number;
}

export interface ChapterRow {
  /** `${mangaId}||${url}` */
  id: string;
  mangaId: string;
  url: string;
  name: string;
  number: number;
  scanlator?: string;
  dateUpload: number;
  /** Position in the source's list (0 = newest first as reported). */
  sourceOrder: number;
  read: boolean;
  bookmark: boolean;
  lastPage: number;
  pageCount: number;
  readAt: number;
  fetchedAt: number;
  modifiedAt: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  order: number;
  deleted?: boolean;
  modifiedAt: number;
}

export type ReaderMode = "paged-ltr" | "paged-rtl" | "paged-vertical" | "webtoon" | "auto";
