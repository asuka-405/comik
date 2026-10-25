import type { MangaRow, SManga } from "./types";
import { normalizeSearchText, searchSimilarity } from "./searchMatch";

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

function descriptionSimilarity(expected: string, actual: string): number {
  const expectedWords = new Set(normalizeSearchText(expected).split(/\s+/).filter((word) => word.length > 2));
  const actualWords = new Set(normalizeSearchText(actual).split(/\s+/).filter((word) => word.length > 2));
  if (!expectedWords.size || !actualWords.size) return 0;
  let overlap = 0;
  for (const word of expectedWords) if (actualWords.has(word)) overlap++;
  return overlap / Math.max(expectedWords.size, actualWords.size);
}

export function migrationMatchRank(candidate: SManga, expectedNames: string[], query: string, expectedDescription = "", tolerance = 0.75): number {
  const actual = [candidate.title, ...(candidate.aliases ?? [])].map(normalizeTitle).filter(Boolean);
  const expected = expectedNames.map(normalizeTitle).filter(Boolean);
  if (actual.some((name) => name === expected[0])) return 0;
  if (actual.some((name) => expected.slice(1).includes(name))) return 1;
  const searched = normalizeTitle(query);
  if (actual.some((name) => name === searched)) return 2;
  if (actual.some((name) => name.startsWith(searched) || searched.startsWith(name))) return 3;
  const canonicalSimilarity = searchSimilarity(expectedNames[0] ?? query, candidate.title);
  if (canonicalSimilarity >= tolerance) return 4 + (1 - canonicalSimilarity);
  const aliasSimilarity = Math.max(0, ...(candidate.aliases ?? []).map((alias) => Math.max(...expectedNames.map((name) => searchSimilarity(name, alias)))));
  if (aliasSimilarity >= tolerance) return 5 + (1 - aliasSimilarity);
  const descriptionScore = descriptionSimilarity(expectedDescription, candidate.description ?? "");
  if (descriptionScore >= 0.35) return 6 + (1 - descriptionScore);
  return 8;
}