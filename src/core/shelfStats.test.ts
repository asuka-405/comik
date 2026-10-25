import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db";
import { flushShelfStats, markShelfStatsDirty, shelfStatsOf, startShelfStats } from "./shelfStats";
import type { ChapterRow } from "./types";

const chapter = (n: number, extra: Partial<ChapterRow> = {}): ChapterRow => ({
  id: `m1||c${n}`, mangaId: "m1", url: `c${n}`, name: `Chapter ${n}`, number: n, dateUpload: 0, sourceOrder: 100 - n,
  read: false, bookmark: false, lastPage: 0, pageCount: 0, readAt: 0, fetchedAt: 1, modifiedAt: 1, ...extra,
} as ChapterRow);

describe("shelf stats", () => {
  beforeAll(() => startShelfStats());

  it("counts unread and picks what Continue opens", () => {
    const row = shelfStatsOf("m1", [chapter(1, { read: true, readAt: 50 }), chapter(2), chapter(3)]);
    expect(row).toMatchObject({ mangaId: "m1", unread: 2, total: 3, lastReadAt: 50 });
    expect(row.resume).toMatchObject({ id: "m1||c2", started: true });
  });

  it("recomputes after chapters are added, changed and deleted (a title with none keeps a zero row)", async () => {
    await db.chapters.bulkPut([chapter(1), chapter(2)]);
    await flushShelfStats();
    expect((await db.shelfStats.get("m1"))?.unread).toBe(2);

    // A reader marking a chapter read goes through put on an existing row.
    await db.chapters.put(chapter(1, { read: true, readAt: 99 }));
    await flushShelfStats();
    expect(await db.shelfStats.get("m1")).toMatchObject({ unread: 1, lastReadAt: 99 });

    await db.chapters.bulkDelete(["m1||c1", "m1||c2"]);
    await flushShelfStats();
    expect(await db.shelfStats.get("m1")).toMatchObject({ total: 0, unread: 0 });
  });

  it("can be marked dirty by hand, as after a table is cleared", async () => {
    await db.chapters.bulkAdd([chapter(1)]);
    await db.shelfStats.clear();
    markShelfStatsDirty("m1");
    await flushShelfStats();
    expect((await db.shelfStats.get("m1"))?.total).toBe(1);
  });
});
