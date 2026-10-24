import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { FilmSlate, MagnifyingGlass } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { getSource } from "@/core/sources/registry";
import { Empty } from "../common";

export function Anime() {
  const anime = useLiveQuery(() => db.manga.filter((item) => item.inLibrary && item.kind === "anime").toArray(), [], []);
  return <div className="page anime-page">
    <section className="hero3d"><div className="copy"><div className="kicker">Library · Anime</div><h2>Episodes and official watch links.</h2></div></section>
    <div className="novel-toolbar"><span className="muted">{anime?.length ?? 0} anime</span><Link className="btn primary" to="/browse?media=anime"><MagnifyingGlass size={16} /> Discover anime</Link></div>
    {!anime?.length ? <Empty title="No anime in your library" body="Discover an anime title to track episodes and available official watch links." action={<Link className="btn primary" to="/browse?media=anime"><MagnifyingGlass size={16} /> Discover anime</Link>} /> : <div className="novel-list">{anime.map((item) => <article className="novel-row" key={item.id}>
      <div className="novel-row-mark"><FilmSlate size={21} /></div>
      <div className="novel-row-copy"><h3>{item.title}</h3><p>{item.episodeCount ? `${item.episodeCount} episodes` : "Episode count unavailable"} · {item.status}</p></div>
      <Link className="btn sm primary" to={`/series/${encodeURIComponent(item.id)}`}>Episodes</Link>
      {item.externalUrl && <a className="btn sm" href={item.externalUrl} target="_blank" rel="noreferrer">AniList</a>}
      {item.externalLinks?.[0] && <a className="btn sm" href={item.externalLinks[0].url} target="_blank" rel="noreferrer">{item.externalLinks[0].site}</a>}
      {!getSource(item.sourceId) && <span className="muted">Source unavailable</span>}
    </article>)}</div>}
  </div>;
}