import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { allSources, isCustom, onSourcesChange } from "@/core/sources/registry";
import type { Source } from "@/core/types";
import { Row, Toggle } from "../common";

function SourceGroup({ title, sources, disabled, onToggleAll, onToggle }: {
  title: string;
  sources: Source[];
  disabled: string[];
  onToggleAll: (enabled: boolean) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const enabledCount = sources.length - sources.filter((source) => disabled.includes(source.id)).length;
  return (
    <section className="panel" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <h2 style={{ marginBottom: 2 }}>{title}</h2>
          <span className="muted" style={{ fontSize: 12 }}>{enabledCount} of {sources.length} enabled</span>
        </div>
        <button className="btn sm" disabled={!sources.length || enabledCount === sources.length} onClick={() => onToggleAll(true)}>Enable all</button>
        <button className="btn sm" disabled={!sources.length || enabledCount === 0} onClick={() => onToggleAll(false)}>Disable all</button>
      </div>
      {!sources.length && <p className="muted">No sources match this filter.</p>}
      {sources.map((source) => (
        <Row key={source.id} title={source.name} hint={`${source.lang.toUpperCase()}${source.baseUrl ? ` · ${source.baseUrl}` : ""}`}>
          <Toggle label={`${disabled.includes(source.id) ? "Enable" : "Disable"} ${source.name}`} on={!disabled.includes(source.id)} onChange={(value) => onToggle(source.id, value)} />
        </Row>
      ))}
    </section>
  );
}

export function SourceSettingsPage() {
  const s = useSettings();
  const [sources, setSources] = useState(allSources);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const off = onSourcesChange(() => setSources(allSources()));
    return () => off();
  }, []);

  const matches = useMemo(() => sources.filter((source) => `${source.name} ${source.lang} ${source.baseUrl}`.toLowerCase().includes(query.toLowerCase())), [sources, query]);
  const builtIn = matches.filter((source) => !isCustom(source.id));
  const custom = matches.filter((source) => isCustom(source.id));

  const toggle = (id: string, enabled: boolean) => {
    s.set({ disabledSourceIds: enabled ? s.disabledSourceIds.filter((item) => item !== id) : [...new Set([...s.disabledSourceIds, id])] });
  };
  const toggleGroup = (items: Source[], enabled: boolean) => {
    const ids = new Set(items.map((source) => source.id));
    s.set({ disabledSourceIds: enabled ? s.disabledSourceIds.filter((id) => !ids.has(id)) : [...new Set([...s.disabledSourceIds, ...ids])] });
  };

  return (
    <div className="page">
      <div className="topbar">
        <div><div className="kicker">Settings</div><h1>Sources</h1></div>
        <div className="spacer" />
        <Link className="btn" to="/settings/proxy">Back to sources and proxy</Link>
      </div>
      <p className="muted" style={{ maxWidth: 680, marginBottom: 18 }}>Disabled sources are hidden from Discover and global search. Your shelf entries, reading progress, and downloaded chapters are unchanged.</p>
      <div style={{ position: "relative", maxWidth: 460 }}>
        <MagnifyingGlass size={16} style={{ position: "absolute", left: 12, top: 13, color: "var(--muted)" }} />
        <input className="input" style={{ paddingLeft: 36 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a source" aria-label="Find a source" />
      </div>
      <SourceGroup title="Built-in sources" sources={builtIn} disabled={s.disabledSourceIds} onToggleAll={(value) => toggleGroup(builtIn, value)} onToggle={toggle} />
      <SourceGroup title="Custom sources" sources={custom} disabled={s.disabledSourceIds} onToggleAll={(value) => toggleGroup(custom, value)} onToggle={toggle} />
    </div>
  );
}