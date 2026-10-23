/**
 * Structure-based extraction for sites that have no dedicated engine. DOM-only (works with the browser's
 * DOMParser and with linkedom in the catalogue build script), no imports from the app.
 *
 * Instead of per-site selectors it relies on patterns nearly every comic site follows:
 *  - series cards are links to /series/<slug>, /manga/<slug>, /comic/<slug> ... that contain a cover image,
 *  - chapters are links whose URL or label carries "chapter 12" / "ep 12" / "ch-12",
 *  - reader pages are the largest run of sibling images on the chapter page.
 */

export const SERIES_SEGMENTS = ["series", "manga", "comic", "comics", "webtoon", "manhwa", "manhua", "title", "serie", "read", "novel", "project"];
const SKIP_PATH = /\/(chapter|episode|ep|ch|page|genre|genres|tag|tags|author|artist|category|type|status|year|search|login|register|user|bookmark|feed)([-_/]|$)/i;
const CHAPTER_RE = /(chapter|chap|ch|episode|ep|capitulo|cap)[-_.\/ ]*#?\d+/i;
const JUNK_IMG = /logo|avatar|icon|banner|sprite|loading|spinner|placeholder|emoji|flag|badge|\/ads?\/|gravatar|button|discord|patreon|facebook|twitter/i;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function abs(href: string | null, base: string): URL | null {
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

export function bestImgSrc(el: Element | null | undefined, base: string): string {
  if (!el) return "";
  for (const a of ["data-lazy-src", "data-src", "data-original", "data-cfsrc", "data-url", "data-srcset", "srcset", "src"]) {
    const v = el.getAttribute(a);
    if (!v || v.startsWith("data:")) continue;
    const first = a.includes("srcset") ? v.split(",").pop()!.trim().split(/\s+/)[0]! : v.trim();
    const u = first ? abs(first, base) : null;
    if (u) return u.toString();
  }
  return "";
}

export interface FoundSeries { path: string; title: string; cover: string }

/** Series cards on a listing page. Paths are returned relative to the site origin. */
export function extractSeries(doc: Document, base: string): FoundSeries[] {
  const origin = new URL(base).origin;
  const byPath = new Map<string, FoundSeries>();
  for (const a of doc.querySelectorAll("a[href]")) {
    const u = abs(a.getAttribute("href"), base);
    if (!u || u.origin !== origin) continue;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2 || segs.length > 3) continue;
    const idx = segs.findIndex((s) => SERIES_SEGMENTS.includes(s.toLowerCase()));
    if (idx !== 0 && !(idx === 1 && segs[0]!.length === 2)) continue; // optional language prefix like /en/series/x
    if (segs.length - idx !== 2) continue;
    if (SKIP_PATH.test(u.pathname) || CHAPTER_RE.test(segs[segs.length - 1]!)) continue;
    const path = u.pathname;
    let card: Element | null = a;
    let img = a.querySelector("img");
    for (let up = 0; !img && up < 3 && card?.parentElement; up++) {
      card = card.parentElement;
      // stop climbing once the card holds several series links (then it is the whole grid)
      img = card.querySelectorAll(`a[href*="${segs[idx + 1]}"]`).length > 3 ? null : card.querySelector("img");
    }
    const cover = bestImgSrc(img, base);
    const titleEl = (card ?? a).querySelector("h1,h2,h3,h4,h5,[class*=title],[class*=name]");
    const candidates = [clean(a.getAttribute("title")), clean(img?.getAttribute("alt")), clean(titleEl?.textContent), clean(a.textContent)].filter((t) => t.length > 1 && t.length < 140 && !/^(read|view|new|hot|chapter)/i.test(t));
    const title = candidates[0];
    if (!title) continue;
    const prev = byPath.get(path);
    if (!prev || (!prev.cover && cover)) byPath.set(path, { path, title, cover: cover || prev?.cover || "" });
  }
  return [...byPath.values()];
}

export interface FoundChapter { path: string; name: string; date: string }

export function extractChapters(doc: Document, base: string): FoundChapter[] {
  const origin = new URL(base).origin;
  const seen = new Map<string, FoundChapter>();
  for (const a of doc.querySelectorAll("a[href]")) {
    const u = abs(a.getAttribute("href"), base);
    if (!u || u.origin !== origin) continue;
    const label = clean(a.textContent);
    if (!CHAPTER_RE.test(u.pathname) && !CHAPTER_RE.test(label)) continue;
    if (u.pathname.split("/").filter(Boolean).length < 2 || /\/(feed|comments?)\b/i.test(u.pathname)) continue;
    const path = u.pathname + u.search;
    if (seen.has(path)) continue;
    const nameEl = a.querySelector("[class*=chapter],[class*=title],[class*=num],span");
    let name = clean(nameEl?.textContent) || label;
    if (name.length > 90) name = name.slice(0, 90);
    const row = a.closest("li,tr,div") ?? a;
    const dateEl = row.querySelector("time,[class*=date],[class*=time],[class*=ago]");
    seen.set(path, { path, name, date: clean(dateEl?.getAttribute("datetime") || dateEl?.textContent) });
  }
  const list = [...seen.values()];
  if (list.length < 2) return list;
  // sites list either newest-first or oldest-first; normalise to newest-first
  const num = (c: FoundChapter) => Number(c.name.match(/\d+(\.\d+)?/)?.[0] ?? c.path.match(/(\d+(\.\d+)?)\/?$/)?.[1] ?? NaN);
  const first = num(list[0]!), last = num(list[list.length - 1]!);
  return Number.isFinite(first) && Number.isFinite(last) && first < last ? list.reverse() : list;
}

/** The largest run of sibling images on a reader page. */
export function extractPageImages(doc: Document, base: string, min = 3): string[] {
  const groups = new Map<Element, string[]>();
  for (const img of doc.querySelectorAll("img")) {
    const src = bestImgSrc(img, base);
    if (!src) continue;
    const marker = `${img.getAttribute("class") ?? ""} ${img.getAttribute("id") ?? ""} ${src}`;
    if (JUNK_IMG.test(marker) || /thumb|cover|poster/i.test(img.getAttribute("class") ?? "")) continue;
    const w = Number(img.getAttribute("width")), h = Number(img.getAttribute("height"));
    if ((w && w < 160) || (h && h < 160)) continue;
    const parent = img.parentElement?.closest("div,section,article,main") ?? img.parentElement;
    if (!parent) continue;
    const list = groups.get(parent) ?? [];
    list.push(src);
    groups.set(parent, list);
  }
  // an ancestor that wraps one image per child counts every child, so merge nested groups upward
  let best: string[] = [];
  for (const [el, list] of groups) {
    let merged = list;
    const outer = el.parentElement;
    if (outer) {
      const all: string[] = [];
      for (const [e2, l2] of groups) if (outer.contains(e2)) all.push(...l2);
      if (all.length > merged.length) merged = all;
    }
    if (merged.length > best.length) best = merged;
  }
  return best.length >= min ? [...new Set(best)] : [];
}

/** Next-page URL pattern: sites paginate with ?page=N, /page/N/, or ?paged=N. */
export function guessPageParam(doc: Document): "query" | "path" {
  return doc.querySelector('a[href*="/page/"]') ? "path" : "query";
}
