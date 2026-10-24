import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFile } from "node:fs/promises";
import { app } from "./app";

const PORT = Number(process.env.PROXY_PORT ?? process.env.PORT ?? 8787);

async function startServer() {
  if (process.env.NODE_ENV === "production") {
    app.use("/*", serveStatic({ root: "./dist" }));
    const indexHtml = await readFile("./dist/index.html", "utf8").catch(() => null);
    if (indexHtml) app.get("*", (c) => c.html(indexHtml));
  }

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`comik proxy listening on :${info.port}`);
  });
}

void startServer();
