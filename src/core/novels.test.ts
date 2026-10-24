import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseHTML } from "linkedom";
import { parseNovelFile } from "./novels";

const parseDocument = (markup: string) => parseHTML(markup).document as unknown as Document;

describe("novel import", () => {
  it("loads UTF-8 TXT content as one chapter", () => {
    expect(parseNovelFile("story.txt", strToU8("First paragraph\n\nSecond paragraph"))).toEqual([
      { title: "story", text: "First paragraph\n\nSecond paragraph" },
    ]);
  });

  it("follows EPUB spine order and extracts readable chapter text", () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="OPS/book.opf" /></rootfiles></container>'),
      "OPS/book.opf": strToU8('<package><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml" /><item id="two" href="two.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="two" /><itemref idref="one" /></spine></package>'),
      "OPS/one.xhtml": strToU8("<html><body><h1>First</h1><p>First chapter.</p></body></html>"),
      "OPS/two.xhtml": strToU8("<html><body><h1>Second</h1><p>Second chapter.</p></body></html>"),
    });
    expect(parseNovelFile("book.epub", bytes, parseDocument)).toEqual([
      { title: "Second", text: "Second\n\nSecond chapter." },
      { title: "First", text: "First\n\nFirst chapter." },
    ]);
  });
});