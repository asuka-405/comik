import { describe, expect, it } from "vitest";
import { chaptersAround, nextUnreadChapters, readingOrder } from "./progress";
import type { ChapterRow } from "./types";

const chapter = (id: string, number: number, read = false, sourceOrder = 0): ChapterRow => ({
  id, mangaId: "series", url: id, name: id, number, scanlator: undefined, dateUpload: 0, sourceOrder,
  read, bookmark: false, lastPage: 0, pageCount: 0, readAt: 0, fetchedAt: 0, modifiedAt: 0,
});

describe("chapter range helpers", () => {
  const rows = [chapter("c3", 3), chapter("c1", 1, true), chapter("c2", 2), chapter("c4", 4)];

  it("returns chapters before and after the selected chapter in reading order", () => {
    expect(chaptersAround(rows, "c2")).toEqual({ before: [rows[1]], after: [rows[0], rows[3]] });
  });

  it("starts next downloads after the selected or latest read chapter and skips read chapters", () => {
    expect(nextUnreadChapters(rows, "c2", 10).map((item) => item.id)).toEqual(["c3", "c4"]);
    expect(nextUnreadChapters(rows, undefined, 10).map((item) => item.id)).toEqual(["c2", "c3", "c4"]);
  });

  it("uses source order for unknown chapter numbers", () => {
    expect(readingOrder([chapter("newer", -1, false, 0), chapter("older", -1, false, 4)]).map((item) => item.id)).toEqual(["older", "newer"]);
  });
});