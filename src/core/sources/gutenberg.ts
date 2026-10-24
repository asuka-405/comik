import { fetchJson, fetchText } from "../http";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";
import type { NovelPart } from "../novels";
import { splitPublicDomainText } from "./gutenbergText";

const API = "https://gutendex.com/books/";
const SITE = "https://www.gutenberg.org";

interface GutenbergBook {
  id: number;
  title: string;
  authors?: { name: string }[];
  subjects?: string[];
  formats: Record<string, string>;
}
interface GutenbergPage { count: number; next: string | null; results: GutenbergBook[] }

const bookId = (manga: SManga) => Number(manga.url.replace(/^\//, ""));
const pageUrl = (page: number, query?: string) => {
  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set("search", query);
  else params.set("sort", "popular");
  return `${API}?${params}`;
};

export { splitPublicDomainText } from "./gutenbergText";

export function createGutenbergSource(): Source {
  const partsCache = new Map<number, NovelPart[]>();
  const textUrl = (book: GutenbergBook) => {
    const formats = book.formats;
    return formats["text/plain; charset=utf-8"] || formats["text/plain; charset=us-ascii"] || formats["text/plain"];
  };
  const mapBook = (book: GutenbergBook): SManga => ({
    url: `/${book.id}`,
    title: book.title,
    kind: "novel",
    externalUrl: `${SITE}/ebooks/${book.id}`,
    cover: `${SITE}/cache/epub/${book.id}/pg${book.id}.cover.medium.jpg`,
    author: book.authors?.map((author) => author.name).join(", "),
    genres: book.subjects?.slice(0, 12) ?? [],
  });
  const listing = async (page: number, query?: string): Promise<MangasPage> => {
    const data = await fetchJson<GutenbergPage>(pageUrl(page, query), { referer: SITE, minGapMs: 250 });
    return { mangas: data.results.map(mapBook), hasNext: !!data.next };
  };
  const loadParts = async (manga: SManga): Promise<NovelPart[]> => {
    const id = bookId(manga);
    const cached = partsCache.get(id);
    if (cached) return cached;
    const metadata = await fetchJson<GutenbergBook>(`${API}${id}`, { referer: SITE, minGapMs: 250 });
    const url = textUrl(metadata);
    if (!url) throw new Error("Project Gutenberg has no plain-text edition for this book");
    const text = await fetchText(url, { referer: SITE, minGapMs: 250 });
    const parts = splitPublicDomainText(text);
    partsCache.set(id, parts);
    return parts;
  };

  return {
    id: "gutenberg-novels",
    name: "Project Gutenberg",
    lang: "en",
    baseUrl: SITE,
    blurb: "Public-domain books and novels, searchable by title or author",
    tint: "#7b5b36",
    supportsLatest: false,
    mediaType: "novel",
    directImages: true,
    getPopular: (page) => listing(page),
    getLatest: async () => ({ mangas: [], hasNext: false }),
    search: (page, query) => listing(page, query.trim() || undefined),
    getFilterList: (): Filter[] => [],
    getMangaDetails: async (manga) => manga,
    async getChapterList(manga): Promise<SChapter[]> {
      const parts = await loadParts(manga);
      return parts.map((part, index) => ({ url: `/${bookId(manga)}/${index + 1}`, name: part.title, number: index + 1, dateUpload: 0 }));
    },
    async getNovelText(chapter, manga) {
      const index = Number(chapter.url.split("/").pop()) - 1;
      const part = (await loadParts(manga))[index];
      if (!part) throw new Error("This chapter is not available in the public-domain text edition");
      return part.text;
    },
    async getPageList(_chapter, _manga): Promise<SPage[]> { return []; },
  };
}