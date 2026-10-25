import { describe, expect, it } from "vitest";
import { inferGenrePreferences } from "./preferences";
import type { ChapterRow, MangaRow } from "./types";

const title = (id: string, inLibrary: boolean, genres: string[]): MangaRow => ({
  id, sourceId: "source", url: id, title: id, genres, status: "unknown", inLibrary, categoryIds: [],
  addedAt: 0, lastUpdateAt: 0, lastFetchedAt: 0, modifiedAt: 0,
});
const chapter = (id: string, mangaId: string, readAt: number): ChapterRow => ({
  id, mangaId, url: id, name: id, number: 1, dateUpload: 0, sourceOrder: 0, read: true,
  bookmark: false, lastPage: 0, pageCount: 1, readAt, fetchedAt: 0, modifiedAt: 0,
});

describe("inferred genre preferences", () => {
  it("weights library titles and recent reading activity", () => {
    const result = inferGenrePreferences([
      title("shelf", true, ["Fantasy"]),
      title("recent", false, ["Mystery"]),
    ], [chapter("recent-1", "recent", 99_000)], 100_000);
    expect(result[0]!.name).toBe("Mystery");
    expect(result.map((item) => item.name)).toContain("Fantasy");
  });

  it("ignores unused catalogue entries", () => {
    expect(inferGenrePreferences([title("browse", false, ["Comedy"])], [])).toEqual([]);
  });
});