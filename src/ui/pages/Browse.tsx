import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, onSourcesChange } from "@/core/sources/registry";
import { upsertManga } from "@/core/repo";
import type { SManga, Source } from "@/core/types";
import { Cover, CoverSkeletons, hueOf, useDebounced } from "../common";
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
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const dq = useDebounced(text, 450);
  const [lang, setLang] = useState(() => localStorage.getItem("comik.lang") ?? "en");

  useEffect(() => {
    setParams(dq ? { q: dq } : {}, { replace: true });
  }, [dq, setParams]);

  const enabledSources = useMemo(() => sources.filter((s) => !disabledSourceIds.includes(s.id)), [sources, disabledSourceIds]);
  const langs = useMemo(() => [...new Set(enabledSources.map((s) => s.lang))], [enabledSources]);
  const [sq, setSq] = useState("");
  const shown = enabledSources
    .filter((s) => s.lang === lang || s.lang === "all")
    .filter((s) => !sq || `${s.name} ${s.baseUrl}`.toLowerCase().includes(sq.toLowerCase()));
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
        searchable.length ? <div className="stack" style={{ marginTop: 14 }}>
          {searchable.map((s) => <GlobalRow key={s.id + q} source={s} q={q} />)}
        </div> : <div className="empty"><h2>No enabled sources</h2><p>Enable a source to search the catalog.</p><button className="btn primary" onClick={() => nav("/settings/sources")}>Manage sources</button></div>
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

/** Global search must not hit 100 sites at once. */
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function GlobalRow({ source, q }: { source: Source; q: string }) {
  const [items, setItems] = useState<SManga[] | null>(null);
  const [err, setErr] = useState("");
  const lib = useLiveQuery(() => db.manga.filter((m) => m.inLibrary).primaryKeys(), [], [] as string[]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof upsertManga>>[]>([]);

  useEffect(() => {
    let dead = false;
    setItems(null);
    setErr("");
    slot(() => source.search(1, q, source.getFilterList()))
      .then(async (r) => {
        const saved = await Promise.all(r.mangas.slice(0, 12).map((m) => upsertManga(source.id, m)));
        if (!dead) { setItems(r.mangas); setRows(saved); }
      })
      .catch((e: Error) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [source, q]);

  return (
    <section data-hue={hueOf(source.id)}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h3 style={{ color: "var(--ink)", fontWeight: 800 }}>{source.name}</h3>
        <Link className="muted" style={{ fontSize: 13 }} to={`/browse/${source.id}?q=${encodeURIComponent(q)}`}>See all</Link>
      </div>
      {err && <div className="err">{err}</div>}
      {!items && !err && <div className="chips">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ width: 120, height: 180, flex: "none" }} />)}</div>}
      {items && !items.length && <div className="muted">No results.</div>}
      {items && items.length > 0 && (
        <div className="chips" style={{ gap: 16, paddingBottom: 14 }}>
          {rows.map((m) => <div key={m.id} style={{ width: 128, flex: "none" }}><Cover m={m} inLibrary={lib?.includes(m.id)} /></div>)}
        </div>
      )}
    </section>
  );
}

export { CoverSkeletons };
