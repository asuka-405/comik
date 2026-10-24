/**
 * Health check for every source in the catalogue, run through the real runtime engines.
 * For each source it lists popular series, searches for one of them, opens the series, reads its
 * chapter list and loads the pages of the first chapter. Requests go through the local proxy.
 *
 *   PROXY_PORT=8799 npx tsx server/index.ts &
 *   PROXY=http://localhost:8799 npx tsx scripts/check-sources.ts [name-filter] [--json out.json]
 *
 * Exit code is 0 even when sources fail: this reports, it does not gate.
 */
import { DOMParser } from "linkedom";
import { writeFileSync } from "node:fs";
import type { Source } from "../src/core/types";

const store = new Map<string, string>();
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
// Newer Node versions define localStorage as a getter, so assign through defineProperty.
for (const [key, value] of Object.entries({ DOMParser, localStorage: storage, sessionStorage: storage, location: new URL("http://localhost/") })) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

const PROXY = process.env.PROXY ?? "http://localhost:8799";
const filter = process.argv.slice(2).find((a) => !a.startsWith("--") && !a.endsWith(".json"))?.toLowerCase();
const skip = (process.env.SKIP ?? "").toLowerCase().split("|").filter(Boolean);
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined;

const { useSettings } = await import("../src/core/settings");
useSettings.getState().set({ proxyUrl: PROXY });
const { allSources } = await import("../src/core/sources/registry");


interface Row { id: string; name: string; engine: string; stage: string; ok: boolean; detail: string; ms: number }

async function check(source: Source): Promise<Row> {
  const started = Date.now();
  const row = (stage: string, ok: boolean, detail = ""): Row => ({ id: source.id, name: source.name, engine: source.id.split("-")[0]!, stage, ok, detail, ms: Date.now() - started });
  const fail = (stage: string, e: unknown) => row(stage, false, (e as Error).message ?? String(e));
  let list;
  try { list = await source.getPopular(1); } catch (e) { return fail("popular", e); }
  if (!list.mangas.length) return row("popular", false, "no series parsed");
  const first = list.mangas[0]!;
  if (list.hasNext) {
    try {
      const second = await source.getPopular(2);
      if (!second.mangas.length) return row("page 2", false, "page 2 is empty");
    } catch (e) { return fail("page 2", e); }
  }
  if (source.supportsLatest) {
    try {
      const latest = await source.getLatest(1);
      if (!latest.mangas.length) return row("latest", false, "no series parsed");
    } catch (e) { return fail("latest", e); }
  }
  const word = first.title.split(/\s+/).find((w) => w.replace(/\W/g, "").length > 3) ?? first.title;
  try {
    const found = await source.search(1, word, source.getFilterList());
    if (!found.mangas.length) return row("search", false, `no results for "${word}"`);
  } catch (e) { return fail("search", e); }
  // A single series can be empty or locked, so give the source three chances before calling it broken.
  let lastError = "no chapters";
  let lastStage = "chapters";
  for (const candidate of list.mangas.slice(0, 3)) {
    let chapters;
    try {
      const detail = await source.getMangaDetails(candidate);
      chapters = await source.getChapterList({ ...candidate, ...detail });
    } catch (e) { lastError = (e as Error).message; lastStage = "chapters"; continue; }
    if (!chapters.length) { lastError = "no chapters"; lastStage = "chapters"; continue; }
    // The newest chapter can be locked or still processing, so try the oldest first, then the newest.
    for (const chapter of [chapters[chapters.length - 1]!, chapters[0]!]) {
      try {
        const pages = await source.getPageList(chapter, candidate);
        if (pages.length) return row("pages", true, `${list.mangas.length} series, ${chapters.length} chapters, ${pages.length} pages`);
        lastError = "no pages"; lastStage = "pages";
      } catch (e) { lastError = (e as Error).message; lastStage = "pages"; }
    }
  }
  return row(lastStage, false, lastError);
}

const sources = allSources().filter((s) => s.id !== "local" && !s.id.startsWith("webtoons") && (!skip.some((part) => s.name.toLowerCase().includes(part))) && (!filter || filter.split("|").some((part) => s.name.toLowerCase().includes(part))));
console.log(`checking ${sources.length} sources through ${PROXY}`);
const rows: Row[] = new Array(sources.length);
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < sources.length) {
    const i = next++;
    rows[i] = await Promise.race([
      check(sources[i]!),
      new Promise<Row>((r) => setTimeout(() => r({ id: sources[i]!.id, name: sources[i]!.name, engine: "", stage: "timeout", ok: false, detail: "no answer in 90 s", ms: 90000 }), 90000)),
    ]);
    if (++done % 10 === 0) console.log(`  ${done}/${sources.length}`);
  }
}));

const ok = rows.filter((r) => r.ok);
console.log(`\n${ok.length}/${rows.length} sources work end to end\n`);
for (const r of rows.filter((x) => !x.ok).sort((a, b) => a.stage.localeCompare(b.stage) || a.name.localeCompare(b.name))) console.log(`${r.stage.padEnd(9)} ${r.name.padEnd(28)} ${r.detail.slice(0, 90)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
process.exit(0);
