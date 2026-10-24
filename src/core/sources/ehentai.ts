import { absUrl, fetchDoc, imgSrc, parseDate, pathOf, text } from "../http";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const BASE = "https://e-hentai.org";
/**
 * The site excludes categories by bit. Comik only lists the drawn ones (Doujinshi 2, Manga 4,
 * Artist CG 8, Game CG 16), so everything else is excluded: Misc 1, Image Set 32, Cosplay 64,
 * Asian Porn 128, Non-H 256 and Western 512.
 */
const DRAWN_ONLY = 1 + 32 + 64 + 128 + 256 + 512;
const PER_GALLERY_PAGE = 20;

/**
 * E-Hentai galleries are one volume each. The gallery page shows 20 thumbnails per page, every
 * thumbnail links to an image page, and that page holds the full image. A chapter's pages are
 * therefore found in two steps: the gallery pages for the links, then each image page for its image.
 */
export function createEHentai(): Source {
  const get = (path: string) => fetchDoc(absUrl(path, BASE), { referer: BASE + "/", minGapMs: 300 });

  const parseList = (doc: Document, hasMore: boolean): MangasPage => {
    const seen = new Set<string>();
    const mangas: SManga[] = [];
    for (const row of doc.querySelectorAll("table.itg tr, .gl1t")) {
      // The popular page ignores the category filter, so keep only drawn categories here as well.
      const category = text(row.querySelector(".cn, .glcat"));
      if (category && !/^(doujinshi|manga|artist cg|game cg)$/i.test(category)) continue;
      const link = row.querySelector("a[href*='/g/']");
      const href = link?.getAttribute("href");
      if (!link || !href || seen.has(href)) continue;
      const title = text(row.querySelector(".glink")) || row.querySelector("img[title]")?.getAttribute("title") || text(link);
      if (!title) continue;
      seen.add(href);
      mangas.push({ url: pathOf(absUrl(href, BASE), BASE), title, cover: imgSrc(row.querySelector(".glthumb img, img"), BASE) });
    }
    return { mangas, hasNext: hasMore && mangas.length > 0 };
  };

  const list = async (page: number, query = "") => {
    const qs = new URLSearchParams({ f_cats: String(DRAWN_ONLY), page: String(page - 1) });
    if (query) qs.set("f_search", query);
    const doc = await get(`/?${qs}`);
    return parseList(doc, !!doc.querySelector("#unext, .ptt td:last-child a"));
  };

  return {
    id: "ehentai-en",
    name: "E-Hentai",
    lang: "en",
    baseUrl: BASE,
    blurb: "Doujinshi, manga and artist CG galleries",
    tint: "#f472b6",
    isNsfw: true,
    supportsLatest: true,
    imageReferer: BASE + "/",

    async getPopular() {
      return parseList(await get("/popular"), false);
    },
    getLatest: (page) => list(page),
    search: (page, query) => list(page, query.trim()),
    getFilterList: (): Filter[] => [],

    async getMangaDetails(manga) {
      const doc = await get(manga.url);
      const meta = (label: string) => text([...doc.querySelectorAll("#gdd tr")].find((tr) => text(tr.querySelector(".gdt1")).startsWith(label))?.querySelector(".gdt2"));
      const tags = [...doc.querySelectorAll("#taglist a")].map((a) => text(a)).filter(Boolean);
      return {
        ...manga,
        title: text(doc.querySelector("#gn")) || manga.title,
        cover: /url\(([^)]+)\)/.exec(doc.querySelector("#gd1 div")?.getAttribute("style") ?? "")?.[1] || manga.cover,
        author: tags.find((t) => !t.includes(":")) && text(doc.querySelector("#taglist a[id^='ta_artist']")) || text(doc.querySelector("#gdn a")) || undefined,
        description: [text(doc.querySelector("#gj")), meta("Language") && `Language: ${meta("Language")}`, meta("Length") && `Length: ${meta("Length")}`].filter(Boolean).join("\n"),
        genres: tags.slice(0, 30),
        status: "completed",
      };
    },

    async getChapterList(manga): Promise<SChapter[]> {
      const doc = await get(manga.url);
      const posted = text([...doc.querySelectorAll("#gdd tr")].find((tr) => text(tr.querySelector(".gdt1")).startsWith("Posted"))?.querySelector(".gdt2"));
      const pages = Number(/(\d+)\s+pages?/i.exec(text(doc.querySelector("#gdd")))?.[1] ?? 0);
      return [{ url: `${manga.url}#pages=${pages}`, name: "Gallery", dateUpload: parseDate(posted) }];
    },

    async getPageList(chapter): Promise<SPage[]> {
      const path = chapter.url.split("#")[0]!;
      const total = Number(/pages=(\d+)/.exec(chapter.url)?.[1] ?? 0);
      const galleryPages = Math.max(1, Math.ceil(total / PER_GALLERY_PAGE));
      const links: string[] = [];
      for (let p = 0; p < galleryPages + 5; p++) {
        const doc = await get(`${path}?p=${p}`);
        const found = [...doc.querySelectorAll("#gdt a[href*='/s/']")].map((a) => a.getAttribute("href") ?? "").filter(Boolean);
        if (!found.length) break;
        links.push(...found);
        // Some accounts see 40 thumbnails a page, so stop on the count, not on a fixed size.
        if (total && links.length >= total) break;
      }
      const images: string[] = [];
      for (const link of links) {
        const doc = await get(link);
        const src = doc.querySelector("#img")?.getAttribute("src");
        if (!src) throw new Error("The site stopped serving images. It limits how many a visitor can load; try again later.");
        images.push(src);
      }
      return images.map((url, index): SPage => ({ index, url }));
    },
  };
}
