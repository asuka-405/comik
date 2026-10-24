import { absUrl, fetchDoc, imgSrc, pathOf, text } from "../http";
import type { Filter, MangasPage, SChapter, SManga, Source } from "../types";

/**
 * Web-novel sites that share a simple shape: a listing of novels, a novel page, a chapter list and a chapter
 * page whose text sits in one element. Each site is described by selectors; the engine does the rest.
 * Add a site by adding a config below and checking it with scripts/check-novels.ts.
 */
export interface NovelSiteConfig {
  id: string;
  name: string;
  baseUrl: string;
  blurb: string;
  tint?: string;
  /** Listing URL templates. `{page}` (1-based), `{page0}` (0-based) and `{query}` are filled in. */
  popular: string;
  latest: string;
  /** Empty when the site's search cannot be called directly: titles are then matched in the first few popular pages. */
  search: string;
  /** A listing with at least this many novels has another page (for sites that do not link to it). */
  perPage?: number;
  /** One novel in a listing, the link to its page inside it, and its cover. */
  card: { item: string; link: string; title?: string; cover?: string };
  /** Selectors on the novel page. Missing ones fall back to the page's og:novel / og: meta tags. */
  details?: { title?: string; author?: string; description?: string; cover?: string; genres?: string };
  chapters:
    /** Chapters have numbered URLs. `latest` finds the newest ones, which also give the highest number. */
    | { mode: "numbered"; latest: string; url: string }
    /** One request returns the whole list. `idFrom` is a selector[attribute] holding the novel id. */
    | { mode: "ajax"; idFrom: string; url: string; link: string }
    /** The novel page lists chapters in pages of ~50, reached with ?page=N. */
    | { mode: "paged"; link: string; last: string }
    /** Everything is on the novel page. */
    | { mode: "inline"; link: string };
  /** Element holding the chapter text, and noise to remove from it. */
  content: string;
  strip?: string;
}

const NOISE = "script,style,iframe,ins,noscript,.ads,.adsbygoogle,[class*=advert],[id*=advert],.chapter-nav,.nav-buttons";
const clean = (value: string) => value.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();

/** Chapter number from a name like "Chapter 12.5: Title". */
export const chapterNumber = (name: string): number | undefined => {
  const match = name.match(/(?:chapter|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i) ?? name.match(/^\s*(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : undefined;
};

/** The text of a chapter element as paragraphs separated by blank lines. */
export function paragraphsOf(root: Element, strip = ""): string {
  const node = root.cloneNode(true) as Element;
  node.querySelectorAll([NOISE, strip].filter(Boolean).join(",")).forEach((child) => child.remove());
  node.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const blocks = [...node.querySelectorAll("p")].map((p) => clean(p.textContent ?? "")).filter(Boolean);
  const lines = blocks.length ? blocks : clean(node.textContent ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.join("\n\n");
}

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(vars[key] ?? "")));

export function createNovelSite(cfg: NovelSiteConfig): Source {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const get = (url: string, extra?: { headers?: Record<string, string> }) => fetchDoc(absUrl(url, base + "/"), { referer: base + "/", minGapMs: 350, ...extra });
  const meta = (doc: Document, property: string) => doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute("content")?.trim() ?? "";

  const toPage = (doc: Document, page: number): MangasPage => {
    const seen = new Set<string>();
    const mangas = [...doc.querySelectorAll(cfg.card.item)].flatMap((item): SManga[] => {
      const link = item.querySelector<HTMLAnchorElement>(cfg.card.link);
      const href = link?.getAttribute("href");
      const title = text(cfg.card.title ? item.querySelector(cfg.card.title) : link) || link?.getAttribute("title")?.trim() || "";
      if (!href || !title) return [];
      const path = pathOf(href, base);
      if (seen.has(path)) return [];
      seen.add(path);
      const cover = imgSrc(item.querySelector(cfg.card.cover ?? "img"), base);
      return [{ url: path, title, kind: "novel", cover: cover || undefined }];
    });
    const next = page + 1;
    const hasNext = !!doc.querySelector(`a[href$="/${next}"], a[href*="page=${next}"], a[href*="p=${next}"]`) || (mangas.length >= 15 && !!doc.querySelector("a[rel=next], li.next:not(.disabled) a")) || (!!cfg.perPage && mangas.length >= cfg.perPage);
    return { mangas, hasNext };
  };
  const list = (template: string, vars: Record<string, string | number>) => async (page: number): Promise<MangasPage> => {
    const first = !vars.query && page === 1;
    const url = first ? fill(template, { ...vars, page: 1, page0: 0 }).replace(/\/1(?=$|\?)/, "").replace(/[?&]page=1(?=$|&)/, "") : fill(template, { ...vars, page, page0: page - 1 });
    return toPage(await get(url), page);
  };

  async function chapterLinks(doc: Document, selector: string): Promise<SChapter[]> {
    const seen = new Set<string>();
    return [...doc.querySelectorAll<HTMLAnchorElement>(selector)].flatMap((a): SChapter[] => {
      const href = a.getAttribute("href") ?? a.getAttribute("value");
      if (!href || href.startsWith("javascript") || href === "#") return [];
      const path = pathOf(href, base);
      if (seen.has(path)) return [];
      seen.add(path);
      const name = (text(a) || a.getAttribute("title")?.trim() || path).replace(/^Read\s+/i, "");
      return [{ url: path, name, number: chapterNumber(name), dateUpload: 0 }];
    });
  }

  /** Oldest chapter first is how the sites list them; the app wants newest first with numbers set. */
  const finish = (chapters: SChapter[]): SChapter[] => {
    const numbered = chapters.map((c, i) => ({ ...c, number: c.number ?? i + 1 }));
    const first = numbered[0]?.number ?? 0;
    const last = numbered[numbered.length - 1]?.number ?? 0;
    return first < last ? numbered.reverse() : numbered;
  };

  return {
    id: cfg.id,
    name: cfg.name,
    lang: "en",
    baseUrl: base,
    blurb: cfg.blurb,
    tint: cfg.tint ?? "#7a6bd6",
    supportsLatest: true,
    mediaType: "novel",
    directImages: true,
    getPopular: list(cfg.popular, {}),
    getLatest: list(cfg.latest, {}),
    async search(page, query) {
      const q = query.trim();
      if (!q) return list(cfg.popular, {})(page);
      if (cfg.search) return list(cfg.search, { query: q })(page);
      // No usable search address: look through the first popular pages instead.
      const needle = q.toLowerCase();
      const pages = await Promise.all([1, 2, 3, 4, 5].map((n) => list(cfg.popular, {})(n).catch(() => ({ mangas: [], hasNext: false }) as MangasPage)));
      return { mangas: pages.flatMap((p) => p.mangas).filter((m) => m.title.toLowerCase().includes(needle)), hasNext: false };
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      const d = cfg.details ?? {};
      const pick = (selector: string | undefined) => (selector ? text(doc.querySelector(selector)) : "");
      const genres = d.genres ? [...doc.querySelectorAll(d.genres)].map(text).filter(Boolean) : meta(doc, "og:novel:genre").split(/\s*,\s*/).filter(Boolean);
      const status = meta(doc, "og:novel:status").toLowerCase();
      return {
        ...manga,
        kind: "novel",
        title: pick(d.title) || meta(doc, "og:novel:novel_name") || manga.title,
        author: pick(d.author) || meta(doc, "og:novel:author") || undefined,
        description: pick(d.description) || meta(doc, "og:description") || undefined,
        cover: (d.cover ? imgSrc(doc.querySelector(d.cover), base) : "") || meta(doc, "og:image") || manga.cover,
        genres,
        status: /complete|finish/.test(status) ? "completed" : /ongoing/.test(status) ? "ongoing" : manga.status,
        externalUrl: absUrl(manga.url, base + "/"),
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(manga.url);
      const mode = cfg.chapters;
      if (mode.mode === "inline") return finish(await chapterLinks(doc, mode.link));
      if (mode.mode === "numbered") {
        const latest = await chapterLinks(doc, mode.latest);
        const top = Math.max(0, ...latest.map((c) => c.number ?? 0));
        if (!top) throw new Error("This novel lists no chapters yet.");
        const names = new Map(latest.map((c) => [c.number, c.name]));
        const slug = manga.url.replace(/^.*\//, "").replace(/\.html$/, "");
        return Array.from({ length: top }, (_, i): SChapter => {
          const n = top - i;
          return { url: fill(mode.url, { slug, n }).replace(/%2F/g, "/"), name: names.get(n) ?? `Chapter ${n}`, number: n, dateUpload: 0 };
        });
      }
      if (mode.mode === "ajax") {
        const [selector, attribute] = mode.idFrom.split("@");
        const id = doc.querySelector(selector!)?.getAttribute(attribute!);
        if (!id) throw new Error("Could not find this novel's chapter list.");
        return finish(await chapterLinks(await get(fill(mode.url, { id }), { headers: { "x-requested-with": "XMLHttpRequest" } }), mode.link));
      }
      // paged
      const pages = [doc];
      const lastHref = doc.querySelector(mode.last)?.getAttribute("href") ?? "";
      const lastPage = Math.min(Number(lastHref.match(/page=(\d+)/)?.[1] ?? 1), 120);
      const rest = Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => i + 2);
      const queue = [...rest];
      const fetched = new Map<number, Document>();
      await Promise.all(Array.from({ length: 4 }, async () => {
        for (let n = queue.shift(); n !== undefined; n = queue.shift()) fetched.set(n, await get(`${manga.url}?page=${n}`));
      }));
      for (const n of rest) pages.push(fetched.get(n)!);
      const all: SChapter[] = [];
      const seen = new Set<string>();
      for (const page of pages) for (const c of await chapterLinks(page, mode.link)) if (!seen.has(c.url)) { seen.add(c.url); all.push(c); }
      return finish(all);
    },

    async getNovelText(chapter) {
      const doc = await get(chapter.url);
      const content = doc.querySelector(cfg.content);
      if (!content) throw new Error(`${cfg.name} did not return readable chapter text.`);
      const body = paragraphsOf(content, cfg.strip);
      if (body.length < 40) throw new Error("This chapter has no readable text yet.");
      return body;
    },
    async getPageList() { return []; },
  };
}

export const NOVEL_SITES: NovelSiteConfig[] = [
  {
    id: "freewebnovel",
    name: "FreeWebNovel",
    baseUrl: "https://freewebnovel.com",
    blurb: "Large library of translated and original web novels",
    tint: "#2f9e8f",
    popular: "https://freewebnovel.com/sort/most-popular/{page}",
    latest: "https://freewebnovel.com/sort/latest-novel/{page}",
    search: "https://freewebnovel.com/search?keyword={query}&page={page}",
    card: { item: ".li-row .li", link: "h3.tit a", cover: ".pic img" },
    details: { title: "h1.tit", description: ".m-desc .txt .inner", author: ".m-imgtxt a[href^='/author/']" },
    chapters: { mode: "numbered", latest: "ul.ul-list5 a", url: "/novel/{slug}/chapter-{n}" },
    content: "#article",
    strip: "h4",
  },
  {
    id: "readnovelfull",
    name: "ReadNovelFull",
    baseUrl: "https://readnovelfull.com",
    blurb: "Popular Chinese, Korean and Japanese web novels in English",
    tint: "#c2692f",
    popular: "https://readnovelfull.com/novel-list/most-popular-novel?page={page}",
    latest: "https://readnovelfull.com/novel-list/latest-release-novel?page={page}",
    search: "https://readnovelfull.com/novel-list/search?keyword={query}&page={page}",
    card: { item: ".list-novel .row", link: "h3.novel-title a", cover: "img.cover" },
    details: { title: "h3.title", description: ".desc-text", author: ".info a[href*='/authors/']", genres: ".info a[href*='/genres/']", cover: ".book img" },
    chapters: { mode: "ajax", idFrom: "[data-novel-id]@data-novel-id", url: "/ajax/chapter-archive?novelId={id}", link: "ul.list-chapter a" },
    content: "#chr-content",
  },
  {
    id: "novelfull",
    name: "NovelFull",
    baseUrl: "https://novelfull.com",
    blurb: "Free web novels, light novels and wuxia",
    tint: "#4a78c9",
    popular: "https://novelfull.com/most-popular?page={page}",
    latest: "https://novelfull.com/latest-release-novel?page={page}",
    search: "https://novelfull.com/search?keyword={query}&page={page}",
    card: { item: ".list-truyen .row", link: "h3.truyen-title a", cover: "img.cover" },
    details: { title: "h3.title", description: ".desc-text", author: ".info a[href^='/author/']", genres: ".info a[href^='/genre/']", cover: ".book img" },
    chapters: { mode: "paged", link: "ul.list-chapter a", last: "ul.pagination li.last a" },
    content: "#chapter-content",
  },
];

NOVEL_SITES.push(
  {
    id: "wuxiabox",
    name: "WuxiaBox (ReadWN)",
    baseUrl: "https://www.wuxiabox.com",
    blurb: "Chinese web novels and wuxia, the former ReadWN",
    tint: "#b5473d",
    popular: "https://www.wuxiabox.com/list/all/all-onclick-{page0}.html",
    latest: "https://www.wuxiabox.com/list/all/all-newstime-{page0}.html",
    search: "",
    perPage: 25,
    card: { item: "li.novel-item", link: "a[href^='/novel/']", title: ".novel-title", cover: "img" },
    details: { title: "h1.novel-title", description: ".summary .content", author: "[itemprop=author]", genres: ".categories a.property-item", cover: ".fixed-img img, figure.cover img" },
    chapters: { mode: "numbered", latest: "a[href^='/novel/'][href*='_']", url: "/novel/{slug}_{n}.html" },
    content: ".chapter-content",
  },
  {
    id: "novelfull-net",
    name: "NovelFull.net",
    baseUrl: "https://novelfull.net",
    blurb: "Wuxia, xianxia and light novels, updated daily",
    tint: "#5b8c5a",
    popular: "https://novelfull.net/most-popular?page={page}",
    latest: "https://novelfull.net/latest-release-novel?page={page}",
    search: "https://novelfull.net/search?keyword={query}&page={page}",
    card: { item: ".li-row .li", link: "h3.tit a", cover: ".pic img" },
    details: { title: "h1.tit", description: ".m-desc .txt .inner", author: ".m-imgtxt a[href*='author']", genres: ".m-imgtxt a[href*='genre']" },
    chapters: { mode: "ajax", idFrom: "[data-novel-id]@data-novel-id", url: "/ajax-chapter-option?novelId={id}", link: "option" },
    content: "#chapter-content, #article, #chr-content",
  },
);

export const createNovelSites = (): Source[] => NOVEL_SITES.map(createNovelSite);
