import { useMemo, useRef, useState, type ReactNode } from "react";
import { CaretDown, CaretRight, Check, Copy, Minus, Play, Stop, Warning, X } from "@phosphor-icons/react";
import type { ConnectorSetting } from "@/core/connectors/schema";
import { reportText, runDebug, summarise, type DebugReport, type Step, type StepStatus } from "@/core/connectors/debug";
import type { TraceEntry } from "@/core/connectors/sandbox";
import { IssueList, copy } from "./Issues";
import { BodyView, JsonBlock } from "./JsonView";

type Tab = "problems" | "returned" | "kept" | "requests" | "log";

const STATUS: Record<StepStatus, { label: string; icon: ReactNode }> = {
  waiting: { label: "Waiting", icon: <Minus size={14} /> },
  running: { label: "Running", icon: <span className="dbg-spin" /> },
  pass: { label: "Passed", icon: <Check size={14} weight="bold" /> },
  warn: { label: "Warnings", icon: <Warning size={14} weight="bold" /> },
  fail: { label: "Failed", icon: <X size={14} weight="bold" /> },
  skipped: { label: "Skipped", icon: <Minus size={14} /> },
};

const size = (bytes?: number) => (bytes === undefined ? "" : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`);

function Request({ entry, onFormat }: { entry: TraceEntry; onFormat: (text: string) => void }) {
  const ok = entry.status !== undefined && entry.status < 400 && !entry.error;
  return (
    <details className={`dbg-req ${ok ? "ok" : "bad"}`}>
      <summary>
        <span className="dbg-method mono">{entry.method}</span>
        <span className="dbg-status mono">{entry.status ?? "---"}</span>
        <span className="dbg-url mono">{entry.url}</span>
        <span className="muted mono">{entry.ms} ms{entry.bytes !== undefined ? `, ${size(entry.bytes)}` : ""}</span>
      </summary>
      <div className="dbg-req-body">
        {entry.error && <p className="issue-detail"><strong>{entry.error}</strong></p>}
        {entry.finalUrl && <p className="muted mono" style={{ fontSize: 12 }}>Redirected to {entry.finalUrl}</p>}
        <div className="connector-actions"><button className="btn sm" onClick={() => copy(entry.url)}><Copy size={13} /> Copy address</button></div>
        {entry.body !== undefined && <BodyView body={entry.body} truncated={entry.truncated} contentType={entry.contentType} onFormat={onFormat} />}
      </div>
    </details>
  );
}

function StepBody({ step, onJump, onFormat }: { step: Step; onJump?: (line: number, column?: number) => void; onFormat: (text: string) => void }) {
  const tabs: [Tab, string][] = [["problems", `Problems${step.issues.length ? ` (${step.issues.length})` : ""}`]];
  if (step.raw !== undefined) tabs.push(["returned", "Returned"]);
  if (step.mapped !== undefined) tabs.push(["kept", "What Comik keeps"]);
  if (step.requests.length) tabs.push(["requests", `Requests (${step.requests.length})`]);
  if (step.logs.length) tabs.push(["log", `Log (${step.logs.length})`]);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked && tabs.some(([t]) => t === picked) ? picked : step.issues.length ? "problems" : step.raw !== undefined ? "returned" : "problems";
  return (
    <div className="dbg-body">
      {step.note && <p className="muted">{step.note}</p>}
      {tabs.length > 1 && (
        <div className="seg sm" role="tablist" aria-label={`${step.label} details`}>
          {tabs.map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => setPicked(value)}>{label}</button>)}
        </div>
      )}
      {tab === "problems" && <IssueList issues={step.issues} onJump={onJump} empty={step.status === "skipped" ? undefined : "No problems found."} />}
      {tab === "returned" && <><p className="muted">Exactly what the connector returned.</p><JsonBlock value={step.raw} onFormat={onFormat} /></>}
      {tab === "kept" && <><p className="muted">What Comik keeps after checking it. Anything missing here was dropped.</p><JsonBlock value={step.mapped} onFormat={onFormat} /></>}
      {tab === "requests" && <div className="dbg-reqs">{step.requests.map((entry) => <Request key={entry.n} entry={entry} onFormat={onFormat} />)}</div>}
      {tab === "log" && <pre className="connector-log">{step.logs.map((l) => `${l.level === "log" ? "" : `${l.level}: `}${l.text}`).join("\n")}</pre>}
    </div>
  );
}

interface Props {
  code: string;
  fields: ConnectorSetting[];
  onJump?: (line: number, column?: number) => void;
  onFormat: (text: string) => void;
  /** Start as soon as the panel opens. */
  autorun?: boolean;
}

/** Runs the connector step by step and shows, for each step, what went wrong, where, and how to fix it. */
export function Debugger({ code, fields: given, onJump, onFormat, autorun }: Props) {
  const [report, setReport] = useState<DebugReport | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("a");
  const [titleId, setTitleId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  const run = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setOpen({});
    const final = await runDebug(code, { settings: values, query, titleId, episodeId, signal: controller.signal }, (next) => {
      setReport(next);
      // Open the first step that has something to show.
      setOpen((prev) => (Object.keys(prev).length ? prev : (() => { const bad = next.steps.find((s) => s.status === "fail") ?? next.steps.find((s) => s.status === "warn"); return bad ? { [bad.id]: true } : prev; })()));
    });
    setReport(final);
    setOpen((prev) => (Object.keys(prev).length ? prev : { [(final.steps.find((s) => s.status === "fail") ?? final.steps.find((s) => s.status === "warn") ?? final.steps.filter((s) => s.status === "pass").at(-1))?.id ?? "code"]: true }));
  };
  if (autorun && !started.current) { started.current = true; queueMicrotask(() => void run()); }

  const fields = given.length ? given : report?.manifest?.settings ?? [];
  const sum = useMemo(() => (report ? summarise(report) : null), [report]);
  const secrets = Object.values(values);

  return (
    <div className="stack" style={{ gap: 12 }}>
      {fields.length > 0 && (
        <fieldset className="dbg-fields">
          <legend>Settings used for the run</legend>
          {fields.map((field) => (
            <div className="field" key={field.key}>
              <label className="label" htmlFor={`dbg-${field.key}`}>{field.label}{field.required ? " *" : ""}</label>
              <input id={`dbg-${field.key}`} className="input" type={field.secret ? "password" : "text"} autoComplete="off" placeholder={field.placeholder} value={values[field.key] ?? ""} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12.5 }}>Used only for this run. They are not saved with the connector.</p>
        </fieldset>
      )}
      <details className="dbg-with">
        <summary>Test with a different search or ids</summary>
        <div className="dbg-with-grid">
          <div className="field"><label className="label" htmlFor="dbg-q">Search for</label><input id="dbg-q" className="input" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="field"><label className="label" htmlFor="dbg-title">Title id (otherwise the first result)</label><input id="dbg-title" className="input mono" value={titleId} onChange={(event) => setTitleId(event.target.value)} /></div>
          <div className="field"><label className="label" htmlFor="dbg-ep">Episode id (otherwise the first episode)</label><input id="dbg-ep" className="input mono" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)} /></div>
        </div>
      </details>
      <div className="connector-actions">
        <button className="btn primary" disabled={!code.trim() || !!report?.running} onClick={() => void run()}><Play size={15} weight="fill" /> {report ? "Run again" : "Run the debugger"}</button>
        {report?.running && <button className="btn" onClick={() => abort.current?.abort()}><Stop size={15} weight="fill" /> Stop</button>}
        {report && !report.running && <button className="btn" onClick={() => copy(reportText(report, secrets), "Report copied")}><Copy size={14} /> Copy report</button>}
        {sum && <span className="dbg-sum mono">{sum.passed} passed{sum.warned ? `, ${sum.warned} with warnings` : ""}{sum.failed ? `, ${sum.failed} failed` : ""}{sum.skipped ? `, ${sum.skipped} skipped` : ""}</span>}
      </div>
      {!report && <p className="muted">It runs the code as Comik would: reads it, starts it, then calls popular, latest, search, details, episodes and streams in turn, using what each returns for the next. Nothing is installed or saved.</p>}
      {report && (
        <ol className="dbg-steps">
          {report.steps.map((step) => {
            const isOpen = !!open[step.id];
            const errors = step.issues.filter((i) => i.severity === "error").length, warnings = step.issues.filter((i) => i.severity === "warning").length;
            return (
              <li key={step.id} className={`dbg-step ${step.status}`}>
                <button className="dbg-head" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [step.id]: !isOpen })} disabled={step.status === "waiting"}>
                  <span className={`dbg-icon ${step.status}`} aria-label={STATUS[step.status].label}>{STATUS[step.status].icon}</span>
                  <strong>{step.label}</strong>
                  {step.call && <code className="dbg-call">{step.call}</code>}
                  <span className="dbg-meta mono">
                    {errors > 0 && <span className="dbg-count bad">{errors} {errors === 1 ? "error" : "errors"}</span>}
                    {warnings > 0 && <span className="dbg-count warn">{warnings} {warnings === 1 ? "warning" : "warnings"}</span>}
                    {step.ms !== undefined && <span className="muted">{step.ms} ms</span>}
                  </span>
                  {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
                </button>
                {isOpen && <StepBody step={step} onJump={onJump} onFormat={onFormat} />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
