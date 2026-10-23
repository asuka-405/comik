import { absUrl, fetchDoc, imgSrc, parseDate, pathOf, text } from "../http";
import { F, findFilter, selectedValue } from "../filters";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const ORIGIN = "https://www.webtoons.com";
const COOKIE = { cookie: "pagGDPR=true; needGDPR=false" };
const PAGE = 30;

const GENRES: [string, string][] = [
  ["Any", ""], ["Action", "action"], ["Comedy", "comedy"], ["Drama", "drama"], ["Fantasy", "fantasy"], ["Heartwarming", "heartwarming"],
  ["Horror", "horror"], ["Romance", "romance"], ["Sci-fi", "sf"], ["Slice of life", "slice-of-life"], ["Sports", "sports"],
  ["Superhero", "superhero"], ["Supernatural", "supernatural"], ["Thriller", "thriller"],
];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function cardsFrom(doc: Document, base: string): SManga[] {
  const seen = new Set<string>();
  const out: SManga[] = [];
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="title_no="]')) {
    const title = text(a.querySelector(".title, .subj"));
    if (!title) continue;
    const href = absUrl(a.getAttribute("href"), base);
    const no = new URL(href).searchParams.get("title_no");
    if (!no || seen.has(no)) continue;
    seen.add(no);
    out.push({
      url: pathOf(href, ORIGIN).replace(/\/list\?/, "/list?"),
      title,
      cover: imgSrc(a.querySelector("img"), base),
      author: text(a.querySelector(".author")) || undefined,
      genres: [text(a.querySelector(".genre"))].filter(Boolean),
    });
  }
  return out;
}

function paginate(all: SManga[], page: number): MangasPage {
  const start = (page - 1) * PAGE;
  return { mangas: all.slice(start, start + PAGE), hasNext: start + PAGE < all.length };
}

export function createWebtoons(lang: string, label: string, canvas = false): Source {
  const root = `${ORIGIN}/${lang}`;
  const get = (url: string) => fetchDoc(url, { headers: COOKIE, minGapMs: 350 });

  // Canvas is paginated by the site, 30 series per page
  const canvasPage = async (page: number, order: string): Promise<MangasPage> => {
    const mangas = cardsFrom(await get(`${root}/canvas/list?genreTab=ALL&sortOrder=${order}&page=${page}`), root);
    return { mangas, hasNext: mangas.length >= PAGE };
  };

  return {
    id: canvas ? `webtoons-canvas-${lang}` : `webtoons-${lang}`,
    name: canvas ? "Webtoon Canvas" : "Webtoon",
    lang,
    baseUrl: ORIGIN,
    blurb: canvas ? `Creator-published vertical comics, ${label}` : `Official vertical-scroll comics, ${label}`,
    tint: "#27d367",
    supportsLatest: true,
    imageReferer: `${ORIGIN}/`,

    async getPopular(page) {
      if (canvas) return canvasPage(page, "MANA");
      return paginate(cardsFrom(await get(`${root}/ranking/popular`), root), page);
    },
    async getLatest(page) {
      if (canvas) return canvasPage(page, "UPDATE");
      const day = DAYS[new Date().getDay()]!;
      return paginate(cardsFrom(await get(`${root}/originals/${day}`), root), page);
    },
    async search(page, query, filters) {
      const genre = findFilter(filters, "genre", "select");
      const slug = genre ? selectedValue(genre) : "";
      if (query.trim()) {
        const doc = await get(`${root}/search?keyword=${encodeURIComponent(query.trim())}`);
        return paginate(cardsFrom(doc, root), page);
      }
      if (slug) {
        const order = findFilter(filters, "order", "select");
        const doc = await get(`${root}/genres/${slug}?sortOrder=${order ? selectedValue(order) : "MANA"}`);
        return paginate(cardsFrom(doc, root), page);
      }
      return this.getPopular(page);
    },
    getFilterList(): Filter[] {
      return [
        F.header("note", "Text search ignores the filters below"),
        F.select("genre", "Genre", GENRES.map((g) => g[0]), GENRES.map((g) => g[1])),
        F.select("order", "Order", ["Popularity", "Likes", "Updated"], ["MANA", "LIKEIT", "UPDATE"]),
      ];
    },

    async getMangaDetails(manga) {
      const url = absUrl(manga.url, ORIGIN);
      const doc = await get(url);
      const authors = [...(doc.querySelector(".author_area")?.childNodes ?? [])]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").replace(/[\s,]+/g, " ").trim())
        .filter(Boolean);
      const dayInfo = text(doc.querySelector("p.day_info"));
      const status: MangaStatus = /completed/i.test(dayInfo) ? "completed" : /hiatus/i.test(dayInfo) ? "hiatus" : dayInfo ? "ongoing" : "unknown";
      return {
        url: manga.url,
        title: text(doc.querySelector("h1.subj")) || manga.title,
        cover: doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? manga.cover,
        author: authors.join(", ") || manga.author,
        description: text(doc.querySelector("p.summary")) || doc.querySelector('meta[property="og:description"]')?.getAttribute("content") || undefined,
        genres: [text(doc.querySelector(".info h2.genre"))].filter(Boolean),
        status,
      };
    },

    async getChapterList(manga) {
      const base = absUrl(manga.url, ORIGIN);
      const seen = new Set<string>();
      const out: SChapter[] = [];
      for (let page = 1; page <= 400; page++) {
        const doc = await get(`${base}${base.includes("?") ? "&" : "?"}page=${page}`);
        let added = 0;
        for (const li of doc.querySelectorAll<HTMLElement>("#_listUl li._episodeItem")) {
          const a = li.querySelector<HTMLAnchorElement>("a.detail_list_link");
          if (!a) continue;
          const url = pathOf(absUrl(a.getAttribute("href"), base), ORIGIN);
          if (seen.has(url)) continue;
          seen.add(url);
          added++;
          const no = Number(li.dataset.episodeNo);
          out.push({
            url,
            name: text(li.querySelector(".subj span")) || `Episode ${no}`,
            number: Number.isFinite(no) ? no : undefined,
            dateUpload: parseDate(text(li.querySelector(".date"))),
          });
        }
        if (!added) break;
      }
      return out;
    },

    async getPageList(chapter): Promise<SPage[]> {
      const doc = await get(absUrl(chapter.url, ORIGIN));
      return [...doc.querySelectorAll<HTMLImageElement>("#_imageList img._images")]
        .map((img) => img.getAttribute("data-url") ?? "")
        .filter(Boolean)
        .map((url, index) => ({ index, url }));
    },
  };
}
