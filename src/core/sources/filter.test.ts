import { describe, expect, it } from "vitest";
import { filterSources } from "./filter";
import type { Source } from "../types";

const make = (name: string, baseUrl = `https://${name.toLowerCase().replace(/\W/g, "")}.com`) => ({ id: name, name, baseUrl, lang: "en" }) as Source;
const sources = [make("Asura Scans"), make("Aqua Manga"), make("Manga Katana"), make("Zinmanga.net"), make("Webtoon Scan")];

describe("source filter", () => {
  it("returns everything for an empty query", () => {
    expect(filterSources(sources, "  ")).toHaveLength(sources.length);
  });

  it("matches the name, never the site address", () => {
    // Every address contains "https" and ".com", so none of those may match.
    expect(filterSources(sources, "https")).toEqual([]);
    expect(filterSources(sources, "com")).toEqual([]);
  });

  it("ranks names that start with the query, then words, then anywhere", () => {
    expect(filterSources(sources, "man").map((s) => s.name)).toEqual(["Manga Katana", "Aqua Manga", "Zinmanga.net"]);
    expect(filterSources(sources, "scan").map((s) => s.name)).toEqual(["Asura Scans", "Webtoon Scan"]);
  });

  it("ignores case, spaces and punctuation", () => {
    expect(filterSources(sources, "MANGA KAT").map((s) => s.name)).toEqual(["Manga Katana"]);
    expect(filterSources(sources, "zin-manga").map((s) => s.name)).toEqual(["Zinmanga.net"]);
  });
});
