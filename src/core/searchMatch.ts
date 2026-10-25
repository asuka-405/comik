import type { SManga } from "./types";

export interface SearchFields {
  tags: boolean;
  description: boolean;
}

export const DEFAULT_SEARCH_TOLERANCE = 0.75;

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function searchSimilarity(query: string, candidate: string): number {
  const left = normalizeSearchText(query).replace(/\s+/g, "");
  const right = normalizeSearchText(candidate).replace(/\s+/g, "");
  if (!left || !right) return 0;
  if (left === right || (left.length >= 3 && right.includes(left))) return 1;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

export function matchesSearch(manga: SManga, query: string, fields: SearchFields, tolerance = DEFAULT_SEARCH_TOLERANCE): boolean {
  const titles = [manga.title, ...(manga.aliases ?? [])];
  if (titles.some((candidate) => searchSimilarity(query, candidate) >= tolerance)) return true;
  if (fields.tags && manga.genres?.some((candidate) => searchSimilarity(query, candidate) >= tolerance)) return true;
  if (!fields.description || !manga.description) return false;

  const normalizedQuery = normalizeSearchText(query);
  const normalizedDescription = normalizeSearchText(manga.description);
  if (normalizedDescription.includes(normalizedQuery)) return true;
  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((term) => term.length > 1))];
  if (!terms.length) return false;
  const matches = terms.filter((term) => normalizedDescription.includes(term)).length;
  return matches / terms.length >= tolerance;
}