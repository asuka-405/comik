import { absUrl, fetchDoc, parseDate, pathOf } from "../http";
import { extractChapters, extractPageImages, extractSeries } from "./heuristics";
import type { CatalogEntry } from "./catalogTypes";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/** Source for sites without a dedicated engine. Verified at catalogue build time, see scripts/build-catalog.ts. */
export function createHeuristic(entry: CatalogEntry): Source {
  const base = entry.baseUrl;
  const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(vars[k] ?? "")));
  const get = (u: string) => fetchDoc(absUrl(u, base + "/"), { referer: base + "/", minGapMs: 600 });

  const toPage = (doc: Document, page: number, query = ""): MangasPage => {
    let found = extractSeries(doc, base);
    if (query) found = found.filter((f) => f.title.toLowerCase().includes(query.toLowerCase()));
    return { mangas: found.map((f): SManga => ({ url: f.path, title: f.title, cover: f.cover })), hasNext: !!entry.paged && found.length > 0 && page < 60 };
  };

  const list = async (page: number) => toPage(await get(fill(entry.listUrl ?? `${base}/`, { page })), page);

  return {
    id: entry.id,
    name: entry.name,
    lang: "en",
    baseUrl: base,
    blurb: new URL(base).host,
    tint: "#8fb8ff",
    isNsfw: entry.nsfw,
    supportsLatest: false,
    imageReferer: base + "/",
    getPopular: (page) => list(page),
    getLatest: (page) => list(page),
    async search(page, query) {
      if (!query.trim()) return list(page);
      if (!entry.searchUrl) return toPage(await get(fill(entry.listUrl ?? `${base}/`, { page })), page, query);
      return toPage(await get(fill(entry.searchUrl, { query: query.trim(), page })), page);
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      const meta = (p: string) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute("content") ?? "";
      const h1 = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim();
      return {
        url: manga.url,
        title: h1 || manga.title,
        cover: meta("og:image") || manga.cover,
        description: (meta("og:description") || meta("description")).trim() || undefined,
      };
    },

    async getChapterList(manga) {
      const doc = await get(manga.url);
      return extractChapters(doc, absUrl(manga.url, base + "/")).map((c): SChapter => ({ url: pathOf(c.path, base), name: c.name, dateUpload: parseDate(c.date) }));
    },

    async getPageList(chapter): Promise<SPage[]> {
      const doc = await get(chapter.url);
      return extractPageImages(doc, absUrl(chapter.url, base + "/")).map((url, index) => ({ index, url }));
    },
  };
}
