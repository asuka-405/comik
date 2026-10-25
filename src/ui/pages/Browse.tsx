import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckSquare, MagnifyingGlass, Plus, Tag } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, onSourcesChange } from "@/core/sources/registry";
import { createCategory, editCategoriesOf, upsertManga } from "@/core/repo";
import { setInLibrary } from "@/core/repo";
import type { MediaKind, Source } from "@/core/types";
import { groupDiscoveredWorks, type DiscoveredSourceEntry } from "@/core/discover";
import { filterSources } from "@/core/sources/filter";
import { matchesSearch, type SearchFields } from "@/core/searchMatch";
import { inferGenrePreferences } from "@/core/preferences";
import { ChallengeError, verifySite } from "@/core/http";
import { cached, DISCOVER_TTL } from "@/core/cache";
import { isNativeShell } from "@/core/platform";
import { Cover, CoverSkeletons, ReadingNotice, Sheet, TextDialog, hueOf, toast, useDebounced } from "../common";
import { PanelField } from "../PanelField";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { useSettings, type LibraryGridColumns } from "@/core/settings";

const LANG_NAMES: Record<string, string> = { all: "Local", en: "English", es: "Spanish", fr: "French", "pt-br": "Portuguese", id: "Indonesian", ru: "Russian", de: "German", it: "Italian", ja: "Japanese", tr: "Turkish", th: "Thai" };
type MediaTab = "comics" | "novels" | "anime";

function useSources(): Source[] {
  const [list, setList] = useState(allSources);
  useEffect(() => {
    const off = onSourcesChange(() => setList(allSources()));
    return () => { off(); };
  }, []);
  return list;
}

export function Browse() {
  const [params, setParams] = useSearchParams();
  const sources = useSources();
  const nav = useNavigate();
  const fx = useSettings((s) => s.fx);
  const disabledSourceIds = useSettings((s) => s.disabledSourceIds);
  const safeMode = useSettings((s) => s.safeMode);
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 900);
  const [lang, setLang] = useState(() => localStorage.getItem("comik.lang") ?? "en");
  const initialMedia = params.get("media");
  const [mediaTab, setMediaTab] = useState<MediaTab>(initialMedia === "novels" || initialMedia === "anime" ? initialMedia : "comics");
  const [searchFields, setSearchFields] = useState<SearchFields>({ tags: false, description: false });
  const gridColumns = useSettings((s) => s.globalSearchGridColumns);
  const tolerance = useSettings((s) => s.globalSearchTolerance);

  useEffect(() => {
    setParams(dq ? { q: dq } : {}, { replace: true });
  }, [dq, setParams]);

  const enabledSources = useMemo(() => sources.filter((s) => !disabledSourceIds.includes(s.id) && !(safeMode && s.isNsfw)), [sources, disabledSourceIds, safeMode]);
  const mediaSources = useMemo(() => enabledSources.filter((source) => mediaTab === "comics" ? source.mediaType !== "novel" && source.mediaType !== "anime" : source.mediaType === (mediaTab === "novels" ? "novel" : "anime")), [enabledSources, mediaTab]);
  const langs = useMemo(() => [...new Set(mediaSources.map((s) => s.lang))], [mediaSources]);
  const [sq, setSq] = useState("");
  const shown = filterSources(mediaSources.filter((s) => mediaTab !== "comics" || s.lang === lang || s.lang === "all"), sq);
  const searchable = shown.filter((s) => s.id !== "local");

  return (
    <div className="page">
      <section className="hero3d">
        {fx && <PanelField mode="hero" />}
        <div className="copy">
          <div className="kicker">Discover</div>
          <h2>Pick a source, or search all of them</h2>
        </div>
      </section>
      <div className="seg discover-media-tabs" role="tablist" aria-label="Discover media type">
        {([["comics", "Comics"], ["novels", "Web novels"], ["anime", "Anime"]] as [MediaTab, string][]).map(([value, label]) => <button key={value} role="tab" aria-selected={mediaTab === value} className={mediaTab === value ? "on" : ""} onClick={() => { setMediaTab(value); setSq(""); }}>{label}</button>)}
      </div>
      <ReadingNotice />
      <div className="topbar">
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <MagnifyingGlass size={18} style={{ position: "absolute", left: 13, top: 12, color: "var(--muted)" }} />
          <input className="input" style={{ paddingLeft: 40, height: 42 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search every source in this language" aria-label="Global search" />
        </div>
        {q && <select className="input shelf-grid-columns" value={gridColumns} onChange={(e) => useSettings.getState().set({ globalSearchGridColumns: e.target.value === "auto" ? "auto" : Number(e.target.value) as LibraryGridColumns })} aria-label="Search grid columns">
          <option value="auto">Auto columns</option>
          {[2, 3, 4, 5, 6].map((columns) => <option key={columns} value={columns}>{columns} columns</option>)}
        </select>}
      </div>
      {q && <div className="chips" role="group" aria-label="Additional search fields">
        <label className="chip"><input type="checkbox" checked={searchFields.tags} onChange={(event) => setSearchFields((fields) => ({ ...fields, tags: event.target.checked }))} /> Match tags</label>
        <label className="chip"><input type="checkbox" checked={searchFields.description} onChange={(event) => setSearchFields((fields) => ({ ...fields, description: event.target.checked }))} /> Match description</label>
      </div>}
      {mediaTab === "comics" && <div className="chips" aria-label="Language">
        {langs.map((l) => <button key={l} className={`chip${l === lang ? " on" : ""}`} onClick={() => { setLang(l); localStorage.setItem("comik.lang", l); }}>{LANG_NAMES[l] ?? l}</button>)}
      </div>
      }

      {q ? (
        searchable.length ? <GlobalSearch sources={searchable} q={q} fields={searchFields} tolerance={tolerance} kind={mediaTab === "comics" ? "comic" : mediaTab === "novels" ? "novel" : "anime"} /> : <div className="empty"><h2>No enabled sources</h2><p>Enable a source to search the catalog.</p><button className="btn primary" onClick={() => nav("/settings/sources")}>Manage sources</button></div>
      ) : (
        <>
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 12px" }}>
          <input className="input" style={{ maxWidth: 320 }} value={sq} onChange={(e) => setSq(e.target.value)} placeholder={`Filter ${shown.length} sources`} aria-label="Filter sources" />
          <span className="mono muted" style={{ fontSize: 12 }}>{shown.length} shown</span>
        </div>
        <div className="src-grid">
          {shown.map((s, i) => (
            <Link key={s.id} to={`/browse/${s.id}`} className="panel source-card compact" data-hue={i % 7} style={{ ["--h" as string]: s.tint }}>
              <div className="ico">{s.icon ? <ConnectorIcon icon={s.icon} name={s.name} size={36} /> : s.name.slice(0, 2)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="src-name">{s.name}</div>
                <div className="muted src-sub">{s.blurb}</div>
              </div>
            </Link>
          ))}
          {mediaTab === "anime" && <button className="panel source-card compact" data-hue="6" onClick={() => nav("/settings/connectors")} style={{ borderStyle: "dashed" }}>
            <div className="ico"><Plus size={20} /></div>
            <div><div className="src-name">Add an anime connector</div><div className="muted src-sub">Connect a site you have permission to use</div></div>
          </button>}
          {mediaTab === "comics" && <button className="panel source-card compact" data-hue="6" onClick={() => nav("/settings#sources")} style={{ borderStyle: "dashed" }}>
            <div className="ico"><Plus size={20} /></div>
            <div><div className="src-name">Add a source</div><div className="muted src-sub">Madara, MangaThemesia or your own selectors</div></div>
          </button>}
        </div>
        </>
      )}
    </div>
  );
}

interface SourceResult { source: Source; rows: Awaited<ReturnType<typeof upsertManga>>[] }
interface SearchSnapshot { results: SourceResult[]; blocked: Source[]; done: string[] }

const searchSnapshots = new Map<string, SearchSnapshot>();

const SEARCH_PARALLEL = 4;
const PER_SOURCE = 12;
const chapterCountCache = new Map<string, number>();

/**
 * Searches every enabled source and shows one loader for the whole search. A source joins the list
 * below as soon as it has results. Sources with no match, or that fail, simply never appear.
 *
 * Sites behind a Cloudflare check are never checked automatically, anywhere in the app. They are listed
 * apart here, each with its own button that runs that one check and then searches it.
 */
function GlobalSearch({ sources, q, fields, tolerance, kind }: { sources: Source[]; q: string; fields: SearchFields; tolerance: number; kind: MediaKind }) {
  const taste = useSettings((s) => s.tastePreferences);
  const ids = sources.map((s) => s.id).join("|");
  const cacheKey = `${ids}\u0000${q}\u0000${fields.tags ? 1 : 0}${fields.description ? 1 : 0}\u0000${tolerance}`;
  const [results, setResults] = useState<SourceResult[]>(() => searchSnapshots.get(cacheKey)?.results ?? []);
  const [blocked, setBlocked] = useState<Source[]>(() => searchSnapshots.get(cacheKey)?.blocked ?? []);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chapterCounts, setChapterCounts] = useState<Record<string, number | "loading" | "unavailable">>({});
  const [sourcePicked, setSourcePicked] = useState<Set<string>>(new Set());
  const [addingSources, setAddingSources] = useState(false);
  const categories = useLiveQuery(() => db.categories.where("kind").equals(kind).sortBy("order").then((rows) => rows.filter((row) => !row.deleted)), [kind], []);
  const lib = useLiveQuery(() => db.manga.where("libraryFlag").equals(1).primaryKeys(), [], [] as string[]);
  const inferredGenres = useLiveQuery(async () => {
    const shelf = await db.manga.where("libraryFlag").equals(1).toArray();
    const recentChapters = await db.chapters.where("readAt").above(0).reverse().limit(500).toArray();
    const ids = [...new Set(recentChapters.map((chapter) => chapter.mangaId))];
    const recent = (await db.manga.bulkGet(ids)).filter((manga): manga is NonNullable<typeof manga> => !!manga);
    const items = new Map([...shelf, ...recent].map((manga) => [manga.id, manga]));
    return inferGenrePreferences([...items.values()], recentChapters);
  }, [taste.autoBuild], []);
  // The list of sources can change while a search runs; the search itself only restarts on a new query.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const saveSnapshot = (patch: Partial<SearchSnapshot>) => {
    const current = searchSnapshots.get(cacheKey) ?? { results: [], blocked: [], done: [] };
    searchSnapshots.set(cacheKey, { ...current, ...patch });
  };

  const works = useMemo(() => {
    const groups = groupDiscoveredWorks(results.flatMap(({ source, rows }) => rows.map((manga) => ({ source, manga }))));
    const preferred = new Set([...taste.includeGenres, ...(taste.autoBuild ? inferredGenres.map((genre) => genre.name) : [])]);
    const avoided = new Set(taste.avoidGenres);
    const score = (work: (typeof groups)[number]) => work.entries.reduce((total, entry) => total + entry.manga.genres.reduce((value, genre) => value + (preferred.has(genre) ? 2 : 0) - (avoided.has(genre) ? 3 : 0), 0), 0);
    return [...groups].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title));
  }, [results, taste, inferredGenres]);
  const toggleSource = (id: string) => setSourcePicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const addPickedSources = async () => {
    setAddingSources(true);
    try {
      await Promise.all([...sourcePicked].map((id) => setInLibrary(id, true)));
      toast(`Added ${sourcePicked.size} source${sourcePicked.size === 1 ? "" : "s"} to your shelf`);
      setSourcePicked(new Set());
    } catch (cause) {
      toast((cause as Error).message || "Could not add those sources", true);
    } finally {
      setAddingSources(false);
    }
  };
  const loadChapterCounts = (entries: DiscoveredSourceEntry[]) => {
    setChapterCounts((current) => Object.fromEntries([
      ...Object.entries(current),
      ...entries.filter(({ manga }) => !chapterCountCache.has(manga.id)).map(({ manga }) => [manga.id, "loading"] as const),
    ]));
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++]!;
        const cachedCount = chapterCountCache.get(entry.manga.id);
        if (cachedCount !== undefined) {
          setChapterCounts((current) => ({ ...current, [entry.manga.id]: cachedCount }));
          continue;
        }
        try {
          const details = await entry.source.getMangaDetails(entry.manga);
          const count = (await entry.source.getChapterList(details)).length;
          chapterCountCache.set(entry.manga.id, count);
          setChapterCounts((current) => ({ ...current, [entry.manga.id]: count }));
        } catch {
          setChapterCounts((current) => ({ ...current, [entry.manga.id]: "unavailable" }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, entries.length) }, worker));
  };

  const toggleWork = (key: string, entries: DiscoveredSourceEntry[]) => {
    const opening = !expanded.has(key);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(key); else next.delete(key);
      return next;
    });
    if (opening) loadChapterCounts(entries);
  };

  /** Search one source and add what it finds. Returns true when it was stopped by a Cloudflare check. */
  const searchOne = async (source: Source, alive: () => boolean): Promise<boolean> => {
    try {
      const page = await cached(`discover:${source.id}:search:1:${q}:`, DISCOVER_TTL, () => source.search(1, q, source.getFilterList()), { staleOnError: true });
      const matches = page.mangas.filter((manga) => matchesSearch(manga, q, fields, tolerance)).slice(0, PER_SOURCE);
      if (alive() && matches.length) {
        const rows = await Promise.all(matches.map((manga) => upsertManga(source.id, manga)));
        if (alive()) setResults((current) => {
          const next = current.some((r) => r.source.id === source.id) ? current : [...current, { source, rows }];
          saveSnapshot({ results: next });
          return next;
        });
      }
      return false;
    } catch (error) {
      return error instanceof ChallengeError;
    }
  };

  useEffect(() => {
    let dead = false;
    const cached = searchSnapshots.get(cacheKey) ?? { results: [], blocked: [], done: [] };
    const queue = sourcesRef.current.filter((source) => !cached.done.includes(source.id));
    setResults(cached.results);
    setBlocked(cached.blocked);
    setProgress({ done: cached.done.length, total: sourcesRef.current.length });
    const worker = async () => {
      while (!dead) {
        const source = queue.shift();
        if (!source) return;
        const needsCheck = await searchOne(source, () => !dead);
        if (!dead) {
          if (needsCheck) setBlocked((current) => {
            const next = current.some((item) => item.id === source.id) ? current : [...current, source];
            saveSnapshot({ blocked: next });
            return next;
          });
          saveSnapshot({ done: [...(searchSnapshots.get(cacheKey)?.done ?? []), source.id] });
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
    };
    for (let i = 0; i < SEARCH_PARALLEL; i++) void worker();
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ids, fields.tags, fields.description, tolerance]);

  const verified = (source: Source) => setBlocked((current) => {
    const next = current.filter((s) => s.id !== source.id);
    saveSnapshot({ blocked: next });
    return next;
  });
  const searching = progress.done < progress.total;
  return (
    <div className="global-search">
      {searching ? (
        <div className="global-search-status" role="status" aria-live="polite">
          <span className="reader-spinner" style={{ width: 18, height: 18 }} />
          <span>Searching {progress.total.toLocaleString()} sources for “{q}”</span>
          <span className="mono muted">{progress.done} / {progress.total}</span>
          <progress value={progress.done} max={progress.total} aria-hidden="true" />
        </div>
      ) : !results.length && !blocked.length ? (
        <div className="empty"><h2>No results for “{q}”</h2><p>Try fewer words or another spelling.</p></div>
      ) : (
        <div className="global-search-status done" role="status"><span>{works.length} titles from {results.length} source{results.length === 1 ? "" : "s"} matched “{q}”</span></div>
      )}
      {results.length > 0 && <div className="global-search-tools">
        <button className={`icon-btn${selecting ? " on" : ""}`} onClick={() => { setSelecting((value) => !value); setPicked(new Set()); }} aria-label="Select search results" aria-pressed={selecting} title="Select results"><CheckSquare size={18} /></button>
        {selecting && <>
          <span className="mono muted">{picked.size} selected</span>
          <button className="btn sm" disabled={!picked.size} onClick={() => setCategoriesOpen(true)}><Tag size={15} /> Add to category</button>
          <button className="btn sm" disabled={!results.length} onClick={() => setPicked(new Set(results.flatMap((result) => result.rows.map((row) => row.id))))}>All</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => setPicked(new Set())}>Clear</button>
        </>}
        {sourcePicked.size > 0 && <>
          <span className="mono muted">{sourcePicked.size} providers selected</span>
          <button className="btn sm primary" disabled={addingSources} onClick={() => void addPickedSources()}>{addingSources ? "Adding…" : "Add providers to shelf"}</button>
        </>}
      </div>}
      {sourcePicked.size > 0 && <p className="muted discover-source-hint">Adding multiple providers keeps their chapter lists separate and lets library updates check each source independently.</p>}
      <div className="discover-work-list">
        {works.map((work) => {
          const first = work.entries[0]!;
          const selected = work.entries.every((entry) => picked.has(entry.manga.id));
          const toggleSelection = () => setPicked((current) => {
            const next = new Set(current);
            if (selected) work.entries.forEach((entry) => next.delete(entry.manga.id));
            else work.entries.forEach((entry) => next.add(entry.manga.id));
            return next;
          });
          return <section key={work.key} className="discover-work" data-hue={hueOf(work.key)}>
            <Cover m={first.manga} inLibrary={work.entries.some((entry) => lib?.includes(entry.manga.id))} select={selecting ? { selecting, selected, onPick: toggleSelection } : undefined} onHold={() => { setSelecting(true); setPicked((current) => new Set([...current, ...work.entries.map((entry) => entry.manga.id)])); }} />
            <div className="discover-work-details">
              <h3>{work.title}</h3>
              <p className="muted">{work.entries.length} available source{work.entries.length === 1 ? "" : "s"}</p>
              <button className="btn sm" aria-expanded={expanded.has(work.key)} onClick={() => toggleWork(work.key, work.entries)}>{expanded.has(work.key) ? "Hide sources" : "Show sources"}</button>
              {expanded.has(work.key) && <div className="discover-providers">
                {work.entries.map((entry) => {
                  const count = chapterCounts[entry.manga.id] ?? chapterCountCache.get(entry.manga.id);
                  const countLabel = typeof count === "number" ? `${count} ${entry.manga.kind === "anime" ? "episodes" : "chapters"}` : count === "loading" ? "Loading count…" : count === "unavailable" ? "Count unavailable" : "Count not loaded";
                  return <div className="discover-provider" key={entry.manga.id}>
                    <label><input type="checkbox" checked={sourcePicked.has(entry.manga.id)} onChange={() => toggleSource(entry.manga.id)} /><span>{entry.source.name}</span><small>{countLabel}</small></label>
                    <Link className="btn sm" to={`/series/${encodeURIComponent(entry.manga.id)}`}>Open chapters</Link>
                  </div>;
                })}
              </div>}
            </div>
          </section>;
        })}
      </div>
      {categoriesOpen && <Sheet title={`Add ${picked.size} to a category`} onClose={() => setCategoriesOpen(false)} center>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {categories?.map((category) => <button key={category.id} className="chip" onClick={() => void editCategoriesOf([...picked], { add: [category.id] }).then(() => { toast(`Added to ${category.name}`); setCategoriesOpen(false); setPicked(new Set()); setSelecting(false); })}>{category.name}</button>)}
        </div>
        <div className="dialog-actions"><button className="btn" onClick={() => { setCategoriesOpen(false); setNewCategoryOpen(true); }}><Plus size={15} /> New category</button></div>
      </Sheet>}
      {newCategoryOpen && <TextDialog title="New category" label="Category name" action="Create and add" onClose={() => setNewCategoryOpen(false)} onSubmit={async (name) => {
        const category = await createCategory(name, kind);
        await editCategoriesOf([...picked], { add: [category.id] });
        toast(`Added to ${category.name}`);
        setNewCategoryOpen(false);
        setPicked(new Set());
        setSelecting(false);
      }} />}
      {blocked.length > 0 && (
        <section className="panel verify-panel" data-hue="5">
          <h3>{blocked.length} source{blocked.length === 1 ? "" : "s"} need a quick check</h3>
          <p className="muted">{isNativeShell ? "These sites ask for a browser check before they answer. Run the ones you want, one at a time. Each search result appears above once its check passes." : "These sites are protected by Cloudflare, which the browser version cannot pass. The Android, Linux and Windows apps can."}</p>
          {isNativeShell && <ul className="verify-list">{blocked.map((source) => <VerifyRow key={source.id} source={source} onVerify={() => searchOne(source, () => true).then((stillBlocked) => { if (!stillBlocked) verified(source); return stillBlocked; })} />)}</ul>}
        </section>
      )}
    </div>
  );
}

/** One site that needs its Cloudflare check, with a button that runs just that check. */
function VerifyRow({ source, onVerify }: { source: Source; onVerify: () => Promise<boolean> }) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const run = async () => {
    setState("working");
    try {
      // Pass the check first, so the search below finds the site open.
      await verifySite(source.baseUrl + "/");
      setState((await onVerify()) ? "failed" : "idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <li className="verify-row">
      <span className="verify-name">{source.name}</span>
      <button className={`btn sm${state === "failed" ? "" : " primary"}`} disabled={state === "working"} onClick={() => void run()}>
        {state === "working" ? "Checking…" : state === "failed" ? "Try again" : "Verify and search"}
      </button>
    </li>
  );
}

export { CoverSkeletons };
