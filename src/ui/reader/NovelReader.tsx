import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookmarkSimple, CaretLeft, CaretRight, Minus, Plus, TextAa } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { db } from "@/core/db";
import { getSource } from "@/core/sources/registry";
import { saveProgress, setBookmark } from "@/core/repo";
import { readingOrder } from "@/core/progress";
import type { ChapterRow, MangaRow } from "@/core/types";

export function NovelReader({ manga, chapter, siblings }: { manga: MangaRow; chapter: ChapterRow; siblings: ChapterRow[] }) {
  const nav = useNavigate();
  const scroller = useRef<HTMLElement>(null);
  const file = useLiveQuery(() => db.localFiles.get(chapter.id), [chapter.id]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const { novelFontSize: fontSize, novelLineHeight: lineHeight, novelFont, set } = useSettings();
  const [bookmarked, setBookmarked] = useState(chapter.bookmark);
  const order = useMemo(() => readingOrder(siblings), [siblings]);
  const index = order.findIndex((item) => item.id === chapter.id);
  const previous = order[index - 1];
  const next = order[index + 1];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");
    if (file?.kind === "text") {
      file.blob.text().then((value) => { if (alive) setText(value); }).catch((error) => { if (alive) setLoadError((error as Error).message); }).finally(() => { if (alive) setLoading(false); });
    } else {
      const source = getSource(manga.sourceId);
      if (!source?.getNovelText) { setText(""); setLoadError("This source does not provide readable chapter text."); setLoading(false); return; }
      source.getNovelText({ url: chapter.url, name: chapter.name, dateUpload: chapter.dateUpload }, { url: manga.url, title: manga.title, kind: "novel" })
        .then(async (value) => {
          if (!alive) return;
          setText(value);
          await db.localFiles.put({ chapterId: chapter.id, blob: new Blob([value], { type: "text/plain;charset=utf-8" }), kind: "text" });
        })
        .catch((error) => { if (alive) setLoadError((error as Error).message || "Could not load this chapter."); })
        .finally(() => { if (alive) setLoading(false); });
    }
    return () => { alive = false; };
  }, [file, manga.id, manga.sourceId, manga.title, manga.url, chapter.id, chapter.url, chapter.name, chapter.dateUpload]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !text) return;
    const percent = chapter.pageCount ? chapter.lastPage / chapter.pageCount : 0;
    node.scrollTop = Math.max(0, (node.scrollHeight - node.clientHeight) * percent);
  }, [text, chapter.id]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let timer = 0;
    const persist = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const max = node.scrollHeight - node.clientHeight;
        const percent = max > 0 ? node.scrollTop / max : 0;
        const finished = percent >= 0.98;
        void saveProgress(chapter.id, Math.round(percent * 100), 100, finished);
      }, 600);
    };
    node.addEventListener("scroll", persist, { passive: true });
    return () => { window.clearTimeout(timer); node.removeEventListener("scroll", persist); };
  }, [chapter.id, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight" && next) nav(`/read/${encodeURIComponent(next.id)}`);
      else if (e.key === "ArrowLeft" && previous) nav(`/read/${encodeURIComponent(previous.id)}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, previous, nav]);

  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const percent = chapter.pageCount ? Math.min(100, Math.round(chapter.lastPage / chapter.pageCount * 100)) : 0;

  return (
    <div className="novel-reader">
      <header className="novel-reader-bar">
        <Link className="icon-btn" to={`/series/${encodeURIComponent(manga.id)}`} aria-label="Back to chapters" title="Back to chapters"><ArrowLeft size={19} /></Link>
        <div className="novel-reader-title"><strong>{manga.title}</strong><span>{chapter.name}</span></div>
        <button className={`icon-btn${bookmarked ? " on" : ""}`} aria-label="Bookmark chapter" aria-pressed={bookmarked} title="Bookmark" onClick={() => { const value = !bookmarked; setBookmarked(value); void setBookmark(chapter.id, value); }}><BookmarkSimple size={18} /></button>
        <button className="icon-btn" aria-label="Smaller text" title="Smaller text" disabled={fontSize <= 14} onClick={() => set({ novelFontSize: Math.max(14, fontSize - 1) })}><Minus size={17} /></button>
        <button className="icon-btn" aria-label="Larger text" title="Larger text" disabled={fontSize >= 28} onClick={() => set({ novelFontSize: Math.min(28, fontSize + 1) })}><Plus size={17} /></button>
        <button className="icon-btn" aria-label={`Text style: ${novelFont}`} title={`Text style: ${novelFont === "serif" ? "serif" : "sans"}. Tap to switch`} onClick={() => set({ novelFont: novelFont === "serif" ? "sans" : "serif" })}><TextAa size={17} /></button>
        <button className="icon-btn" aria-label="Line spacing" title="Line spacing" onClick={() => set({ novelLineHeight: lineHeight >= 2.2 ? 1.5 : Math.round((lineHeight + 0.2) * 100) / 100 })}><span className="mono" style={{ fontSize: 11 }}>{lineHeight.toFixed(1)}</span></button>
      </header>
      <div className="novel-reader-progress"><i style={{ width: `${percent}%` }} /></div>
      <main className="novel-reading-scroll" ref={scroller}>
        {loading ? <div className="novel-reading-message">Loading chapter…</div> : loadError ? <div className="novel-reading-message" role="alert">{loadError}</div> : <article className="novel-prose" style={{ fontSize, lineHeight, fontFamily: novelFont === "sans" ? "var(--font)" : undefined }}>
          <h1>{chapter.name}</h1>
          {paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph.split("\n").map((line, index) => <span key={index}>{index > 0 && <br />}{line}</span>)}</p>)}
        </article>}
      </main>
      <footer className="novel-reader-footer">
        <button className="btn" disabled={!previous} onClick={() => previous && nav(`/read/${encodeURIComponent(previous.id)}`)}><CaretLeft size={16} /> Previous</button>
        <span className="mono muted">{index + 1} / {order.length}</span>
        <button className="btn primary" disabled={!next} onClick={() => next && nav(`/read/${encodeURIComponent(next.id)}`)}>Next <CaretRight size={16} /></button>
      </footer>
    </div>
  );
}