/**
 * Builds src/core/sources/catalog.json from the Mihon/Tachiyomi extension index (keiyoushi).
 *
 * The index only lists names and site URLs, not scraping logic. So we probe each English,
 * non-adult site, detect which shared theme it runs (Madara or MangaThemesia), and keep it only if
 * its listing page parses into real series cards with the same selectors the runtime engines use.
 *
 *   npx tsx scripts/build-catalog.ts [--refresh]
 */
import { parseHTML } from "linkedom";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MADARA_CARD, MADARA_SUBS, THEMESIA_CARD, THEMESIA_PATHS, detectEngine } from "../src/core/sources/engines";
import { extractChapters, extractPageImages, extractSeries } from "../src/core/sources/heuristics";

const INDEX_URL = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json";
const CACHE = process.env.INDEX_CACHE ?? "/tmp/comik-extension-index.json";
const OUT = new URL("../src/core/sources/catalog.json", import.meta.url).pathname;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface Ext { packageName: string; contentWarning?: string; sources: { id: string; name: string; language: string; homeUrl: string }[] }
import type { CatalogEntry } from "../src/core/sources/catalogTypes";

const MIN_MS = Number(process.env.GET_MS ?? 0);
async function get(url: string, requested = 12000): Promise<{ html: string; url: string } | null> {
  const ms = Math.max(requested, MIN_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: AbortSignal.timeout(ms), redirect: "follow" });
    if (!res.ok) return null;
    return { html: await res.text(), url: res.url };
  } catch {
    return null;
  }
}

const cards = (html: string, selector: string) => parseHTML(html).document.querySelectorAll(selector).length;

export const reasons: Record<string, string[]> = {};
const why = (r: string, name: string) => ((reasons[r] ??= []).push(name), null);

const MIN_SERIES = Number(process.env.MIN_SERIES ?? 6);
const MIN_PAGES = Number(process.env.MIN_PAGES ?? 3);
const LIST_PATHS = ["series", "manga", "comics", "comic", "browse", "webtoon", "manhwa", "library", "directory", "manga-list", "all", "latest", "popular", "list", "directory/all", ""];
const SEARCH_TPLS = ["/search?q={query}", "/?s={query}", "/search?keyword={query}", "/search?title={query}", "/search/{query}", "/search?search={query}"];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Verify a site end to end with the structure-based engine: listing, a series' chapters, a chapter's pages. */
async function probeHeuristic(name: string, id: string, origin: string): Promise<CatalogEntry | null> {
  for (const p of LIST_PATHS) {
    const path = p ? `/${p}` : "";
    const first = await get(`${origin}${path}${p ? "?page=1" : ""}`, 10000);
    if (!first) continue;
    const series = extractSeries(parseHTML(first.html).document as unknown as Document, first.url);
    if (series.length < MIN_SERIES) continue;
    // reading must work, not just listing: need chapters and pages for at least one of the first series
    let readable = false;
    for (const s of series.slice(0, 3)) {
      const d = await get(origin + s.path, 10000);
      if (!d) continue;
      const chapters = extractChapters(parseHTML(d.html).document as unknown as Document, d.url);
      for (const c of chapters.slice(0, 2)) {
        const r = await get(origin + c.path, 10000);
        if (r && extractPageImages(parseHTML(r.html).document as unknown as Document, r.url, MIN_PAGES).length >= MIN_PAGES) { readable = true; break; }
      }
      if (readable) break;
    }
    if (!readable) return null;
    // pagination: does page 2 differ?
    let paged = false;
    if (p) {
      const second = await get(`${origin}${path}?page=2`, 10000);
      if (second) paged = !sameList(series.map((x) => x.path), extractSeries(parseHTML(second.html).document as unknown as Document, second.url).map((x) => x.path));
    }
    const word = series[0]!.title.split(" ").find((w) => w.length > 3) ?? series[0]!.title;
    let searchUrl: string | undefined;
    for (const tpl of SEARCH_TPLS) {
      const r = await get(origin + tpl.replace("{query}", encodeURIComponent(word)), 10000);
      if (r && extractSeries(parseHTML(r.html).document as unknown as Document, r.url).some((x) => x.title.toLowerCase().includes(word.toLowerCase()))) { searchUrl = `${origin}${tpl}`; break; }
    }
    return { id, name, baseUrl: origin, engine: "heuristic", path: p, listUrl: `${origin}${path}${p ? "?page={page}" : ""}`, searchUrl: searchUrl?.includes("{page}") ? searchUrl : searchUrl, paged };
  }
  return null;
}

async function probe(name: string, id: string, home: string): Promise<CatalogEntry | null> {
  const first = await get(home);
  if (!first) return why("unreachable", name);
  const origin = new URL(first.url).origin;
  if (/mangadex\.org|webtoons\.com/.test(origin)) return why("native", name);
  const engine = detectEngine(first.html);
  if (!engine) {
    if (/cf-chl|challenge-platform|just a moment/i.test(first.html)) return why("cloudflare", name);
    return (await probeHeuristic(name, id, origin)) ?? why("heuristic-failed", name);
  }
  if (engine === "madara") {
    for (const sub of MADARA_SUBS) {
      const r = await get(`${origin}/${sub}/?m_orderby=views`, 10000);
      if (r && cards(r.html, MADARA_CARD) >= 3) return { id, name, baseUrl: origin, engine, path: sub };
    }
    return (await probeHeuristic(name, id, origin)) ?? why("madara-list-failed", name);
  } else {
    for (const p of THEMESIA_PATHS) {
      const r = await get(`${origin}/${p}/?order=popular`, 10000);
      if (r && cards(r.html, THEMESIA_CARD) >= 3) return { id, name, baseUrl: origin, engine, path: p };
    }
    return (await probeHeuristic(name, id, origin)) ?? why("themesia-list-failed", name);
  }
  return null;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!, i); }
  }));
  return out;
}

async function main() {
  if (!existsSync(CACHE) || process.argv.includes("--refresh")) {
    const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`index fetch failed: ${res.status}`);
    writeFileSync(CACHE, await res.text());
  }
  const index = JSON.parse(readFileSync(CACHE, "utf8")) as { extensionList: { extensions: Ext[] } };
  const seen = new Set<string>();
  const candidates: { id: string; name: string; home: string }[] = [];
  for (const e of index.extensionList.extensions) {
    if (e.contentWarning?.includes("NSFW")) continue; // adult catalogues are left out of the defaults
    for (const s of e.sources) {
      if (!(process.env.LANGS ?? "en").split(",").includes(s.language)) continue;
      let host = "";
      try { host = new URL(s.homeUrl).host.replace(/^www\./, ""); } catch { continue; }
      if (seen.has(host)) continue;
      seen.add(host);
      candidates.push({ id: `mihon-${s.id}`, name: s.name, home: s.homeUrl });
    }
  }
  // KEEP=1: only probe what the existing catalogue is missing, then merge (used for slower retry passes)
  const existing: CatalogEntry[] = process.env.KEEP && existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
  const have = new Set(existing.map((e) => e.id));
  for (let i = candidates.length - 1; i >= 0; i--) if (have.has(candidates[i]!.id)) candidates.splice(i, 1);
  console.log(`probing ${candidates.length} English non-adult sites`);
  let done = 0;
  const results = await pool(candidates, 16, async (c) => {
    const r = await probe(c.name, c.id, c.home);
    if (++done % 25 === 0) console.log(`  ${done}/${candidates.length}`);
    return r;
  });
  const catalog = [...existing, ...results.filter((x): x is CatalogEntry => !!x)].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
  const byEngine = catalog.reduce<Record<string, number>>((m, c) => ((m[c.engine] = (m[c.engine] ?? 0) + 1), m), {});
  console.log(`kept ${catalog.length}`, byEngine);
  for (const [k, v] of Object.entries(reasons)) console.log(`  ${k}: ${v.length}`, v.slice(0, 12).join(", "));
}

void main();
