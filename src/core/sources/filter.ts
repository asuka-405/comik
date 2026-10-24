import type { Source } from "../types";

/** Match on the source name only. A site address such as "https://" must never match a filter. */
export function filterSources(sources: Source[], query: string): Source[] {
  const key = query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!key) return sources;
  const rank = (source: Source) => {
    const name = source.name.toLowerCase();
    const flat = name.replace(/[^\p{L}\p{N}]+/gu, "");
    if (flat.startsWith(key)) return 0;
    if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(key))) return 1;
    return flat.includes(key) ? 2 : 3;
  };
  return sources
    .map((source) => ({ source, rank: rank(source) }))
    .filter((entry) => entry.rank < 3)
    .sort((a, b) => a.rank - b.rank || a.source.name.localeCompare(b.source.name))
    .map((entry) => entry.source);
}
