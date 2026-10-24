import { describe, expect, it } from "vitest";
import { compareAppVersions } from "./appUpdates";

describe("app version order", () => {
  it("orders pre-releases before their release and compares numeric suffixes", () => {
    expect(compareAppVersions("0.4.0-alpha.2", "0.4.0-alpha.10")).toBeLessThan(0);
    expect(compareAppVersions("0.4.0-alpha", "0.4.0")).toBeLessThan(0);
  });

  it("has no ceiling on minor or major versions", () => {
    expect(compareAppVersions("0.4.2-alpha", "0.4.0-alpha")).toBeGreaterThan(0);
    expect(compareAppVersions("0.9.9-alpha", "0.4.0-alpha")).toBeGreaterThan(0);
    expect(compareAppVersions("0.10.0-alpha", "0.9.9-alpha")).toBeGreaterThan(0);
    expect(compareAppVersions("1.0.0-alpha", "0.9.9-alpha")).toBeGreaterThan(0);
    expect(compareAppVersions("2.3.1", "1.99.99")).toBeGreaterThan(0);
  });
});
