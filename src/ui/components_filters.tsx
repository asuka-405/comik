import { useState } from "react";
import { CaretDown, Check, Minus } from "@phosphor-icons/react";
import type { Filter } from "@/core/types";
import { cloneFilters } from "@/core/filters";
import { Sheet } from "./common";

/** Renders a source's FilterList (Mihon-style: header, select, sort, checkbox, tri-state, group, text). */
function Node({ f, set }: { f: Filter; set: (next: Filter) => void }) {
  const [open, setOpen] = useState(false);
  switch (f.type) {
    case "header":
      return <div className="label" style={{ margin: "6px 0 10px", color: "var(--gold)" }}>{f.name}</div>;
    case "separator":
      return <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "14px 0" }} />;
    case "text":
      return (
        <div className="field"><label>{f.name}</label><input className="input" value={f.state} onChange={(e) => set({ ...f, state: e.target.value })} /></div>
      );
    case "select":
      return (
        <div className="field"><label>{f.name}</label>
          <select className="input" value={f.state} onChange={(e) => set({ ...f, state: Number(e.target.value) })}>{f.options.map((o, i) => <option key={o} value={i}>{o}</option>)}</select>
        </div>
      );
    case "sort":
      return (
        <div className="field"><label>{f.name}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="input" value={f.state.index} onChange={(e) => set({ ...f, state: { ...f.state, index: Number(e.target.value) } })}>{f.options.map((o, i) => <option key={o} value={i}>{o}</option>)}</select>
            <div className="seg"><button className={!f.state.ascending ? "on" : ""} onClick={() => set({ ...f, state: { ...f.state, ascending: false } })}>Desc</button><button className={f.state.ascending ? "on" : ""} onClick={() => set({ ...f, state: { ...f.state, ascending: true } })}>Asc</button></div>
          </div>
        </div>
      );
    case "checkbox":
      return (
        <button className={`chip${f.state ? " on" : ""}`} onClick={() => set({ ...f, state: !f.state })}>{f.state && <Check size={13} weight="bold" />}{f.name}</button>
      );
    case "tristate":
      return (
        <button className={`chip${f.state ? " on" : ""}`} style={f.state === 2 ? { ["--h" as string]: "var(--warm)" } : undefined} onClick={() => set({ ...f, state: ((f.state + 1) % 3) as 0 | 1 | 2 })}>
          {f.state === 1 && <Check size={13} weight="bold" />}{f.state === 2 && <Minus size={13} weight="bold" />}{f.name}
        </button>
      );
    case "group": {
      const active = f.filters.filter((x) => (x.type === "checkbox" && x.state) || (x.type === "tristate" && x.state)).length;
      return (
        <div style={{ marginBottom: 14 }}>
          <button className="row" style={{ width: "100%", padding: "8px 0", border: 0 }} onClick={() => setOpen(!open)}>
            <span className="grow" style={{ textAlign: "left", fontWeight: 800, color: "var(--ink)" }}>{f.name}{active ? <span className="tag" style={{ marginLeft: 8 }}>{active}</span> : null}</span>
            <CaretDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: ".2s" }} />
          </button>
          {(open || active > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 6 }}>
              {f.filters.map((c, i) => <Node key={c.key} f={c} set={(n) => set({ ...f, filters: f.filters.map((x, j) => (j === i ? n : x)) })} />)}
            </div>
          )}
        </div>
      );
    }
  }
}

export function FilterSheet({ initial, fresh, onApply, onClose }: { initial: Filter[]; fresh: () => Filter[]; onApply: (f: Filter[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => cloneFilters(initial));
  return (
    <Sheet title="Filters" onClose={onClose}>
      {draft.map((f, i) =>
        f.type === "checkbox" || f.type === "tristate" ? null : <Node key={f.key + i} f={f} set={(n) => setDraft((d) => d.map((x, j) => (j === i ? n : x)))} />,
      )}
      {draft.some((f) => f.type === "checkbox" || f.type === "tristate") && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {draft.map((f, i) => (f.type === "checkbox" || f.type === "tristate" ? <Node key={f.key} f={f} set={(n) => setDraft((d) => d.map((x, j) => (j === i ? n : x)))} /> : null))}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, position: "sticky", bottom: -20, padding: "16px 0 4px", background: "var(--canvas)" }}>
        <button className="btn" onClick={() => setDraft(fresh())}>Reset</button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => { onApply(draft); onClose(); }}>Apply</button>
      </div>
    </Sheet>
  );
}
