import type { SManga } from "../types";

export interface AniListMedia {
  id: number;
  title: { romaji?: string; english?: string; native?: string };
  description?: string | null;
  episodes?: number | null;
  nextAiringEpisode?: { episode: number } | null;
  status?: string;
  genres?: string[];
  coverImage?: { large?: string };
  externalLinks?: { site: string; url: string; type?: string }[];
}

export function mapAniListMedia(media: AniListMedia): SManga {
  const title = media.title.english || media.title.romaji || media.title.native || `Anime ${media.id}`;
  const aliases = [media.title.romaji, media.title.native, media.title.english].filter((value): value is string => !!value && value !== title);
  return {
    url: `/anime/${media.id}`,
    title,
    aliases,
    kind: "anime",
    externalUrl: `https://anilist.co/anime/${media.id}`,
    // A show that is still airing has no total yet; count the episodes already out.
    episodeCount: media.episodes ?? (media.nextAiringEpisode ? Math.max(0, media.nextAiringEpisode.episode - 1) : undefined),
    externalLinks: (media.externalLinks ?? []).filter((link) => link.type === "STREAMING" && /^https:\/\//i.test(link.url)).map(({ site, url }) => ({ site, url })),
    cover: media.coverImage?.large,
    description: media.description?.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").trim(),
    genres: media.genres ?? [],
    status: media.status === "FINISHED" ? "completed" : media.status === "RELEASING" ? "ongoing" : "unknown",
  };
}