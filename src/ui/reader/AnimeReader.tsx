import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import { setRead } from "@/core/repo";
import { readingOrder } from "@/core/progress";
import { getSource } from "@/core/sources/registry";
import type { ChapterRow, MangaRow } from "@/core/types";
import { AnimePlayer } from "./AnimePlayer";

/** One episode: a video player when the source is a connector, otherwise links to the official services. */
export function AnimeReader({ manga, chapter, siblings }: { manga: MangaRow; chapter: ChapterRow; siblings: ChapterRow[] }) {
  const nav = useNavigate();
  const order = useMemo(() => readingOrder(siblings), [siblings]);
  const index = order.findIndex((item) => item.id === chapter.id);
  const previous = order[index - 1];
  const next = order[index + 1];
  const links = manga.externalLinks ?? [];
  const source = getSource(manga.sourceId);
  const playable = !!source?.getStreams;
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem("comik.anime.autonext") !== "0");
  const goNext = () => next && nav(`/read/${encodeURIComponent(next.id)}`, { replace: true });

  return <main className="anime-reader">
    <header className="anime-reader-bar">
      <Link className="icon-btn" to={`/series/${encodeURIComponent(manga.id)}`} aria-label="Back to episodes"><ArrowLeft size={19} /></Link>
      <div><strong>{manga.title}</strong><span>{chapter.name}</span></div>
    </header>
    <section className="anime-reader-content">
      {playable && source ? <AnimePlayer key={chapter.id} source={source} manga={manga} chapter={chapter} onEnded={goNext} autoNext={autoNext && !!next} /> : (
        <>
          <div className="kicker">Episode {chapter.number}</div>
          <h1>{chapter.name}</h1>
          <p>This catalogue tracks episodes and watch progress. Comik does not host video; choose an official provider below.</p>
          <div className="anime-provider-list">
            {links.map((link) => <a className="btn primary" key={link.url} href={link.url} target="_blank" rel="noreferrer">Watch on {link.site}</a>)}
            {manga.externalUrl && <a className="btn" href={manga.externalUrl} target="_blank" rel="noreferrer">Anime details</a>}
            {!links.length && !manga.externalUrl && <span className="muted">No legal watch destination is listed for this title.</span>}
          </div>
        </>
      )}
      {playable && (
        <div className="anime-episode-info">
          <div className="kicker">{chapter.seasonTitle ? `${chapter.seasonTitle} · ` : ""}Episode {chapter.number}{chapter.duration ? ` · ${Math.round(chapter.duration / 60)} min` : ""}{chapter.filler ? " · Filler" : ""}</div>
          <h1>{chapter.name}</h1>
          {chapter.description && <p>{chapter.description}</p>}
          <label className="anime-autonext"><input type="checkbox" checked={autoNext} onChange={(event) => { setAutoNext(event.target.checked); localStorage.setItem("comik.anime.autonext", event.target.checked ? "1" : "0"); }} /> Play the next episode automatically</label>
        </div>
      )}
      <button className={`btn${chapter.read ? " primary" : ""}`} onClick={() => void setRead([chapter.id], !chapter.read)}><Check size={16} />{chapter.read ? "Watched" : "Mark watched"}</button>
    </section>
    <footer className="anime-reader-footer">
      <button className="btn" disabled={!previous} onClick={() => previous && nav(`/read/${encodeURIComponent(previous.id)}`)}><CaretLeft size={16} /> Previous</button>
      <span className="mono muted">{index + 1} / {order.length}</span>
      <button className="btn primary" disabled={!next} onClick={() => next && nav(`/read/${encodeURIComponent(next.id)}`)}>Next <CaretRight size={16} /></button>
    </footer>
  </main>;
}
