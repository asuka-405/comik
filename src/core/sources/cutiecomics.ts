import { absUrl, fetchDoc, imgSrc, pathOf, text } from "../http";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const BASE = "https://cutiecomics.com";
const PER_PAGE = 20;

/**
 * Cutie Comics runs on a news-style CMS: each comic is one post, the page lists its images as
 * thumbnails in /uploads/posts/<month>/thumbs/, and the full-size file sits one folder up.
 * A post is one volume, so it becomes one chapter.
 */
export function createCutieComics(): Source {
  const get = (path: string) => fetchDoc(absUrl(path, BASE), { referer: BASE + "/", minGapMs: 400 });

  const parseList = (doc: Document): MangasPage => {
    const mangas = [...doc.querySelectorAll("div.w25")].flatMap((card): SManga[] => {
      const link = card.querySelector("strong a[href], a[href]");
      const href = link?.getAttribute("href");
      const title = text(card.querySelector("strong a")) || link?.getAttribute("title") || "";
      return href && title ? [{ url: pathOf(absUrl(href, BASE), BASE), title, cover: imgSrc(card.querySelector("img"), BASE) }] : [];
    });
    return { mangas, hasNext: mangas.length >= PER_PAGE };
  };

  return {
    id: "cutiecomics-en",
    name: "Cutie Comics",
    lang: "en",
    baseUrl: BASE,
    blurb: "Hentai manga and doujinshi",
    tint: "#f9a8d4",
    isNsfw: true,
    supportsLatest: true,
    imageReferer: BASE + "/",

    async getPopular(page) {
      return parseList(await get(page > 1 ? `/page/${page}/` : "/"));
    },
    getLatest(page) {
      return this.getPopular(page);
    },
    async search(page, query) {
      if (!query.trim()) return this.getPopular(page);
      const qs = new URLSearchParams({ do: "search", subaction: "search", story: query.trim(), search_start: String(page), result_from: String((page - 1) * PER_PAGE + 1) });
      return parseList(await get(`/index.php?${qs}`));
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      return {
        ...manga,
        title: text(doc.querySelector("h1")) || manga.title,
        genres: [...new Set([...doc.querySelectorAll("a[href*='/tags/']")].map(text).filter(Boolean))].slice(0, 25),
        description: doc.querySelector("meta[name=description]")?.getAttribute("content") || undefined,
        status: "completed",
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      return [{ url: manga.url, name: "Full comic", dateUpload: 0 }];
    },

    async getPageList(chapter): Promise<SPage[]> {
      const doc = await get(chapter.url);
      const seen = new Set<string>();
      const pages: SPage[] = [];
      for (const img of doc.querySelectorAll("img")) {
        const src = img.getAttribute("src") ?? "";
        if (!/\/uploads\/posts\/[^/]+\/thumbs\//.test(src) || seen.has(src)) continue;
        seen.add(src);
        pages.push({ index: pages.length, url: absUrl(src.replace("/thumbs/", "/"), BASE) });
      }
      if (!pages.length) throw new Error("No pages were found in this post.");
      return pages;
    },
  };
}
