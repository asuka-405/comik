import { absUrl, fetchDoc, fetchText, imgSrc, parseDate, pathOf, text } from "../http";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const BASE = "https://mangakatana.com";

const STATUS: Record<string, MangaStatus> = { ongoing: "ongoing", completed: "completed", cancelled: "cancelled" };

/** MangaKatana has its own markup (not Madara or MangaThemesia), so it gets a small dedicated source. */
export function createMangaKatana(): Source {
  const get = (url: string) => fetchDoc(url, { referer: BASE + "/", minGapMs: 500 });

  const parseList = (doc: Document): MangasPage => {
    const mangas: SManga[] = [...doc.querySelectorAll("#book_list .item")].flatMap((item): SManga[] => {
      const link = item.querySelector("h3.title a");
      const href = link?.getAttribute("href");
      if (!link || !href) return [];
      return [{ url: pathOf(href, BASE), title: text(link), cover: imgSrc(item.querySelector(".wrap_img img"), BASE) }];
    });
    return { mangas, hasNext: !!doc.querySelector("a.next.page-numbers") };
  };

  return {
    id: "mangakatana-en",
    name: "MangaKatana",
    lang: "en",
    baseUrl: BASE,
    blurb: "Manga, manhwa and manhua with fast pages",
    tint: "#e5484d",
    supportsLatest: true,
    imageReferer: BASE + "/",

    async getPopular(page) {
      return parseList(await get(`${BASE}/manga/page/${page}?filter=1&order=popular`).catch(() => get(`${BASE}/manga/page/${page}`)));
    },
    async getLatest(page) {
      return parseList(await get(`${BASE}/latest/page/${page}`));
    },
    async search(page, query) {
      if (!query.trim()) return this.getPopular(page);
      const qs = new URLSearchParams({ search: query.trim(), search_by: "book_name" });
      return parseList(await get(`${BASE}/page/${page}?${qs}`));
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(absUrl(manga.url, BASE));
      const statusText = text(doc.querySelector(".d-cell-small.value.status, .status")).toLowerCase();
      return {
        ...manga,
        title: text(doc.querySelector("h1.heading")) || manga.title,
        cover: imgSrc(doc.querySelector(".cover img"), BASE) || manga.cover,
        author: text(doc.querySelector(".author")) || undefined,
        description: text(doc.querySelector(".summary p")) || undefined,
        genres: [...doc.querySelectorAll(".genres a")].map(text).filter(Boolean).slice(0, 12),
        status: STATUS[statusText] ?? "unknown",
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(absUrl(manga.url, BASE));
      return [...doc.querySelectorAll(".chapters tr")].flatMap((row): SChapter[] => {
        const link = row.querySelector(".chapter a");
        const href = link?.getAttribute("href");
        if (!link || !href) return [];
        return [{ url: pathOf(href, BASE), name: text(link), dateUpload: parseDate(text(row.querySelector(".update_time"))) }];
      });
    },

    async getPageList(chapter): Promise<SPage[]> {
      // The reader keeps its image addresses in a script variable, not in the markup.
      const html = await fetchText(absUrl(chapter.url, BASE), { referer: BASE + "/", minGapMs: 500 });
      const list = /var\s+thzq\s*=\s*\[([^\]]*)\]/.exec(html)?.[1] ?? "";
      return [...list.matchAll(/'([^']+)'/g)].map((m, index): SPage => ({ index, url: m[1]! }));
    },
  };
}
