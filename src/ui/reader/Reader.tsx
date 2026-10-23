import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookmarkSimple, CaretLeft, CaretRight, SlidersHorizontal } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { useSettings } from "@/core/settings";
import { loadPages, releasePages, type ReaderPage } from "@/core/pages";
import { patchManga, saveProgress, setBookmark } from "@/core/repo";
import { readingOrder } from "@/core/progress";
import { formatChapterNumber, missingBetween } from "@/core/chapterRecognition";
import { deleteDownloads } from "@/core/downloads";
import type { ChapterRow, MangaRow, ReaderMode } from "@/core/types";
import { processImage, looksLikeStrip, type Piece } from "./imageProcessing";
import { ReaderSettings } from "./ReaderSettings";

type Mode = Exclude<ReaderMode, "auto">;
const STRIP_GENRES = /webtoon|long strip|manhwa|manhua|full color|web comic/i;

interface Slide { page: number; piece: number; data: Piece }

export function Reader() {
  const chapterId = decodeURIComponent(useParams().chapterId ?? "");
  const nav = useNavigate();
  const chapter = useLiveQuery(() => db.chapters.get(chapterId), [chapterId]);
  const manga = useLiveQuery(() => (chapter ? db.manga.get(chapter.mangaId) : undefined), [chapter?.mangaId]);
  const siblings = useLiveQuery(() => (chapter ? db.chapters.where("mangaId").equals(chapter.mangaId).toArray() : []), [chapter?.mangaId], [] as ChapterRow[]);

  if (chapter === undefined || (chapter && manga === undefined)) return <div className="reader"><div className="interstitial"><div className="skel" style={{ width: 200, height: 14 }} /></div></div>;
  if (!chapter || !manga) return <div className="reader"><div className="interstitial"><h2>Chapter not found</h2><button className="btn" onClick={() => nav("/")}>Back</button></div></div>;
  return <ReaderBody key={chapter.id} chapter={chapter} manga={manga} siblings={siblings ?? []} />;
}

function ReaderBody({ chapter, manga, siblings }: { chapter: ChapterRow; manga: MangaRow; siblings: ChapterRow[] }) {
  const nav = useNavigate();
  const st = useSettings();
  const [pages, setPages] = useState<ReaderPage[] | null>(null);
  const [error, setError] = useState("");
  const [tries, setTries] = useState(0);
  const [hud, setHud] = useState(true);
  const [menu, setMenu] = useState(false);
  const [cur, setCur] = useState(0);
  const [pieces, setPieces] = useState<Record<number, Piece[]>>({});
  const [strip, setStrip] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const startPage = useRef(!chapter.read && chapter.lastPage > 0 ? chapter.lastPage : 0);

  const order = useMemo(() => readingOrder(siblings), [siblings]);
  const idx = order.findIndex((c) => c.id === chapter.id);
  const pick = (dir: 1 | -1) => {
    for (let i = idx + dir; i >= 0 && i < order.length; i += dir) {
      if (dir === 1 && st.skipReadChapters && order[i]!.read) continue;
      return order[i];
    }
  };
  const next = pick(1), prev = pick(-1);
  const gap = next ? missingBetween(chapter.number, next.number) : 0;

  /* ---- load pages ---- */
  useEffect(() => {
    let dead = false;
    setPages(null);
    setError("");
    loadPages(manga, chapter).then((p) => !dead && setPages(p)).catch((e: Error) => !dead && setError(e.message));
    return () => { dead = true; releasePages(chapter.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id, tries]);

  /* ---- decide mode ---- */
  const chosen: ReaderMode = manga.readerMode ?? st.readerMode;
  const mode: Mode = chosen !== "auto" ? chosen : manga.genres.some((g) => STRIP_GENRES.test(g)) || manga.sourceId.startsWith("webtoons") || strip ? "webtoon" : "paged-rtl";

  /* ---- analyse + process pages (paged modes) ---- */
  const paged = mode !== "webtoon";
  useEffect(() => {
    if (!pages) return;
    let dead = false;
    const sizes: { w: number; h: number }[] = [];
    // a quick sample is enough to tell strips from pages when mode is auto
    if (chosen === "auto") {
      Promise.all(pages.slice(0, 3).map((p) => processImage(p.src, { crop: false, split: false }).then((r) => r[0]!).catch(() => null))).then((r) => {
        r.forEach((x) => x && sizes.push(x));
        if (!dead) setStrip(looksLikeStrip(sizes));
      });
    }
    return () => { dead = true; };
  }, [pages, chosen]);

  useEffect(() => {
    if (!pages || !paged) return;
    let dead = false;
    const want = [];
    for (let i = Math.max(0, cur - 1); i <= Math.min(pages.length - 1, cur + st.preload); i++) if (!pieces[i]) want.push(i);
    want.slice(0, 3).forEach((i) =>
      processImage(pages[i]!.src, { crop: st.cropBorders, split: st.splitTall })
        .catch(() => [{ url: pages[i]!.src, w: 800, h: 1200, wide: false, owned: false } as Piece])
        .then((p) => !dead && setPieces((m) => (m[i] ? m : { ...m, [i]: p }))),
    );
    return () => { dead = true; };
  }, [pages, paged, cur, st.preload, st.cropBorders, st.splitTall, pieces]);

  // settings changed: drop processed pieces
  useEffect(() => {
    setPieces((m) => { Object.values(m).flat().forEach((p) => p.owned && URL.revokeObjectURL(p.url)); return {}; });
  }, [st.cropBorders, st.splitTall, mode]);

  const slides: Slide[] = useMemo(() => {
    if (!pages) return [];
    return pages.flatMap((p) => (pieces[p.index] ?? [{ url: p.src, w: 800, h: 1200, wide: false, owned: false }]).map((data, piece) => ({ page: p.index, piece, data })));
  }, [pages, pieces]);

  const slideIdx = Math.max(0, slides.findIndex((s) => s.page === cur && s.piece === 0));
  const [slideCur, setSlideCur] = useState<number | null>(null);
  const at = slideCur ?? slideIdx;
  useEffect(() => { if (slideCur !== null && slides[slideCur]) setCur(slides[slideCur]!.page); }, [slideCur, slides]);

  /* ---- navigation ---- */
  const total = pages?.length ?? 0;
  const [end, setEnd] = useState(false);
  const rtl = mode === "paged-rtl";
  const step = useCallback((dir: 1 | -1) => {
    if (!paged) return;
    const s = slides[at];
    const second = st.doublePages && s && !s.data.wide && slides[at + 1] && !slides[at + 1]!.data.wide ? 2 : 1;
    const nextIdx = dir === 1 ? at + second : at - (st.doublePages && at >= 2 && !slides[at - 1]?.data.wide && !slides[at - 2]?.data.wide ? 2 : 1);
    if (nextIdx >= slides.length) return setEnd(true);
    if (nextIdx < 0) { if (prev) nav(`/read/${encodeURIComponent(prev.id)}`, { replace: true }); return; }
    setEnd(false);
    setSlideCur(nextIdx);
  }, [paged, slides, at, st.doublePages, prev, nav]);

  const goChapter = useCallback((c?: ChapterRow) => c && nav(`/read/${encodeURIComponent(c.id)}`, { replace: true }), [nav]);

  /* ---- progress ---- */
  useEffect(() => {
    if (!pages) return;
    const finished = paged ? end || cur >= total - 1 : false;
    const t = setTimeout(() => void saveProgress(chapter.id, cur, total, finished), 500);
    return () => clearTimeout(t);
  }, [cur, end, total, pages, paged, chapter.id]);

  useEffect(() => {
    if (end && st.deleteAfterRead) void deleteDownloads([chapter.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  /* ---- keyboard ---- */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (menu) return;
      const dir = (d: 1 | -1) => (rtl ? -d : d) as 1 | -1;
      if (e.key === "ArrowRight") paged && step(dir(1));
      else if (e.key === "ArrowLeft") paged && step(dir(-1));
      else if (e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") { if (paged && mode !== "paged-vertical" ? e.key === " " : mode === "paged-vertical") { e.preventDefault(); step(1); } }
      else if (e.key === "ArrowUp" && mode === "paged-vertical") step(-1);
      else if (e.key === "n") goChapter(next);
      else if (e.key === "p") goChapter(prev);
      else if (e.key === "m") setHud((h) => !h);
      else if (e.key === "Escape") nav(`/series/${encodeURIComponent(manga.id)}`);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [paged, rtl, mode, step, next, prev, goChapter, nav, manga.id, menu]);

  /* ---- keep screen on ---- */
  useEffect(() => {
    if (!st.keepScreenOn || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => { void lock?.release(); };
  }, [st.keepScreenOn]);

  /* ---- webtoon: current page from scroll position ---- */
  useEffect(() => {
    if (paged || !pages || !scroller.current) return;
    const root = scroller.current;
    const slots = root.querySelectorAll<HTMLElement>("[data-page]");
    // a page is "current" while it crosses the vertical middle of the viewport (works for 10,000px strips)
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) setCur(Number((en.target as HTMLElement).dataset.page));
    }, { root, rootMargin: "-50% 0px -50% 0px", threshold: 0 });
    slots.forEach((s) => io.observe(s));
    const sentinel = root.querySelector("[data-end]");
    const endIo = new IntersectionObserver(([e]) => e?.isIntersecting && setEnd(true), { root, threshold: 0.4 });
    if (sentinel) endIo.observe(sentinel);
    // resume position
    if (startPage.current > 0) root.querySelector<HTMLElement>(`[data-page="${startPage.current}"]`)?.scrollIntoView();
    startPage.current = 0;
    return () => { io.disconnect(); endIo.disconnect(); };
  }, [paged, pages]);

  useEffect(() => {
    if (paged && pages && startPage.current > 0 && slides.length) {
      const i = slides.findIndex((s) => s.page === startPage.current && s.piece === 0);
      if (i >= 0) { setSlideCur(i); startPage.current = 0; }
    }
  }, [paged, pages, slides]);

  /* ---- tap zones ---- */
  const onTap = (e: React.MouseEvent) => {
    if (menu) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (!paged || st.tapZones === "off") return setHud((h) => !h);
    const flip = st.invertTaps ? -1 : 1;
    const vertical = mode === "paged-vertical";
    let action: "prev" | "next" | "menu" = "menu";
    if (st.tapZones === "edge") action = (vertical ? y : x) < 0.18 ? "prev" : (vertical ? y : x) > 0.82 ? "next" : "menu";
    else if (st.tapZones === "l-shaped") action = x < 0.33 || y < 0.33 ? "prev" : x > 0.66 || y > 0.66 ? "next" : "menu";
    else action = (vertical ? y : x) < 0.33 ? "prev" : (vertical ? y : x) > 0.66 ? "next" : "menu";
    if (action === "menu") return setHud((h) => !h);
    const dir = (action === "next" ? 1 : -1) * flip * (rtl ? -1 : 1);
    step(dir as 1 | -1);
  };

  /* ---- render ---- */
  const parts = [st.brightness !== 1 && `brightness(${st.brightness})`, st.grayscale && "grayscale(1)", st.invert && "invert(1)", st.sepia > 0 && `sepia(${st.sepia})`].filter(Boolean);
  const filter = parts.length ? parts.join(" ") : "none"; // filtering a giant scroll container stalls the compositor, so it is applied per image
  const label = `Ch. ${formatChapterNumber(chapter.number)}${chapter.name && !/^\s*(ch|chapter)/i.test(chapter.name) ? `, ${chapter.name}` : ""}`;
  const shown = Math.min(cur + 1, total);

  const endCard = (
    <div className="interstitial" data-end>
      <div className="kicker">Finished</div>
      <h2>{label}</h2>
      {gap > 0 && <div className="gap-note">{gap} chapter{gap === 1 ? "" : "s"} missing before the next one.</div>}
      {next ? (
        <>
          <p className="muted">Up next: Ch. {formatChapterNumber(next.number)} {next.name}</p>
          <button className="btn primary" onClick={() => goChapter(next)}>Next chapter</button>
        </>
      ) : <p className="muted">That is the latest chapter. Check back after the next update.</p>}
      <button className="btn ghost" onClick={() => nav(`/series/${encodeURIComponent(manga.id)}`)}>Back to series</button>
    </div>
  );

  return (
    <div className={`reader${paged ? "" : " scroll"}`} style={{ ["--series" as string]: manga.accent ?? "var(--accent)", ["--rfilter" as string]: filter }}>
      {error && (
        <div className="interstitial">
          <h2>Could not load chapter</h2>
          <p className="muted" style={{ maxWidth: 480 }}>{error}</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" onClick={() => setTries((t) => t + 1)}>Try again</button>
            <button className="btn" onClick={() => nav(`/series/${encodeURIComponent(manga.id)}`)}>Back</button>
          </div>
        </div>
      )}
      {!pages && !error && <div className="interstitial"><div className="skel" style={{ width: 220, height: 14 }} /><span className="mono muted">Fetching pages</span></div>}

      {pages && !paged && (
        <div ref={scroller} onClick={onTap} style={{ position: "absolute", inset: 0, overflowY: "auto" }}>
          <div className="col" style={{ padding: `0 ${st.webtoonSidePadding}%`, maxWidth: 760, margin: "0 auto", gap: st.webtoonGap }}>
            {pages.map((p) => <ScrollPage key={p.index} page={p} crop={st.cropBorders} />)}
          </div>
          {endCard}
        </div>
      )}

      {pages && paged && !end && (
        <div className="stage" onClick={onTap}>
          <PagedView slides={slides} at={at} double={st.doublePages && st.smartSpreads !== undefined} rtl={rtl} fit={st.fit} vertical={mode === "paged-vertical"} />
        </div>
      )}
      {pages && paged && end && <div className="stage">{endCard}</div>}

      {pages && st.showPageNumber && !hud && !end && <div className="pageno">{shown} / {total}</div>}

      <div className={`hud top${hud ? "" : " hide"}`}>
        <button className="icon-btn" onClick={() => nav(`/series/${encodeURIComponent(manga.id)}`)} aria-label="Back to series"><ArrowLeft size={18} /></button>
        <div className="title" style={{ flex: 1 }}>{manga.title}<small>{label}</small></div>
        <button className={`icon-btn${chapter.bookmark ? " on" : ""}`} onClick={() => void setBookmark(chapter.id, !chapter.bookmark)} aria-label="Bookmark chapter"><BookmarkSimple size={18} weight={chapter.bookmark ? "fill" : "regular"} /></button>
        <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Reader settings"><SlidersHorizontal size={18} /></button>
      </div>

      <div className={`hud bottom${hud ? "" : " hide"}`}>
        <div className="scrub">
          <button className="icon-btn" disabled={!prev} onClick={() => goChapter(prev)} aria-label="Previous chapter"><CaretLeft size={18} /></button>
          <span className="mono" style={{ width: 44, textAlign: "right" }}>{shown}</span>
          <div style={{ position: "relative", flex: 1, direction: rtl ? "rtl" : "ltr" }}>
            {preview !== null && pages?.[preview] && (
              <img src={pages[preview]!.src} alt="" style={{ position: "absolute", bottom: 34, left: `clamp(0px, calc(${(preview / Math.max(total - 1, 1)) * 100}% - 45px), calc(100% - 90px))`, width: 90, height: 128, objectFit: "cover", border: "1px solid var(--accent)", boxShadow: "4px 4px 0 var(--accent-soft)", background: "#12101a" }} />
            )}
            <input
              type="range" min={0} max={Math.max(total - 1, 0)} value={Math.min(cur, Math.max(total - 1, 0))} style={{ width: "100%" }} aria-label="Page"
              onChange={(e) => {
                const p = Number(e.target.value);
                setPreview(p); setEnd(false);
                if (paged) setSlideCur(Math.max(0, slides.findIndex((s) => s.page === p && s.piece === 0)));
                else scroller.current?.querySelector<HTMLElement>(`[data-page="${p}"]`)?.scrollIntoView();
              }}
              onPointerUp={() => setPreview(null)} onBlur={() => setPreview(null)}
            />
          </div>
          <span className="mono" style={{ width: 44 }}>{total}</span>
          <button className="icon-btn" disabled={!next} onClick={() => goChapter(next)} aria-label="Next chapter"><CaretRight size={18} /></button>
        </div>
      </div>

      {menu && <ReaderSettings mode={mode} chosen={chosen} onClose={() => setMenu(false)} onMode={(m) => void patchManga(manga.id, { readerMode: m })} />}
    </div>
  );
}

/* ----------------------------- webtoon page ----------------------------- */
function ScrollPage({ page, crop }: { page: ReaderPage; crop: boolean }) {
  const [src, setSrc] = useState<string>(page.src);
  const [state, setState] = useState<"idle" | "loaded" | "error">("idle");
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(page.index < 3);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setNear(true), { rootMargin: "1800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    let dead = false;
    let owned: string | undefined;
    if (crop) {
      processImage(page.src, { crop: true, split: false }).then((r) => { owned = r[0]!.owned ? r[0]!.url : undefined; if (!dead) setSrc(r[0]!.url); }).catch(() => !dead && setSrc(page.src));
    } else setSrc(page.src);
    return () => { dead = true; if (owned) URL.revokeObjectURL(owned); };
  }, [near, crop, page.src]);

  return (
    <div ref={ref} data-page={page.index} className={`rslot${state === "loaded" ? " loaded" : ""}`} style={state === "loaded" ? undefined : { minHeight: "70vh" }}>
      {state !== "loaded" && <span className="ph">{state === "error" ? "" : page.index + 1}</span>}
      {near && state !== "error" && <img className="rimg" src={n ? `${src}${src.includes("?") ? "&" : "?"}r=${n}` : src} alt={`Page ${page.index + 1}`} onLoad={() => setState("loaded")} onError={() => (n < 2 ? setTimeout(() => setN(n + 1), 600) : setState("error"))} draggable={false} />}
      {state === "error" && <button className="btn sm" onClick={(e) => { e.stopPropagation(); setN(0); setState("idle"); setSrc(page.src + `${page.src.includes("?") ? "&" : "?"}x=${Date.now()}`); }}>Page {page.index + 1} failed. Retry</button>}
    </div>
  );
}

/* ------------------------------- paged view ------------------------------- */
function PagedView({ slides, at, double, rtl, fit, vertical }: { slides: Slide[]; at: number; double: boolean; rtl: boolean; fit: string; vertical: boolean }) {
  const a = slides[at];
  const b = double && a && !a.data.wide ? slides[at + 1] : undefined;
  const pair = b && !b.data.wide ? [a!, b] : a ? [a] : [];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [at]);
  if (!a) return <span className="mono muted">...</span>;
  const fitStyle: React.CSSProperties = fit === "width" ? { width: "100%", height: "auto", maxHeight: "none" } : fit === "original" ? { maxWidth: "none" } : { maxHeight: "100%", maxWidth: "100%", objectFit: "contain" as const };
  return (
    <div
      className={`spread${rtl ? " rtl" : ""}`}
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: drag.current ? "none" : "transform .25s var(--ease)", overflow: fit === "width" ? "auto" : "visible", flexDirection: vertical ? "column" : undefined }}
      onDoubleClick={(e) => { e.stopPropagation(); setZoom((z) => (z > 1 ? 1 : 2.2)); setPan({ x: 0, y: 0 }); }}
      onPointerDown={(e) => { if (zoom > 1) drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; }}
      onPointerMove={(e) => { if (drag.current) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
      onPointerUp={() => (drag.current = null)}
    >
      {pair.map((s) => <img key={`${s.page}-${s.piece}`} className={`rimg${pair.length === 1 ? " solo" : ""}`} src={s.data.url} alt={`Page ${s.page + 1}`} style={fitStyle} draggable={false} />)}
    </div>
  );
}
