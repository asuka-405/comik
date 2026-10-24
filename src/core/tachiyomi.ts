import { gunzipSync } from "fflate";
import type { Source } from "./types";

/**
 * Import of Tachiyomi and Mihon backups (`.tachibk`, or the older `.proto.gz`).
 *
 * A backup is a gzip-compressed Protocol Buffers message. This file reads the handful of fields
 * Comik can use with a small hand-written decoder, so no protobuf library is needed. Field numbers
 * follow the public `Backup`, `BackupManga`, `BackupChapter`, `BackupCategory`, `BackupSource` and
 * `BackupHistory` messages. Unknown fields are skipped, so newer backups still open.
 */

/* ------------------------------- wire reader ------------------------------- */

class Reader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array, private readonly end = bytes.length) {}

  get done() {
    return this.pos >= this.end;
  }

  private byte(): number {
    if (this.pos >= this.end) throw new Error("This backup file is damaged or cut short.");
    return this.bytes[this.pos++]!;
  }

  /** Unsigned varint as a number. Exact below 2^53, which covers every field except source ids. */
  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      result += (b & 0x7f) * scale;
      if (!(b & 0x80)) return result;
      scale *= 128;
    }
    throw new Error("This backup file is damaged.");
  }

  /** Source ids are signed 64-bit values, so they need BigInt. */
  varintBig(): bigint {
    let result = 0n;
    for (let shift = 0n, i = 0; i < 10; i++, shift += 7n) {
      const b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return BigInt.asIntN(64, result);
    }
    throw new Error("This backup file is damaged.");
  }

  float(): number {
    if (this.pos + 4 > this.end) throw new Error("This backup file is damaged or cut short.");
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4).getFloat32(0, true);
    this.pos += 4;
    return value;
  }

  /** Length-delimited payload, as a view onto the same buffer. */
  bytesField(): Uint8Array {
    const length = this.varint();
    if (this.pos + length > this.end) throw new Error("This backup file is damaged or cut short.");
    const view = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return view;
  }

  string(): string {
    return new TextDecoder().decode(this.bytesField());
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.bytesField();
    else if (wire === 5) this.pos += 4;
    else throw new Error("This backup file is damaged.");
  }
}

/** Calls `handle` for each field. It returns true once it has consumed the value, otherwise the field is skipped. */
function readMessage(bytes: Uint8Array, handle: (field: number, wire: number, reader: Reader) => boolean) {
  const reader = new Reader(bytes);
  while (!reader.done) {
    const tag = reader.varint();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (!handle(field, wire, reader)) reader.skip(wire);
  }
}

/* --------------------------------- messages -------------------------------- */

export interface BackupChapterData {
  url: string;
  name: string;
  scanlator: string;
  read: boolean;
  bookmark: boolean;
  lastPageRead: number;
  dateUpload: number;
  chapterNumber: number;
  sourceOrder: number;
}

export interface BackupMangaData {
  /** Tachiyomi source id as a decimal string. */
  source: string;
  url: string;
  title: string;
  artist: string;
  author: string;
  description: string;
  genres: string[];
  status: number;
  thumbnailUrl: string;
  dateAdded: number;
  favorite: boolean;
  /** Backup category ids this series belongs to. */
  categories: string[];
  chapters: BackupChapterData[];
  /** Chapter url to the time it was last read. */
  history: Map<string, number>;
  /** Reading mode flags, 0 for the app default. */
  viewer: number;
}

export interface ParsedBackup {
  manga: BackupMangaData[];
  categories: { id: string; name: string; order: number }[];
  /** Source id to the name the backup recorded for it. */
  sourceNames: Map<string, string>;
}

function parseChapter(bytes: Uint8Array): BackupChapterData {
  const chapter: BackupChapterData = { url: "", name: "", scanlator: "", read: false, bookmark: false, lastPageRead: 0, dateUpload: 0, chapterNumber: -1, sourceOrder: 0 };
  readMessage(bytes, (field, wire, r) => {
    if (field === 1 && wire === 2) chapter.url = r.string();
    else if (field === 2 && wire === 2) chapter.name = r.string();
    else if (field === 3 && wire === 2) chapter.scanlator = r.string();
    else if (field === 4 && wire === 0) chapter.read = r.varint() !== 0;
    else if (field === 5 && wire === 0) chapter.bookmark = r.varint() !== 0;
    else if (field === 6 && wire === 0) chapter.lastPageRead = r.varint();
    else if (field === 8 && wire === 0) chapter.dateUpload = r.varint();
    else if (field === 9 && wire === 5) chapter.chapterNumber = r.float();
    else if (field === 10 && wire === 0) chapter.sourceOrder = r.varint();
    else return false;
    return true;
  });
  return chapter;
}

function parseManga(bytes: Uint8Array): BackupMangaData {
  const manga: BackupMangaData = {
    source: "0", url: "", title: "", artist: "", author: "", description: "", genres: [], status: 0, thumbnailUrl: "",
    dateAdded: 0, favorite: true, categories: [], chapters: [], history: new Map(), viewer: 0,
  };
  let legacyViewer = 0;
  let viewerFlags = 0;
  readMessage(bytes, (field, wire, r) => {
    if (field === 1 && wire === 0) manga.source = r.varintBig().toString();
    else if (field === 2 && wire === 2) manga.url = r.string();
    else if (field === 3 && wire === 2) manga.title = r.string();
    else if (field === 4 && wire === 2) manga.artist = r.string();
    else if (field === 5 && wire === 2) manga.author = r.string();
    else if (field === 6 && wire === 2) manga.description = r.string();
    else if (field === 7 && wire === 2) manga.genres.push(r.string());
    else if (field === 8 && wire === 0) manga.status = r.varint();
    else if (field === 9 && wire === 2) manga.thumbnailUrl = r.string();
    else if (field === 13 && wire === 0) manga.dateAdded = r.varint();
    else if (field === 14 && wire === 0) legacyViewer = r.varint();
    else if (field === 16 && wire === 2) manga.chapters.push(parseChapter(r.bytesField()));
    // Category ids are packed in current backups and repeated in old ones.
    else if (field === 17 && wire === 2) {
      const packed = new Reader(r.bytesField());
      while (!packed.done) manga.categories.push(String(packed.varint()));
    } else if (field === 17 && wire === 0) manga.categories.push(String(r.varint()));
    else if (field === 100 && wire === 0) manga.favorite = r.varint() !== 0;
    else if (field === 103 && wire === 0) viewerFlags = r.varint();
    else if (field === 104 && wire === 2) {
      let url = "";
      let lastRead = 0;
      readMessage(r.bytesField(), (f, w, hr) => {
        if (f === 1 && w === 2) url = hr.string();
        else if (f === 2 && w === 0) lastRead = hr.varint();
        else return false;
        return true;
      });
      if (url) manga.history.set(url, Math.max(lastRead, manga.history.get(url) ?? 0));
    } else return false;
    return true;
  });
  manga.viewer = (viewerFlags & 7) || legacyViewer;
  return manga;
}

/** Decode a backup file. Accepts the gzip-wrapped form and a bare protobuf. */
export function parseTachiyomiBackup(file: Uint8Array): ParsedBackup {
  const bytes = file[0] === 0x1f && file[1] === 0x8b ? gunzipSync(file) : file;
  const parsed: ParsedBackup = { manga: [], categories: [], sourceNames: new Map() };
  readMessage(bytes, (field, wire, r) => {
    if (field === 1 && wire === 2) parsed.manga.push(parseManga(r.bytesField()));
    else if (field === 2 && wire === 2) {
      const category = { id: "", name: "", order: 0 };
      readMessage(r.bytesField(), (f, w, cr) => {
        if (f === 1 && w === 2) category.name = cr.string();
        else if (f === 2 && w === 0) category.order = cr.varint();
        else if (f === 3 && w === 0) category.id = String(cr.varint());
        else return false;
        return true;
      });
      parsed.categories.push(category);
    } else if (field === 101 && wire === 2) {
      let name = "";
      let id = "";
      readMessage(r.bytesField(), (f, w, sr) => {
        if (f === 1 && w === 2) name = sr.string();
        else if (f === 2 && w === 0) id = sr.varintBig().toString();
        else return false;
        return true;
      });
      if (id) parsed.sourceNames.set(id, name);
    } else return false;
    return true;
  });
  // A real backup has at least one series or category. Anything else is another kind of file.
  if (!parsed.manga.length && !parsed.categories.length) throw new Error("This does not look like a Tachiyomi or Mihon backup.");
  return parsed;
}

/* ---------------------------------- planning --------------------------------- */

export interface PlannedSeries {
  backup: BackupMangaData;
  source: Source;
}

export interface ImportPlan {
  matched: PlannedSeries[];
  /** Sources Comik does not have, with how many series each would have brought. */
  unmatched: { name: string; count: number }[];
  /** Series in the file that were not on the library (browsing leftovers). */
  notInLibrary: number;
  chapters: number;
}

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Pair each backup source with one of ours. Catalogue sources carry their Tachiyomi id (`mihon-<id>`),
 * so most match exactly. Otherwise fall back to the name, plus the official Webtoons site.
 */
export function resolveSource(sourceId: string, recordedName: string | undefined, sources: Source[]): Source | undefined {
  const byId = sources.find((s) => s.id === `mihon-${sourceId}`);
  if (byId) return byId;
  const wanted = normalizeName(recordedName ?? "");
  if (!wanted) return undefined;
  if (/^webtoons?(com)?$/.test(wanted)) return sources.find((s) => s.id === "webtoons-en");
  return sources.find((s) => normalizeName(s.name) === wanted);
}

export function planImport(backup: ParsedBackup, sources: Source[]): ImportPlan {
  const matched: PlannedSeries[] = [];
  const missing = new Map<string, number>();
  let notInLibrary = 0;
  let chapters = 0;
  for (const manga of backup.manga) {
    if (!manga.favorite) {
      notInLibrary++;
      continue;
    }
    const source = resolveSource(manga.source, backup.sourceNames.get(manga.source), sources);
    if (!source || !manga.url || !manga.title) {
      const name = backup.sourceNames.get(manga.source) || `Source ${manga.source}`;
      missing.set(name, (missing.get(name) ?? 0) + 1);
      continue;
    }
    matched.push({ backup: manga, source });
    chapters += manga.chapters.length;
  }
  const unmatched = [...missing].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { matched, unmatched, notInLibrary, chapters };
}
