import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpenText, Copy, DownloadSimple, PlugsConnected, Trash } from "@phosphor-icons/react";
import { db, type ConnectorRow } from "@/core/db";
import { checkConnectorUpdate, fetchConnectorCode, inspectConnector, installConnector, removeConnector, setConnectorEnabled, setConnectorSettings, testConnector } from "@/core/connectors/registry";
import { parseManifest, type ConnectorManifest } from "@/core/connectors/schema";
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
  const rows = useLiveQuery(async () => (await db.connectors.toArray()).sort((a, b) => a.name.localeCompare(b.name)), [], []);

  return (
    <Detail title="Anime connectors" intro="A connector tells Comik how to read one anime site you have permission to use. Comik does the rest.">
      <div className="seg" role="tablist" aria-label="Connectors">
        {([["installed", `Installed${rows?.length ? ` (${rows.length})` : ""}`], ["add", "Add a connector"], ["docs", "Documentation"]] as [Tab, string][]).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>
      {tab === "installed" && <Installed rows={rows ?? []} onAdd={() => setTab("add")} onEdit={(code) => { setDraft(code); setTab("add"); }} />}
      {tab === "add" && <Add draft={draft} setDraft={setDraft} onDone={() => { setDraft(""); setTab("installed"); }} onDocs={() => setTab("docs")} />}
      {tab === "docs" && <Docs onUseTemplate={(code) => { setDraft(code); setTab("add"); }} />}
    </Detail>
  );
}

/* --------------------------------------------------------------- installed */

function Installed({ rows, onAdd, onEdit }: { rows: ConnectorRow[]; onAdd: () => void; onEdit: (code: string) => void }) {
  if (!rows.length) {
    return (
      <section className="panel" data-hue="5">
        <h2>No connectors yet</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Connectors add anime sources to Discover with their own video, episode lists and details. Try the demo to see the whole flow, or write one for a service you are allowed to use.</p>
        <button className="btn primary" onClick={onAdd}><PlugsConnected size={16} /> Add a connector</button>
      </section>
    );
  }
  return <div className="connector-grid">{rows.map((row) => <ConnectorCard key={row.id} row={row} onEdit={() => onEdit(row.code)} />)}</div>;
}

function ConnectorCard({ row, onEdit }: { row: ConnectorRow; onEdit: () => void }) {
  const manifest = useMemo<ConnectorManifest | null>(() => { try { return parseManifest(row.manifest); } catch { return null; } }, [row]);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; log: string[] } | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(row.settings);
  const [confirm, setConfirm] = useState<null | "remove" | { code: string; newDomains: string[] }>(null);
  const fields = manifest?.settings ?? [];

  const test = async () => {
    setBusy("test"); setResult(null);
    try { const r = await testConnector(row.id); setResult({ ok: true, text: r.titles ? `Works: ${r.titles} titles, starting with “${r.first}”.` : "It answered, but returned no titles.", log: r.log }); }
    catch (cause) { setResult({ ok: false, text: (cause as Error).message, log: [] }); }
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
      <h3>{row.name} <span className="tag dim">v{row.version}</span>{row.nsfw && <span className="tag">18+</span>}{!manifest && <span className="tag">broken</span>}</h3>
      {manifest?.description && <p className="muted">{manifest.description}</p>}
      <div className="connector-meta">{row.domains.map((domain) => <span className="tag dim mono" key={domain}>{domain}</span>)}</div>
      <p className="muted">{manifest?.author ? `By ${manifest.author}. ` : ""}Installed {new Date(row.installedAt).toLocaleDateString()}{row.sourceUrl ? ", updates from a web address" : ", pasted in"}.</p>
      <div className="connector-actions">
        <label className="row-inline"><Toggle label={`Enable ${row.name}`} on={row.enabled} onChange={(on) => void setConnectorEnabled(row.id, on)} /> <span>{row.enabled ? "On" : "Off"}</span></label>
        <button className="btn sm" disabled={!row.enabled || !!busy} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test"}</button>
        {fields.length > 0 && <button className="btn sm" onClick={() => setEditing(!editing)}>Settings</button>}
        {row.sourceUrl && <button className="btn sm" disabled={!!busy} onClick={() => void update()}>{busy === "update" ? "Checking…" : "Check for update"}</button>}
        <button className="btn sm" onClick={onEdit}>View or edit code</button>
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
      {result && <div className={result.ok ? "connector-log" : "err"} role="status">{result.text}{result.log.length > 0 && <pre className="connector-log">{result.log.join("\n")}</pre>}</div>}
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

function Add({ draft, setDraft, onDone, onDocs }: { draft: string; setDraft: (code: string) => void; onDone: () => void; onDocs: () => void }) {
  const [address, setAddress] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ConnectorManifest | null>(null);
  const [attested, setAttested] = useState(false);

  const download = async () => {
    setBusy(true); setError(""); setReview(null);
    try { const code = await fetchConnectorCode(address); setDraft(code); setSourceUrl(address.trim()); await check(code); }
    catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  };
  const check = async (code = draft) => {
    setBusy(true); setError(""); setAttested(false);
    try { setReview(await inspectConnector(code)); } catch (cause) { setReview(null); setError((cause as Error).message); }
    setBusy(false);
  };
  const install = async () => {
    setBusy(true); setError("");
    try { const row = await installConnector({ code: draft, sourceUrl, attested }); toast(`${row.name} installed. Find it in Discover > Anime.`); setSourceUrl(""); setReview(null); onDone(); }
    catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  };

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
        <textarea className="input connector-code" spellCheck={false} value={draft} onChange={(event) => { setDraft(event.target.value); setReview(null); setSourceUrl(""); }} placeholder={"module.exports = {\n  manifest: { ... },\n  async search(query, page, filters, ctx) { ... },\n};"} aria-label="Connector code" />
        <div className="connector-actions" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={busy || !draft.trim()} onClick={() => void check()}>{busy ? "Checking…" : "Review"}</button>
          <button className="btn sm" onClick={() => { setDraft(TEMPLATE); setReview(null); setSourceUrl(""); }}>Insert template</button>
          <button className="btn sm" onClick={() => { setDraft(DEMO); setReview(null); setSourceUrl(""); void check(DEMO); }}>Install the demo</button>
          <button className="btn sm" onClick={onDocs}><BookOpenText size={14} /> How to write one</button>
        </div>
      </section>
      {error && <div className="err" role="alert">{error}</div>}
      {review && (
        <section className="panel connector-review" data-hue="3">
          <h2>{review.name} <span className="tag dim">v{review.version}</span></h2>
          {review.description && <p>{review.description}</p>}
          <p className="muted">{review.author ? `By ${review.author}. ` : ""}It will be able to contact only these hosts, over https:</p>
          <ul>{review.domains.map((domain) => <li key={domain}>{domain}</li>)}</ul>
          {review.direct && <p className="muted">It makes requests directly from your browser instead of Comik's proxy.</p>}
          {!!review.settings?.length && <p className="muted">It asks for: {review.settings.map((s) => s.label).join(", ")}. You enter these after installing.</p>}
          <label className="connector-attest"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} /> <span>I have permission from the operator of these sites to use them with Comik, and I trust this code. Comik does not review connectors.</span></label>
          <div className="dialog-actions"><button className="btn primary" disabled={busy || !attested} onClick={() => void install()}>{busy ? "Installing…" : "Install connector"}</button></div>
        </section>
      )}
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
        return <p key={i}>{inline(block.inline)}</p>;
      })}
    </article>
  );
}

