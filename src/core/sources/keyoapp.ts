import { absUrl, fetchDoc, fetchText, pathOf, text } from "../http";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

/**
 * Keyoapp sites render plain HTML with a small, regular layout: a series list at `/series`, a latest
 * list at `/latest/`, chapters in `#chapters`, and page images in `#pages` whose address is built
 * from a per-image `uid` and a CDN template inside a script. Search filters the full list, which
 * the site also does in the page, so it is done here too.
 */
export interface KeyoappConfig {
  id: string;
  name: string;
  baseUrl: string;
  nsfw?: boolean;
}

const PAGE = 24;
const STATUS: Record<string, MangaStatus> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", dropped: "cancelled", cancelled: "cancelled" };

/** Covers are CSS backgrounds: `background-image:url(...)` or the `--photoURL:url(...)` variable. */
function backgroundUrl(element: Element | null | undefined): string | undefined {
  const style = element?.getAttribute("style") ?? "";
  const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(style);
  return match?.[1]?.replace(/&amp;/g, "&");
}

export function createKeyoapp(cfg: KeyoappConfig): Source {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const get = (path: string) => fetchDoc(`${base}${path}`, { referer: base + "/", minGapMs: 400 });

  const fromCard = (card: Element): SManga | null => {
    const link = card.matches("a[href]") ? card : card.querySelector("a[href]");
    const href = link?.getAttribute("href");
    if (!link || !href) return null;
    const title = (card.getAttribute("title") || link.getAttribute("title") || text(link)).trim();
    const cover = backgroundUrl(card.querySelector("[style*='background-image']") ?? link) ?? backgroundUrl(card);
    return title ? { url: pathOf(absUrl(href, base), base), title, cover } : null;
  };

  const everySeries = async (): Promise<SManga[]> => {
    const doc = await get("/series");
    return [...doc.querySelectorAll("#searched_series_page > button")].flatMap((button) => {
      // Light novels are listed with the comics; they have no pages to read here.
      if (/novel/i.test(button.getAttribute("data-type") ?? "")) return [];
      const manga = fromCard(button);
      return manga ? [manga] : [];
    });
  };

  const slice = (all: SManga[], page: number): MangasPage => ({ mangas: all.slice((page - 1) * PAGE, page * PAGE), hasNext: all.length > page * PAGE });

  return {
    id: cfg.id,
    name: cfg.name,
    lang: "en",
    baseUrl: base,
    blurb: `Keyoapp site at ${new URL(base).host}`,
    tint: "#5eead4",
    isNsfw: cfg.nsfw,
    supportsLatest: true,
    imageReferer: base + "/",

    async getPopular(page) {
      return slice(await everySeries(), page);
    },
    async getLatest(page) {
      const doc = await get("/latest/");
      const mangas = [...doc.querySelectorAll("div.group.latest-poster, div.grid > div.group")].flatMap((card) => {
        const manga = fromCard(card);
        return manga ? [manga] : [];
      });
      return slice(mangas, page);
    },
    async search(page, query) {
      const all = await everySeries();
      const needle = query.trim().toLowerCase();
      return slice(needle ? all.filter((m) => m.title.toLowerCase().includes(needle)) : all, page);
    },
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      const labelled = (label: string) => text([...doc.querySelectorAll("div")].find((d) => d.querySelector(":scope > span")?.textContent?.trim() === label)?.nextElementSibling);
      return {
        ...manga,
        title: text(doc.querySelector("div.grid > h1")) || manga.title,
        cover: backgroundUrl(doc.querySelector("div[class*=photoURL], div[style*=photoURL]")) || manga.cover,
        description: text(doc.querySelector("#expand_content p")) || undefined,
        author: labelled("Author") || undefined,
        artist: labelled("Artist") || undefined,
        genres: [...doc.querySelectorAll("a[href*='genre=']")].map((a) => text(a).replace(/^,\s*/, "")).filter(Boolean),
        status: STATUS[labelled("Status").toLowerCase()] ?? "unknown",
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(manga.url);
      return [...doc.querySelectorAll("#chapters > a, #chapters > div")].flatMap((row): SChapter[] => {
        const link = row.matches("a[href]") ? row : row.querySelector("a[href]");
        const href = link?.getAttribute("href");
        if (!link || !href) return [];
        // Coin-locked and upcoming chapters have no pages to load.
        if (row.querySelector("img[alt~=Coin]") || /upcoming/i.test(text(row))) return [];
        const name = (link.getAttribute("title") || text(row.querySelector(".text-sm")) || text(link)).trim();
        const date = Date.parse(link.getAttribute("d") ?? "") || 0;
        return [{ url: pathOf(absUrl(href, base), base), name, dateUpload: date }];
      });
    },

    async getPageList(chapter): Promise<SPage[]> {
      const html = await fetchText(absUrl(chapter.url, base), { referer: base + "/", minGapMs: 400 });
      const doc = new DOMParser().parseFromString(html, "text/html");
      const uids = [...doc.querySelectorAll("#pages > img")].map((img) => img.getAttribute("uid")).filter((uid): uid is string => !!uid);
      // The CDN is written into a script as a template: https://cdn.example.org/uploads/${uid}
      const template = /["'`](https?:\/\/[^"'`\s]+?)\$\{uid\}["'`]/.exec(html)?.[1];
      if (uids.length && !template) throw new Error("Could not find where this site stores its pages.");
      return uids.map((uid, index): SPage => ({ index, url: `${template}${uid}` }));
    },
  };
}
