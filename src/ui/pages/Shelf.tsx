import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, ArrowsClockwise, CaretDown, CaretUp, Check, FunnelSimple, LockKey, MagnifyingGlass, PencilSimple, Plus, Rows, SlidersHorizontal, SquaresFour, Tag, Trash, X } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { useSettings, type LibraryGridColumns, type LibrarySort } from "@/core/settings";
import { createCategory, deleteCategory, editCategoriesOf, moveCategory, removeFromLibrary, renameCategory, setSeriesRead, setVault } from "@/core/repo";
import { importNovel } from "@/core/novels";
import { getSource } from "@/core/sources/registry";
import { resumeTarget, statsOf, type LibraryStats } from "@/core/progress";
import { updateLibrary, useUpdater } from "@/core/updater";
import { mediaOf, type CategoryRow, type ChapterRow, type MangaRow, type MediaKind } from "@/core/types";
import { MEDIA } from "../media";
import { PanelField } from "../PanelField";
import { ConfirmDialog, Cover, Empty, Sheet, TextDialog, coverSrc, hueOf, timeAgo, toast, useLongPress } from "../common";
import { formatChapterNumber } from "@/core/chapterRecognition";

interface Entry { m: MangaRow; s: LibraryStats; chapters: ChapterRow[] }
const shelfSnapshots = new Map<MediaKind, { entries: Entry[]; cats: CategoryRow[] }>();

const SORTS: [LibrarySort, string][] = [["lastRead", "Last read"], ["lastUpdate", "Latest update"], ["unread", "Unread"], ["title", "Title"], ["added", "Date added"]];

export function Shelf({ onSearch, kind = "comic" }: { onSearch: () => void; kind?: MediaKind }) {
  const words = MEDIA[kind];
  const st = useSettings();
  const nav = useNavigate();
  const [cat, setCat] = useState<string>("all");
  const [filter, setFilter] = useState("");
  const [tools, setTools] = useState(false);
  const up = useUpdater();
  const picker = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Each media shelf starts clean: the tab and filter of the comic shelf mean nothing on the anime shelf.
  useEffect(() => { setCat("all"); setFilter(""); setSelecting(false); setPicked(new Set()); }, [kind]);

  const data = useLiveQuery(async () => {
    const manga = (await db.manga.where("libraryFlag").equals(1).toArray()).filter((item) => mediaOf(item) === kind);
    const ids = new Set(manga.map((m) => m.id));
    const chapters = ids.size ? await db.chapters.where("mangaId").anyOf([...ids]).toArray() : [];
    const by = new Map<string, ChapterRow[]>();
    for (const c of chapters) (by.get(c.mangaId) ?? by.set(c.mangaId, []).get(c.mangaId)!).push(c);
    const cats = (await db.categories.where("kind").equals(kind).sortBy("order")).filter((c) => !c.deleted);
    const result = { entries: manga.map<Entry>((m) => ({ m, chapters: by.get(m.id) ?? [], s: statsOf(by.get(m.id) ?? []) })), cats };
    shelfSnapshots.set(kind, result);
    return result;
  }, [kind], shelfSnapshots.get(kind));

  const safeEntries = useMemo(() => (data?.entries ?? []).filter((entry) => mediaOf(entry.m) === kind && !entry.m.vault && (!st.safeMode || !getSource(entry.m.sourceId)?.isNsfw)), [data, st.safeMode, kind]);

  const view = useMemo(() => {
    if (!data) return [];
    let list = safeEntries.filter((e) => (cat === "all" ? true : e.m.categoryIds.includes(cat)));
    if (filter) list = list.filter((e) => e.m.title.toLowerCase().includes(filter.toLowerCase()));
    if (st.libraryOnlyUnread) list = list.filter((e) => e.s.unread > 0);
    const dir = st.librarySortAsc ? 1 : -1;
    const key: Record<LibrarySort, (e: Entry) => number | string> = {
      title: (e) => e.m.title.toLowerCase(), unread: (e) => e.s.unread, lastRead: (e) => e.s.lastReadAt,
      added: (e) => e.m.addedAt, lastUpdate: (e) => e.m.lastUpdateAt,
    };
    const k = key[st.librarySort];
    return [...list].sort((a, b) => (k(a) > k(b) ? dir : k(a) < k(b) ? -dir : 0));
  }, [data, safeEntries, cat, filter, st.libraryOnlyUnread, st.librarySort, st.librarySortAsc]);

  const resume = useMemo(
    () => safeEntries.filter((e) => e.s.lastReadAt > 0).sort((a, b) => b.s.lastReadAt - a.s.lastReadAt).map((e) => ({ e, r: resumeTarget(e.chapters) })).filter((x) => x.r).slice(0, 10),
    [safeEntries],
  );

  const total = safeEntries.length;
  const unreadTotal = safeEntries.reduce((n, e) => n + e.s.unread, 0);
  const gridStyle = st.libraryGridColumns === "auto"
    ? undefined
    : { gridTemplateColumns: `repeat(${st.libraryGridColumns}, minmax(0, 1fr))` };

  /* ----- multi-select ----- */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [dialog, setDialog] = useState<null | "new" | "manage" | "categories" | "move" | "remove" | { rename: CategoryRow } | { drop: CategoryRow }>(null);
  const pickedIds = [...picked];
  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (!next.delete(id)) next.add(id); return next; });
  const startSelecting = (id?: string) => { setSelecting(true); if (id) setPicked(new Set([id])); };
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const selectAllShown = () => setPicked(new Set(view.map((e) => e.m.id)));
  const select = (id: string) => ({ selecting, selected: picked.has(id), onPick: () => toggle(id) });

  // Series that leave the view (filters, safe mode, another tab) cannot stay selected invisibly.
  useEffect(() => {
    const visible = new Set(view.map((e) => e.m.id));
    setPicked((cur) => (cur.size && [...cur].some((id) => !visible.has(id)) ? new Set([...cur].filter((id) => visible.has(id))) : cur));
  }, [view]);
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && !dialog && stopSelecting();
    const onPopState = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      window.history.go(1);
      if (dialog) setDialog(null);
      stopSelecting();
    };
    addEventListener("keydown", onKeyDown);
    addEventListener("popstate", onPopState, true);
    return () => {
      removeEventListener("keydown", onKeyDown);
      removeEventListener("popstate", onPopState, true);
    };
  }, [selecting, dialog]);

  const done = (msg: string) => { toast(msg); setDialog(null); stopSelecting(); };
  const count = (n: number) => `${n} ${n === 1 ? "title" : "titles"}`;
  const activeTools = (filter ? 1 : 0) + (st.libraryOnlyUnread ? 1 : 0);
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    try {
      for (const file of Array.from(files)) await importNovel(file);
      toast(`Imported ${files.length} novel${files.length === 1 ? "" : "s"}`);
    } catch (cause) {
      toast((cause as Error).message || "Could not import that novel.", true);
    } finally {
      setImporting(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <div className="page">
      <section className="hero3d" aria-label={words.shelfKicker}>
        {st.fx && <PanelField mode="hero" />}
        <div className="copy">
          <div className="kicker">{words.shelfKicker}</div>
          <h2>{total ? `${total} ${total === 1 ? "title" : "titles"}, ${unreadTotal} ${kind === "anime" ? "unwatched" : "unread"}` : kind === "comic" ? "An empty shelf" : `No ${words.plural.toLowerCase()} yet`}</h2>
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
                    {words.short} {formatChapterNumber(r!.chapter.number)}{kind === "comic" && r!.started && r!.chapter.lastPage > 0 ? `, page ${r!.chapter.lastPage + 1}` : ""}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{timeAgo(e.s.lastReadAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="shelf-toolbar">
        <div className="shelf-tabrow">
        <div className="chips shelf-tabs" role="tablist" aria-label="Shelf tabs">
          <button className={`chip${cat === "all" ? " on" : ""}`} onClick={() => setCat("all")}>All <span className="mono muted">{total}</span></button>
          {data?.cats.map((c) => (
            <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip${cat === c.id ? " on" : ""}`} data-hue={hueOf(c.id)} onClick={() => setCat(c.id)}>{c.name}</button>
          ))}
          <button className="chip" onClick={() => setDialog("new")} aria-label="New shelf tab" title="New shelf tab"><Plus size={14} /></button>
        </div>
          <button className="icon-btn" onClick={() => setDialog("manage")} aria-label="Manage shelf tabs" title="Manage tabs"><PencilSimple size={17} /></button>
        </div>
        <div className="shelf-bar">
          <button className={`btn shelf-tools-toggle${tools ? " on" : ""}`} onClick={() => setTools((v) => !v)} aria-expanded={tools} aria-controls="shelf-tools">
            <SlidersHorizontal size={16} />Filter and sort{activeTools > 0 && <span className="tag">{activeTools}</span>}{tools ? <CaretUp size={14} /> : <CaretDown size={14} />}
          </button>
          {kind === "novel" && <>
            <input ref={picker} type="file" accept=".epub,.txt,application/epub+zip,text/plain" multiple hidden onChange={(event) => void importFiles(event.target.files)} />
            <button className="btn" disabled={importing} onClick={() => picker.current?.click()}><Plus size={16} />{importing ? "Importing…" : "Import"}</button>
          </>}
          <button className="btn" disabled={up.running || !total} onClick={async () => { await updateLibrary(safeEntries.map((e) => e.m).filter((m) => m.sourceId !== "local")); const r = useUpdater.getState(); toast(r.failed.length ? `${r.failed.length} failed, ${r.newChapters} new ${words.units}` : `${r.newChapters} new ${words.units}`, r.failed.length > 0); }}>
            <ArrowsClockwise size={16} className={up.running ? "spin" : ""} />{up.running ? `${up.done}/${up.total}` : "Update"}
          </button>
        </div>
        {tools && (
          <div className="shelf-controls" id="shelf-tools">
            <div className="shelf-filter-wrap">
              <MagnifyingGlass size={16} style={{ position: "absolute", left: 11, top: 12, color: "var(--muted)" }} />
              <input className="input shelf-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${words.plural.toLowerCase()}`} aria-label="Filter shelf" />
            </div>
            <select className="input shelf-sort" value={st.librarySort} onChange={(e) => st.set({ librarySort: e.target.value as LibrarySort })} aria-label="Sort">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {st.libraryDensity !== "list" && <select className="input shelf-grid-columns" value={st.libraryGridColumns} onChange={(e) => st.set({ libraryGridColumns: e.target.value === "auto" ? "auto" : Number(e.target.value) as LibraryGridColumns })} aria-label="Grid columns">
              <option value="auto">Auto columns</option>
              {[2, 3, 4, 5, 6].map((columns) => <option key={columns} value={columns}>{columns} columns</option>)}
            </select>}
            <button className={`icon-btn${st.libraryOnlyUnread ? " on" : ""}`} onClick={() => st.set({ libraryOnlyUnread: !st.libraryOnlyUnread })} aria-label="Only unread" title="Only unread"><FunnelSimple size={18} /></button>
            <button className="icon-btn" onClick={() => st.set({ libraryDensity: st.libraryDensity === "cozy" ? "compact" : st.libraryDensity === "compact" ? "list" : "cozy" })} aria-label="Change density" title={`Density: ${st.libraryDensity}`}>
              {st.libraryDensity === "list" ? <Rows size={18} /> : <SquaresFour size={18} />}
            </button>
            <button className="btn" disabled={!view.length} onClick={() => { setSelecting(true); selectAllShown(); setTools(false); }}><Check size={16} /> Select all</button>
          </div>
        )}
      </div>
      {up.running && <div className="progress-line" style={{ marginBottom: 14 }}><i style={{ width: `${(up.done / Math.max(up.total, 1)) * 100}%` }} /></div>}

      {!data && <div className="grid" style={gridStyle}>{Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ aspectRatio: "2/3" }} />)}</div>}
      {data && !view.length && (
        total === 0 ? (
          <Empty title={`No ${words.plural.toLowerCase()} here yet`} body={kind === "comic" ? "Browse a source and press Add to shelf on anything you want to follow. You can also import CBZ files from Settings." : kind === "novel" ? "Add a web novel from Discover, or import an EPUB or TXT file." : "Add an anime from Discover to track episodes and find where to watch."} action={<div style={{ display: "flex", gap: 10 }}><button className="btn primary" onClick={() => nav(words.discover)}>Discover</button><button className="btn" onClick={onSearch}>Search</button></div>} />
        ) : (
          <Empty title="No match" body="Nothing on this shelf fits the current category or filter." />
        )
      )}
      {st.libraryDensity === "list" ? (
        <div className="stack" style={{ gap: 10 }}>
          {view.map(({ m, s }) => <ListRow key={m.id} m={m} s={s} words={words} badge={st.libraryUnreadBadge} sel={selecting ? select(m.id) : undefined} onHold={() => startSelecting(m.id)} />)}
        </div>
      ) : (
        <div className={`grid${st.libraryDensity === "compact" ? " compact" : ""}`} style={gridStyle}>
          {view.map(({ m, s }) => (
            <Cover key={m.id} m={m} unread={st.libraryUnreadBadge ? s.unread : 0} progress={s.progress} sub={s.lastReadAt ? timeAgo(s.lastReadAt) : undefined} select={selecting ? select(m.id) : undefined} onHold={() => startSelecting(m.id)} />
          ))}
        </div>
      )}

      {selecting && (
        <div className="selbar shelf-selbar" role="toolbar" aria-label="Selected series">
          <span className="selbar-count mono">{picked.size} selected</span>
          <button className="btn sm" onClick={picked.size === view.length ? () => setPicked(new Set()) : selectAllShown}>{picked.size === view.length && view.length > 0 ? "None" : "All"}</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => setDialog("categories")}><Tag size={15} /> Tabs</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => setDialog("move")}>Move to</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => void setSeriesRead(pickedIds, true).then(() => done(`Marked ${count(picked.size)} as read`))}><Check size={15} /> Read</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => void setVault(pickedIds, true).then(() => done(`Moved ${count(picked.size)} to the Vault`))}><LockKey size={15} /> Vault</button>
          <button className="btn sm danger" disabled={!picked.size} onClick={() => setDialog("remove")}><Trash size={15} /> Remove</button>
          <button className="icon-btn" onClick={stopSelecting} aria-label="Done selecting" title="Done"><X size={17} /></button>
        </div>
      )}

      {dialog === "new" && (
        <TextDialog title="New shelf tab" label="Tab name" action="Create" onClose={() => setDialog(null)} onSubmit={async (name) => {
          const row = await createCategory(name, kind);
          setCat(row.id);
          setDialog(null);
        }} />
      )}
      {dialog === "manage" && data && (
        <Sheet title="Shelf tabs" onClose={() => setDialog(null)} center>
          {!data.cats.length && <p className="muted">No tabs yet. Tabs group your shelf, like Reading or Finished.</p>}
          <ul className="cat-list">
            {data.cats.map((c, i) => {
              const n = safeEntries.filter((e) => e.m.categoryIds.includes(c.id)).length;
              return (
                <li key={c.id} className="cat-row" data-hue={hueOf(c.id)}>
                  <span className="cat-name">{c.name}</span>
                  <span className="mono muted">{n}</span>
                  <button className="icon-btn" disabled={i === 0} onClick={() => void moveCategory(c.id, -1)} aria-label={`Move ${c.name} up`} title="Move up"><ArrowUp size={16} /></button>
                  <button className="icon-btn" disabled={i === data.cats.length - 1} onClick={() => void moveCategory(c.id, 1)} aria-label={`Move ${c.name} down`} title="Move down"><ArrowDown size={16} /></button>
                  <button className="icon-btn" onClick={() => setDialog({ rename: c })} aria-label={`Rename ${c.name}`} title="Rename"><PencilSimple size={16} /></button>
                  <button className="icon-btn" onClick={() => setDialog({ drop: c })} aria-label={`Delete ${c.name}`} title="Delete"><Trash size={16} /></button>
                </li>
              );
            })}
          </ul>
          <div className="dialog-actions"><button className="btn" onClick={() => setDialog("new")}><Plus size={15} /> New tab</button></div>
        </Sheet>
      )}
      {dialog && typeof dialog === "object" && "rename" in dialog && (
        <TextDialog title="Rename tab" label="Tab name" initial={dialog.rename.name} action="Save" onClose={() => setDialog("manage")} onSubmit={async (name) => { await renameCategory(dialog.rename.id, name); setDialog("manage"); }} />
      )}
      {dialog && typeof dialog === "object" && "drop" in dialog && (
        <ConfirmDialog title={`Delete “${dialog.drop.name}”?`} body="The tab goes away. The series in it stay on your shelf, under All." action="Delete tab" danger onClose={() => setDialog("manage")} onConfirm={async () => {
          const id = dialog.drop.id;
          await deleteCategory(id);
          if (cat === id) setCat("all");
          setDialog("manage");
        }} />
      )}
      {dialog === "categories" && data && (
        <CategorySheet cats={data.cats} entries={safeEntries.filter((e) => picked.has(e.m.id))} onNew={() => setDialog("new")} onClose={() => setDialog(null)} />
      )}
      {dialog === "move" && data && (
        <Sheet title={`Move ${count(picked.size)} to`} onClose={() => setDialog(null)} center>
          <p className="muted" style={{ marginBottom: 12 }}>Replaces the tabs these series are in now.</p>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {data.cats.map((c) => <button key={c.id} className="chip" data-hue={hueOf(c.id)} onClick={() => void editCategoriesOf(pickedIds, { set: [c.id] }).then(() => done(`Moved ${count(picked.size)} to ${c.name}`))}>{c.name}</button>)}
            <button className="chip" onClick={() => void editCategoriesOf(pickedIds, { set: [] }).then(() => done(`Took ${count(picked.size)} out of every tab`))}>No tab</button>
            <button className="chip" onClick={() => setDialog("new")}><Plus size={14} /> New tab</button>
          </div>
        </Sheet>
      )}
      {dialog === "remove" && (
        <ConfirmDialog title={`Remove ${count(picked.size)} from your shelf?`} body="Reading progress and downloads are kept. You can add them back from their page." action="Remove" danger onClose={() => setDialog(null)} onConfirm={() => void removeFromLibrary(pickedIds).then(() => done(`Removed ${count(picked.size)}`))} />
      )}
    </div>
  );
}

function ListRow({ m, s, badge, words, sel, onHold }: { m: MangaRow; s: LibraryStats; badge: boolean; words: (typeof MEDIA)[MediaKind]; sel?: { selecting: boolean; selected: boolean; onPick: () => void }; onHold: () => void }) {
  const press = useLongPress(onHold);
  return (
    <Link
      to={`/series/${encodeURIComponent(m.id)}`}
      className={`list-row${sel?.selected ? " picked" : ""}`}
      data-hue={hueOf(m.id)}
      {...press.handlers}
      onClick={(e) => {
        if (press.held.current) { e.preventDefault(); press.held.current = false; return; }
        if (sel) { e.preventDefault(); sel.onPick(); }
      }}
    >
      {sel && <span className={`pick inline${sel.selected ? " on" : ""}`} aria-hidden="true">{sel.selected && <Check size={14} weight="bold" />}</span>}
      <img src={coverSrc(m.sourceId, m.cover)} alt="" loading="lazy" draggable={false} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: "var(--ink)" }}>{m.title}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>{s.total} {s.total === 1 ? words.unit : words.units}, {timeAgo(s.lastReadAt) || "not started"}</div>
      </div>
      {s.unread > 0 && badge && <span className="tag">{s.unread}</span>}
    </Link>
  );
}

/** Tick a tab to put every selected series in it, untick to take them out. A dash means only some are in it. */
function CategorySheet({ cats, entries, onNew, onClose }: { cats: CategoryRow[]; entries: Entry[]; onNew: () => void; onClose: () => void }) {
  const ids = entries.map((e) => e.m.id);
  return (
    <Sheet title={`Tabs for ${entries.length} ${entries.length === 1 ? "title" : "titles"}`} onClose={onClose} center>
      {!cats.length && <p className="muted" style={{ marginBottom: 12 }}>No tabs yet. Make one to start grouping.</p>}
      <ul className="cat-list">
        {cats.map((c) => {
          const have = entries.filter((e) => e.m.categoryIds.includes(c.id)).length;
          const state = have === 0 ? "none" : have === entries.length ? "all" : "some";
          return (
            <li key={c.id}>
              <button className="cat-row cat-pick" data-hue={hueOf(c.id)} role="checkbox" aria-checked={state === "all" ? true : state === "some" ? "mixed" : false} onClick={() => void editCategoriesOf(ids, state === "all" ? { remove: [c.id] } : { add: [c.id] })}>
                <span className={`pick inline${state === "none" ? "" : " on"}`} aria-hidden="true">{state === "all" ? <Check size={14} weight="bold" /> : state === "some" ? <span className="dash" /> : null}</span>
                <span className="cat-name">{c.name}</span>
                <span className="mono muted">{have}/{entries.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="dialog-actions">
        <button className="btn" onClick={onNew}><Plus size={15} /> New tab</button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
