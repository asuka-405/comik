import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db";
import { coverSrc } from "./common";

interface Item { key: string; label: string; group: string; img?: string; run: () => void }

/** Ctrl+K: jump to a series on the shelf, a page, or search every source at once. */
export function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const library = useLiveQuery(() => db.manga.filter((m) => m.inLibrary).toArray(), [], []);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { nav(to); onClose(); };
    const s = q.trim().toLowerCase();
    const pages: Item[] = [
      { key: "p-shelf", label: "Shelf", group: "Go to", run: go("/") },
      { key: "p-disc", label: "Discover sources", group: "Go to", run: go("/browse") },
      { key: "p-time", label: "Timeline", group: "Go to", run: go("/timeline") },
      { key: "p-set", label: "Settings", group: "Go to", run: go("/settings") },
    ].filter((p) => !s || p.label.toLowerCase().includes(s));
    const series: Item[] = (library ?? [])
      .filter((m) => !s || m.title.toLowerCase().includes(s))
      .slice(0, 8)
      .map((m) => ({ key: m.id, label: m.title, group: "On your shelf", img: coverSrc(m.sourceId, m.cover), run: go(`/series/${encodeURIComponent(m.id)}`) }));
    const web: Item[] = s ? [{ key: "web", label: `Search every source for "${q.trim()}"`, group: "Search", run: go(`/browse?q=${encodeURIComponent(q.trim())}`) }] : [];
    return [...web, ...series, ...pages];
  }, [q, library, nav, onClose]);

  useEffect(() => setSel(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") items[sel]?.run();
    else if (e.key === "Escape") onClose();
  };

  let last = "";
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search your shelf, or every source" aria-label="Search" />
        <div className="res">
          {items.map((it, i) => {
            const head = it.group !== last ? <div className="grp" key={`g-${it.group}`}>{it.group}</div> : null;
            last = it.group;
            return (
              <div key={it.key}>
                {head}
                <button className={`item${i === sel ? " sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
                  {it.img ? <img src={it.img} alt="" /> : null}
                  <span>{it.label}</span>
                </button>
              </div>
            );
          })}
          {!items.length && <div className="grp">Nothing yet. Type a title.</div>}
        </div>
      </div>
    </div>
  );
}
