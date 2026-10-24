import { fetchJson } from "../http";
import type { Filter, MangasPage, SChapter, SManga, SPage, Source } from "../types";
import { mapAniListMedia, type AniListMedia } from "./anilistMedia";

const API = "https://graphql.anilist.co/";
const MEDIA_FIELDS = `id
      title { romaji english native }
      description(asHtml: false)
      episodes
      nextAiringEpisode { episode }
      status
      genres
      coverImage { large }
      externalLinks { site url type }`;
const ANIME_QUERY = `query ($page: Int, $search: String, $sort: [MediaSort!]) {
  Page(page: $page, perPage: 24) {
    pageInfo { hasNextPage }
    media(type: ANIME, search: $search, sort: $sort, isAdult: false) {
      ${MEDIA_FIELDS}
    }
  }
}`;
const ANIME_DETAILS_QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`;

interface AniListResponse { data: { Page: { pageInfo: { hasNextPage: boolean }; media: AniListMedia[] } } }
export { mapAniListMedia } from "./anilistMedia";

/** AniList's GraphQL endpoint only answers POST. */
const graphql = <T>(query: string, variables: Record<string, unknown>) =>
  fetchJson<T>(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), referer: "https://anilist.co/", minGapMs: 500 });

export function createAniListAnimeSource(): Source {
  const list = async (page: number, search: string | undefined, sort: string): Promise<MangasPage> => {
    const response = await graphql<AniListResponse>(ANIME_QUERY, { page, search: search || null, sort: [sort] });
    return { mangas: response.data.Page.media.map(mapAniListMedia), hasNext: response.data.Page.pageInfo.hasNextPage };
  };
  const details = async (manga: SManga): Promise<SManga> => {
    const id = Number(manga.url.split("/").pop());
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid AniList anime id");
    const response = await graphql<{ data: { Media: AniListMedia } }>(ANIME_DETAILS_QUERY, { id });
    return mapAniListMedia(response.data.Media);
  };

  return {
    id: "anilist-anime",
    name: "AniList Anime",
    lang: "all",
    baseUrl: "https://anilist.co",
    blurb: "Anime catalogue and official streaming destinations",
    tint: "#2f79c7",
    supportsLatest: true,
    mediaType: "anime",
    directImages: true,
    getPopular: (page) => list(page, undefined, "TRENDING_DESC"),
    getLatest: (page) => list(page, undefined, "START_DATE_DESC"),
    search: (page, query) => list(page, query.trim() || undefined, "SEARCH_MATCH"),
    getFilterList: (): Filter[] => [],
    getMangaDetails: details,
    async getChapterList(manga): Promise<SChapter[]> {
      const anime = await details(manga);
      return Array.from({ length: Math.min(anime.episodeCount ?? 0, 500) }, (_, index) => ({
        url: `/anime/${manga.url.split("/").pop()}/episode/${index + 1}`,
        name: `Episode ${index + 1}`,
        number: index + 1,
        dateUpload: 0,
      }));
    },
    async getPageList(): Promise<SPage[]> { return []; },
  };
}