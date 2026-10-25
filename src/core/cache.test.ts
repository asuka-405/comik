import { describe, expect, it, vi } from "vitest";
import { cached } from "./cache";

describe("cached", () => {
  it("serves a fresh answer without asking again, and asks again when forced or expired", async () => {
    const load = vi.fn(async () => ({ n: Math.random() }));
    const first = await cached("t:fresh", 60_000, load);
    expect(await cached("t:fresh", 60_000, load)).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    const forced = await cached("t:fresh", 60_000, load, { force: true });
    expect(forced).not.toBe(first);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cached("t:fresh", 0, load)).not.toBe(forced);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("asks once for simultaneous requests", async () => {
    const load = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve("x"), 10)));
    const [a, b] = await Promise.all([cached("t:same", 60_000, load), cached("t:same", 60_000, load)]);
    expect([a, b]).toEqual(["x", "x"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not store failures, and can fall back to an older answer", async () => {
    await expect(cached("t:fail", 60_000, async () => { throw new Error("down"); })).rejects.toThrow("down");
    expect(await cached("t:fail", 60_000, async () => "ok")).toBe("ok");
    await expect(cached("t:fail", 60_000, async () => { throw new Error("down"); }, { force: true })).rejects.toThrow("down");
    expect(await cached("t:fail", 0, async () => { throw new Error("down"); }, { staleOnError: true })).toBe("ok");
  });
});
