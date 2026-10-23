import { absUrl, fetchDoc, imgSrc, parseDate, pathOf, text } from "../http";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/**
 * A source described entirely by URL templates + CSS selectors, so users can wire up a
 * site themselves without writing code. The "build your own extension" path.
 *
 * Templates accept {page} and {query}. Selector fields take any CSS selector;
 * `attr@selector` syntax is not needed: links read href, images read the best lazy-load attr.
 */
export interface SelectorConfig {
  popularUrl: string;
  latestUrl?: string;
  searchUrl?: string;
  /** Selector for one result card. */
  card: string;
  /** Inside a card. */
  cardLink?: string;
  cardTitle?: string;
  cardImage?: string;
  nextPage?: string;
  /** Detail page. */
  detailTitle?: string;
  detailCover?: string;
  detailDescription?: string;
  detailAuthor?: string;
  detailGenres?: string;
  chapterRow: string;
  chapterLink?: string;
  chapterDate?: string;
  /** Reader page images. */
  pageImage: string;
  /** Pages when page numbers start at 0 or 1 in templates. */
  pageStart?: string;
}

export interface SelectorSourceInit {
  id: string;
  name: string;
  baseUrl: string;
  lang: string;
  config: Record<string, string>;
}

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(vars[k] ?? "")));

export function createSelectorSource(init: SelectorSourceInit): Source {
  const c = init.config as unknown as SelectorConfig;
  const base = init.baseUrl.replace(/\/+$/, "");
  const start = Number(c.pageStart ?? 1);
  const get = (u: string) => fetchDoc(absUrl(u, base + "/"), { referer: base + "/", minGapMs: 500 });

  const cards = (doc: Document): MangasPage => {
    const mangas: SManga[] = [];
    for (const el of doc.querySelectorAll(c.card)) {
      const a = (c.cardLink ? el.querySelector(c.cardLink) : el.matches("a") ? el : el.querySelector("a")) as HTMLAnchorElement | null;
      if (!a) continue;
      const title = text(c.cardTitle ? el.querySelector(c.cardTitle) : a) || a.getAttribute("title") || "";
      if (!title) continue;
      mangas.push({ url: pathOf(absUrl(a.getAttribute("href"), base + "/"), base), title, cover: imgSrc(c.cardImage ? el.querySelector(c.cardImage) : el.querySelector("img"), base) });
    }
    return { mangas, hasNext: c.nextPage ? !!doc.querySelector(c.nextPage) : mangas.length > 0 };
  };

  return {
    id: init.id,
    name: init.name,
    lang: init.lang,
    baseUrl: base,
    blurb: `Custom selector source at ${new URL(base).host}`,
    tint: "#c0c7d1",
    supportsLatest: !!c.latestUrl,
    imageReferer: base + "/",

    async getPopular(page) {
      return cards(await get(fill(c.popularUrl, { page: page - 1 + start })));
    },
    async getLatest(page) {
      return cards(await get(fill(c.latestUrl ?? c.popularUrl, { page: page - 1 + start })));
    },
    async search(page, query) {
      if (!c.searchUrl) return { mangas: [], hasNext: false };
      return cards(await get(fill(c.searchUrl, { page: page - 1 + start, query })));
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      return {
        url: manga.url,
        title: (c.detailTitle ? text(doc.querySelector(c.detailTitle)) : "") || manga.title,
        cover: (c.detailCover ? imgSrc(doc.querySelector(c.detailCover), base) : "") || manga.cover,
        description: c.detailDescription ? text(doc.querySelector(c.detailDescription)) : undefined,
        author: c.detailAuthor ? text(doc.querySelector(c.detailAuthor)) : undefined,
        genres: c.detailGenres ? [...doc.querySelectorAll(c.detailGenres)].map(text) : undefined,
      };
    },

    async getChapterList(manga) {
      const doc = await get(manga.url);
      const out: SChapter[] = [];
      for (const row of doc.querySelectorAll(c.chapterRow)) {
        const a = (c.chapterLink ? row.querySelector(c.chapterLink) : row.matches("a") ? row : row.querySelector("a")) as HTMLAnchorElement | null;
        if (!a) continue;
        out.push({ url: pathOf(absUrl(a.getAttribute("href"), base + "/"), base), name: text(a), dateUpload: parseDate(text(c.chapterDate ? row.querySelector(c.chapterDate) : null)) });
      }
      return out;
    },

    async getPageList(chapter): Promise<SPage[]> {
      const doc = await get(chapter.url);
      return [...doc.querySelectorAll(c.pageImage)].map((i) => imgSrc(i, base)).filter(Boolean).map((url, index) => ({ index, url }));
    },
  };
}
