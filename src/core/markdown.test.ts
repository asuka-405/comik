import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";

describe("fenced code", () => {
  it("keeps code verbatim, with its language and tag", () => {
    const blocks = parseMarkdown("Intro\n\n```js template\nconst a = 1;\n\n  // # not a heading\n```\n\n- after");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "code", "list"]);
    expect(blocks[1]).toEqual({ type: "code", lang: "js", meta: "template", text: "const a = 1;\n\n  // # not a heading" });
  });
  it("closes an unfinished fence at the end", () => {
    expect(parseMarkdown("```\nx")).toEqual([{ type: "code", lang: "", meta: "", text: "x" }]);
  });
});
