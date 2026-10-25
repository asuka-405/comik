import { describe, expect, it } from "vitest";
import { checkManifest, checkResult, explainFault, lintCode } from "./diagnose";
import { parseManifest } from "./schema";

const manifest = parseManifest({ id: "demo-site", name: "Demo", version: "1.0.0", apiVersion: 1, domains: ["api.example.com", "*.cdn.example.com"], icon: "https://api.example.com/i.png" });
const good = `module.exports = {
  manifest: { id: "demo-site", name: "Demo", version: "1.0.0", apiVersion: 1, domains: ["api.example.com"] },
  async search(query, page, filters, ctx) { return { items: [], hasNext: false }; },
  async details(id, ctx) { return { id, title: "x" }; },
  async episodes(id, ctx) { return []; },
  async streams(episodeId, info, ctx) { return { streams: [] }; },
};`;

describe("lintCode", () => {
  it("accepts a well formed connector", async () => {
    expect((await lintCode(good)).filter((i) => i.severity === "error")).toEqual([]);
  });
  it("points at the line and column of a syntax error, with the code around it", async () => {
    const code = good.replace("async details(id, ctx) {", "async details(id, ctx) {\n    const x = ;");
    const [issue] = await lintCode(code);
    expect(issue).toMatchObject({ severity: "error", line: 5, column: 15 });
    expect(issue!.snippet!.find((l) => l.mark)!.n).toBe(5);
  });
  it("names the bracket that is never closed", async () => {
    const [issue] = await lintCode("module.exports = {\n  manifest: {\n    id: 'a',\n");
    expect(issue!.title).toMatch(/opened on line 2 is never closed/);
    expect(issue!.line).toBe(2);
  });
  it("explains a broken optional chain", async () => {
    const [issue] = await lintCode('module.exports = {\n  async details(id, ctx) {\n    return { id, title: doc.querySelector("h1")?textContent };\n  },\n};');
    expect(issue!.severity).toBe("error");
    expect(issue!.fix).toMatch(/\?\./);
  });
  it("finds list methods called on a NodeList", async () => {
    const issues = await lintCode(`${good}\nconst rows = doc.querySelectorAll(".a").filter((x) => x);`);
    expect(issues.find((i) => /querySelectorAll/.test(i.title))).toMatchObject({ severity: "error", line: 8 });
  });
  it("flags requests that are never awaited, blocked globals and http addresses", async () => {
    const issues = await lintCode(`${good}\nconst a = ctx.http.get("https://api.example.com/x").text;\nfetch("http://api.example.com/y");`);
    const titles = issues.map((i) => i.title).join("|");
    expect(titles).toMatch(/used before it finishes/);
    expect(titles).toMatch(/fetch is not available/);
    expect(titles).toMatch(/uses http/);
  });
  it("recognises JSON, HTML and missing exports", async () => {
    expect((await lintCode('{"id": "a"}'))[0]!.title).toMatch(/JSON data/);
    expect((await lintCode("<!doctype html><html></html>"))[0]!.title).toMatch(/web page/);
    expect((await lintCode("const a = 1;")).map((i) => i.title)).toContain("Nothing is exported");
  });
  it("accepts export default", async () => {
    expect((await lintCode(good.replace("module.exports =", "export default"))).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("explainFault", () => {
  it("tells which host to add to the domains", () => {
    const issue = explainFault({ message: "cdn.other.net is not in this connector's domains. Add it to manifest.domains if the operator permits it.", phase: "call", method: "streams" });
    expect(issue.title).toMatch(/cdn\.other\.net is not in manifest\.domains/);
    expect(issue.where).toBe("streams()");
  });
  it("explains a null selector with the line it happened on", () => {
    const code = 'a\nb\nconst t = doc.querySelector(".x").textContent;\nc';
    const issue = explainFault({ message: "Cannot read properties of null (reading 'textContent')", phase: "call", method: "details", line: 3, column: 38 }, code);
    expect(issue.title).toMatch(/textContent of null/);
    expect(issue.fix).toMatch(/selector/);
    expect(issue.snippet!.find((l) => l.mark)!.text).toMatch(/querySelector/);
  });
  it("covers HTTP status, JSON from HTML, ctx in helpers and the 60 request limit", () => {
    expect(explainFault({ message: "api.example.com answered HTTP 403.", phase: "call" }).title).toMatch(/403/);
    expect(explainFault({ message: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, phase: "call" }).title).toMatch(/web page/);
    expect(explainFault({ message: "ctx is not defined", phase: "call" }).title).toMatch(/ctx/);
    expect(explainFault({ message: "A single call may make at most 60 requests.", phase: "call" }).title).toMatch(/Too many/);
    expect(explainFault({ message: "manifest.domains must list every host the connector contacts.", phase: "manifest" }).example).toMatch(/domains/);
  });
});

describe("checkResult", () => {
  it("names each value Comik drops", () => {
    const issues = checkResult("search", { items: [{ id: "1", title: "A", cover: "/rel.jpg", banner: "https://evil.net/b.jpg" }, { title: "no id" }], hasNext: "yes" }, manifest);
    const text = issues.map((i) => `${i.where}: ${i.title}`).join("\n");
    expect(text).toMatch(/items\[0\]\.cover: cover was dropped/);
    expect(text).toMatch(/items\[0\]\.banner: banner was dropped/);
    expect(text).toMatch(/items\[1\]\.id: id is missing/);
    expect(text).toMatch(/hasNext should be true or false/);
  });
  it("says when a list is returned instead of { items }", () => {
    expect(checkResult("popular", [{ id: "1", title: "A" }], manifest)[0]).toMatchObject({ severity: "error", title: expect.stringMatching(/not \{ items, hasNext \}/) });
  });
  it("checks episodes for ids, numbers and repeats", () => {
    const issues = checkResult("episodes", [{ id: "a", number: "x" }, { number: 2 }, { id: "c", number: 3 }, { id: "d", number: 3 }], manifest);
    const text = issues.map((i) => i.title).join("|");
    expect(text).toMatch(/number is missing or not a number/);
    expect(text).toMatch(/id is missing/);
    expect(text).toMatch(/numbers repeat|number.* repeat/);
  });
  it("checks streams for dropped urls and an empty list", () => {
    expect(checkResult("streams", { streams: [] }, manifest)[0]!.title).toMatch(/no streams/i);
    const issues = checkResult("streams", { streams: [{ url: "https://evil.net/a.m3u8" }], subtitles: [{ url: "https://evil.net/s.vtt" }], skips: [{ kind: "intro", start: 9, end: 2 }] }, manifest);
    expect(issues.map((i) => i.title).join("|")).toMatch(/stream was dropped/);
    expect(issues.map((i) => i.title).join("|")).toMatch(/subtitle was dropped/);
    expect(issues.map((i) => i.title).join("|")).toMatch(/skip range was dropped/);
  });
});

describe("manifest icon", () => {
  it("keeps an icon on an allowed host or inline, and reports one that would be dropped", () => {
    expect(manifest.icon).toBe("https://api.example.com/i.png");
    expect(parseManifest({ id: "demo-site", name: "D", version: "1.0.0", apiVersion: 1, domains: ["a.example.com"], icon: "data:image/svg+xml;utf8,%3Csvg%2F%3E" }).icon).toMatch(/^data:image\/svg/);
    const raw = { id: "demo-site", name: "D", version: "1.0.0", apiVersion: 1, domains: ["a.example.com"], icon: "https://evil.net/x.png" };
    const m = parseManifest(raw);
    expect(m.icon).toBeUndefined();
    expect(checkManifest(raw, m).find((i) => i.where === "manifest.icon")).toMatchObject({ severity: "warning", title: "icon was dropped" });
  });
  it("accepts numeric ids and numeric strings", async () => {
    const { toSChapters, toSManga } = await import("./schema");
    expect(toSManga({ id: 42, title: "A", rating: "8.5" }, manifest)).toMatchObject({ url: "42", rating: 8.5 });
    expect(toSChapters([{ id: 7, number: "3" }], manifest)[0]).toMatchObject({ url: "7", number: 3 });
  });
});
