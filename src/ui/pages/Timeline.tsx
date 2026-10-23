import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "@/core/db";
import { formatChapterNumber } from "@/core/chapterRecognition";
import { Empty, coverSrc, dayLabel, hueOf, timeAgo } from "../common";
import type { ChapterRow, MangaRow } from "@/core/types";

type Item = { c: ChapterRow; m: MangaRow };

function group(items: Item[], at: (i: Item) => number) {
  const out: [string, Item[]][] = [];
  for (const it of items) {
    const label = dayLabel(at(it));
    const last = out[out.length - 1];
    if (last?.[0] === label) last[1].push(it);
    else out.push([label, [it]]);
  }
  return out;
}

export function Timeline() {
  const [tab, setTab] = useState<"updates" | "history">("updates");

  useEffect(() => {
    localStorage.setItem("comik.timeline.seen", String(Date.now()));
  }, []);

  const updates = useLiveQuery(async () => {
    const chapters = await db.chapters.where("fetchedAt").above(0).reverse().sortBy("fetchedAt");
    const manga = new Map((await db.manga.filter((m) => m.inLibrary).toArray()).map((m) => [m.id, m]));
    return chapters.filter((c) => manga.has(c.mangaId)).slice(0, 150).map((c) => ({ c, m: manga.get(c.mangaId)! }));
  }, [], []);

  const history = useLiveQuery(async () => {
    const chapters = await db.chapters.where("readAt").above(0).reverse().sortBy("readAt");
    const manga = new Map((await db.manga.toArray()).map((m) => [m.id, m]));
    return chapters.slice(0, 200).filter((c) => manga.has(c.mangaId)).map((c) => ({ c, m: manga.get(c.mangaId)! }));
  }, [], []);

  const items = tab === "updates" ? updates : history;
  const groups = group(items ?? [], (i) => (tab === "updates" ? i.c.fetchedAt : i.c.readAt));

  return (
    <div className="page">
      <div className="topbar"><div><div className="kicker">Timeline</div><h1>{tab === "updates" ? "What dropped" : "What you read"}</h1></div></div>
      <div className="tabs" role="tablist">
        <button className={`tab${tab === "updates" ? " on" : ""}`} role="tab" onClick={() => setTab("updates")}>Updates</button>
        <button className={`tab${tab === "history" ? " on" : ""}`} role="tab" onClick={() => setTab("history")}>History</button>
      </div>
      {!items?.length && (
        <Empty
          title={tab === "updates" ? "No new chapters yet" : "No reading history"}
          body={tab === "updates" ? "When the shelf finds new chapters during an update, they land here." : "Chapters you open show up here, newest first."}
        />
      )}
      {groups.map(([label, list]) => (
        <section key={label}>
          <div className="day">{label}</div>
          <div className="stack" style={{ gap: 8 }}>
            {list.map(({ c, m }) => (
              <Link key={c.id} to={`/read/${encodeURIComponent(c.id)}`} className="list-row" data-hue={hueOf(m.id)} style={{ opacity: tab === "updates" && c.read ? 0.55 : 1 }}>
                <img src={coverSrc(m.sourceId, m.cover)} alt="" loading="lazy" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: "var(--ink)" }}>{m.title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Ch. {formatChapterNumber(c.number)}{tab === "history" && !c.read && c.lastPage > 0 ? `, page ${c.lastPage + 1}` : ""}
                    {c.name && !/^\s*(ch|chapter|ep)/i.test(c.name) ? `, ${c.name}` : ""}
                  </div>
                </div>
                <span className="mono muted" style={{ fontSize: 12 }}>{timeAgo(tab === "updates" ? c.fetchedAt : c.readAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
