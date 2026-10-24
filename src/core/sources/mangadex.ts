import { fetchJson } from "../http";
import { F, excluded, findFilter, flattenFilters, included, selectedValue } from "../filters";
import type { Filter, MangaStatus, MangasPage, SChapter, SManga, SPage, Source } from "../types";

const API = "https://api.mangadex.org";
const COVERS = "https://uploads.mangadex.org/covers";
const PAGE_SIZE = 30;
const ALL_RATINGS = ["safe", "suggestive", "erotica", "pornographic"];

interface Rel {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}
interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles?: Record<string, string>[];
    description?: Record<string, string>;
    status?: string;
    tags?: { id: string; attributes: { name: Record<string, string>; group: string } }[];
  };
  relationships: Rel[];
}
interface MdList<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}

type TagInfo = { id: string; name: string; group: string };
let tagCache: TagInfo[] | null = null;

const STATUS: Record<string, MangaStatus> = {
  ongoing: "ongoing",
  completed: "completed",
  hiatus: "hiatus",
  cancelled: "cancelled",
};

function pickTitle(m: MdManga, lang: string): string {
  const t = m.attributes.title;
  const alt = m.attributes.altTitles?.find((a) => a[lang])?.[lang];
  return t[lang] ?? alt ?? t.en ?? Object.values(t)[0] ?? m.attributes.altTitles?.find((a) => a.en)?.en ?? "Untitled";
}

function coverOf(m: MdManga): string | undefined {
  const rel = m.relationships.find((r) => r.type === "cover_art");
  const file = rel?.attributes?.fileName as string | undefined;
  return file ? `${COVERS}/${m.id}/${file}.512.jpg` : undefined;
}

function toManga(m: MdManga, lang: string): SManga {
  const names = (type: string) =>
    m.relationships
      .filter((r) => r.type === type)
      .map((r) => r.attributes?.name as string | undefined)
      .filter(Boolean)
      .join(", ") || undefined;
  return {
    url: m.id,
    title: pickTitle(m, lang),
    cover: coverOf(m),
    author: names("author"),
    artist: names("artist"),
    description: m.attributes.description?.[lang] ?? m.attributes.description?.en,
    genres: m.attributes.tags?.map((t) => t.attributes.name.en ?? "").filter(Boolean),
    status: STATUS[m.attributes.status ?? ""] ?? "unknown",
  };
}

const q = (params: [string, string | number][]) => params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");

export function createMangaDex(lang: string, label: string): Source {
  const id = `mangadex-${lang}`;

  async function list(page: number, extra: [string, string | number][]): Promise<MangasPage> {
    const offset = (page - 1) * PAGE_SIZE;
    const params: [string, string | number][] = [
      ["limit", PAGE_SIZE],
      ["offset", offset],
      ["includes[]", "cover_art"],
      ["includes[]", "author"],
      ["includes[]", "artist"],
      ["availableTranslatedLanguage[]", lang],
      ["hasAvailableChapters", "true"],
      ...extra,
    ];
    const res = await fetchJson<MdList<MdManga>>(`${API}/manga?${q(params)}`, { minGapMs: 220 });
    return { mangas: res.data.map((m) => toManga(m, lang)), hasNext: res.offset + res.limit < Math.min(res.total, 10000) };
  }

  const ratingParams = (selected: string[]): [string, string][] => (selected.length ? selected : ["safe", "suggestive"]).map((r) => ["contentRating[]", r]);

  const source: Source = {
    id,
    name: "MangaDex",
    lang,
    baseUrl: "https://mangadex.org",
    blurb: `Community-uploaded manga, ${label}`,
    tint: "#f26b3a",
    supportsLatest: true,
    imageReferer: "https://mangadex.org/",

    getPopular: (page) => list(page, [["order[followedCount]", "desc"], ...ratingParams([])]),
    getLatest: (page) => list(page, [["order[latestUploadedChapter]", "desc"], ...ratingParams([])]),

    async search(page, query, filters) {
      const params: [string, string | number][] = [];
      if (query.trim()) params.push(["title", query.trim()]);

      const sort = findFilter(filters, "sort", "sort");
      if (sort) params.push([`order[${selectedValue(sort)}]`, sort.state.ascending ? "asc" : "desc"]);
      else params.push(["order[relevance]", "desc"]);

      const ratings = included(findFilter(filters, "rating", "group"));
      params.push(...ratingParams(ratings));
      for (const s of included(findFilter(filters, "status", "group"))) params.push(["status[]", s]);
      for (const d of included(findFilter(filters, "demographic", "group"))) params.push(["publicationDemographic[]", d]);

      for (const g of flattenFilters(filters)) {
        if (g.type !== "group" || !g.key.startsWith("tag-")) continue;
        for (const t of included(g)) params.push(["includedTags[]", t]);
        for (const t of excluded(g)) params.push(["excludedTags[]", t]);
      }
      const mode = findFilter(filters, "tagMode", "select");
      if (mode && mode.state === 1) params.push(["includedTagsMode", "OR"]);

      return list(page, params);
    },

    getFilterList(): Filter[] {
      const tags = tagCache ?? [];
      const byGroup = (g: string) => tags.filter((t) => t.group === g).map((t) => F.tri(t.id, t.name));
      return [
        F.sort("sort", "Sort by", ["Relevance", "Follows", "Latest chapter", "Newest", "Rating", "Title", "Year"], ["relevance", "followedCount", "latestUploadedChapter", "createdAt", "rating", "title", "year"]),
        F.group("rating", "Content rating", [F.checkbox("safe", "Safe", true), F.checkbox("suggestive", "Suggestive", true), F.checkbox("erotica", "Erotica"), F.checkbox("pornographic", "Pornographic")]),
        F.group("status", "Status", [F.checkbox("ongoing", "Ongoing"), F.checkbox("completed", "Completed"), F.checkbox("hiatus", "Hiatus"), F.checkbox("cancelled", "Cancelled")]),
        F.group("demographic", "Demographic", [F.checkbox("shounen", "Shounen"), F.checkbox("shoujo", "Shoujo"), F.checkbox("seinen", "Seinen"), F.checkbox("josei", "Josei")]),
        F.select("tagMode", "Tag match", ["All selected", "Any selected"]),
        ...(tags.length
          ? [
              F.group("tag-genre", "Genres", byGroup("genre")),
              F.group("tag-theme", "Themes", byGroup("theme")),
              F.group("tag-format", "Formats", byGroup("format")),
              F.group("tag-content", "Content", byGroup("content")),
            ]
          : [F.header("tags-loading", "Tags are still loading, reopen filters in a moment")]),
      ];
    },

    async getMangaDetails(manga) {
      const res = await fetchJson<{ data: MdManga }>(`${API}/manga/${manga.url}?${q([["includes[]", "cover_art"], ["includes[]", "author"], ["includes[]", "artist"]])}`, { minGapMs: 220 });
      return toManga(res.data, lang);
    },

    async getChapterList(manga) {
      const out: SChapter[] = [];
      const limit = 500;
      for (let offset = 0; offset < 10000; offset += limit) {
        const params: [string, string | number][] = [
          ["limit", limit],
          ["offset", offset],
          ["translatedLanguage[]", lang],
          ["order[volume]", "desc"],
          ["order[chapter]", "desc"],
          ["includeExternalUrl", 0],
          ["includes[]", "scanlation_group"],
          ...ALL_RATINGS.map((r): [string, string] => ["contentRating[]", r]),
        ];
        const res = await fetchJson<
          MdList<{ id: string; attributes: { chapter?: string; volume?: string; title?: string; readableAt?: string; publishAt?: string; pages?: number }; relationships: Rel[] }>
        >(`${API}/manga/${manga.url}/feed?${q(params)}`, { minGapMs: 220 });
        for (const c of res.data) {
          if (c.attributes.pages === 0) continue;
          const { chapter, volume, title } = c.attributes;
          const group = c.relationships.filter((r) => r.type === "scanlation_group").map((r) => r.attributes?.name as string).filter(Boolean).join(", ");
          const name = [volume ? `Vol. ${volume}` : "", chapter ? `Ch. ${chapter}` : "", title ? `- ${title}` : ""].filter(Boolean).join(" ").trim() || "Oneshot";
          const parsed = chapter !== undefined ? Number.parseFloat(chapter) : NaN;
          out.push({
            url: c.id,
            name,
            number: Number.isFinite(parsed) ? parsed : undefined,
            dateUpload: Date.parse(c.attributes.readableAt ?? c.attributes.publishAt ?? "") || 0,
            scanlator: group || undefined,
          });
        }
        if (res.offset + res.limit >= res.total) break;
      }
      if (!out.length) {
        // Distinguish "nothing uploaded" from "only linked out to the publisher" (e.g. licensed titles)
        const ext = await fetchJson<MdList<{ attributes: { externalUrl?: string } }>>(
          `${API}/manga/${manga.url}/feed?${q([["limit", 1], ["translatedLanguage[]", lang], ["includeExternalUrl", 1], ...ALL_RATINGS.map((r): [string, string] => ["contentRating[]", r])])}`,
          { minGapMs: 220 },
        ).catch(() => null);
        const link = ext?.data[0]?.attributes.externalUrl;
        if (link) throw new Error(`The ${label} chapters of this title are hosted on ${new URL(link).host}, so they cannot be read inside Comik.`);
      }
      return out;
    },

    async getPageList(chapter) {
      const res = await fetchJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(`${API}/at-home/server/${chapter.url}`, { minGapMs: 1400 });
      return res.chapter.data.map<SPage>((f, index) => ({ index, url: `${res.baseUrl}/data/${res.chapter.hash}/${f}` }));
    },
  };
  return source;
}

/** Fetch the tag list once so the filter drawer can show genres. Safe to call repeatedly. */
export async function loadMangaDexTags(): Promise<void> {
  if (tagCache) return;
  const res = await fetchJson<{ data: { id: string; attributes: { name: Record<string, string>; group: string } }[] }>(`${API}/manga/tag`, { minGapMs: 220 });
  tagCache = res.data.map((t) => ({ id: t.id, name: t.attributes.name.en ?? "", group: t.attributes.group })).sort((a, b) => a.name.localeCompare(b.name));
}

