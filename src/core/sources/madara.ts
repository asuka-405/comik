import { absUrl, fetchDoc, fetchText, imgSrc, parseDate, parseHtml, pathOf, request, text } from "../http";
import { F, findFilter, selectedValue } from "../filters";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/**
 * Engine for the WordPress "Madara" manga theme. Hundreds of sites share this
 * markup, so one engine + a base URL gives you a working source. This is the
 * same idea as Mihon's multisrc modules.
 */

export interface MadaraConfig {
  id: string;
  name: string;
  baseUrl: string;
  lang: string;
  /** Selector overrides for forks that tweak markup. */
  selectors?: Partial<Record<"card" | "title" | "chapterRow" | "pageImg", string>>;
  nsfw?: boolean;
}

const STATUS_MAP: [RegExp, MangaStatus][] = [
  [/ongoing|publishing|updating|en curso/i, "ongoing"],
  [/completed|complete|finished|end|completado/i, "completed"],
  [/hiatus|on hold|pausado/i, "hiatus"],
  [/cancel|dropped|canceled/i, "cancelled"],
];

export function createMadara(cfg: MadaraConfig): Source {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const sel = {
    card: cfg.selectors?.card ?? "div.page-item-detail, div.c-tabs-item__content",
    title: cfg.selectors?.title ?? "h3 a, h5 a, .post-title a",
    chapterRow: cfg.selectors?.chapterRow ?? "li.wp-manga-chapter",
    pageImg: cfg.selectors?.pageImg ?? "div.page-break img, .reading-content img",
  };

  const parseCards = (doc: Document): MangasPage => {
    const mangas: SManga[] = [];
    for (const el of doc.querySelectorAll(sel.card)) {
      const a = el.querySelector<HTMLAnchorElement>(sel.title);
      if (!a) continue;
      mangas.push({ url: pathOf(absUrl(a.getAttribute("href"), base), base), title: text(a), cover: imgSrc(el.querySelector("img"), base) });
    }
    const hasNext = !!doc.querySelector("a.nextpostslink, .nav-previous a, a.next.page-numbers") || mangas.length >= 12;
    return { mangas, hasNext };
  };

  async function listing(page: number, orderby: string, query = "", extra: Record<string, string[]> = {}): Promise<MangasPage> {
    const body = new URLSearchParams({
      action: "madara_load_more",
      page: String(page - 1),
      template: "madara-core/content/content-archive",
      "vars[paged]": String(page),
      "vars[orderby]": orderby === "relevance" ? "" : "meta_value_num",
      "vars[template]": "archive",
      "vars[sidebar]": "right",
      "vars[post_type]": "wp-manga",
      "vars[post_status]": "publish",
      "vars[meta_key]": orderby === "views" ? "_wp_manga_views" : orderby === "latest" ? "_latest_update" : "",
      "vars[order]": "desc",
      "vars[posts_per_page]": "20",
    });
    if (query) body.set("vars[s]", query);
    for (const [k, vals] of Object.entries(extra)) vals.forEach((v) => body.append(`vars[${k}][]`, v));
    const res = await request(`${base}/wp-admin/admin-ajax.php`, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
      referer: base + "/",
      minGapMs: 500,
    });
    const html = await res.text();
    const parsed = parseCards(parseHtml(`<body>${html}</body>`, base));
    return { mangas: parsed.mangas, hasNext: parsed.mangas.length >= 10 };
  }

  return {
    id: cfg.id,
    name: cfg.name,
    lang: cfg.lang,
    baseUrl: base,
    blurb: `Madara-theme site at ${new URL(base).host}`,
    tint: "#7aa2ff",
    supportsLatest: true,
    isNsfw: cfg.nsfw,
    imageReferer: base + "/",

    getPopular: (page) => listing(page, "views"),
    getLatest: (page) => listing(page, "latest"),
    async search(page, query, filters) {
      const order = findFilter(filters, "order", "select");
      if (query.trim()) {
        const url = `${base}/${page > 1 ? `page/${page}/` : ""}?s=${encodeURIComponent(query.trim())}&post_type=wp-manga`;
        return parseCards(await fetchDoc(url, { referer: base + "/", minGapMs: 500 }));
      }
      return listing(page, order ? selectedValue(order) : "views");
    },
    getFilterList(): Filter[] {
      return [F.select("order", "Order by", ["Most viewed", "Latest update"], ["views", "latest"])];
    },

    async getMangaDetails(manga) {
      const doc = await fetchDoc(absUrl(manga.url, base), { referer: base + "/", minGapMs: 500 });
      const info = (label: string) => {
        for (const item of doc.querySelectorAll(".post-content_item")) {
          if (text(item.querySelector(".summary-heading")).toLowerCase().includes(label)) return item.querySelector(".summary-content");
        }
        return null;
      };
      const statusText = text(info("status"));
      return {
        url: manga.url,
        title: text(doc.querySelector(".post-title h1, .post-title h3")).replace(/^(hot|new|\s)+/i, "") || manga.title,
        cover: imgSrc(doc.querySelector(".summary_image img"), base) || manga.cover,
        author: text(info("author")) || undefined,
        artist: text(info("artist")) || undefined,
        description: text(doc.querySelector(".description-summary .summary__content, .manga-excerpt")),
        genres: [...(info("genre")?.querySelectorAll("a") ?? [])].map(text),
        status: STATUS_MAP.find(([re]) => re.test(statusText))?.[1] ?? "unknown",
      };
    },

    async getChapterList(manga) {
      const url = absUrl(manga.url, base);
      let doc: Document;
      // Newer Madara builds serve the list from an ajax endpoint
      try {
        const html = await (await request(url.replace(/\/?$/, "/") + "ajax/chapters/", { method: "POST", referer: url, minGapMs: 500 })).text();
        doc = parseHtml(`<body>${html}</body>`, base);
        if (!doc.querySelector(sel.chapterRow)) throw new Error("empty");
      } catch {
        doc = await fetchDoc(url, { referer: base + "/", minGapMs: 500 });
      }
      const out: SChapter[] = [];
      for (const li of doc.querySelectorAll(sel.chapterRow)) {
        const a = li.querySelector<HTMLAnchorElement>("a");
        if (!a) continue;
        const dateEl = li.querySelector(".chapter-release-date i, .chapter-release-date a, .chapter-release-date");
        const dateText = text(dateEl) || dateEl?.getAttribute("title") || "";
        out.push({ url: pathOf(absUrl(a.getAttribute("href"), base), base), name: text(a), dateUpload: parseDate(dateText) });
      }
      return out;
    },

    async getPageList(chapter): Promise<SPage[]> {
      const url = absUrl(chapter.url, base);
      const html = await fetchText(url + (url.includes("?") ? "&" : "?") + "style=list", { referer: base + "/", minGapMs: 500 });
      const doc = parseHtml(html, base);
      return [...doc.querySelectorAll(sel.pageImg)]
        .map((img) => imgSrc(img, base))
        .filter(Boolean)
        .map((u, index) => ({ index, url: u }));
    },
  };
}
