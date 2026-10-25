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

  it("uses description similarity only after title matches", () => {
    const description = "A student discovers a hidden kingdom and becomes its reluctant ruler.";
    const titleMatch = { url: "/1", title: "Main Title", description: "A different premise." };
    const descriptionMatch = { url: "/2", title: "Unrelated Name", description: "A student discovers a hidden kingdom and becomes its ruler." };
    expect(migrationMatchRank(titleMatch, ["Main Title"], "Main Title", description)).toBe(0);
    expect(migrationMatchRank(descriptionMatch, ["Main Title"], "Main Title", description)).toBeLessThan(8);
  });

  it("respects the configured fuzzy-title tolerance", () => {
    const candidate = { url: "/1", title: "Fullmetal Alchemist" };
    expect(migrationMatchRank(candidate, ["Fullmetal Alchemist"], "Fullmetal Alchemist", "", 0.95)).toBe(0);
    expect(migrationMatchRank({ url: "/2", title: "Fullmetal Alchemst" }, ["Fullmetal Alchemist"], "Fullmetal Alchemist", "", 0.95)).toBe(8);
  });
});