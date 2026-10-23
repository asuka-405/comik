import { absUrl, fetchDoc, fetchText, imgSrc, parseDate, parseHtml, pathOf, text } from "../http";
import { F, findFilter, selectedValue } from "../filters";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/**
 * Engine for the "MangaThemesia" WordPress theme (a very common reskin base).
 * Pages are embedded as a ts_reader JSON blob, with a plain <img> fallback.
 */

export interface ThemesiaConfig {
  id: string;
  name: string;
  baseUrl: string;
  lang: string;
  /** Path that lists series, default "manga". */
  listPath?: string;
  nsfw?: boolean;
}

export function createThemesia(cfg: ThemesiaConfig): Source {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const listPath = cfg.listPath ?? "manga";

  const parseCards = (doc: Document): MangasPage => {
    const mangas: SManga[] = [];
    for (const el of doc.querySelectorAll(".listupd .bs .bsx, .listupd .utao .uta")) {
      const a = el.querySelector<HTMLAnchorElement>("a");
      if (!a) continue;
      mangas.push({
        url: pathOf(absUrl(a.getAttribute("href"), base), base),
        title: a.getAttribute("title") || text(el.querySelector(".tt, h4")),
        cover: imgSrc(el.querySelector("img"), base),
      });
    }
    return { mangas, hasNext: !!doc.querySelector("a.next.page-numbers, .hpage a.r, a.next") };
  };

  const list = async (page: number, params: Record<string, string>) => {
    const qs = new URLSearchParams({ page: String(page), ...params });
    return parseCards(await fetchDoc(`${base}/${listPath}/?${qs}`, { referer: base + "/", minGapMs: 500 }));
  };

  return {
    id: cfg.id,
    name: cfg.name,
    lang: cfg.lang,
    baseUrl: base,
    blurb: `MangaThemesia site at ${new URL(base).host}`,
    tint: "#ffb454",
    supportsLatest: true,
    isNsfw: cfg.nsfw,
    imageReferer: base + "/",

    getPopular: (page) => list(page, { order: "popular" }),
    getLatest: (page) => list(page, { order: "update" }),
    search(page, query, filters) {
      const order = findFilter(filters, "order", "select");
      const status = findFilter(filters, "status", "select");
      const params: Record<string, string> = { order: order ? selectedValue(order) : "popular" };
      if (query.trim()) params.title = query.trim();
      if (status && selectedValue(status)) params.status = selectedValue(status);
      return list(page, params);
    },
    getFilterList(): Filter[] {
      return [
        F.select("order", "Order by", ["Popular", "Latest update", "A-Z", "Newest"], ["popular", "update", "title", "latest"]),
        F.select("status", "Status", ["Any", "Ongoing", "Completed", "Hiatus"], ["", "ongoing", "completed", "hiatus"]),
      ];
    },

    async getMangaDetails(manga) {
      const doc = await fetchDoc(absUrl(manga.url, base), { referer: base + "/", minGapMs: 500 });
      const row = (label: string) => {
        for (const el of doc.querySelectorAll(".imptdt, .tsinfo .imptdt")) {
          if (text(el).toLowerCase().startsWith(label)) return text(el.querySelector("i, a")) || text(el).slice(label.length).trim();
        }
        return "";
      };
      const st = row("status").toLowerCase();
      const status: MangaStatus = st.includes("ongoing") ? "ongoing" : st.includes("complet") ? "completed" : st.includes("hiatus") ? "hiatus" : st.includes("drop") ? "cancelled" : "unknown";
      return {
        url: manga.url,
        title: text(doc.querySelector("h1.entry-title")) || manga.title,
        cover: imgSrc(doc.querySelector(".thumb img"), base) || manga.cover,
        author: row("author") || undefined,
        artist: row("artist") || undefined,
        description: text(doc.querySelector(".entry-content[itemprop=description], .summary__content")),
        genres: [...doc.querySelectorAll(".mgen a")].map(text),
        status,
      };
    },

    async getChapterList(manga) {
      const doc = await fetchDoc(absUrl(manga.url, base), { referer: base + "/", minGapMs: 500 });
      const out: SChapter[] = [];
      for (const li of doc.querySelectorAll("#chapterlist li")) {
        const a = li.querySelector<HTMLAnchorElement>("a");
        if (!a) continue;
        const num = Number(li.getAttribute("data-num"));
        out.push({
          url: pathOf(absUrl(a.getAttribute("href"), base), base),
          name: text(li.querySelector(".chapternum")) || text(a),
          number: Number.isFinite(num) && li.hasAttribute("data-num") ? num : undefined,
          dateUpload: parseDate(text(li.querySelector(".chapterdate"))),
        });
      }
      return out;
    },

    async getPageList(chapter): Promise<SPage[]> {
      const html = await fetchText(absUrl(chapter.url, base), { referer: base + "/", minGapMs: 500 });
      const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
      if (m) {
        try {
          const json = JSON.parse(m[1]!) as { sources?: { images?: string[] }[] };
          const images = json.sources?.[0]?.images ?? [];
          if (images.length) return images.map((u, index) => ({ index, url: absUrl(u, base) }));
        } catch {
          /* fall through to DOM */
        }
      }
      const doc = parseHtml(html, base);
      return [...doc.querySelectorAll("#readerarea img")].map((img) => imgSrc(img, base)).filter(Boolean).map((url, index) => ({ index, url }));
    },
  };
}
