import { absUrl, fetchDoc, pathOf, text } from "../http";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const BASE = "https://hentai2read.com";

/**
 * Hentai2Read is server-rendered. Series pages live at /doujinshi/<id>-<slug> (also /original and
 * /imageset), each chapter at /reader/<slug>/<chapter id>/page-<n>, and page images on a CDN at
 * hentaicdn.com/hentai/<id>/<folder>/ccdn<0001>.jpg. The reader shows one image per page, which gives
 * the folder and extension; the rest follow from the page count printed next to each chapter.
 */
export function createHentai2Read(): Source {
  const get = (path: string) => fetchDoc(absUrl(path, BASE), { referer: BASE + "/", minGapMs: 500 });

  const parseList = (doc: Document): MangasPage => {
    const mangas = [...doc.querySelectorAll("article[data-card] > a[href]")].flatMap((link): SManga[] => {
      const href = link.getAttribute("href");
      const title = link.getAttribute("title") || text(link.closest("article")?.querySelector("h2, h3, [class*=title]")) || text(link.querySelector("img[alt]") ? undefined : link);
      const alt = link.querySelector("img")?.getAttribute("alt") ?? "";
      const cover = link.querySelector("img")?.getAttribute("src") || undefined;
      const name = (title || alt).trim();
      return href && name ? [{ url: pathOf(absUrl(href, BASE), BASE), title: name, cover }] : [];
    });
    return { mangas, hasNext: !!doc.querySelector("a[rel=next], a[href*='page-" + 2 + "']") && mangas.length > 0 };
  };

  return {
    id: "hentai2read-en",
    name: "Hentai2Read",
    lang: "en",
    baseUrl: BASE,
    blurb: "Doujinshi and original manga",
    tint: "#fb7185",
    isNsfw: true,
    supportsLatest: true,
    imageReferer: BASE + "/",

    async getPopular(page) {
      return parseList(await get(page > 1 ? `/browse/page-${page}` : "/browse"));
    },
    getLatest(page) {
      return this.getPopular(page);
    },
    async search(page, query) {
      if (!query.trim()) return this.getPopular(page);
      return parseList(await get(`/search?q=${encodeURIComponent(query.trim())}&page=${page}`));
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      const description = doc.querySelector("meta[name=description]")?.getAttribute("content") ?? "";
      const status: MangaStatus = /\bcompleted\b/i.test(text(doc.body)) ? "completed" : "unknown";
      return {
        ...manga,
        title: text(doc.querySelector("h1")) || manga.title,
        cover: doc.querySelector("img[src*='/cover/']")?.getAttribute("src") || manga.cover,
        author: text(doc.querySelector("a[href^='/artist/']")) || undefined,
        description: description || undefined,
        genres: [...doc.querySelectorAll("a[href^='/tag/'], a[href*='/tags/']")].map(text).filter(Boolean).slice(0, 20),
        status,
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(manga.url);
      const seen = new Map<string, SChapter>();
      for (const link of doc.querySelectorAll("a[href^='/reader/']")) {
        const href = link.getAttribute("href") ?? "";
        const match = /\/reader\/([^/]+)\/(\d+)\/page-1\b/.exec(href);
        if (!match || seen.has(match[2]!)) continue;
        // The chapter's block reads "Chapter 6: Title - 18 pages".
        let block: Element | null = link;
        let label = "";
        for (let i = 0; i < 4 && block && !label; i++, block = block.parentElement) label = /Chapter\s+\d+[^]*?-\s*\d+\s+pages?/i.exec(text(block))?.[0] ?? "";
        if (!label) continue;
        const pages = Number(/(\d+)\s+pages?/i.exec(label)?.[1] ?? 0);
        const name = label.replace(/\s*-\s*\d+\s+pages?$/i, "").trim();
        // The page count rides in the url so the pages can be built without another request.
        seen.set(match[2]!, { url: `/reader/${match[1]}/${match[2]}/page-1?pages=${pages}`, name, dateUpload: 0 });
      }
      // Single-chapter series have no chapter block, just the "Read first" link.
      if (!seen.size) {
        const first = doc.querySelector("a[href^='/reader/']")?.getAttribute("href");
        const pages = Number(/(\d+)\s+pages?/i.exec(text(doc.body))?.[1] ?? 0);
        if (first) seen.set("only", { url: `${first.split("?")[0]}?pages=${pages}`, name: "Chapter 1", dateUpload: 0 });
      }
      // Chapter 1 first in the page, but sources list newest first.
      return [...seen.values()].reverse();
    },

    async getPageList(chapter): Promise<SPage[]> {
      const pages = Number(/[?&]pages=(\d+)/.exec(chapter.url)?.[1] ?? 0);
      const doc = await get(chapter.url.split("?")[0]!);
      const first = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "").find((s) => /hentaicdn\.com\/hentai\/\d+\/[^/]+\/ccdn\d+\.\w+$/.test(s));
      if (!first) throw new Error("Could not find this chapter's first page.");
      const [, dir, , ext] = /^(.*\/)ccdn(\d+)\.(\w+)$/.exec(first)!;
      const count = pages > 0 ? pages : Number(/\b1\s*(?:\/|of)\s*(\d+)\b/.exec(text(doc.body))?.[1] ?? 1);
      return Array.from({ length: count }, (_, index): SPage => ({ index, url: `${dir}ccdn${String(index + 1).padStart(4, "0")}.${ext}` }));
    },
  };
}
