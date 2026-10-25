import { normalizeSearchText } from "./searchMatch";
import type { MangaRow, Source } from "./types";

export interface DiscoveredSourceEntry {
  source: Source;
  manga: MangaRow;
}

export interface DiscoveredWork {
  key: string;
  title: string;
  entries: DiscoveredSourceEntry[];
}

/** Group exact title/alias matches for display without merging source-specific records. */
export function groupDiscoveredWorks(entries: DiscoveredSourceEntry[]): DiscoveredWork[] {
  const groups: DiscoveredWork[] = [];
  const byName = new Map<string, DiscoveredWork>();

  for (const entry of entries) {
    const names = [entry.manga.title, ...(entry.manga.aliases ?? [])]
      .map(normalizeSearchText)
      .filter(Boolean);
    let group = names.map((name) => byName.get(name)).find((candidate) => candidate);
    if (!group) {
      group = { key: entry.manga.id, title: entry.manga.title, entries: [] };
      groups.push(group);
    }
    if (!group.entries.some((item) => item.manga.id === entry.manga.id)) group.entries.push(entry);
    for (const name of names) byName.set(name, group);
  }

  return groups.map((group) => ({
    ...group,
    entries: [...group.entries].sort((a, b) => a.source.name.localeCompare(b.source.name)),
  }));
}