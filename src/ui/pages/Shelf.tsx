import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowsClockwise, FunnelSimple, MagnifyingGlass, Plus, Rows, SquaresFour } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { useSettings, type LibrarySort } from "@/core/settings";
import { createCategory } from "@/core/repo";
import { resumeTarget, statsOf, type LibraryStats } from "@/core/progress";
import { updateLibrary, useUpdater } from "@/core/updater";
import type { ChapterRow, MangaRow } from "@/core/types";
import { PanelField } from "../PanelField";
import { Cover, Empty, coverSrc, hueOf, timeAgo, toast } from "../common";
import { formatChapterNumber } from "@/core/chapterRecognition";

interface Entry { m: MangaRow; s: LibraryStats; chapters: ChapterRow[] }

const SORTS: [LibrarySort, string][] = [["lastRead", "Last read"], ["lastUpdate", "Latest update"], ["unread", "Unread"], ["title", "Title"], ["added", "Date added"]];

export function Shelf({ onSearch }: { onSearch: () => void }) {
  const st = useSettings();
  const nav = useNavigate();
  const [cat, setCat] = useState<string>("all");
  const [filter, setFilter] = useState("");
  const up = useUpdater();

  const data = useLiveQuery(async () => {
    const manga = await db.manga.filter((m) => m.inLibrary).toArray();
    const ids = new Set(manga.map((m) => m.id));
    const chapters = (await db.chapters.toArray()).filter((c) => ids.has(c.mangaId));
    const by = new Map<string, ChapterRow[]>();
    for (const c of chapters) (by.get(c.mangaId) ?? by.set(c.mangaId, []).get(c.mangaId)!).push(c);
    const cats = (await db.categories.orderBy("order").toArray()).filter((c) => !c.deleted);
    return { entries: manga.map<Entry>((m) => ({ m, chapters: by.get(m.id) ?? [], s: statsOf(by.get(m.id) ?? []) })), cats };
  }, []);

  const view = useMemo(() => {
    if (!data) return [];
    let list = data.entries.filter((e) => (cat === "all" ? true : e.m.categoryIds.includes(cat)));
    if (filter) list = list.filter((e) => e.m.title.toLowerCase().includes(filter.toLowerCase()));
    if (st.libraryOnlyUnread) list = list.filter((e) => e.s.unread > 0);
    const dir = st.librarySortAsc ? 1 : -1;
    const key: Record<LibrarySort, (e: Entry) => number | string> = {
      title: (e) => e.m.title.toLowerCase(), unread: (e) => e.s.unread, lastRead: (e) => e.s.lastReadAt,
      added: (e) => e.m.addedAt, lastUpdate: (e) => e.m.lastUpdateAt,
    };
    const k = key[st.librarySort];
    return [...list].sort((a, b) => (k(a) > k(b) ? dir : k(a) < k(b) ? -dir : 0));
  }, [data, cat, filter, st.libraryOnlyUnread, st.librarySort, st.librarySortAsc]);

  const resume = useMemo(
    () => (data?.entries ?? []).filter((e) => e.s.lastReadAt > 0).sort((a, b) => b.s.lastReadAt - a.s.lastReadAt).map((e) => ({ e, r: resumeTarget(e.chapters) })).filter((x) => x.r).slice(0, 10),
    [data],
  );

  const total = data?.entries.length ?? 0;
  const unreadTotal = data?.entries.reduce((n, e) => n + e.s.unread, 0) ?? 0;

  const addCategory = async () => {
    const name = prompt("Category name");
    if (name?.trim()) setCat((await createCategory(name)).id);
  };

  return (
    <div className="page">
      <section className="hero3d" aria-label="Your shelf">
        {st.fx && <PanelField mode="hero" />}
        <div className="copy">
          <div className="kicker">Your shelf</div>
          <h2>{total ? `${total} ${total === 1 ? "series" : "series"}, ${unreadTotal} unread` : "An empty shelf"}</h2>
          <p>{total ? "Pick up where you stopped, or check what dropped overnight." : "Find something in Discover and keep it here. Everything stays on this device unless you turn on sync."}</p>
        </div>
      </section>

      {resume.length > 0 && (
        <>
          <div className="kicker" style={{ marginBottom: 10 }}>Continue</div>
          <div className="resume">
            {resume.map(({ e, r }) => (
              <Link key={e.m.id} to={`/read/${encodeURIComponent(r!.chapter.id)}`} className="panel" data-hue={hueOf(e.m.id)}>
                <img src={coverSrc(e.m.sourceId, e.m.cover)} alt="" />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="t">{e.m.title}</div>
                  <div className="meter"><i style={{ width: `${Math.round(e.s.progress * 100)}%` }} /></div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    Ch. {formatChapterNumber(r!.chapter.number)}{r!.started && r!.chapter.lastPage > 0 ? `, page ${r!.chapter.lastPage + 1}` : ""}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{timeAgo(e.s.lastReadAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="topbar" style={{ marginTop: 14 }}>
        <div className="chips" style={{ flex: 1, minWidth: 0 }} role="tablist" aria-label="Categories">
          <button className={`chip${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>All <span className="mono muted">{total}</span></button>
          {data?.cats.map((c) => (
            <button key={c.id} className={`chip${cat === c.id ? " on" : ""}`} data-hue={hueOf(c.id)} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
          <button className="chip" onClick={addCategory} aria-label="New category"><Plus size={14} /></button>
        </div>
        <div style={{ position: "relative" }}>
          <MagnifyingGlass size={16} style={{ position: "absolute", left: 11, top: 12, color: "var(--muted)" }} />
          <input className="input" style={{ width: 190, paddingLeft: 34 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter shelf" aria-label="Filter shelf" />
        </div>
        <select className="input" style={{ width: "auto" }} value={st.librarySort} onChange={(e) => st.set({ librarySort: e.target.value as LibrarySort })} aria-label="Sort">
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className={`icon-btn${st.libraryOnlyUnread ? " on" : ""}`} onClick={() => st.set({ libraryOnlyUnread: !st.libraryOnlyUnread })} aria-label="Only unread" title="Only unread"><FunnelSimple size={18} /></button>
        <button className="icon-btn" onClick={() => st.set({ libraryDensity: st.libraryDensity === "cozy" ? "compact" : st.libraryDensity === "compact" ? "list" : "cozy" })} aria-label="Change density" title={`Density: ${st.libraryDensity}`}>
          {st.libraryDensity === "list" ? <Rows size={18} /> : <SquaresFour size={18} />}
        </button>
        <button className="btn" disabled={up.running || !total} onClick={async () => { await updateLibrary(); const r = useUpdater.getState(); toast(r.failed.length ? `${r.failed.length} failed, ${r.newChapters} new chapters` : `${r.newChapters} new chapters`, r.failed.length > 0); }}>
          <ArrowsClockwise size={16} className={up.running ? "spin" : ""} />{up.running ? `${up.done}/${up.total}` : "Update"}
        </button>
      </div>
      {up.running && <div className="progress-line" style={{ marginBottom: 14 }}><i style={{ width: `${(up.done / Math.max(up.total, 1)) * 100}%` }} /></div>}

      {!data && <div className="grid">{Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: "2/3" }} />)}</div>}
      {data && !view.length && (
        total === 0 ? (
          <Empty title="Nothing here yet" body="Browse a source and press Add to shelf on anything you want to follow. You can also import CBZ files from Settings." action={<div style={{ display: "flex", gap: 10 }}><button className="btn primary" onClick={() => nav("/browse")}>Discover</button><button className="btn" onClick={onSearch}>Search</button></div>} />
        ) : (
          <Empty title="No match" body="Nothing on this shelf fits the current category or filter." />
        )
      )}
      {st.libraryDensity === "list" ? (
        <div className="stack" style={{ gap: 10 }}>
          {view.map(({ m, s }) => (
            <Link key={m.id} to={`/series/${encodeURIComponent(m.id)}`} className="list-row" data-hue={hueOf(m.id)}>
              <img src={coverSrc(m.sourceId, m.cover)} alt="" loading="lazy" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, color: "var(--ink)" }}>{m.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{s.total} chapters, {timeAgo(s.lastReadAt) || "not started"}</div>
              </div>
              {s.unread > 0 && st.libraryUnreadBadge && <span className="tag">{s.unread}</span>}
            </Link>
          ))}
        </div>
      ) : (
        <div className={`grid${st.libraryDensity === "compact" ? " compact" : ""}`}>
          {view.map(({ m, s }) => (
            <Cover key={m.id} m={m} unread={st.libraryUnreadBadge ? s.unread : 0} progress={s.progress} sub={s.lastReadAt ? timeAgo(s.lastReadAt) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
