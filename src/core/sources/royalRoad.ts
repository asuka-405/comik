import { absUrl, fetchDoc, parseDate, pathOf, text } from "../http";
import type { Filter, SChapter, SManga, SPage, Source } from "../types";

const BASE = "https://www.royalroad.com";

function cards(doc: Document): SManga[] {
  return [...doc.querySelectorAll(".fiction-list-item, .fiction-list, .fiction-item")].flatMap((item) => {
    const link = item.querySelector<HTMLAnchorElement>('h2 a[href*="/fiction/"], h3 a[href*="/fiction/"], a[href*="/fiction/"]');
    const href = link?.getAttribute("href");
    const title = text(link);
    if (!href || !title) return [];
    const image = item.querySelector("img");
    const cover = image?.getAttribute("src") || image?.getAttribute("data-src") || undefined;
    return [{ url: pathOf(href, BASE), title, kind: "novel" as const, externalUrl: absUrl(href, BASE), cover: cover ? absUrl(cover, BASE) : undefined }];
  });
}

export function createRoyalRoadSource(): Source {
  const get = (url: string) => fetchDoc(url, { referer: BASE + "/", minGapMs: 700 });
  return {
    id: "royal-road-novels",
    name: "Royal Road",
    lang: "en",
    baseUrl: BASE,
    blurb: "Creator-published web fiction and original novels",
    tint: "#3b7a57",
    supportsLatest: true,
    mediaType: "novel",
    directImages: true,
    async getPopular(page) {
      const suffix = page > 1 ? `?page=${page}` : "";
      const doc = await get(`${BASE}/fictions/best-rated${suffix}`);
      return { mangas: cards(doc), hasNext: !!doc.querySelector("a[rel=next], .pagination .next:not(.disabled) a") };
    },
    async getLatest(page) {
      const suffix = page > 1 ? `?page=${page}` : "";
      const doc = await get(`${BASE}/fictions/latest-updates${suffix}`);
      return { mangas: cards(doc), hasNext: !!doc.querySelector("a[rel=next], .pagination .next:not(.disabled) a") };
    },
    async search(page, query) {
      const params = new URLSearchParams({ title: query.trim(), page: String(page) });
      const doc = await get(`${BASE}/fictions/search?${params}`);
      return { mangas: cards(doc), hasNext: !!doc.querySelector("a[rel=next], .pagination .next:not(.disabled) a") };
    },
    getFilterList: (): Filter[] => [],
    async getMangaDetails(manga) {
      const doc = await get(absUrl(manga.url, BASE));
      const description = doc.querySelector(".description .hidden-content, .description, .fiction-description");
      const authors = [...doc.querySelectorAll(".author a, a[href*='/profile/']")].map(text).filter(Boolean);
      return {
        ...manga,
        kind: "novel",
        title: text(doc.querySelector("h1[property=name], h1")) || manga.title,
        author: authors.join(", ") || manga.author,
        description: text(description) || manga.description,
        cover: doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? manga.cover,
        externalUrl: absUrl(manga.url, BASE),
      };
    },
    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(absUrl(manga.url, BASE));
      const rows = [...doc.querySelectorAll("table#chapters tbody tr, #chapters tbody tr")];
      return rows.flatMap((row, index): SChapter[] => {
        const link = row.querySelector<HTMLAnchorElement>('a[href*="/chapter/"]');
        const href = link?.getAttribute("href");
        if (!href) return [];
        const dateText = text(row.querySelector("time, .date, td:last-child"));
        return [{ url: pathOf(href, BASE), name: text(link) || `Chapter ${index + 1}`, number: index + 1, dateUpload: parseDate(dateText) }];
      });
    },
    async getNovelText(chapter) {
      const doc = await get(absUrl(chapter.url, BASE));
      const content = doc.querySelector("#chapter-content, .chapter-content, article.chapter");
      if (!content) throw new Error("Royal Road did not return readable chapter text");
      content.querySelectorAll("script,style,button,.chapter-footer").forEach((node) => node.remove());
      const paragraphs = [...content.querySelectorAll("p,blockquote,h1,h2,h3")].map((node) => text(node)).filter(Boolean);
      const body = (paragraphs.length ? paragraphs : [text(content)]).join("\n\n").trim();
      if (!body) throw new Error("This chapter has no readable text");
      return body;
    },
    async getPageList(): Promise<SPage[]> { return []; },
  };
}