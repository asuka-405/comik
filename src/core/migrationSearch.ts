import type { MangaRow, SManga } from "./types";

type MangaNames = Pick<MangaRow, "title" | "aliases" | "description">;

export function normalizeTitle(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function migrationQueries(manga: MangaNames): string[] {
  const legacy = [...(manga.description?.matchAll(/(?:alternative titles|alternative names|aliases)\s*:\s*([^\n]+)/gi) ?? [])]
    .flatMap((match) => match[1]!.split(/[,;|]/));
  const names = [manga.title, ...(manga.aliases ?? []), ...legacy].map((name) => name.trim()).filter(Boolean);
  const seen = new Set<string>();
  return names.filter((name) => {
    const normalized = normalizeTitle(name);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function migrationMatchRank(candidate: SManga, expectedNames: string[], query: string): number {
  const actual = [candidate.title, ...(candidate.aliases ?? [])].map(normalizeTitle).filter(Boolean);
  const expected = expectedNames.map(normalizeTitle).filter(Boolean);
  if (actual.some((name) => name === expected[0])) return 0;
  if (actual.some((name) => expected.slice(1).includes(name))) return 1;
  const searched = normalizeTitle(query);
  if (actual.some((name) => name === searched)) return 2;
  if (actual.some((name) => name.startsWith(searched) || searched.startsWith(name))) return 3;
  return 4;
}