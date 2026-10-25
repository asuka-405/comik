import { describe, expect, it } from "vitest";
import { groupDiscoveredWorks } from "./discover";
import type { MangaRow, Source } from "./types";

const source = (id: string, name: string) => ({ id, name } as Source);
const manga = (id: string, title: string, aliases?: string[]): MangaRow => ({
  id, sourceId: id.split("::")[0]!, url: id, title, aliases, genres: [], status: "unknown",
  inLibrary: false, categoryIds: [], addedAt: 0, lastUpdateAt: 0, lastFetchedAt: 0, modifiedAt: 0,
});

describe("Discover work grouping", () => {
  it("shows exact title and alternate-title matches as one work while keeping providers", () => {
    const groups = groupDiscoveredWorks([
      { source: source("one", "First"), manga: manga("one::/title", "The Long Journey", ["Journey North"]) },
      { source: source("two", "Second"), manga: manga("two::/story", "Journey North") },
      { source: source("three", "Third"), manga: manga("three::/other", "A Different Story") },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.entries.map((entry) => entry.source.name)).toEqual(["First", "Second"]);
    expect(groups[0]!.entries.map((entry) => entry.manga.id)).toEqual(["one::/title", "two::/story"]);
  });
});