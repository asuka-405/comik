import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, FunnelSimple, MagnifyingGlass } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { ensureSourceReady, getSource } from "@/core/sources/registry";
import { upsertManga } from "@/core/repo";
import { cloneFilters, hasActiveFilters } from "@/core/filters";
import type { Filter, MangaRow } from "@/core/types";
import { Cover, CoverSkeletons, Empty, useDebounced } from "../common";
import { FilterSheet } from "../components_filters";

type Mode = "popular" | "latest" | "search";

export function SourceView() {
  const { sourceId = "" } = useParams();
  const source = getSource(sourceId);
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [mode, setMode] = useState<Mode>(sp.get("q") ? "search" : "popular");
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const dq = useDebounced(query, 500);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [rows, setRows] = useState<MangaRow[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const lib = useLiveQuery(() => db.manga.filter((m) => m.inLibrary).primaryKeys(), [], [] as string[]);

  useEffect(() => {
    if (!source) return;
    void ensureSourceReady(source).then(() => setFilters(source.getFilterList()));
    setFilters(source.getFilterList());
  }, [source]);

  const dirty = !!source && JSON.stringify(filters) !== JSON.stringify(source.getFilterList());
  const searching = mode === "search" || (dirty && hasActiveFilters(filters));
  const effective: Mode = searching && mode !== "latest" ? "search" : mode;

  const load = useCallback(
    async (p: number, reset: boolean) => {
      if (!source) return;
      const token = ++run.current;
      setLoading(true);
      setError("");
      try {
        const res = effective === "popular" ? await source.getPopular(p) : effective === "latest" ? await source.getLatest(p) : await source.search(p, dq, filters);
        const saved = await Promise.all(res.mangas.map((m) => upsertManga(source.id, m)));
        if (token !== run.current) return;
        setRows((prev) => {
          const seen = new Set(reset ? [] : prev.map((r) => r.id));
          return [...(reset ? [] : prev), ...saved.filter((r) => !seen.has(r.id))];
        });
        setHasNext(res.hasNext && res.mangas.length > 0);
        setPage(p);
      } catch (e) {
        if (token === run.current) setError((e as Error).message);
      } finally {
        if (token === run.current) setLoading(false);
      }
    },
    [source, effective, dq, filters],
  );

  useEffect(() => {
    setRows([]);
    setHasNext(true);
    void load(1, true);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && hasNext && !loading && !error && rows.length > 0 && void load(page + 1, false), { rootMargin: "700px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, loading, error, page, rows.length, load]);

  if (!source) return <div className="page"><Empty title="Source not found" body="It may have been removed." action={<button className="btn primary" onClick={() => nav("/browse")}>Back to Discover</button>} /></div>;

  return (
    <div className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav("/browse")} aria-label="Back"><ArrowLeft size={18} /></button>
        <div><div className="kicker">{source.lang.toUpperCase()}</div><h1>{source.name}</h1></div>
        <div className="spacer" />
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
          <MagnifyingGlass size={16} style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
          <input className="input" style={{ paddingLeft: 36 }} value={query} onChange={(e) => { setQuery(e.target.value); setMode(e.target.value ? "search" : "popular"); }} placeholder={`Search ${source.name}`} aria-label="Search source" />
        </div>
        <button className={`icon-btn${dirty && hasActiveFilters(filters) ? " on" : ""}`} onClick={() => setShowFilters(true)} aria-label="Filters"><FunnelSimple size={18} /></button>
      </div>
      <div className="seg" style={{ marginBottom: 20 }}>
        <button className={effective === "popular" ? "on" : ""} onClick={() => { setQuery(""); setFilters(cloneFilters(source.getFilterList())); setMode("popular"); }}>Popular</button>
        {source.supportsLatest && <button className={effective === "latest" ? "on" : ""} onClick={() => { setQuery(""); setMode("latest"); }}>Latest</button>}
        <button className={effective === "search" ? "on" : ""} onClick={() => setMode("search")}>Search</button>
      </div>

      {error && <div className="err" style={{ marginBottom: 16 }}>{error} <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => void load(page + (rows.length ? 1 : 0), rows.length === 0)}>Retry</button></div>}
      {rows.length === 0 && loading && <CoverSkeletons />}
      {rows.length === 0 && !loading && !error && <Empty title="No results" body="Try a different word, or loosen the filters." />}
      <div className="grid">{rows.map((m) => <Cover key={m.id} m={m} inLibrary={lib?.includes(m.id)} />)}</div>
      <div ref={sentinel} style={{ height: 1 }} />
      {rows.length > 0 && loading && <div className="muted" style={{ textAlign: "center", padding: 24 }}>Loading more</div>}

      {showFilters && <FilterSheet initial={filters} fresh={() => source.getFilterList()} onApply={(f) => { setFilters(f); }} onClose={() => setShowFilters(false)} />}
    </div>
  );
}
