import { useMemo, useRef, useState } from "react";
import { Copy } from "@phosphor-icons/react";
import { checkJson, formatJson } from "@/core/connectors/json";
import { snippetAt, type Issue } from "@/core/connectors/diagnose";
import { CodeEditor, type EditorHandle } from "./CodeEditor";
import { IssueCard, copy } from "./Issues";

const SHOWN = 200;

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") {
    const shown = value.length > 400 ? `${value.slice(0, 400)}…` : value;
    return <span className="j-str" title={value.length > 400 ? `${value.length} characters` : undefined}>{JSON.stringify(shown)}</span>;
  }
  if (typeof value === "number") return <span className="j-num">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="j-bool">{String(value)}</span>;
  return <span className="j-null">{value === null ? "null" : String(value)}</span>;
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const label = name !== undefined ? <span className="j-key">{name}: </span> : null;
  if (value === null || typeof value !== "object") return <div className="j-row">{label}<Scalar value={value} /></div>;
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const open = depth < 2 && entries.length <= 30;
  return (
    <details open={open} className="j-node">
      <summary>{label}<span className="j-punct">{Array.isArray(value) ? `[ ${entries.length} ]` : `{ ${entries.length} }`}</span></summary>
      <div className="j-children">
        {entries.slice(0, SHOWN).map(([k, v]) => <Node key={k} name={Array.isArray(value) ? `[${k}]` : k} value={v} depth={depth + 1} />)}
        {entries.length > SHOWN && <div className="j-row muted">… {entries.length - SHOWN} more not shown</div>}
      </div>
    </details>
  );
}

/** A value as a collapsible tree, or as formatted text, with a copy button. */
export function JsonBlock({ value, onFormat }: { value: unknown; onFormat?: (text: string) => void }) {
  const [text, setText] = useState(false);
  const pretty = useMemo(() => { try { return JSON.stringify(value, null, 2) ?? "undefined"; } catch { return String(value); } }, [value]);
  return (
    <div className="json-block">
      <div className="json-bar">
        <div className="seg sm" role="tablist" aria-label="View">
          <button role="tab" aria-selected={!text} className={!text ? "on" : ""} onClick={() => setText(false)}>Tree</button>
          <button role="tab" aria-selected={text} className={text ? "on" : ""} onClick={() => setText(true)}>Text</button>
        </div>
        <span className="muted mono">{pretty.length.toLocaleString()} chars</span>
        <button className="btn sm" onClick={() => copy(pretty)}><Copy size={13} /> Copy</button>
        {onFormat && <button className="btn sm" onClick={() => onFormat(pretty)}>Open in formatter</button>}
      </div>
      {text ? <pre className="json-text">{pretty.length > 60_000 ? `${pretty.slice(0, 60_000)}\n… ${(pretty.length - 60_000).toLocaleString()} more characters` : pretty}</pre> : <div className="json-tree"><Node value={value} depth={0} /></div>}
    </div>
  );
}

/** Raw response text: shown as a tree when it is JSON, as plain text when not. */
export function BodyView({ body, truncated, contentType, onFormat }: { body: string; truncated?: boolean; contentType?: string; onFormat?: (text: string) => void }) {
  const parsed = useMemo(() => (truncated || !/^\s*[[{]/.test(body) ? null : checkJson(body)), [body, truncated]);
  if (parsed?.ok) return <JsonBlock value={parsed.value} onFormat={onFormat} />;
  const looksJson = /json/i.test(contentType ?? "") || /^\s*[[{]/.test(body);
  return (
    <div className="json-block">
      <div className="json-bar">
        <span className="muted mono">{contentType?.split(";")[0] || "text"}{truncated ? ", first 40,000 characters" : ""}</span>
        <button className="btn sm" onClick={() => copy(body)}><Copy size={13} /> Copy</button>
        {looksJson && onFormat && <button className="btn sm" onClick={() => onFormat(body)}>Open in formatter</button>}
      </div>
      {parsed && !parsed.ok && !truncated && <p className="muted" style={{ fontSize: 12.5 }}>Looks like JSON but is not valid: {parsed.message} (line {parsed.line}, column {parsed.column}).</p>}
      <pre className="json-text">{body || "(empty)"}</pre>
    </div>
  );
}

/** Paste JSON, see it formatted, or see exactly where it is broken. */
export function JsonFormatter({ text, setText }: { text: string; setText: (text: string) => void }) {
  const editor = useRef<EditorHandle>(null);
  const check = useMemo(() => (text.trim() ? checkJson(text) : null), [text]);
  const [sort, setSort] = useState(false);
  const problem: Issue | null = check && !check.ok ? {
    severity: "error", title: check.message, line: check.line, column: check.column,
    snippet: snippetAt(text, check.line), fix: check.fix,
  } : null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <CodeEditor ref={editor} label="JSON to format" value={text} onChange={setText} marks={problem ? { [problem.line!]: "error" } : {}} placeholder={'Paste a response or a manifest here.\n{"id": 1, "title": "Example"}'} minRows={10} />
      <div className="connector-actions">
        <button className="btn primary" disabled={!check?.ok} onClick={() => { const r = formatJson(text, { sort }); if (r.ok) setText(r.text); }}>Format</button>
        <button className="btn" disabled={!check?.ok} onClick={() => { const r = formatJson(text, { minify: true, sort }); if (r.ok) setText(r.text); }}>Minify</button>
        <label className="row-inline"><input type="checkbox" checked={sort} onChange={(event) => setSort(event.target.checked)} /> Sort keys</label>
        <button className="btn" disabled={!text} onClick={() => copy(text)}><Copy size={14} /> Copy</button>
        <button className="btn" disabled={!text} onClick={() => setText("")}>Clear</button>
      </div>
      {!text.trim() && <p className="muted">Paste JSON to check and format it. Responses in the debugger have an Open in formatter button.</p>}
      {check?.ok && <p className="json-ok">Valid JSON.</p>}
      {problem && <IssueCard issue={problem} onJump={(line, column) => editor.current?.jump(line, column)} />}
    </div>
  );
}
