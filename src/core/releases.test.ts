import { describe, expect, it } from "vitest";
import { classifyAsset, downloadsFor, formatBytes, parseReleases } from "./releases";
import { parseMarkdown } from "./markdown";

describe("releases", () => {
  it("classifies uploaded files by platform", () => {
    expect(classifyAsset("Comik-android.apk")).toBe("android");
    expect(classifyAsset("Comik-linux-x64.AppImage")).toBe("linux");
    expect(classifyAsset("Comik-windows-x64.zip")).toBe("windows");
    expect(classifyAsset("Comik-Setup.exe")).toBe("windows");
    expect(classifyAsset("SHA256SUMS.txt")).toBeUndefined();
  });

  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(14758608)).toBe("14.1 MB");
    expect(formatBytes(140218450)).toBe("134 MB");
  });

  it("skips drafts and reads the sha256 digest", () => {
    const releases = parseReleases([
      { tag_name: "v0.2.0", name: null, body: null, published_at: "2026-01-01T00:00:00Z", created_at: "", prerelease: false, draft: false, html_url: "u", assets: [{ name: "Comik-android.apk", size: 1, browser_download_url: "d", download_count: 3, digest: "sha256:abc" }] },
      { tag_name: "v0.3.0", draft: true, assets: [] },
    ]);
    expect(releases).toHaveLength(1);
    expect(releases[0].name).toBe("v0.2.0");
    const rows = downloadsFor(releases[0]);
    expect(rows.find((r) => r.info.platform === "android")?.asset?.sha256).toBe("abc");
    expect(rows.find((r) => r.info.platform === "linux")?.asset).toBeUndefined();
  });
});

describe("markdown", () => {
  it("parses headings, lists, paragraphs and inline marks", () => {
    const blocks = parseMarkdown("# New\n\nIntro **bold** and `code`.\n\n- one\n- [two](https://example.com)\n\n### Fixes\nline a\nline b");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "heading", "paragraph"]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[2]).toMatchObject({ items: [[{ type: "text", text: "one" }], [{ type: "link", href: "https://example.com" }]] });
    expect(blocks[4]).toMatchObject({ inline: [{ type: "text", text: "line a line b" }] });
  });

  it("does not turn non-http links into anchors", () => {
    const [block] = parseMarkdown("[x](javascript:alert(1))");
    expect(JSON.stringify(block)).not.toContain('"link"');
  });
});
