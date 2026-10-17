/**
 * Downloads cover art for the top Webtoon series into public/assets/webtoon-covers/.
 *
 * Ranking order: the site's Popular ranking first, then Trending, then each genre's most popular
 * list taken round-robin, de-duplicated by title number, until 100 series are collected.
 * Covers are saved exactly as the listing serves them (standard thumbnail, no resizing).
 *
 *   node scripts/fetch-webtoon-covers.mjs [count]
 */
import { parseHTML } from "linkedom";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";

const COUNT = Number(process.argv[2] ?? 100);
const OUT = new URL("../public/assets/webtoon-covers/", import.meta.url).pathname;
const ROOT = "https://www.webtoons.com/en";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GENRES = ["action", "comedy", "drama", "fantasy", "heartwarming", "horror", "romance", "sf", "slice-of-life", "sports", "superhero", "supernatural", "thriller"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function html(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, cookie: "pagGDPR=true; needGDPR=false" }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

function cards(doc) {
  const out = [];
  for (const a of doc.querySelectorAll('a[href*="title_no="]')) {
    const title = (a.querySelector(".title, .subj")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const img = a.querySelector("img")?.getAttribute("src");
    const no = new URL(a.getAttribute("href"), ROOT).searchParams.get("title_no");
    if (title && img && no) out.push({ no, title, cover: img, url: new URL(a.getAttribute("href"), ROOT).toString(), genre: (a.querySelector(".genre")?.textContent ?? "").trim() });
  }
  return out;
}

const picked = new Map();
const add = (list, tag) => { for (const c of list) if (!picked.has(c.no) && picked.size < COUNT) picked.set(c.no, { ...c, from: tag }); };

for (const [name, path] of [["popular", "/ranking/popular"], ["trending", "/ranking/trending"]]) {
  try { add(cards(parseHTML(await html(ROOT + path)).document), name); } catch (e) { console.warn("skip", name, e.message); }
  await sleep(400);
}
console.log(`after rankings: ${picked.size}`);

const perGenre = [];
for (const g of GENRES) {
  try { perGenre.push({ g, list: cards(parseHTML(await html(`${ROOT}/genres/${g}?sortOrder=MANA`)).document) }); } catch (e) { console.warn("skip genre", g, e.message); }
  await sleep(400);
}
for (let i = 0; picked.size < COUNT && i < 60; i++) for (const { g, list } of perGenre) if (list[i]) add([list[i]], `genre:${g}`);
console.log(`collected: ${picked.size}`);

mkdirSync(OUT, { recursive: true });
const items = [...picked.values()];
const manifest = [];
let next = 0, failed = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < items.length) {
    const i = next++;
    const it = items[i];
    const rank = String(i + 1).padStart(3, "0");
    try {
      const res = await fetch(it.cover, { headers: { "user-agent": UA, referer: "https://www.webtoons.com/" }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(String(res.status));
      const type = res.headers.get("content-type") ?? "";
      const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : extname(new URL(it.cover).pathname) || ".jpg";
      const slug = it.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const file = `${rank}-${slug}${ext}`;
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(join(OUT, file), buf);
      manifest[i] = { rank: i + 1, title: it.title, genre: it.genre, titleNo: it.no, seriesUrl: it.url, source: it.from, file, bytes: buf.length };
    } catch (e) {
      failed++;
      console.warn(`failed ${it.title}: ${e.message}`);
    }
    await sleep(150);
  }
}));
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest.filter(Boolean), null, 2) + "\n");
console.log(`saved ${manifest.filter(Boolean).length} covers, ${failed} failed -> ${OUT}`);
