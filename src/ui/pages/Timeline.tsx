import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CaretDown, CaretUp, Trash } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { useSettings } from "@/core/settings";
import { getSource } from "@/core/sources/registry";
import { clearHistory, historyIdsSince, removeFromHistory } from "@/core/repo";
import { formatChapterNumber } from "@/core/chapterRecognition";
import { ConfirmDialog, Empty, Sheet, coverSrc, dayLabel, hueOf, timeAgo, toast } from "../common";
import type { ChapterRow, MangaRow } from "@/core/types";

type Item = { c: ChapterRow; m: MangaRow };
/** Consecutive entries of one comic inside a day, newest first. */
type Run = { m: MangaRow; items: Item[] };

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

/** Club neighbours from the same comic. Another comic in between ends the run. */
function clubRuns(items: Item[]): Run[] {
  const runs: Run[] = [];
  for (const it of items) {
    const last = runs[runs.length - 1];
    if (last && last.m.id === it.m.id) last.items.push(it);
    else runs.push({ m: it.m, items: [it] });
  }
  return runs;
}

function chapterLabel(c: ChapterRow, history: boolean) {
  const extra = c.name && !/^\s*(ch|chapter|ep)/i.test(c.name) ? `, ${c.name}` : "";
  return `Ch. ${formatChapterNumber(c.number)}${history && !c.read && c.lastPage > 0 ? `, page ${c.lastPage + 1}` : ""}${extra}`;
}

function rangeLabel(items: Item[]) {
  const nums = items.map((i) => i.c.number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return `${items.length} chapters`;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `${items.length} chapters` : `Ch. ${formatChapterNumber(lo)} to ${formatChapterNumber(hi)}, ${items.length} chapters`;
}

const WINDOWS: [string, number | undefined][] = [
  ["Last hour", 36e5],
  ["Last 24 hours", 864e5],
  ["Last 7 days", 7 * 864e5],
  ["Last 30 days", 30 * 864e5],
  ["All history", undefined],
];

export function Timeline() {
  const [tab, setTab] = useState<"updates" | "history">("updates");
  const [clearing, setClearing] = useState<null | "pick" | { label: string; since?: number; count: number }>(null);
  const safeMode = useSettings((s) => s.safeMode);

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

  const isHistory = tab === "history";
  const items = isHistory ? history : updates;
  const visibleItems = (items ?? []).filter(({ m }) => !safeMode || !getSource(m.sourceId)?.isNsfw);
  const groups = group(visibleItems, (i) => (isHistory ? i.c.readAt : i.c.fetchedAt));

  const pickWindow = async (label: string, span?: number) => {
    const since = span === undefined ? undefined : Date.now() - span;
    const count = (await historyIdsSince(since)).length;
    if (!count) {
      toast(`Nothing in history for “${label.toLowerCase()}”`);
      return;
    }
    setClearing({ label, since, count });
  };

  return (
    <div className="page">
      <div className="topbar">
        <div><div className="kicker">Timeline</div><h1>{isHistory ? "What you read" : "What dropped"}</h1></div>
        {isHistory && visibleItems.length > 0 && <button className="btn" onClick={() => setClearing("pick")}><Trash size={16} /> Clear history</button>}
      </div>
      <div className="tabs" role="tablist">
        <button className={`tab${tab === "updates" ? " on" : ""}`} role="tab" onClick={() => setTab("updates")}>Updates</button>
        <button className={`tab${isHistory ? " on" : ""}`} role="tab" onClick={() => setTab("history")}>History</button>
      </div>
      {!visibleItems.length && (
        <Empty
          title={isHistory ? "No reading history" : "No new chapters yet"}
          body={isHistory ? "Chapters you open show up here, newest first." : "When the shelf finds new chapters during an update, they land here."}
        />
      )}
      {groups.map(([label, list]) => (
        <section key={label}>
          <div className="day">{label}</div>
          <div className="stack" style={{ gap: 8 }}>
            {clubRuns(list).map((run) => <RunRow key={run.items[0]!.c.id} run={run} history={isHistory} />)}
          </div>
        </section>
      ))}

      {clearing === "pick" && (
        <Sheet title="Clear history" onClose={() => setClearing(null)} center>
          <p className="muted" style={{ marginBottom: 12 }}>Removes entries from this list. Chapters stay marked as read and keep their page, and your shelf is untouched.</p>
          <div className="stack" style={{ gap: 8 }}>
            {WINDOWS.map(([label, span]) => <button key={label} className={`btn${span === undefined ? " danger" : ""}`} onClick={() => void pickWindow(label, span)}>{label}</button>)}
          </div>
        </Sheet>
      )}
      {clearing && typeof clearing === "object" && (
        <ConfirmDialog
          title={`Clear “${clearing.label.toLowerCase()}”?`}
          body={`${clearing.count} history ${clearing.count === 1 ? "entry" : "entries"} will be removed. This also clears them on your other devices when sync is on.`}
          action="Clear"
          danger
          onClose={() => setClearing("pick")}
          onConfirm={async () => {
            const n = await clearHistory(clearing.since);
            setClearing(null);
            toast(`Cleared ${n} ${n === 1 ? "entry" : "entries"}`);
          }}
        />
      )}
    </div>
  );
}

/** One comic's neighbouring chapters. A single chapter is a plain row; several fold into one that opens. */
function RunRow({ run, history }: { run: Run; history: boolean }) {
  const [open, setOpen] = useState(false);
  const { m, items } = run;
  const newest = items[0]!.c;
  const at = (c: ChapterRow) => (history ? c.readAt : c.fetchedAt);
  const dim = !history && items.every((i) => i.c.read);
  const clubbed = items.length > 1;

  const drop = (ids: string[]) => void removeFromHistory(ids).then(() => toast(ids.length > 1 ? `Removed ${ids.length} entries` : "Removed from history"));

  return (
    <div className="tl-item" data-hue={hueOf(m.id)}>
      <div className="tl-main">
        <Link to={`/read/${encodeURIComponent(newest.id)}`} className="list-row" data-hue={hueOf(m.id)} style={{ opacity: dim ? 0.55 : 1 }}>
          <img src={coverSrc(m.sourceId, m.cover)} alt="" loading="lazy" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: "var(--ink)" }}>{m.title}</div>
            <div className="muted" style={{ fontSize: 13 }}>{clubbed ? rangeLabel(items) : chapterLabel(newest, history)}</div>
          </div>
          <span className="mono muted" style={{ fontSize: 12 }}>{timeAgo(at(newest))}</span>
        </Link>
        {clubbed && <button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? `Hide chapters of ${m.title}` : `Show ${items.length} chapters of ${m.title}`} title={open ? "Hide chapters" : "Show chapters"}>{open ? <CaretUp size={16} /> : <CaretDown size={16} />}</button>}
        {history && <button className="icon-btn" onClick={() => drop(items.map((i) => i.c.id))} aria-label={clubbed ? `Remove ${items.length} chapters of ${m.title} from history` : `Remove ${m.title} from history`} title="Remove from history"><Trash size={16} /></button>}
      </div>
      {clubbed && open && (
        <ul className="tl-sub">
          {items.map(({ c }) => (
            <li key={c.id}>
              <Link to={`/read/${encodeURIComponent(c.id)}`} className="tl-sub-link">
                <span>{chapterLabel(c, history)}</span>
                <span className="mono muted">{timeAgo(at(c))}</span>
              </Link>
              {history && <button className="icon-btn" onClick={() => drop([c.id])} aria-label={`Remove ${chapterLabel(c, history)} from history`} title="Remove from history"><Trash size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
