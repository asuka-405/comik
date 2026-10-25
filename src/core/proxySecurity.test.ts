import { describe, expect, it } from "vitest";
import { app, isPrivateAddress } from "../../server/app";

describe("proxy network guards", () => {
  it("blocks loopback, link-local, and special-use addresses", async () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("198.19.1.2")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);

    const response = await app.request("/api/fetch?url=http%3A%2F%2F127.0.0.1%2F");
    expect(response.status).toBe(403);
  });

  it("rejects oversized caller bodies before forwarding them", async () => {
    const response = await app.request("/api/fetch?url=https%3A%2F%2Fexample.com%2F", {
      method: "POST",
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      body: "x",
    });
    expect(response.status).toBe(413);
  });
});