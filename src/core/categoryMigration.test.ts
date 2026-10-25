import { describe, expect, it } from "vitest";
import { splitLegacyCategories } from "./categoryMigration";
import type { CategoryRow, MangaRow } from "./types";

const category = (id: string): CategoryRow => ({ id, name: id, order: 0, modifiedAt: 1 });
const manga = (id: string, kind: MangaRow["kind"], categoryIds: string[]): MangaRow => ({
  id, sourceId: "source", url: id, title: id, kind, genres: [], status: "unknown", inLibrary: true,
  categoryIds, addedAt: 0, lastUpdateAt: 0, lastFetchedAt: 0, modifiedAt: 1,
});

describe("legacy category split", () => {
  it("preserves comic ids and clones categories for assigned novels and anime", () => {
    const result = splitLegacyCategories([category("reading")], [
      manga("comic", "comic", ["reading"]), manga("novel", "novel", ["reading"]), manga("anime", "anime", ["reading"]),
    ], 10);
    expect(result.categories.map((item) => [item.id, item.kind])).toEqual([
      ["reading", "comic"], ["reading::novel", "novel"], ["reading::anime", "anime"],
    ]);
    expect(result.manga.map((item) => item.categoryIds)).toEqual([["reading"], ["reading::novel"], ["reading::anime"]]);
  });
});