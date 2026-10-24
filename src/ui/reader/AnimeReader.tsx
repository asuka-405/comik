import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import { setRead } from "@/core/repo";
import { readingOrder } from "@/core/progress";
import type { ChapterRow, MangaRow } from "@/core/types";

export function AnimeReader({ manga, chapter, siblings }: { manga: MangaRow; chapter: ChapterRow; siblings: ChapterRow[] }) {
  const nav = useNavigate();
  const order = useMemo(() => readingOrder(siblings), [siblings]);
  const index = order.findIndex((item) => item.id === chapter.id);
  const previous = order[index - 1];
  const next = order[index + 1];
  const links = manga.externalLinks ?? [];

  return <main className="anime-reader">
    <header className="anime-reader-bar">
      <Link className="icon-btn" to={`/series/${encodeURIComponent(manga.id)}`} aria-label="Back to episodes"><ArrowLeft size={19} /></Link>
      <div><strong>{manga.title}</strong><span>{chapter.name}</span></div>
    </header>
    <section className="anime-reader-content">
      <div className="kicker">Episode {chapter.number}</div>
      <h1>{chapter.name}</h1>
      <p>This catalogue tracks episodes and watch progress. Comik does not host video; choose an official provider below.</p>
      <div className="anime-provider-list">
        {links.map((link) => <a className="btn primary" key={link.url} href={link.url} target="_blank" rel="noreferrer">Watch on {link.site}</a>)}
        {manga.externalUrl && <a className="btn" href={manga.externalUrl} target="_blank" rel="noreferrer">Anime details</a>}
        {!links.length && !manga.externalUrl && <span className="muted">No legal watch destination is listed for this title.</span>}
      </div>
      <button className={`btn${chapter.read ? " primary" : ""}`} onClick={() => void setRead([chapter.id], !chapter.read)}><Check size={16} />{chapter.read ? "Watched" : "Mark watched"}</button>
    </section>
    <footer className="anime-reader-footer">
      <button className="btn" disabled={!previous} onClick={() => previous && nav(`/read/${encodeURIComponent(previous.id)}`)}><CaretLeft size={16} /> Previous</button>
      <span className="mono muted">{index + 1} / {order.length}</span>
      <button className="btn primary" disabled={!next} onClick={() => next && nav(`/read/${encodeURIComponent(next.id)}`)}>Next <CaretRight size={16} /></button>
    </footer>
  </main>;
}