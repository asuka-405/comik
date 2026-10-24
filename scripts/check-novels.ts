/**
 * Health check for the web-novel sites: list, search, open a novel, read its chapters and one chapter's text.
 *
 *   PROXY_PORT=8799 npx tsx server/index.ts &
 *   PROXY=http://localhost:8799 npx tsx scripts/check-novels.ts [name-filter]
 */
import { DOMParser } from "linkedom";

const store = new Map<string, string>();
const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
for (const [key, value] of Object.entries({ DOMParser, localStorage: storage, sessionStorage: storage, location: new URL("http://localhost/") })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

/**
 * VIA=curl sends the requests through curl instead of the local proxy. Some Cloudflare-protected sites turn
 * the proxy's Node client away but let curl through, so this checks the selectors for them. The apps pass the
 * same check in a real browser engine.
 */
if (process.env.VIA === "curl") {
  const { spawnSync } = await import("node:child_process");
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.searchParams.get("url");
    if (!target || !url.pathname.endsWith("/fetch")) return real(input, init);
    const extra = JSON.parse((init?.headers as Record<string, string> | undefined)?.["x-comik-headers"] ?? "{}") as Record<string, string>;
    const args = ["-sL", "--compressed", "-m", "40", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "-w", "\n%{http_code}"];
    const ref = url.searchParams.get("ref");
    if (ref) args.push("-e", ref);
    for (const [key, value] of Object.entries(extra)) args.push("-H", `${key}: ${value}`);
    if (init?.method === "POST" && init.body) args.push("-X", "POST", "-d", String(init.body));
    const out = spawnSync("curl", [...args, target], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout;
    const cut = out.lastIndexOf("\n");
    const status = Number(out.slice(cut + 1)) || 502;
    const body = out.slice(0, cut);
    const headers = new Headers();
    if (/Just a moment|id="challenge-form"/.test(body.slice(0, 4000))) headers.set("x-comik-challenge", "cloudflare");
    return new Response(body, { status, headers });
  }) as typeof fetch;
}

const filter = process.argv[2]?.toLowerCase();
const { useSettings } = await import("../src/core/settings");
useSettings.getState().set({ proxyUrl: process.env.PROXY ?? "http://localhost:8799" });
const { createNovelSites } = await import("../src/core/sources/novelSites");

for (const source of createNovelSites().filter((s) => !filter || s.id.includes(filter))) {
  const started = Date.now();
  const say = (stage: string, detail: string) => console.log(`${source.id.padEnd(14)} ${stage.padEnd(9)} ${detail}`);
  try {
    const popular = await source.getPopular(1);
    say("popular", `${popular.mangas.length} novels, next=${popular.hasNext}, first "${popular.mangas[0]?.title}" cover=${!!popular.mangas[0]?.cover}`);
    const latest = await source.getLatest(1);
    say("latest", `${latest.mangas.length} novels`);
    const word = (popular.mangas[0]?.title ?? "sword").split(" ")[0]!;
    const found = await source.search(1, word, source.getFilterList());
    say("search", `"${word}" → ${found.mangas.length}`);
    const novel = popular.mangas[0]!;
    const details = await source.getMangaDetails(novel);
    say("details", `author="${details.author}" desc=${(details.description ?? "").length} chars genres=${details.genres?.length ?? 0} cover=${!!details.cover}`);
    const chapters = await source.getChapterList(novel);
    say("chapters", `${chapters.length}, newest "${chapters[0]?.name}" (${chapters[0]?.url}), oldest "${chapters[chapters.length - 1]?.name}"`);
    const chapter = chapters[chapters.length - 1]!;
    const body = await source.getNovelText!(chapter, novel);
    say("text", `${body.length} chars: ${body.slice(0, 90).replace(/\n+/g, " ")}`);
    say("ok", `${Math.round((Date.now() - started) / 1000)}s`);
  } catch (error) {
    say("FAIL", (error as Error).message.slice(0, 220));
  }
}
