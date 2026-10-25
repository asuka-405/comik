import { describe, expect, it } from "vitest";
import { matchesSearch, searchSimilarity } from "./searchMatch";

describe("search matching", () => {
  it("normalizes accents and tolerates small title typos", () => {
    expect(searchSimilarity("Cafe Story", "Café Story")).toBe(1);
    expect(matchesSearch({ url: "/1", title: "Fullmetal Alchemist" }, "Fullmetal Alchemst", { tags: false, description: false })).toBe(true);
  });

  it("matches alternate titles by default and requires opt-in for metadata", () => {
    const manga = { url: "/1", title: "Main Title", aliases: ["Old Name"], genres: ["Fantasy"], description: "A quiet fantasy story" };
    expect(matchesSearch(manga, "Old Name", { tags: false, description: false })).toBe(true);
    expect(matchesSearch(manga, "Fantasy", { tags: false, description: false })).toBe(false);
    expect(matchesSearch(manga, "Fantasy", { tags: true, description: false })).toBe(true);
    expect(matchesSearch(manga, "quiet fantasy story dragon", { tags: false, description: true })).toBe(true);
  });

  it("rejects weakly similar titles", () => {
    expect(matchesSearch({ url: "/1", title: "The Moonlit Garden" }, "space battles", { tags: false, description: false })).toBe(false);
  });

  it("uses the configured tolerance and defaults to 0.75", () => {
    const title = { url: "/1", title: "Fullmetal Alchemist" };
    expect(matchesSearch(title, "Fullmetal Alchemst", { tags: false, description: false })).toBe(true);
    expect(matchesSearch(title, "Fullmetal Alchemst", { tags: false, description: false }, 0.95)).toBe(false);
    expect(matchesSearch(title, "Fullmetal Alchemst", { tags: false, description: false }, 0.6)).toBe(true);
  });
});