import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { allSources, onSourcesChange } from "@/core/sources/registry";
import { upsertManga } from "@/core/repo";
import type { SManga, Source } from "@/core/types";
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
        searchable.length ? <div className="stack" style={{ marginTop: 14 }}>
          {searchable.map((s) => <GlobalRow key={s.id} source={s} q={q} />)}
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
async function slot<T>(fn: () => Promise<T | null>, onStart: () => void): Promise<T | null> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  onStart();
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function GlobalRow({ source, q }: { source: Source; q: string }) {
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<SManga[] | null>(null);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState<"waiting" | "queued" | "loading" | "done">("waiting");
  const lib = useLiveQuery(() => db.manga.filter((m) => m.inLibrary).primaryKeys(), [], [] as string[]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof upsertManga>>[]>([]);

  useEffect(() => {
    const element = section.current;
    if (!element || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "500px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    setItems(null);
    setErr("");
    setRows([]);
    setStatus("queued");
    slot(() => dead ? Promise.resolve(null) : source.search(1, q, source.getFilterList()), () => {
      if (!dead) setStatus("loading");
    })
      .then(async (r) => {
        if (!r || dead) return;
        const mangas = r.mangas.slice(0, 12);
        const saved = await Promise.all(mangas.map((m) => upsertManga(source.id, m)));
        if (!dead) { setItems(mangas); setRows(saved); setStatus("done"); }
      })
      .catch((e: Error) => {
        if (!dead) { setErr(e.message); setStatus("done"); }
      });
    return () => { dead = true; };
  }, [source, q, visible]);

  return (
    <section ref={section} data-hue={hueOf(source.id)}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h3 style={{ color: "var(--ink)", fontWeight: 800 }}>{source.name}</h3>
        <Link className="muted" style={{ fontSize: 13 }} to={`/browse/${source.id}?q=${encodeURIComponent(q)}`}>See all</Link>
      </div>
      {err && <div className="err">{err}</div>}
      {(status === "queued" || status === "loading") && <div className="muted" role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}><span className="reader-spinner" style={{ width: 16, height: 16 }} />{status === "queued" ? "Waiting to search" : "Searching this source"}</div>}
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
