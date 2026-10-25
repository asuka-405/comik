import { describe, expect, it } from "vitest";
import { DOMParser } from "linkedom";

// The registry reads settings, which persist to localStorage; the node test environment has none.
const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
for (const [key, value] of Object.entries({ DOMParser, localStorage: storage, location: new URL("http://localhost/") })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const { DEFAULT_DISABLED_SOURCE_IDS } = await import("./settings");

describe("default disabled sources", () => {
  it("lists each source once", () => {
    expect(new Set(DEFAULT_DISABLED_SOURCE_IDS).size).toBe(DEFAULT_DISABLED_SOURCE_IDS.length);
  });

  it("names only sources that exist", async () => {
    const { allSources } = await import("./sources/registry");
    const known = new Set(allSources().map((s) => s.id));
    expect(DEFAULT_DISABLED_SOURCE_IDS.filter((id) => !known.has(id))).toEqual([]);
  });
});
