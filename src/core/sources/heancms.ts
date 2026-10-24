import { fetchJson } from "../http";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/**
 * HeanCMS is a hosted comic CMS: the site is a JavaScript app over a JSON API on the `api.` host.
 * Series come from `/query`, a series from `/series/<slug>`, its chapters from `/chapter/query`
 * and the page images from `/chapter/<series>/<chapter>`. No HTML is parsed.
 */
export interface HeanConfig {
  id: string;
  name: string;
  baseUrl: string;
  /** Defaults to the site's address with an `api.` host. */
  apiUrl?: string;
  nsfw?: boolean;
}

interface QueryItem { id: number; title: string; series_slug: string; thumbnail?: string }
interface QueryResult { data: QueryItem[]; meta?: { current_page: number; last_page: number } }
interface SeriesResult extends QueryItem { description?: string; author?: string; studio?: string; status?: string; tags?: { name: string }[]; alternative_names?: string }
interface ChapterItem { chapter_name: string; chapter_slug: string; price?: number; created_at?: string }
interface ChapterQuery { data: ChapterItem[]; meta?: { current_page: number; last_page: number } }
interface ChapterResult { chapter?: { chapter_data?: { images?: string[] } } }

const STATUS: Record<string, MangaStatus> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", dropped: "cancelled" };

/** The description is an HTML fragment; keep the readable text. */
function plainText(html: string | undefined): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function createHeanCms(cfg: HeanConfig): Source {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const api = (cfg.apiUrl ?? base.replace("://", "://api.")).replace(/\/+$/, "");
  const get = <T>(path: string) => fetchJson<T>(`${api}${path}`, { referer: base + "/", minGapMs: 400 });

  // The series id is needed for the chapter list and cannot be recovered from the slug, so keep both in the url.
  const urlOf = (item: QueryItem) => `/series/${item.series_slug}#${item.id}`;
  const slugOf = (url: string) => url.replace(/#.*$/, "").split("/").filter(Boolean).pop() ?? "";
  const idOf = (url: string) => url.split("#")[1] ?? "";

  const list = async (page: number, query: string, orderBy: string): Promise<MangasPage> => {
    const qs = new URLSearchParams({ query_string: query, status: "All", order: "desc", orderBy, series_type: "Comic", page: String(page), perPage: "24", tags_ids: "[]", adult: "true" });
    const result = await get<QueryResult>(`/query?${qs}`);
    const mangas: SManga[] = result.data.map((item) => ({ url: urlOf(item), title: item.title, cover: item.thumbnail }));
    return { mangas, hasNext: !!result.meta && result.meta.current_page < result.meta.last_page };
  };

  return {
    id: cfg.id,
    name: cfg.name,
    lang: "en",
    baseUrl: base,
    blurb: `HeanCMS site at ${new URL(base).host}`,
    tint: "#c084fc",
    isNsfw: cfg.nsfw,
    supportsLatest: true,
    imageReferer: base + "/",

    getPopular: (page) => list(page, "", "total_views"),
    getLatest: (page) => list(page, "", "latest"),
    search: (page, query) => list(page, query.trim(), "total_views"),
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const series = await get<SeriesResult>(`/series/${slugOf(manga.url)}`);
      return {
        ...manga,
        title: series.title || manga.title,
        cover: series.thumbnail || manga.cover,
        author: series.author || series.studio || undefined,
        aliases: (series.alternative_names ?? "").split(/[,;|\n]/).map((name) => name.trim()).filter(Boolean),
        description: [plainText(series.description), series.alternative_names ? `Alternative titles: ${series.alternative_names}` : ""].filter(Boolean).join("\n\n") || undefined,
        genres: (series.tags ?? []).map((t) => t.name),
        status: STATUS[(series.status ?? "").toLowerCase()] ?? "unknown",
        // A listing entry carries the id; a bare slug does not, so refresh it here.
        url: `/series/${series.series_slug}#${series.id}`,
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const seriesId = idOf(manga.url);
      const slug = slugOf(manga.url);
      if (!seriesId) throw new Error("This series needs to be opened from the catalogue first.");
      const out: SChapter[] = [];
      for (let page = 1; page < 50; page++) {
        const result = await get<ChapterQuery>(`/chapter/query?page=${page}&perPage=500&series_id=${seriesId}`);
        for (const c of result.data) {
          // Paid chapters have no images to fetch, so leave them out rather than list unreadable entries.
          if (c.price) continue;
          out.push({ url: `/series/${slug}/${c.chapter_slug}`, name: c.chapter_name, dateUpload: c.created_at ? Date.parse(c.created_at) || 0 : 0 });
        }
        if (!result.meta || result.meta.current_page >= result.meta.last_page) break;
      }
      return out;
    },

    async getPageList(chapter): Promise<SPage[]> {
      const [, , series, slug] = chapter.url.split("/");
      const result = await get<ChapterResult>(`/chapter/${series}/${slug}`);
      const images = result.chapter?.chapter_data?.images ?? [];
      if (!images.length) throw new Error("This chapter has no free pages.");
      return images.map((url, index): SPage => ({ index, url: /^https?:\/\//.test(url) ? url : `${api}/${url.replace(/^\//, "")}` }));
    },
  };
}
