import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { app } from "./app";

const PORT = Number(process.env.PROXY_PORT ?? process.env.PORT ?? 8787);
const HOST = process.env.PROXY_HOST ?? "127.0.0.1";
const REMOTE_TOKEN = process.env.PROXY_AUTH_TOKEN ?? "";

function sameToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function startServer() {
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(HOST) && !REMOTE_TOKEN) {
    throw new Error("Set PROXY_AUTH_TOKEN before binding the proxy to a non-loopback address.");
  }
  if (process.env.NODE_ENV === "production") {
    app.use("/*", serveStatic({ root: "./dist" }));
    const indexHtml = await readFile("./dist/index.html", "utf8").catch(() => null);
    if (indexHtml) app.get("*", (c) => c.html(indexHtml));
  }

  serve({ fetch: async (request) => {
    if (REMOTE_TOKEN && request.method !== "OPTIONS") {
      const provided = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
      if (!sameToken(provided, REMOTE_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return app.fetch(request);
  }, port: PORT, hostname: HOST }, (info) => {
    console.log(`comik proxy listening on ${HOST}:${info.port}`);
  });
}

void startServer();
