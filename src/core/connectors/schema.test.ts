import { describe, expect, it } from "vitest";
import { checkUrl, hostAllowed, parseManifest, toSChapters, toSManga, toStreamSet } from "./schema";

const manifest = parseManifest({ id: "demo-site", name: "Demo", version: "1.0.0", apiVersion: 1, domains: ["api.example.com", "*.cdn.example.com"] });

describe("manifest", () => {
  it("accepts a well formed manifest and lower-cases domains", () => {
    expect(parseManifest({ id: "demo-site", name: "Demo", version: "1.2.3", apiVersion: 1, domains: ["API.Example.com"] }).domains).toEqual(["api.example.com"]);
  });
  it("rejects bad ids, versions, api versions and domains", () => {
    const base = { id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1, domains: ["a.example.com"] };
    expect(() => parseManifest({ ...base, id: "Bad Id" })).toThrow(/id/);
    expect(() => parseManifest({ ...base, version: "one" })).toThrow(/version/);
    expect(() => parseManifest({ ...base, apiVersion: 2 })).toThrow(/apiVersion/);
    expect(() => parseManifest({ ...base, domains: [] })).toThrow(/domains/);
    for (const bad of ["localhost", "10.0.0.1", "http://x.com", "*.com", "*", "a.example.com/path"]) expect(() => parseManifest({ ...base, domains: [bad] })).toThrow(/domain/);
  });
});

describe("allowlist", () => {
  it("matches exact hosts and wildcard subdomains only", () => {
    expect(hostAllowed("api.example.com", manifest.domains)).toBe(true);
    expect(hostAllowed("a.cdn.example.com", manifest.domains)).toBe(true);
    expect(hostAllowed("cdn.example.com", manifest.domains)).toBe(false);
    expect(hostAllowed("evil-api.example.com", manifest.domains)).toBe(false);
    expect(hostAllowed("api.example.com.evil.net", manifest.domains)).toBe(false);
  });
  it("requires https, no credentials and an allowed host", () => {
    expect(() => checkUrl("http://api.example.com/x", manifest.domains)).toThrow(/https/);
    expect(() => checkUrl("https://user:pw@api.example.com/x", manifest.domains)).toThrow(/user name/);
    expect(() => checkUrl("https://other.com/x", manifest.domains)).toThrow(/not in this connector/);
    expect(checkUrl("https://api.example.com/x", manifest.domains).hostname).toBe("api.example.com");
  });
});

describe("results", () => {
  it("maps a title and drops pictures off the allowlist", () => {
    const m = toSManga({ id: "7", title: "Show", cover: "https://api.example.com/c.jpg", banner: "https://evil.net/b.jpg", tags: ["Action", ""], status: "Airing", year: 2024, rating: 8.46, episodeCount: 12 }, manifest);
    expect(m).toMatchObject({ url: "7", title: "Show", kind: "anime", cover: "https://api.example.com/c.jpg", genres: ["Action"], status: "ongoing", year: 2024, rating: 8.5, episodeCount: 12 });
    expect(m.banner).toBeUndefined();
    expect(() => toSManga({ id: "7" }, manifest)).toThrow();
  });
  it("lists episodes newest first and keeps a season 2 that restarts at 1 from clashing", () => {
    const list = toSChapters([
      { id: "a1", number: 1, season: 1, title: "Start" }, { id: "a2", number: 2, season: 1 },
      { id: "b1", number: 1, season: 2 }, { id: "b2", number: 2, season: 2, airDate: "2024-05-01" },
    ], manifest);
    expect(list.map((c) => c.url)).toEqual(["b2", "b1", "a2", "a1"]);
    expect(list.map((c) => c.number)).toEqual([4, 3, 2, 1]);
    expect(list[0]!.name).toBe("S2 E2");
    expect(list[3]!.name).toBe("S1 E1: Start");
    expect(list[0]!.dateUpload).toBe(Date.parse("2024-05-01"));
  });
  it("keeps one season's own numbers and plain names", () => {
    const list = toSChapters([{ id: "x", number: 1 }, { id: "y", number: 2, duration: 1440 }], manifest);
    expect(list.map((c) => [c.number, c.name])).toEqual([[2, "Episode 2"], [1, "Episode 1"]]);
    expect(list[0]!.duration).toBe(1440);
  });
  it("accepts streams on allowed hosts only and refuses an empty set", () => {
    const set = toStreamSet({
      streams: [{ url: "https://a.cdn.example.com/v/index.m3u8", label: "1080p", proxy: true, headers: { Authorization: "Bearer x", Cookie: "no" } }, { url: "https://evil.net/v.mp4" }, { url: "http://api.example.com/v.mp4" }],
      subtitles: [{ url: "https://api.example.com/en.srt", lang: "EN", label: "English" }, { url: "https://evil.net/x.vtt", lang: "fr" }],
      skips: [{ kind: "intro", start: 10, end: 90 }, { kind: "intro", start: 90, end: 10 }, { kind: "other", start: 0, end: 5 }],
    }, manifest);
    expect(set.streams).toHaveLength(1);
    expect(set.streams[0]).toMatchObject({ type: "hls", proxy: true, label: "1080p", headers: { Authorization: "Bearer x" } });
    expect(set.subtitles).toEqual([expect.objectContaining({ lang: "en", format: "srt" })]);
    expect(set.skips).toEqual([{ kind: "intro", start: 10, end: 90 }]);
    expect(() => toStreamSet({ streams: [{ url: "https://evil.net/v.mp4" }] }, manifest)).toThrow(/no playable stream/);
  });
});
