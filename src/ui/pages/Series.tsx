import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { LockKey, ArrowsDownUp, ArrowsLeftRight, BookmarkSimple, CaretLeft, CaretRight, Check, DownloadSimple, Play, Plus, Trash, ArrowsClockwise, ShareNetwork, Tag } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, getSource } from "@/core/sources/registry";
import { useSettings } from "@/core/settings";
import { setVault, findDuplicates, markPreviousRead, migrateManga, setBookmark, setInLibrary, setMangaCategories, setRead, patchManga, syncChapters, upsertManga } from "@/core/repo";
import { refreshManga } from "@/core/updater";
import { DISCOVER_TTL } from "@/core/cache";
import { ChallengeError } from "@/core/http";
import { resumeTarget, readingOrder, dedupeByNumber, chaptersAround, nextUnreadChapters } from "@/core/progress";
import { migrationMatchRank, migrationQueries } from "@/core/migrationSearch";
import { formatChapterNumber, missingBetween } from "@/core/chapterRecognition";
import { deleteDownloads, enqueueDownloads } from "@/core/downloads";
import type { ChapterRow, SManga, Source } from "@/core/types";
import { Empty, FloatBack, ReadingNotice, Sheet, coverSrc, hueOf, timeAgo, toast } from "../common";
import { dominantColor } from "../color";
import { ChallengeFix } from "../ChallengeFix";

type Filt = "unread" | "bookmarked" | "downloaded";
const CHAPTERS_PER_PAGE = 50;
const MIGRATION_SEARCH_PARALLEL = 4;

interface MigrationMatch { source: Source; manga: SManga; rank: number; matchedQuery: string }

export function Series() {
  const id = decodeURIComponent(useParams().id ?? "");
  const nav = useNavigate();
  const safeMode = useSettings((s) => s.safeMode);
  const searchTolerance = useSettings((s) => s.globalSearchTolerance);
  const disabledSourceIds = useSettings((s) => s.disabledSourceIds);
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
  const [rangeSide, setRangeSide] = useState<"before" | "after" | null>(null);
  const [showDupes, setShowDupes] = useState(false);
  const [chapterPage, setChapterPage] = useState(0);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateMatches, setMigrateMatches] = useState<MigrationMatch[]>([]);
  const [migrateSelected, setMigrateSelected] = useState("");
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateError, setMigrateError] = useState("");
  const [migrateProgress, setMigrateProgress] = useState({ done: 0, total: 0, term: "" });
  const [migrateBlocked, setMigrateBlocked] = useState(0);

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
    // A library title keeps its saved details and chapters until the next library refresh (the Update button, the
    // automatic update, or Refresh on this page). A title that is only being browsed is fetched again after an hour.
    if (manga && manga.sourceId !== "local" && (manga.lastFetchedAt === 0 || (!manga.inLibrary && Date.now() - manga.lastFetchedAt > DISCOVER_TTL))) void refresh();
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

  const isNovel = manga.kind === "novel";
  const isAnime = manga.kind === "anime";
  const target = resumeTarget(chapters ?? []);
  const unread = dedupeByNumber(chapters ?? []).filter((c) => !c.read).length;
  const dupeCount = (chapters?.length ?? 0) - dedupeByNumber(chapters ?? []).length;
  const toggleSel = (cid: string) => setSel((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const chosen = (chapters ?? []).filter((c) => sel.has(c.id));
  const rangeAnchor = sel.size === 1 ? chosen[0] : undefined;
  const range = rangeAnchor ? chaptersAround(chapters ?? [], rangeAnchor.id) : { before: [], after: [] };
  const ranged = rangeSide ? range[rangeSide] : [];
  const next10 = nextUnreadChapters(chapters ?? [], rangeAnchor?.id, 10);
  const next25 = nextUnreadChapters(chapters ?? [], rangeAnchor?.id, 25);

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

  const applyRangeRead = async (read: boolean) => {
    await setRead(ranged.map((chapter) => chapter.id), read);
    toast(`Marked ${ranged.length} chapters ${read ? "read" : "unread"}`);
    setRangeSide(null);
  };

  const deleteRangeDownloads = async () => {
    await deleteDownloads(ranged.map((chapter) => chapter.id));
    toast(`Deleted downloads for ${ranged.length} chapters`);
    setRangeSide(null);
  };

  const downloadRange = async () => {
    await download(ranged);
    setRangeSide(null);
  };

  const searchMigrationTarget = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!manga) return;
    const sources = allSources().filter((candidate) => candidate.id !== manga.sourceId && candidate.id !== "local"
      && !disabledSourceIds.includes(candidate.id) && !(safeMode && candidate.isNsfw));
    let queries = migrationQueries(manga);
    if (!queries.length) return;
    setMigrateBusy(true);
    setMigrateError("");
    setMigrateMatches([]);
    setMigrateSelected("");
    setMigrateProgress({ done: 0, total: sources.length, term: manga.title });
    setMigrateBlocked(0);
    const found = new Map<string, MigrationMatch>();
    const blocked = new Set<string>();
    const failures: string[] = [];
    const queue = [...sources];
    const sortedMatches = () => [...found.values()].sort((a, b) => a.rank - b.rank || a.source.name.localeCompare(b.source.name) || a.manga.title.localeCompare(b.manga.title));
    const originalSource = getSource(manga.sourceId);
    if (originalSource) {
      try {
        const details = await originalSource.getMangaDetails({ url: manga.url, title: manga.title });
        queries = migrationQueries({ ...manga, ...details });
        await upsertManga(manga.sourceId, details);
      } catch (cause) {
        if (cause instanceof ChallengeError) blocked.add(originalSource.id);
      }
    }
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const candidateSource = queue.shift()!;
        let hadChallenge = false;
        for (const query of queries) {
          for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
            try {
              const page = await candidateSource.search(pageNumber, query, candidateSource.getFilterList());
              let changed = false;
              for (const result of page.mangas) {
                const key = `${candidateSource.id}::${result.url}`;
                const rank = migrationMatchRank(result, queries, query, manga.description ?? "", searchTolerance);
                const previous = found.get(key);
                if (!previous || rank < previous.rank) {
                  found.set(key, { source: candidateSource, manga: result, rank, matchedQuery: query });
                  changed = true;
                }
              }
              if (changed) setMigrateMatches(sortedMatches());
              if (!page.hasNext) break;
            } catch (cause) {
              if (cause instanceof ChallengeError) hadChallenge = true;
              else failures.push(`${candidateSource.name}: ${(cause as Error).message}`);
              break;
            }
          }
        }
        if (hadChallenge) blocked.add(candidateSource.id);
        done++;
        setMigrateProgress({ done, total: sources.length, term: queries[0]! });
        setMigrateBlocked(blocked.size);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MIGRATION_SEARCH_PARALLEL, sources.length) }, worker));
    setMigrateMatches(sortedMatches());
    if (!found.size && failures.length && !blocked.size) setMigrateError(failures[0]!);
    setMigrateBusy(false);
  };

  const migrateTo = async ({ source: destination, manga: match }: MigrationMatch) => {
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

  const checkMigrationMatch = (match: MigrationMatch) => {
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      toast("Allow pop-ups to open this entry in a new tab.", true);
      return;
    }
    void (async () => {
      try {
        const details = await match.source.getMangaDetails(match.manga).catch(() => match.manga);
        const row = await upsertManga(match.source.id, details);
        preview.location.replace(`${window.location.origin}/series/${encodeURIComponent(row.id)}`);
      } catch (cause) {
        preview.close();
        toast((cause as Error).message || "Could not open this source entry.", true);
      }
    })();
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
        {!isNovel && <button className="icon-btn" onClick={refresh} aria-label="Refresh" title="Refresh"><ArrowsClockwise size={18} className={loading ? "spin" : ""} /></button>}
      </div>

      <section className="series-hero">
        <div className="art">{manga.cover && <img src={coverSrc(manga.sourceId, manga.cover)} alt="" />}</div>
        <div>
          <h1>{manga.title}</h1>
          <div className="muted" style={{ marginTop: 6, fontWeight: 600 }}>{[manga.author, manga.artist && manga.artist !== manga.author ? manga.artist : ""].filter(Boolean).join(", ") || "Unknown author"}</div>
          <div className="facts">
            {manga.status !== "unknown" && <span className="tag" style={{ background: "var(--series)", color: "#101018", textTransform: "capitalize" }}>{manga.status}</span>}
            <span className="tag dim">{chapterCount ?? chapters?.length ?? 0} {isAnime ? "episodes" : "chapters"}</span>
            {unread > 0 && <span className="tag warm">{unread} unread</span>}
            {manga.genres.slice(0, 6).map((g) => <span className="tag dim" key={g}>{g}</span>)}
          </div>
          {isAnime && (manga.year || manga.studios?.length || manga.rating) ? <div className="muted" style={{ fontSize: 13 }}>{[manga.year, manga.studios?.join(", "), manga.rating ? `★ ${manga.rating}` : "", manga.contentRating].filter(Boolean).join(" · ")}</div> : null}
          {manga.description && <p className={`desc${open ? " open" : ""}`} onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>{manga.description}</p>}
          <div className="actions">
            {target ? (
              <Link className="btn primary" style={{ background: "var(--series)", borderColor: "var(--series)", color: "#101018" }} to={`/read/${encodeURIComponent(target.chapter.id)}`}>
                <Play size={16} weight="fill" />{target.started ? "Continue" : "Start"} Ch. {formatChapterNumber(target.chapter.number)}
              </Link>
            ) : (chapters?.length ?? 0) > 0 ? <span className="btn" style={{ pointerEvents: "none" }}><Check size={16} /> Caught up</span> : null}
            <button className="btn" onClick={toggleLibrary}>{manga.inLibrary ? <><Check size={16} /> On shelf</> : <><Plus size={16} /> Add to shelf</>}</button>
            {manga.inLibrary && !isNovel && !isAnime && <button className="btn" onClick={() => { setMigrateMatches([]); setMigrateError(""); setMigrateOpen(true); }}><ArrowsLeftRight size={16} /> Migrate</button>}
            {manga.inLibrary && <button className="btn" onClick={() => void setVault([manga.id], !manga.vault).then(() => toast(manga.vault ? "Back on your shelf" : "Moved to the Vault"))}><LockKey size={16} /> {manga.vault ? "Take out of Vault" : "Move to Vault"}</button>}
            {manga.inLibrary && !!cats?.length && <button className="btn" onClick={() => setCatSheet(true)}><Tag size={16} /> Categories</button>}
            {manga.inLibrary && <Link className="btn" to={`/community/new?comic=${encodeURIComponent(manga.id)}`}><ShareNetwork size={16} /> Share</Link>}
          </div>
        </div>
      </section>

      {error && <div className="err" style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><span style={{ flex: "1 1 240px" }}>{error}</span><ChallengeFix message={error} onDone={() => void refresh()} /></div>}

      <div className="topbar" style={{ marginBottom: 12 }}>
        <div className="kicker" style={{ flex: 1 }}>{isAnime ? "Episodes" : "Chapters"}</div>
        {(["unread", "bookmarked", "downloaded"] as Filt[]).map((f) => (
          <button key={f} className={`chip${filters.has(f) ? " on" : ""}`} onClick={() => { setChapterPage(0); setFilters((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; }); }} style={{ textTransform: "capitalize" }}>{f}</button>
        ))}
        {dupeCount > 0 && <button className={`chip${showDupes ? " on" : ""}`} onClick={() => { setShowDupes((v) => !v); setChapterPage(0); }} title="Other uploads of the same chapter number">{dupeCount} duplicate{dupeCount === 1 ? "" : "s"}</button>}
        <button className="icon-btn" onClick={() => { setChapterPage(0); void patchManga(manga.id, { chapterSortAsc: !asc }); }} aria-label="Reverse order" title={asc ? "Oldest first" : "Newest first"}><ArrowsDownUp size={18} /></button>
        {!isNovel && !isAnime && <button className="btn sm" disabled={!next10.length} onClick={() => void download(next10)}>Download next 10</button>}
        {!isNovel && !isAnime && <button className="btn sm" disabled={!next25.length} onClick={() => void download(next25)}>Download next 25</button>}
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
                  {isAnime && c.thumbnail && <img className="episode-thumb" src={coverSrc(manga.sourceId, c.thumbnail)} alt="" loading="lazy" />}
                  <span className="num">{formatChapterNumber(c.number)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="nm" style={{ display: "block" }}>{c.name}</span>
                    {isAnime && c.description && <span className="episode-desc">{c.description}</span>}
                    <span className="meta">{[c.dateUpload ? timeAgo(c.dateUpload) : "", c.scanlator, isAnime && c.duration ? `${Math.round(c.duration / 60)} min` : "", isAnime && c.seasonTitle ? c.seasonTitle : "", !c.read && c.lastPage > 0 && isAnime ? `at ${Math.floor(c.lastPage / 60)}:${String(c.lastPage % 60).padStart(2, "0")}` : "", !isAnime && !c.read && c.lastPage > 0 ? `page ${c.lastPage + 1}${c.pageCount ? ` of ${c.pageCount}` : ""}` : ""].filter(Boolean).join(", ")}</span>
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
          {sel.size === 1 && <>
            <button className="btn sm" disabled={!range.before.length} onClick={() => setRangeSide("before")}>Before ({range.before.length})</button>
            <button className="btn sm" disabled={!range.after.length} onClick={() => setRangeSide("after")}>After ({range.after.length})</button>
          </>}
          <button className="btn sm" onClick={() => { chosen.forEach((c) => void setBookmark(c.id, !c.bookmark)); setSel(new Set()); }}><BookmarkSimple size={14} /></button>
          {!isNovel && !isAnime && <button className="btn sm" onClick={() => void download(chosen)}><DownloadSimple size={14} /></button>}
          {!isNovel && !isAnime && chosen.some((c) => dlMap.get(c.id)?.state === "done") && <button className="btn sm danger" onClick={() => { void deleteDownloads(chosen.map((c) => c.id)); setSel(new Set()); }}><Trash size={14} /></button>}
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
      {rangeSide && <Sheet title={`Chapters ${rangeSide} ${formatChapterNumber(rangeAnchor!.number)}`} onClose={() => setRangeSide(null)} center>
        <p className="muted">Apply an action to the {ranged.length} chapters {rangeSide} the selected chapter, in reading order.</p>
        <div className="dialog-actions range-actions">
          <button className="btn" onClick={() => void applyRangeRead(true)}><Check size={15} /> Mark read</button>
          <button className="btn" onClick={() => void applyRangeRead(false)}>Mark unread</button>
          {!isNovel && !isAnime && <button className="btn" onClick={() => void downloadRange()}><DownloadSimple size={15} /> Download</button>}
          {!isNovel && !isAnime && <button className="btn danger" disabled={!ranged.some((chapter) => dlMap.get(chapter.id)?.state === "done")} onClick={() => void deleteRangeDownloads()}><Trash size={15} /> Delete downloads</button>}
        </div>
      </Sheet>}
      {migrateOpen && (
        <Sheet title="Migrate series" onClose={() => !migrateBusy && setMigrateOpen(false)} center>
          <p className="muted" style={{ marginBottom: 14 }}>Search every enabled source for “{manga.title}” and its alternate titles. Shelf tabs and reader settings move over; read state follows matching chapter numbers. The old source record stays off your shelf.</p>
          <form onSubmit={(event) => void searchMigrationTarget(event)}>
            <div className="dialog-actions"><button className="btn primary" type="submit" disabled={migrateBusy}>{migrateBusy ? "Searching…" : "Search all sources"}</button></div>
          </form>
          {migrateBusy && <div className="migration-progress" role="status"><span>Searching {migrateProgress.done} of {migrateProgress.total} sources</span><progress max={migrateProgress.total || 1} value={migrateProgress.done} /></div>}
          {migrateError && <div className="err" role="alert">{migrateError}</div>}
          {!!migrateBlocked && <p className="muted" role="status">{migrateBlocked} protected source{migrateBlocked === 1 ? " was" : "s were"} skipped because it requested a browser check.</p>}
          {migrateMatches.length > 0 && <>
            <ul className="migrate-results">
            {migrateMatches.map((match) => <li key={`${match.source.id}::${match.manga.url}`}>
              {match.manga.cover && <img src={match.manga.cover} alt="" loading="lazy" />}
              <label className="migrate-choice"><input type="radio" name="migrate-target" checked={migrateSelected === `${match.source.id}::${match.manga.url}`} onChange={() => setMigrateSelected(`${match.source.id}::${match.manga.url}`)} /><span><strong>{match.manga.title}</strong><small>{match.source.name} · {match.rank === 0 ? "Exact title" : match.rank === 1 ? "Exact alternate title" : match.rank >= 6 ? "Description match" : `Matched “${match.matchedQuery}”`}</small></span></label>
              <button className="btn sm" onClick={() => checkMigrationMatch(match)}>Check entry</button>
            </li>)}
            </ul>
            <div className="dialog-actions"><button className="btn primary" disabled={migrateBusy || !migrateSelected} onClick={() => {
              const match = migrateMatches.find((item) => `${item.source.id}::${item.manga.url}` === migrateSelected);
              if (match) void migrateTo(match);
            }}>Migrate selected</button></div>
          </>}
          {!migrateBusy && !migrateMatches.length && !migrateError && <p className="muted" style={{ marginTop: 12 }}>Search all sources to see possible matches.</p>}
          {!migrateBusy && !migrateMatches.length && !!migrateBlocked && <p className="muted">Some sources could not be searched because they require a browser check.</p>}
        </Sheet>
      )}
    </div>
    </>
  );
}

