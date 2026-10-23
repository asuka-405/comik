import { describe, expect, it } from "vitest";
import { backfillNumbers, missingBetween, recognizeChapterNumber as r } from "./chapterRecognition";

describe("recognizeChapterNumber", () => {
  it("reads explicit markers", () => {
    expect(r("Chapter 12")).toBe(12);
    expect(r("Ch.15.5 - Title")).toBe(15.5);
    expect(r("Episode 105 (END)")).toBe(105);
    expect(r("#7")).toBe(7);
  });
  it("ignores volume and season numbers", () => {
    expect(r("Vol.2 Ch.15")).toBe(15);
    expect(r("Season 3 Episode 4")).toBe(4);
  });
  it("strips the series title", () => {
    expect(r("Re:Zero 2 Chapter 9", "Re:Zero 2")).toBe(9);
    expect(r("2.5 Dimensional Seduction 33", "2.5 Dimensional Seduction")).toBe(33);
  });
  it("maps letter suffixes to decimals", () => {
    expect(r("Chapter 12a")).toBeCloseTo(12.1);
    expect(r("Chapter 12b")).toBeCloseTo(12.2);
  });
  it("handles bare numbers", () => {
    expect(r("12 - The Return")).toBe(12);
    expect(r("The Return 44")).toBe(44);
  });
  it("prefers a source-provided number", () => {
    expect(r("whatever", "x", 8)).toBe(8);
  });
  it("returns -1 when nothing is found", () => {
    expect(r("Prologue")).toBe(-1);
  });
});

describe("backfillNumbers", () => {
  it("fills unknowns from neighbours", () => {
    expect(backfillNumbers([3, -1, 1])[1]).toBeGreaterThan(1);
    expect(backfillNumbers([3, -1, 1])[1]).toBeLessThan(3);
  });
});

describe("missingBetween", () => {
  it("counts whole chapters skipped", () => {
    expect(missingBetween(3, 6)).toBe(2);
    expect(missingBetween(3, 4)).toBe(0);
    expect(missingBetween(3.5, 4)).toBe(0);
  });
});
