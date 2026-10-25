import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string };

/** Mirrors Netlify's rewrites: deep links under /web open the app, /releases and /docs open their pages. */
function routeFallback(request: { url?: string }, _response: unknown, next: () => void) {
  const [pathname, query] = (request.url ?? "").split("?", 2);
  if (pathname === "/releases") request.url = `/releases/index.html${query ? `?${query}` : ""}`;
  if (pathname === "/docs") request.url = `/docs/index.html${query ? `?${query}` : ""}`;
  if ((pathname === "/web" || pathname.startsWith("/web/")) && !/\.[^/]+$/.test(pathname)) {
    request.url = `/web/index.html${query ? `?${query}` : ""}`;
  }
  next();
}

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8787);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "comik-web-route-fallback",
      configureServer(server) {
        server.middlewares.use(routeFallback);
      },
      configurePreviewServer(server) {
        server.middlewares.use(routeFallback);
      },
    },
  ],
  base: process.env.COMIK_NATIVE_BUILD === "1" ? "./" : "/",
  define: {
    __COMIK_NATIVE_BUILD__: JSON.stringify(process.env.COMIK_NATIVE_BUILD === "1"),
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: { "/api": `http://localhost:${PROXY_PORT}` },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        landing: path.resolve(import.meta.dirname, "index.html"),
        web: path.resolve(import.meta.dirname, "web/index.html"),
        releases: path.resolve(import.meta.dirname, "releases/index.html"),
        docs: path.resolve(import.meta.dirname, "docs/index.html"),
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
