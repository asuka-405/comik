import type { ChapterRow, MangaRow } from "./types";

export interface TastePreferences {
  autoBuild: boolean;
  includeGenres: string[];
  avoidGenres: string[];
}

export interface CommunityProfile {
  username: string;
  displayName: string;
}

export interface GenrePreference { name: string; score: number }

/** Build a lightweight taste profile from shelf membership, reading volume, and recency. */
export function inferGenrePreferences(manga: MangaRow[], chapters: ChapterRow[], now = Date.now()): GenrePreference[] {
  const byManga = new Map<string, ChapterRow[]>();
  for (const chapter of chapters) {
    if (!chapter.readAt) continue;
    const rows = byManga.get(chapter.mangaId) ?? [];
    rows.push(chapter);
    byManga.set(chapter.mangaId, rows);
  }

  const scores = new Map<string, number>();
  for (const item of manga) {
    const read = byManga.get(item.id) ?? [];
    if (!item.inLibrary && !read.length) continue;
    const latestRead = Math.max(0, ...read.map((chapter) => chapter.readAt));
    const recency = latestRead ? Math.max(0, 1 - (now - latestRead) / (90 * 864e5)) : 0;
    const weight = (item.inLibrary ? 1 : 0) + Math.min(read.length, 8) * 0.2 + recency;
    for (const raw of item.genres) {
      const name = raw.trim();
      if (name) scores.set(name, (scores.get(name) ?? 0) + weight);
    }
  }
  return [...scores].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 20);
}

export const DEFAULT_TASTE_PREFERENCES: TastePreferences = { autoBuild: true, includeGenres: [], avoidGenres: [] };
export const DEFAULT_COMMUNITY_PROFILE: CommunityProfile = { username: "", displayName: "" };