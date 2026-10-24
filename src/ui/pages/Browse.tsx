import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, onSourcesChange } from "@/core/sources/registry";
import { upsertManga } from "@/core/repo";
import type { Source } from "@/core/types";
import { filterSources } from "@/core/sources/filter";
import { Cover, CoverSkeletons, ReadingNotice, hueOf, useDebounced } from "../common";
import { PanelField } from "../PanelField";
import { useSettings } from "@/core/settings";

const LANG_NAMES: Record<string, string> = { all: "Local", en: "English", es: "Spanish", fr: "French", "pt-br": "Portuguese", id: "Indonesian", ru: "Russian", de: "German", it: "Italian", ja: "Japanese", tr: "Turkish", th: "Thai" };

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
  const dq = useDebounced(text, 450);
  const [lang, setLang] = useState(() => localStorage.getItem("comik.lang") ?? "en");

  useEffect(() => {
    setParams(dq ? { q: dq } : {}, { replace: true });
  }, [dq, setParams]);

  const enabledSources = useMemo(() => sources.filter((s) => !disabledSourceIds.includes(s.id) && !(safeMode && s.isNsfw)), [sources, disabledSourceIds, safeMode]);
  const langs = useMemo(() => [...new Set(enabledSources.map((s) => s.lang))], [enabledSources]);
  const [sq, setSq] = useState("");
  const shown = filterSources(enabledSources.filter((s) => s.lang === lang || s.lang === "all"), sq);
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
      <ReadingNotice />
      <div className="topbar">
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <MagnifyingGlass size={18} style={{ position: "absolute", left: 13, top: 12, color: "var(--muted)" }} />
          <input className="input" style={{ paddingLeft: 40, height: 42 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search every source in this language" aria-label="Global search" />
        </div>
      </div>
      <div className="chips" aria-label="Language">
        {langs.map((l) => <button key={l} className={`chip${l === lang ? " on" : ""}`} onClick={() => { setLang(l); localStorage.setItem("comik.lang", l); }}>{LANG_NAMES[l] ?? l}</button>)}
      </div>

      {q ? (
        searchable.length ? <GlobalSearch sources={searchable} q={q} /> : <div className="empty"><h2>No enabled sources</h2><p>Enable a source to search the catalog.</p><button className="btn primary" onClick={() => nav("/settings/sources")}>Manage sources</button></div>
      ) : (
        <>
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 12px" }}>
          <input className="input" style={{ maxWidth: 320 }} value={sq} onChange={(e) => setSq(e.target.value)} placeholder={`Filter ${shown.length} sources`} aria-label="Filter sources" />
          <span className="mono muted" style={{ fontSize: 12 }}>{shown.length} shown</span>
        </div>
        <div className="src-grid">
          {shown.map((s, i) => (
            <Link key={s.id} to={`/browse/${s.id}`} className="panel source-card compact" data-hue={i % 7} style={{ ["--h" as string]: s.tint }}>
              <div className="ico">{s.name.slice(0, 2)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="src-name">{s.name}</div>
                <div className="muted src-sub">{s.blurb}</div>
              </div>
            </Link>
          ))}
          <button className="panel source-card compact" data-hue="6" onClick={() => nav("/settings#sources")} style={{ borderStyle: "dashed" }}>
            <div className="ico"><Plus size={20} /></div>
            <div><div className="src-name">Add a source</div><div className="muted src-sub">Madara, MangaThemesia or your own selectors</div></div>
          </button>
        </div>
        </>
      )}
    </div>
  );
}

interface SourceResult { source: Source; rows: Awaited<ReturnType<typeof upsertManga>>[] }

const SEARCH_PARALLEL = 6;
const PER_SOURCE = 12;

/**
 * Searches every enabled source and shows one loader for the whole search. A source joins the list
 * below as soon as it has results. Sources with no match, or that fail, simply never appear.
 */
function GlobalSearch({ sources, q }: { sources: Source[]; q: string }) {
  const [results, setResults] = useState<SourceResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const lib = useLiveQuery(() => db.manga.filter((m) => m.inLibrary).primaryKeys(), [], [] as string[]);
  // The list of sources can change while a search runs; the search itself only restarts on a new query.
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const ids = sources.map((s) => s.id).join("|");

  useEffect(() => {
    let dead = false;
    const queue = [...sourcesRef.current];
    setResults([]);
    setProgress({ done: 0, total: queue.length });
    const worker = async () => {
      while (!dead) {
        const source = queue.shift();
        if (!source) return;
        try {
          const page = await source.search(1, q, source.getFilterList());
          if (!dead && page.mangas.length) {
            const rows = await Promise.all(page.mangas.slice(0, PER_SOURCE).map((m) => upsertManga(source.id, m)));
            if (!dead) setResults((current) => [...current, { source, rows }]);
          }
        } catch {
          // A source that cannot answer is left out rather than shown as an error.
        }
        if (!dead) setProgress((p) => ({ ...p, done: p.done + 1 }));
      }
    };
    for (let i = 0; i < SEARCH_PARALLEL; i++) void worker();
    return () => { dead = true; };
  }, [q, ids]);

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
      ) : !results.length ? (
        <div className="empty"><h2>No results for “{q}”</h2><p>Try fewer words or another spelling.</p></div>
      ) : (
        <div className="global-search-status done" role="status"><span>{results.length} source{results.length === 1 ? "" : "s"} had matches for “{q}”</span></div>
      )}
      {results.map(({ source, rows }) => (
        <section key={source.id} className="global-result" data-hue={hueOf(source.id)}>
          <div className="global-result-head">
            <h3>{source.name}</h3>
            <Link className="muted" to={`/browse/${source.id}?q=${encodeURIComponent(q)}`}>See all</Link>
          </div>
          <div className="global-result-grid">
            {rows.map((m) => <Cover key={m.id} m={m} inLibrary={lib?.includes(m.id)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export { CoverSkeletons };
