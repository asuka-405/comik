import { describe, expect, it } from "vitest";
import { compareAppVersions, isSafeUpdatePath, validateUpdateManifest } from "./appUpdates";

describe("native app updates", () => {
  it("orders alpha versions before stable and compares numeric suffixes", () => {
    expect(compareAppVersions("0.4.0-alpha.2", "0.4.0-alpha.10")).toBeLessThan(0);
    expect(compareAppVersions("0.4.0-alpha", "0.4.0")).toBeLessThan(0);
    expect(compareAppVersions("0.4.1-alpha", "0.4.0")).toBeGreaterThan(0);
    expect(compareAppVersions("0.9.9-alpha", "0.4.0-alpha")).toBeGreaterThan(0);
    expect(compareAppVersions("1.0.0-alpha", "0.9.9-alpha")).toBeGreaterThan(0);
  });

  it("only permits app bundle paths and rejects traversal", () => {
    expect(isSafeUpdatePath("web/index.html")).toBe(true);
    expect(isSafeUpdatePath("releases/index.html")).toBe(true);
    expect(isSafeUpdatePath("assets/app.js")).toBe(true);
    expect(isSafeUpdatePath("../main.cjs")).toBe(false);
    expect(isSafeUpdatePath("web/../../main.cjs")).toBe(false);
    expect(isSafeUpdatePath("desktop/main.cjs")).toBe(false);
  });

  it("rejects duplicate, oversized, or unsafe manifest entries", () => {
    const valid = { schema: 1 as const, version: "0.4.0-alpha", archiveSha256: "a".repeat(64), files: [
      { path: "web/index.html", size: 10, sha256: "b".repeat(64) },
    ] };
    expect(validateUpdateManifest(valid, "0.4.0-alpha")).toBe(true);
    expect(validateUpdateManifest({ ...valid, files: [...valid.files, ...valid.files] }, valid.version)).toBe(false);
    expect(validateUpdateManifest({ ...valid, files: [{ ...valid.files[0]!, path: "../main.cjs" }] }, valid.version)).toBe(false);
    expect(validateUpdateManifest({ ...valid, files: [{ ...valid.files[0]!, size: Number.MAX_SAFE_INTEGER }] }, valid.version)).toBe(false);
  });
});