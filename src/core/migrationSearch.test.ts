import { describe, expect, it } from "vitest";
import { migrationMatchRank, migrationQueries } from "./migrationSearch";

describe("migration search names", () => {
  it("deduplicates aliases and recovers aliases from older descriptions", () => {
    expect(migrationQueries({
      title: "Café Story",
      aliases: ["Cafe Story", "別名"],
      description: "A note\nAlternative titles: Old Story, Other Name",
    })).toEqual(["Café Story", "別名", "Old Story", "Other Name"]);
  });

  it("ranks canonical and alternate exact titles above broad search matches", () => {
    const names = ["Main Title", "Alt Title"];
    expect(migrationMatchRank({ url: "/1", title: "Main Title" }, names, "Main Title")).toBe(0);
    expect(migrationMatchRank({ url: "/2", title: "Alt Title" }, names, "Alt Title")).toBe(1);
    expect(migrationMatchRank({ url: "/3", title: "Alt Title: Side Story" }, names, "Alt Title")).toBe(3);
  });
});