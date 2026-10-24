import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, BookmarkSimple, CaretLeft, CaretRight, Minus, Plus } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { saveProgress, setBookmark } from "@/core/repo";
import { readingOrder } from "@/core/progress";
import type { ChapterRow, MangaRow } from "@/core/types";

export function NovelReader({ manga, chapter, siblings }: { manga: MangaRow; chapter: ChapterRow; siblings: ChapterRow[] }) {
  const nav = useNavigate();
  const scroller = useRef<HTMLElement>(null);
  const file = useLiveQuery(() => db.localFiles.get(chapter.id), [chapter.id]);
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(18);
  const [bookmarked, setBookmarked] = useState(chapter.bookmark);
  const order = useMemo(() => readingOrder(siblings), [siblings]);
  const index = order.findIndex((item) => item.id === chapter.id);
  const previous = order[index - 1];
  const next = order[index + 1];

  useEffect(() => {
    let alive = true;
    if (!file) { setText(""); return; }
    file.blob.text().then((value) => { if (alive) setText(value); });
    return () => { alive = false; };
  }, [file]);

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

  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const percent = chapter.pageCount ? Math.min(100, Math.round(chapter.lastPage / chapter.pageCount * 100)) : 0;

  return (
    <div className="novel-reader">
      <header className="novel-reader-bar">
        <Link className="icon-btn" to={`/series/${encodeURIComponent(manga.id)}`} aria-label="Back to chapters" title="Back to chapters"><ArrowLeft size={19} /></Link>
        <div className="novel-reader-title"><strong>{manga.title}</strong><span>{chapter.name}</span></div>
        <button className={`icon-btn${bookmarked ? " on" : ""}`} aria-label="Bookmark chapter" aria-pressed={bookmarked} title="Bookmark" onClick={() => { const value = !bookmarked; setBookmarked(value); void setBookmark(chapter.id, value); }}><BookmarkSimple size={18} /></button>
        <button className="icon-btn" aria-label="Smaller text" title="Smaller text" disabled={fontSize <= 14} onClick={() => setFontSize((size) => Math.max(14, size - 1))}><Minus size={17} /></button>
        <button className="icon-btn" aria-label="Larger text" title="Larger text" disabled={fontSize >= 28} onClick={() => setFontSize((size) => Math.min(28, size + 1))}><Plus size={17} /></button>
      </header>
      <div className="novel-reader-progress"><i style={{ width: `${percent}%` }} /></div>
      <main className="novel-reading-scroll" ref={scroller}>
        {!file ? <div className="novel-reading-message">This novel text is not stored on this device.</div> : !text ? <div className="novel-reading-message">Loading chapter…</div> : <article className="novel-prose" style={{ fontSize }}>
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