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

describe("tables", () => {
  const source = "Intro\n\n| Name | Value |\n|---|---|\n| `a` | **b** |\n| c | d |\n\nAfter";

  it("parses a table when asked", () => {
    const blocks = parseMarkdown(source, { tables: true });
    const table = blocks.find((b) => b.type === "table");
    expect(table).toMatchObject({ type: "table" });
    if (table?.type === "table") {
      expect(table.head).toHaveLength(2);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]![0]).toEqual([{ type: "code", text: "a" }]);
    }
    expect(blocks.at(-1)).toMatchObject({ type: "paragraph" });
  });

  it("leaves tables as plain text by default", () => {
    expect(parseMarkdown(source).some((b) => b.type === "table")).toBe(false);
  });
});
