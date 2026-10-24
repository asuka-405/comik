import { db, type CustomSourceRow } from "../db";
import { createMangaDex } from "./mangadex";
import { createMangaKatana } from "./mangakatana";
import { createHentai2Read } from "./hentai2read";
import { createEHentai } from "./ehentai";
import { createCutieComics } from "./cutiecomics";
import { createWebtoons } from "./webtoons";
import { createMadara } from "./madara";
import { createThemesia } from "./themesia";
import { createSelectorSource } from "./selector";
import { localSource } from "./local";
import { createHeuristic } from "./heuristic";
import { createHeanCms } from "./heancms";
import { createKeyoapp } from "./keyoapp";
import { createGutenbergSource } from "./gutenberg";
import { createRoyalRoadSource } from "./royalRoad";
import { createAniListAnimeSource } from "./anilist";
import { createNovelSites } from "./novelSites";
import catalog from "./catalog.json";
import type { CatalogEntry } from "./catalogTypes";
import type { Source } from "../types";

const WT_LANGS: [string, string][] = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["id", "Indonesian"], ["th", "Thai"]];

/** Sites from the Mihon / Tachiyomi extension index, mapped onto our engines and verified by scripts/build-catalog.ts. */
function fromCatalog(e: CatalogEntry): Source {
  if (e.engine === "madara") return createMadara({ id: e.id, name: e.name, baseUrl: e.baseUrl, lang: "en", mangaSubString: e.path, nsfw: e.nsfw });
  if (e.engine === "themesia") return createThemesia({ id: e.id, name: e.name, baseUrl: e.baseUrl, lang: "en", listPath: e.path, nsfw: e.nsfw });
  if (e.engine === "keyoapp") return createKeyoapp({ id: e.id, name: e.name, baseUrl: e.baseUrl, nsfw: e.nsfw });
  if (e.engine === "heancms") return createHeanCms({ id: e.id, name: e.name, baseUrl: e.baseUrl, apiUrl: e.apiUrl, nsfw: e.nsfw });
  return createHeuristic(e);
}

const builtin: Source[] = [
  createMangaDex("en", "English"),
  createMangaKatana(),
  createHentai2Read(),
  createEHentai(),
  createCutieComics(),
  ...WT_LANGS.map(([l, n]) => createWebtoons(l, n)),
  createWebtoons("en", "English", true),
  createGutenbergSource(),
  createRoyalRoadSource(),
  ...createNovelSites(),
  createAniListAnimeSource(),
  ...(catalog as CatalogEntry[]).map(fromCatalog),
  localSource,
];

let custom = new Map<string, Source>();
const subs = new Set<() => void>();

export function buildCustom(row: CustomSourceRow): Source {
  const init = { id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, config: row.config };
  if (row.kind === "madara") return createMadara({ id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, nsfw: row.config.nsfw === "1" });
  if (row.kind === "themesia") return createThemesia({ id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, listPath: row.config.listPath || undefined, nsfw: row.config.nsfw === "1" });
  return createSelectorSource(init);
}

export async function loadCustomSources() {
  const rows = await db.customSources.toArray();
  custom = new Map(rows.map((r) => [r.id, buildCustom(r)]));
  subs.forEach((f) => f());
}

export async function addCustomSource(row: Omit<CustomSourceRow, "id" | "createdAt">): Promise<Source> {
  const full: CustomSourceRow = { ...row, id: `custom-${row.kind}-${crypto.randomUUID().slice(0, 8)}`, createdAt: Date.now() };
  await db.customSources.put(full);
  await loadCustomSources();
  return custom.get(full.id)!;
}

export async function removeCustomSource(id: string) {
  await db.customSources.delete(id);
  await loadCustomSources();
}

export const onSourcesChange = (fn: () => void) => {
  subs.add(fn);
  return () => { subs.delete(fn); };
};

export const allSources = (): Source[] => [...builtin, ...custom.values()].sort((a, b) => a.name.localeCompare(b.name));
export const isCatalogSource = (id: string) => id.startsWith("mihon-");
export const getSource = (id: string): Source | undefined => allSources().find((s) => s.id === id);
export const isCustom = (id: string) => custom.has(id);
