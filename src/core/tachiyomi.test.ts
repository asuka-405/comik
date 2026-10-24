import { describe, expect, it } from "vitest";
import { gzipSync } from "fflate";
import { parseTachiyomiBackup, planImport, resolveSource } from "./tachiyomi";
import type { Source } from "./types";

/* A tiny protobuf writer, enough to build a backup the way Tachiyomi lays it out. */
const varint = (value: number | bigint): number[] => {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
};
const tag = (field: number, wire: number) => varint(field * 8 + wire);
const num = (field: number, value: number | bigint) => [...tag(field, 0), ...varint(value)];
const str = (field: number, value: string) => {
  const bytes = [...new TextEncoder().encode(value)];
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
};
const msg = (field: number, inner: number[]) => [...tag(field, 2), ...varint(inner.length), ...inner];
const float = (field: number, value: number) => [...tag(field, 5), ...new Uint8Array(new Float32Array([value]).buffer)];

const source = (id: string, name: string): Source => ({ id, name, lang: "en", baseUrl: "https://example.org", supportsLatest: true } as Source);

function sampleBackup(): Uint8Array {
  const chapter = (url: string, name: string, n: number, read: boolean) => msg(16, [...str(1, url), ...str(2, name), ...num(4, read ? 1 : 0), ...num(6, read ? 12 : 0), ...float(9, n), ...num(10, 0)]);
  const manga = msg(1, [
    ...num(1, 8513894820944573933n), ...str(2, "/manga/solo/"), ...str(3, "Solo"), ...str(5, "Chugong"), ...str(7, "Action"), ...str(7, "Fantasy"),
    ...num(8, 2), ...num(13, 1700000000000), ...chapter("/manga/solo/ch-2/", "Chapter 2", 2, false), ...chapter("/manga/solo/ch-1/", "Chapter 1", 1, true),
    ...msg(17, [...varint(5)]), ...num(100, 1), ...num(103, 2), ...msg(104, [...str(1, "/manga/solo/ch-1/"), ...num(2, 1700000005000)]),
  ]);
  const other = msg(1, [...num(1, -42n), ...str(2, "/x"), ...str(3, "Elsewhere"), ...num(100, 1)]);
  const browsed = msg(1, [...num(1, 8513894820944573933n), ...str(2, "/manga/seen/"), ...str(3, "Seen only"), ...num(100, 0)]);
  const category = msg(2, [...str(1, "Reading"), ...num(2, 0), ...num(3, 5)]);
  const names = [...msg(101, [...str(1, "Akaza Scans"), ...num(2, 8513894820944573933n)]), ...msg(101, [...str(1, "Gone Scans"), ...num(2, -42n)])];
  return gzipSync(new Uint8Array([...manga, ...other, ...browsed, ...category, ...names]));
}

describe("tachiyomi backup import", () => {
  it("decodes series, chapters, categories, history and signed source ids", () => {
    const backup = parseTachiyomiBackup(sampleBackup());
    expect(backup.manga).toHaveLength(3);
    const solo = backup.manga[0]!;
    expect(solo).toMatchObject({ source: "8513894820944573933", url: "/manga/solo/", title: "Solo", author: "Chugong", genres: ["Action", "Fantasy"], status: 2, favorite: true, viewer: 2, categories: ["5"] });
    expect(solo.chapters.map((c) => [c.url, c.read, c.chapterNumber, c.lastPageRead])).toEqual([["/manga/solo/ch-2/", false, 2, 0], ["/manga/solo/ch-1/", true, 1, 12]]);
    expect(solo.history.get("/manga/solo/ch-1/")).toBe(1700000005000);
    expect(backup.manga[1]!.source).toBe("-42");
    expect(backup.categories).toEqual([{ id: "5", name: "Reading", order: 0 }]);
    expect(backup.sourceNames.get("-42")).toBe("Gone Scans");
  });

  it("accepts a backup that is not compressed", () => {
    const raw = new Uint8Array([...msg(1, [...num(1, 7), ...str(2, "/a"), ...str(3, "A")])]);
    expect(parseTachiyomiBackup(raw).manga[0]!.title).toBe("A");
  });

  it("plans which series can be imported and reports the rest", () => {
    const backup = parseTachiyomiBackup(sampleBackup());
    const plan = planImport(backup, [source("mihon-8513894820944573933", "Akaza Scans")]);
    expect(plan.matched.map((m) => m.backup.title)).toEqual(["Solo"]);
    expect(plan.unmatched).toEqual([{ name: "Gone Scans", count: 1 }]);
    expect(plan.notInLibrary).toBe(1);
    expect(plan.chapters).toBe(2);
  });

  it("falls back to the source name and the official Webtoons site", () => {
    expect(resolveSource("1", "Cool  Scans", [source("custom-1", "Cool Scans")])?.id).toBe("custom-1");
    expect(resolveSource("2", "Webtoons.com", [source("webtoons-en", "Webtoon")])?.id).toBe("webtoons-en");
    expect(resolveSource("3", "Nope", [source("a", "A")])).toBeUndefined();
  });

  it("rejects files that are not backups", () => {
    expect(() => parseTachiyomiBackup(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => parseTachiyomiBackup(new Uint8Array())).toThrow(/does not look like/);
  });
});
