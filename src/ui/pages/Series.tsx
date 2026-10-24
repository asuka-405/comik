import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowsDownUp, ArrowsLeftRight, BookmarkSimple, CaretLeft, CaretRight, Check, DownloadSimple, Play, Plus, Trash, ArrowsClockwise, ShareNetwork, Tag } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, getSource } from "@/core/sources/registry";
import { useSettings } from "@/core/settings";
import { findDuplicates, markPreviousRead, migrateManga, setBookmark, setInLibrary, setMangaCategories, setRead, patchManga, syncChapters, upsertManga } from "@/core/repo";
import { refreshManga } from "@/core/updater";
import { resumeTarget, readingOrder, dedupeByNumber } from "@/core/progress";
import { formatChapterNumber, missingBetween } from "@/core/chapterRecognition";
import { deleteDownloads, enqueueDownloads } from "@/core/downloads";
import type { ChapterRow, SManga } from "@/core/types";
import { Empty, FloatBack, ReadingNotice, Sheet, coverSrc, hueOf, timeAgo, toast } from "../common";
import { dominantColor } from "../color";

type Filt = "unread" | "bookmarked" | "downloaded";
const CHAPTERS_PER_PAGE = 50;

export function Series() {
  const id = decodeURIComponent(useParams().id ?? "");
  const nav = useNavigate();
  const safeMode = useSettings((s) => s.safeMode);
  const manga = useLiveQuery(() => db.manga.get(id), [id]);
  const chapters = useLiveQuery(() => db.chapters.where("mangaId").equals(id).toArray(), [id], [] as ChapterRow[]);
  const chapterCount = useLiveQuery(() => db.chapters.where("mangaId").equals(id).count(), [id]);
  const downloads = useLiveQuery(() => db.downloads.where("mangaId").equals(id).toArray(), [id], []);
  const cats = useLiveQuery(() => db.categories.orderBy("order").toArray().then((c) => c.filter((x) => !x.deleted)), [], []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Set<Filt>>(new Set());
  const [catSheet, setCatSheet] = useState(false);
  const [showDupes, setShowDupes] = useState(false);
  const [chapterPage, setChapterPage] = useState(0);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateSourceId, setMigrateSourceId] = useState("");
  const [migrateQuery, setMigrateQuery] = useState("");
  const [migrateMatches, setMigrateMatches] = useState<SManga[]>([]);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateError, setMigrateError] = useState("");

  useEffect(() => setChapterPage(0), [id]);

  const source = manga ? getSource(manga.sourceId) : undefined;
  const dlMap = useMemo(() => new Map((downloads ?? []).map((d) => [d.chapterId, d])), [downloads]);

  const refresh = async () => {
    if (!manga) return;
    setLoading(true);
    setError("");
    try {
      await refreshManga(manga);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (safeMode && source?.isNsfw) return;
    if (manga && Date.now() - manga.lastFetchedAt > 10 * 60_000 && manga.sourceId !== "local") void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga?.id, safeMode, source?.isNsfw]);

  // tint the page with the cover's colour
  useEffect(() => {
    if (!manga?.cover || manga.accent) return;
    void dominantColor(coverSrc(manga.sourceId, manga.cover)).then((c) => { if (c) void db.manga.update(manga.id, { accent: c }); });
  }, [manga?.id, manga?.cover, manga?.accent, manga?.sourceId]);

  const asc = manga?.chapterSortAsc ?? false;
  const list = useMemo(() => {
    let l = readingOrder(showDupes ? (chapters ?? []) : dedupeByNumber(chapters ?? []));
    if (filters.has("unread")) l = l.filter((c) => !c.read);
    if (filters.has("bookmarked")) l = l.filter((c) => c.bookmark);
    if (filters.has("downloaded")) l = l.filter((c) => dlMap.get(c.id)?.state === "done");
    return asc ? l : l.reverse();
  }, [chapters, filters, asc, dlMap, showDupes]);
  const pageCount = Math.ceil(list.length / CHAPTERS_PER_PAGE);
  const pageIndex = Math.min(chapterPage, Math.max(0, pageCount - 1));
  const visibleChapters = list.slice(pageIndex * CHAPTERS_PER_PAGE, (pageIndex + 1) * CHAPTERS_PER_PAGE);

  if (manga === undefined) return <div className="page"><div className="skel" style={{ height: 320 }} /></div>;
  if (!manga) return <div className="page"><Empty title="Series not found" body="Open it from Discover again." action={<button className="btn primary" onClick={() => nav("/browse")}>Discover</button>} /></div>;
  if (safeMode && source?.isNsfw) return <div className="page"><Empty title="Hidden by Safe mode" body="This series is from a source marked as 18+. Turn off Safe mode in Settings to view it." action={<button className="btn primary" onClick={() => nav("/settings/privacy")}>Safe mode settings</button>} /></div>;

  const target = resumeTarget(chapters ?? []);
  const unread = dedupeByNumber(chapters ?? []).filter((c) => !c.read).length;
  const dupeCount = (chapters?.length ?? 0) - dedupeByNumber(chapters ?? []).length;
  const toggleSel = (cid: string) => setSel((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const chosen = (chapters ?? []).filter((c) => sel.has(c.id));

  const toggleLibrary = async () => {
    if (manga.inLibrary) {
      await setInLibrary(manga.id, false);
      toast("Removed from shelf");
      return;
    }
    const dupes = await findDuplicates(manga.title, manga.id);
    await setInLibrary(manga.id, true);
    toast(dupes.length ? `Added. You already follow "${dupes[0]!.title}" from another source.` : "Added to shelf");
    if (cats?.length) setCatSheet(true);
  };

  const download = async (items: ChapterRow[]) => {
    await enqueueDownloads(manga, items.filter((c) => dlMap.get(c.id)?.state !== "done"));
    toast(`Downloading ${items.length} chapter${items.length === 1 ? "" : "s"}`);
    setSel(new Set());
  };

  const searchMigrationTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    const destination = getSource(migrateSourceId);
    if (!destination || !migrateQuery.trim()) return;
    setMigrateBusy(true);
    setMigrateError("");
    setMigrateMatches([]);
    try {
      const page = await destination.search(1, migrateQuery.trim(), destination.getFilterList());
      setMigrateMatches(page.mangas);
    } catch (cause) {
      setMigrateError((cause as Error).message || "Could not search that source.");
    } finally {
      setMigrateBusy(false);
    }
  };

  const migrateTo = async (match: SManga) => {
    const destination = getSource(migrateSourceId);
    if (!destination) return;
    setMigrateBusy(true);
    setMigrateError("");
    try {
      const details = await destination.getMangaDetails(match).catch(() => match);
      const target = await upsertManga(destination.id, details);
      const remoteChapters = await destination.getChapterList(details);
      await syncChapters(target, remoteChapters);
      const transferred = await migrateManga(manga.id, target.id);
      toast(`Moved to ${destination.name}; transferred progress for ${transferred} chapters`);
      setMigrateOpen(false);
      nav(`/series/${encodeURIComponent(target.id)}`, { replace: true });
    } catch (cause) {
      setMigrateError((cause as Error).message || "Could not migrate this series.");
    } finally {
      setMigrateBusy(false);
    }
  };

  let prev: ChapterRow | undefined;
  return (
    <>
    <FloatBack />
    <div className="page has-back" style={{ ["--series" as string]: manga.accent ?? "var(--accent)" }} data-hue={hueOf(manga.id)}>
      <ReadingNotice />
      <div className="topbar">
        <span className="kicker">{source?.name ?? manga.sourceId}</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh"><ArrowsClockwise size={18} className={loading ? "spin" : ""} /></button>
      </div>

      <section className="series-hero">
        <div className="art">{manga.cover && <img src={coverSrc(manga.sourceId, manga.cover)} alt="" />}</div>
        <div>
          <h1>{manga.title}</h1>
          <div className="muted" style={{ marginTop: 6, fontWeight: 600 }}>{[manga.author, manga.artist && manga.artist !== manga.author ? manga.artist : ""].filter(Boolean).join(", ") || "Unknown author"}</div>
          <div className="facts">
            {manga.status !== "unknown" && <span className="tag" style={{ background: "var(--series)", color: "#101018", textTransform: "capitalize" }}>{manga.status}</span>}
            <span className="tag dim">{chapterCount ?? chapters?.length ?? 0} chapters</span>
            {unread > 0 && <span className="tag warm">{unread} unread</span>}
            {manga.genres.slice(0, 6).map((g) => <span className="tag dim" key={g}>{g}</span>)}
          </div>
          {manga.description && <p className={`desc${open ? " open" : ""}`} onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>{manga.description}</p>}
          <div className="actions">
            {target ? (
              <Link className="btn primary" style={{ background: "var(--series)", borderColor: "var(--series)", color: "#101018" }} to={`/read/${encodeURIComponent(target.chapter.id)}`}>
                <Play size={16} weight="fill" />{target.started ? "Continue" : "Start"} Ch. {formatChapterNumber(target.chapter.number)}
              </Link>
            ) : (chapters?.length ?? 0) > 0 ? <span className="btn" style={{ pointerEvents: "none" }}><Check size={16} /> Caught up</span> : null}
            <button className="btn" onClick={toggleLibrary}>{manga.inLibrary ? <><Check size={16} /> On shelf</> : <><Plus size={16} /> Add to shelf</>}</button>
            {manga.inLibrary && <button className="btn" onClick={() => { setMigrateSourceId(""); setMigrateQuery(manga.title); setMigrateMatches([]); setMigrateError(""); setMigrateOpen(true); }}><ArrowsLeftRight size={16} /> Migrate</button>}
            {manga.inLibrary && !!cats?.length && <button className="btn" onClick={() => setCatSheet(true)}><Tag size={16} /> Categories</button>}
            {manga.inLibrary && <Link className="btn" to={`/community/new?comic=${encodeURIComponent(manga.id)}`}><ShareNetwork size={16} /> Share</Link>}
          </div>
        </div>
      </section>

      {error && <div className="err" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="topbar" style={{ marginBottom: 12 }}>
        <div className="kicker" style={{ flex: 1 }}>Chapters</div>
        {(["unread", "bookmarked", "downloaded"] as Filt[]).map((f) => (
          <button key={f} className={`chip${filters.has(f) ? " on" : ""}`} onClick={() => { setChapterPage(0); setFilters((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; }); }} style={{ textTransform: "capitalize" }}>{f}</button>
        ))}
        {dupeCount > 0 && <button className={`chip${showDupes ? " on" : ""}`} onClick={() => { setShowDupes((v) => !v); setChapterPage(0); }} title="Other uploads of the same chapter number">{dupeCount} duplicate{dupeCount === 1 ? "" : "s"}</button>}
        <button className="icon-btn" onClick={() => { setChapterPage(0); void patchManga(manga.id, { chapterSortAsc: !asc }); }} aria-label="Reverse order" title={asc ? "Oldest first" : "Newest first"}><ArrowsDownUp size={18} /></button>
        <button className="btn sm" onClick={() => setSel(new Set(list.map((c) => c.id)))}>Select all</button>
      </div>

      {loading && !chapters?.length && Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ height: 50, marginBottom: 4 }} />)}
      {!loading && !chapters?.length && !error && <Empty title="No readable chapters" body="This source has none in this language. Some titles only link out to the publisher, which cannot be read here. You can refresh or try another source." />}

      <div>
        {visibleChapters.map((c) => {
          const gap = prev && !filters.size && asc ? missingBetween(prev.number, c.number) : 0;
          const gapDesc = prev && !filters.size && !asc ? missingBetween(c.number, prev.number) : 0;
          prev = c;
          const dl = dlMap.get(c.id);
          return (
            <div key={c.id}>
              {(gap > 0 || gapDesc > 0) && <div className="gap-note">{gap || gapDesc} chapter{(gap || gapDesc) === 1 ? "" : "s"} missing here. The source may not have them.</div>}
              <div className={`chap${c.read ? " read" : ""}`}>
                <button className={`sel${sel.has(c.id) ? " on" : ""}`} onClick={() => toggleSel(c.id)} aria-label="Select chapter">{sel.has(c.id) && <Check size={13} weight="bold" />}</button>
                <Link to={`/read/${encodeURIComponent(c.id)}`} style={{ display: "contents" }}>
                  <span className="num">{formatChapterNumber(c.number)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="nm" style={{ display: "block" }}>{c.name}</span>
                    <span className="meta">{[c.dateUpload ? timeAgo(c.dateUpload) : "", c.scanlator, !c.read && c.lastPage > 0 ? `page ${c.lastPage + 1}${c.pageCount ? ` of ${c.pageCount}` : ""}` : ""].filter(Boolean).join(", ")}</span>
                  </span>
                </Link>
                {c.bookmark && <BookmarkSimple size={16} weight="fill" color="var(--gold)" />}
                {dl?.state === "done" && <DownloadSimple size={16} color="var(--green)" weight="bold" aria-label="Downloaded" />}
                {(dl?.state === "running" || dl?.state === "queued") && <span className="mono muted" style={{ fontSize: 11 }}>{dl.total ? `${dl.done}/${dl.total}` : "..."}</span>}
                {dl?.state === "error" && <span className="mono" style={{ fontSize: 11, color: "var(--warm)" }} title={dl.error}>failed</span>}
              </div>
            </div>
          );
        })}
      </div>

      {list.length > 0 && <div className="topbar" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {pageIndex * CHAPTERS_PER_PAGE + 1}-{Math.min((pageIndex + 1) * CHAPTERS_PER_PAGE, list.length)} of {list.length}
        </span>
        <button className="icon-btn" onClick={() => setChapterPage((p) => Math.max(0, p - 1))} disabled={pageIndex === 0} aria-label="Previous chapter page" title="Previous page"><CaretLeft size={18} /></button>
        <span className="muted mono" style={{ fontSize: 12 }}>Page {pageIndex + 1} of {pageCount}</span>
        <button className="icon-btn" onClick={() => setChapterPage((p) => Math.min(pageCount - 1, p + 1))} disabled={pageIndex >= pageCount - 1} aria-label="Next chapter page" title="Next page"><CaretRight size={18} /></button>
      </div>}

      {sel.size > 0 && (
        <div className="selbar" role="toolbar" aria-label="Selected chapters">
          <button className="btn sm" onClick={() => { void setRead([...sel], true); setSel(new Set()); }}><Check size={14} /> Read</button>
          <button className="btn sm" onClick={() => { void setRead([...sel], false); setSel(new Set()); }}>Unread</button>
          {sel.size === 1 && <button className="btn sm" onClick={() => { void markPreviousRead(manga.id, chosen[0]!.number); setSel(new Set()); toast("Earlier chapters marked read"); }}>Read all before</button>}
          <button className="btn sm" onClick={() => { chosen.forEach((c) => void setBookmark(c.id, !c.bookmark)); setSel(new Set()); }}><BookmarkSimple size={14} /></button>
          <button className="btn sm" onClick={() => void download(chosen)}><DownloadSimple size={14} /></button>
          {chosen.some((c) => dlMap.get(c.id)?.state === "done") && <button className="btn sm danger" onClick={() => { void deleteDownloads(chosen.map((c) => c.id)); setSel(new Set()); }}><Trash size={14} /></button>}
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {catSheet && (
        <Sheet title="Categories" onClose={() => setCatSheet(false)} center>
          {!cats?.length && <p className="muted">No categories yet. Create one from the Shelf.</p>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {cats?.map((c) => {
              const on = manga.categoryIds.includes(c.id);
              return <button key={c.id} className={`chip${on ? " on" : ""}`} data-hue={hueOf(c.id)} onClick={() => void setMangaCategories(manga.id, on ? manga.categoryIds.filter((x) => x !== c.id) : [...manga.categoryIds, c.id])}>{on && <Check size={13} weight="bold" />}{c.name}</button>;
            })}
          </div>
        </Sheet>
      )}
      {migrateOpen && (
        <Sheet title="Migrate series" onClose={() => !migrateBusy && setMigrateOpen(false)} center>
          <p className="muted" style={{ marginBottom: 14 }}>Choose the matching series on another source. Shelf tabs and reader settings move over; read state follows matching chapter numbers. The old source record stays off your shelf.</p>
          <form onSubmit={(event) => void searchMigrationTarget(event)}>
            <div className="field"><label className="label" htmlFor="migrate-source">Destination source</label>
              <select id="migrate-source" className="input" value={migrateSourceId} onChange={(event) => { setMigrateSourceId(event.target.value); setMigrateMatches([]); }}>
                <option value="">Choose a source</option>
                {allSources().filter((item) => item.id !== manga.sourceId && item.id !== "local" && !(safeMode && item.isNsfw)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <div className="field"><label className="label" htmlFor="migrate-query">Search destination</label>
              <input id="migrate-query" className="input" value={migrateQuery} onChange={(event) => setMigrateQuery(event.target.value)} placeholder="Series title" />
            </div>
            <div className="dialog-actions"><button className="btn primary" type="submit" disabled={!migrateSourceId || !migrateQuery.trim() || migrateBusy}>{migrateBusy ? "Working…" : "Search"}</button></div>
          </form>
          {migrateError && <div className="err" role="alert">{migrateError}</div>}
          {migrateMatches.length > 0 && <ul className="migrate-results">
            {migrateMatches.map((match) => <li key={match.url}>
              <span>{match.title}</span>
              <button className="btn sm" disabled={migrateBusy} onClick={() => void migrateTo(match)}>Move here</button>
            </li>)}
          </ul>}
          {!migrateBusy && !migrateMatches.length && !migrateError && <p className="muted" style={{ marginTop: 12 }}>Search results will appear here.</p>}
        </Sheet>
      )}
    </div>
    </>
  );
}
