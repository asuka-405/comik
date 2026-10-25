import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bug, BookOpenText, BracketsCurly, Copy, DownloadSimple, MagicWand, PlugsConnected, Trash } from "@phosphor-icons/react";
import { db, type ConnectorRow } from "@/core/db";
import { checkConnectorUpdate, fetchConnectorCode, installConnector, removeConnector, setConnectorEnabled, setConnectorSettings, testConnector } from "@/core/connectors/registry";
import { parseManifest, type ConnectorManifest } from "@/core/connectors/schema";
import { lintCode, type Issue, type Severity } from "@/core/connectors/diagnose";
import { explainDownload, issueFromError, reviewCode } from "@/core/connectors/debug";
import { tidyText } from "@/core/connectors/json";
import { CodeEditor, type EditorHandle } from "../connectors/CodeEditor";
import { ConnectorIcon } from "../connectors/ConnectorIcon";
import { Debugger } from "../connectors/Debugger";
import { IssueCard, IssueList } from "../connectors/Issues";
import { JsonFormatter } from "../connectors/JsonView";
import { parseMarkdown, type Block, type Inline } from "@/core/markdown";
import docs from "../../../docs/CONNECTORS.md?raw";
import { ConfirmDialog, Toggle, toast } from "../common";
import { Detail } from "./Settings";

const BLOCKS = parseMarkdown(docs);
const codeWith = (meta: string) => BLOCKS.find((b): b is Extract<Block, { type: "code" }> => b.type === "code" && b.meta === meta)?.text ?? "";
const TEMPLATE = codeWith("template");
const DEMO = codeWith("demo");

type Tab = "installed" | "add" | "docs";

/** Settings > Anime connectors: the installed ones, a place to add more from code or an address, and the documentation. */
export function ConnectorSettings() {
  const [tab, setTab] = useState<Tab>("installed");
  const [draft, setDraft] = useState("");
  /** Counts up each time a card asks for its connector to be debugged, so the debugger restarts and runs. */
  const [debugRun, setDebugRun] = useState(0);
  const rows = useLiveQuery(async () => (await db.connectors.toArray()).sort((a, b) => a.name.localeCompare(b.name)), [], []);

  return (
    <Detail title="Anime connectors" intro="A connector tells Comik how to read one anime site you have permission to use. Comik does the rest.">
      <div className="seg" role="tablist" aria-label="Connectors">
        {([["installed", `Installed${rows?.length ? ` (${rows.length})` : ""}`], ["add", "Add a connector"], ["docs", "Documentation"]] as [Tab, string][]).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>
      {tab === "installed" && <Installed rows={rows ?? []} onAdd={() => setTab("add")} onEdit={(code, debug) => { setDraft(code); if (debug) setDebugRun((n) => n + 1); setTab("add"); }} />}
      {tab === "add" && <Add draft={draft} setDraft={setDraft} debugRun={debugRun} onDone={() => { setDraft(""); setTab("installed"); }} onDocs={() => setTab("docs")} />}
      {tab === "docs" && <Docs onUseTemplate={(code) => { setDraft(code); setTab("add"); }} />}
    </Detail>
  );
}

/* --------------------------------------------------------------- installed */

function Installed({ rows, onAdd, onEdit }: { rows: ConnectorRow[]; onAdd: () => void; onEdit: (code: string, debug?: boolean) => void }) {
  if (!rows.length) {
    return (
      <section className="panel" data-hue="5">
        <h2>No connectors yet</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Connectors add anime sources to Discover with their own video, episode lists and details. Try the demo to see the whole flow, or write one for a service you are allowed to use.</p>
        <button className="btn primary" onClick={onAdd}><PlugsConnected size={16} /> Add a connector</button>
      </section>
    );
  }
  return <div className="connector-grid">{rows.map((row) => <ConnectorCard key={row.id} row={row} onEdit={(debug) => onEdit(row.code, debug)} />)}</div>;
}

function ConnectorCard({ row, onEdit }: { row: ConnectorRow; onEdit: (debug?: boolean) => void }) {
  const manifest = useMemo<ConnectorManifest | null>(() => { try { return parseManifest(row.manifest); } catch { return null; } }, [row]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; log: string[]; issue?: Issue } | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(row.settings);
  const [confirm, setConfirm] = useState<null | "remove" | { code: string; newDomains: string[] }>(null);
  const fields = manifest?.settings ?? [];

  const test = async () => {
    setBusy("test"); setResult(null);
    try { const r = await testConnector(row.id); setResult({ ok: true, text: r.titles ? `Works: ${r.titles} titles, starting with “${r.first}”.` : "It answered, but returned no titles.", log: r.log }); }
    catch (cause) { const issue = issueFromError(cause, row.code, "popular"); setResult({ ok: false, text: issue.title, log: [], issue }); }
    setBusy("");
  };
  const update = async () => {
    setBusy("update");
    try {
      const found = await checkConnectorUpdate(row.id);
      if (!found) toast("This connector was pasted in, so there is no address to update from.", true);
      else if (found.sameVersion) toast("Already up to date");
      else setConfirm({ code: found.code, newDomains: found.newDomains });
    } catch (cause) { toast((cause as Error).message, true); }
    setBusy("");
  };

  return (
    <article className="connector-card">
      <h3><ConnectorIcon icon={manifest?.icon} name={row.name} size={32} /> {row.name} <span className="tag dim">v{row.version}</span>{row.nsfw && <span className="tag">18+</span>}{!manifest && <span className="tag">broken</span>}</h3>
      {manifest?.description && <p className="muted">{manifest.description}</p>}
      <div className="connector-meta">{row.domains.map((domain) => <span className="tag dim mono" key={domain}>{domain}</span>)}</div>
      <p className="muted">{manifest?.author ? `By ${manifest.author}. ` : ""}Installed {new Date(row.installedAt).toLocaleDateString()}{row.sourceUrl ? ", updates from a web address" : ", pasted in"}.</p>
      <div className="connector-actions">
        <label className="row-inline"><Toggle label={`Enable ${row.name}`} on={row.enabled} onChange={(on) => void setConnectorEnabled(row.id, on)} /> <span>{row.enabled ? "On" : "Off"}</span></label>
        <button className="btn sm" disabled={!row.enabled || !!busy} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test"}</button>
        {fields.length > 0 && <button className="btn sm" onClick={() => setEditing(!editing)}>Settings</button>}
        {row.sourceUrl && <button className="btn sm" disabled={!!busy} onClick={() => void update()}>{busy === "update" ? "Checking…" : "Check for update"}</button>}
        <button className="btn sm" disabled={!!busy} onClick={() => onEdit(true)}><Bug size={14} /> Debug</button>
        <button className="btn sm" onClick={() => onEdit()}>View or edit code</button>
        <button className="btn sm danger" onClick={() => setConfirm("remove")}><Trash size={14} /> Remove</button>
      </div>
      {editing && (
        <form className="connector-review" onSubmit={(event) => { event.preventDefault(); void setConnectorSettings(row.id, values).then(() => { toast("Settings saved"); setEditing(false); }); }}>
          {fields.map((field) => (
            <div className="field" key={field.key}>
              <label className="label" htmlFor={`${row.id}-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
              <input id={`${row.id}-${field.key}`} className="input" type={field.secret ? "password" : "text"} autoComplete="off" placeholder={field.placeholder} value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
            </div>
          ))}
          <div className="dialog-actions"><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button><button className="btn primary">Save</button></div>
        </form>
      )}
      {result?.ok && <div className="connector-log" role="status">{result.text}{result.log.length > 0 && <pre className="connector-log">{result.log.join("\n")}</pre>}</div>}
      {result && !result.ok && result.issue && <IssueCard issue={result.issue} />}
      {confirm === "remove" && <ConfirmDialog title={`Remove ${row.name}?`} body="Its code and settings are deleted from this device. Titles you added from it stay in your library but cannot load until you install it again." action="Remove" danger onClose={() => setConfirm(null)} onConfirm={() => void removeConnector(row.id).then(() => toast("Connector removed"))} />}
      {confirm && typeof confirm === "object" && (
        <ConfirmDialog
          title={`Update ${row.name}?`}
          body={confirm.newDomains.length ? `This version also contacts: ${confirm.newDomains.join(", ")}. Only update if you have permission to use those sites.` : "The code at its address has changed. The hosts it contacts are the same as before."}
          action="Update" danger={confirm.newDomains.length > 0} onClose={() => setConfirm(null)}
          onConfirm={() => { const code = confirm.code; setConfirm(null); void installConnector({ code, sourceUrl: row.sourceUrl, attested: true }).then(() => toast("Connector updated")).catch((cause: Error) => toast(cause.message, true)); }}
        />
      )}
    </article>
  );
}

/* --------------------------------------------------------------------- add */

function Add({ draft, setDraft, debugRun, onDone, onDocs }: { draft: string; setDraft: (code: string) => void; debugRun: number; onDone: () => void; onDocs: () => void }) {
  const [address, setAddress] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Issue[]>([]);
  const [review, setReview] = useState<ConnectorManifest | null>(null);
  const [reviewed, setReviewed] = useState<Issue[] | null>(null);
  const [lint, setLint] = useState<Issue[]>([]);
  const [attested, setAttested] = useState(false);
  const [json, setJson] = useState("");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [debugKey, setDebugKey] = useState(debugRun);
  const editor = useRef<EditorHandle>(null);
  const debuggerPanel = useRef<HTMLElement>(null);
  const jsonPanel = useRef<HTMLDetailsElement>(null);

  // Check the code for mistakes while it is typed, so a problem is marked before anything is run.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => { void lintCode(draft).then((found) => { if (current) setLint(draft.trim() ? found : []); }).catch(() => undefined); }, 450);
    return () => { current = false; clearTimeout(timer); };
  }, [draft]);

  // A card's Debug button opens this tab with the debugger running.
  useEffect(() => { if (debugRun > 0) { setDebugKey(debugRun); setTimeout(() => debuggerPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); } }, [debugRun]);

  const edited = (code: string) => { setDraft(code); setReview(null); setReviewed(null); setProblems([]); setSourceUrl(""); };
  const issues = reviewed ?? lint;
  const marks = useMemo(() => {
    const out: Record<number, Severity> = {};
    const rank = { error: 3, warning: 2, info: 1 } as const;
    for (const issue of issues) if (issue.line && (!out[issue.line] || rank[issue.severity] > rank[out[issue.line]!])) out[issue.line] = issue.severity;
    return out;
  }, [issues]);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;

  const check = async (code = draft) => {
    setBusy(true); setProblems([]); setAttested(false); setReview(null);
    const result = await reviewCode(code);
    setReviewed(result.issues);
    setReview(result.issues.some((i) => i.severity === "error") ? null : result.manifest ?? null);
    setBusy(false);
  };
  const download = async () => {
    setBusy(true); setProblems([]); setReview(null); setReviewed(null);
    try { const code = await fetchConnectorCode(address); setDraft(code); setSourceUrl(address.trim()); await check(code); }
    catch (cause) { setProblems([explainDownload((cause as Error).message)]); }
    setBusy(false);
  };
  const install = async () => {
    setBusy(true); setProblems([]);
    try { const row = await installConnector({ code: draft, sourceUrl, attested }); toast(`${row.name} installed. Find it in Discover > Anime.`); setSourceUrl(""); setReview(null); setReviewed(null); onDone(); }
    catch (cause) { setProblems([issueFromError(cause, draft)]); }
    setBusy(false);
  };
  const tidy = () => {
    const result = tidyText(draft);
    if (result.text === draft) { toast("Nothing to tidy"); return; }
    edited(result.text);
    toast(result.kind === "json" ? "Formatted as JSON" : "Tidied indentation and spacing");
  };
  const openFormatter = (text: string) => {
    setJson(text); setJsonOpen(true);
    setTimeout(() => jsonPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const jump = (line: number, column?: number) => editor.current?.jump(line, column);

  return (
    <div className="stack">
      <section className="panel" data-hue="5">
        <h2>From a web address</h2>
        <p className="muted" style={{ marginBottom: 10 }}>The link to the raw connector file, for example a raw GitHub file. Comik downloads it and keeps a copy on this device.</p>
        <div className="source-studio-url" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 240px", minWidth: 0 }} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="https://raw.githubusercontent.com/you/connector/main/connector.js" aria-label="Connector file address" />
          <button className="btn primary" disabled={busy || !address.trim()} onClick={() => void download()}><DownloadSimple size={16} /> Download</button>
        </div>
      </section>
      <section className="panel" data-hue="5">
        <h2>Or paste the code</h2>
        <CodeEditor ref={editor} label="Connector code" value={draft} onChange={edited} marks={marks} placeholder={"module.exports = {\n  manifest: { ... },\n  async search(query, page, filters, ctx) { ... },\n};"} />
        <div className="connector-actions" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || !draft.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Review"}</button>
          <button className="btn sm" disabled={!draft.trim()} onClick={tidy}><MagicWand size={14} /> Format</button>
          <button className="btn sm" onClick={() => { edited(TEMPLATE); }}>Insert template</button>
          <button className="btn sm" onClick={() => { edited(DEMO); void check(DEMO); }}>Install the demo</button>
          <button className="btn sm" onClick={onDocs}><BookOpenText size={14} /> How to write one</button>
        </div>
        {draft.trim() && !reviewed && (
          <p className={`dbg-live mono ${errors ? "bad" : warnings ? "warn" : "ok"}`} role="status">
            {errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : warnings ? "No errors" : "No problems found"}{warnings ? `, ${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""} in the code as you type. Press Review to start it and check the manifest.
          </p>
        )}
      </section>
      {problems.length > 0 && <IssueList issues={problems} />}
      {issues.length > 0 && (
        <section className="panel" data-hue={errors ? 0 : 2}>
          <h2>Problems <span className="tag dim">{errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : ""}{errors && warnings ? ", " : ""}{warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : ""}{!errors && !warnings ? `${issues.length} ${issues.length === 1 ? "note" : "notes"}` : ""}</span></h2>
          <p className="muted" style={{ marginBottom: 10 }}>Each one says where it is and how to fix it. The line buttons select that spot in the code above.</p>
          <IssueList issues={issues} onJump={jump} />
        </section>
      )}
      {review && (
        <section className="panel connector-review" data-hue="3">
          <h2 className="connector-title"><ConnectorIcon icon={review.icon} name={review.name} size={40} /> <span>{review.name} <span className="tag dim">v{review.version}</span></span></h2>
          {review.description && <p>{review.description}</p>}
          <p className="muted">{review.author ? `By ${review.author}. ` : ""}It will be able to contact only these hosts, over https:</p>
          <ul>{review.domains.map((domain) => <li key={domain}>{domain}</li>)}</ul>
          {review.direct && <p className="muted">It makes requests directly from your browser instead of Comik's proxy.</p>}
          {!!review.settings?.length && <p className="muted">It asks for: {review.settings.map((s) => s.label).join(", ")}. You enter these after installing.</p>}
          <label className="connector-attest"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /> <span>I have permission from the operator of these sites to use them with Comik, and I trust this code. Comik does not review connectors.</span></label>
          <div className="dialog-actions"><button className="btn primary" disabled={busy || !attested} onClick={() => void install()}>{busy ? "Installing…" : "Install connector"}</button></div>
        </section>
      )}
      <section className="panel" data-hue="4" ref={debuggerPanel}>
        <h2><Bug size={18} style={{ verticalAlign: "-3px" }} /> Debugger</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Try the connector before installing it. Each step shows what came back, what Comik keeps, every request it made, and what to fix.</p>
        <Debugger key={debugKey} code={draft} fields={review?.settings ?? []} onJump={jump} onFormat={openFormatter} autorun={debugKey > 0} />
      </section>
      <details className="panel" data-hue="1" ref={jsonPanel} open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)}>
        <summary className="panel-summary"><BracketsCurly size={18} style={{ verticalAlign: "-3px" }} /> JSON formatter</summary>
        <div style={{ marginTop: 12 }}><JsonFormatter text={json} setText={setJson} /></div>
      </details>
    </div>
  );
}

/* -------------------------------------------------------------------- docs */

function inline(parts: Inline[]) {
  return parts.map((part, i) => {
    if (part.type === "bold") return <strong key={i}>{part.text}</strong>;
    if (part.type === "code") return <code key={i}>{part.text}</code>;
    if (part.type === "link") return <a key={i} href={part.href} target="_blank" rel="noreferrer">{part.text}</a>;
    return part.text;
  });
}

function Docs({ onUseTemplate }: { onUseTemplate: (code: string) => void }) {
  return (
    <article className="panel connector-docs" data-hue="4">
      {BLOCKS.map((block, i) => {
        if (block.type === "heading") return block.level === 2 ? <h2 key={i}>{inline(block.inline)}</h2> : <h3 key={i}>{inline(block.inline)}</h3>;
        if (block.type === "list") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>;
        if (block.type === "code") {
          return (
            <div className="doc-code" key={i}>
              <div className="doc-code-bar">
                <span className="mono muted">{block.lang || "code"}</span>
                <button className="btn sm" onClick={() => void navigator.clipboard.writeText(block.text).then(() => toast("Copied"))}><Copy size={13} /> Copy</button>
                <button className="btn sm" onClick={() => onUseTemplate(block.text)}>Use this code</button>
              </div>
              <pre><code>{block.text}</code></pre>
            </div>
          );
        }
        if (block.type === "table") return null;
        return <p key={i}>{inline(block.inline)}</p>;
      })}
    </article>
  );
}

