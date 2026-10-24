import { useRef, useState } from "react";
import { allSources } from "@/core/sources/registry";
import { parseTachiyomiBackup, planImport, type ImportPlan, type ParsedBackup } from "@/core/tachiyomi";
import { applyImport, type ImportResult } from "@/core/tachiyomiApply";
import { toast } from "../common";

type State =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "preview"; backup: ParsedBackup; plan: ImportPlan; name: string }
  | { phase: "importing"; done: number; total: number }
  | { phase: "done"; result: ImportResult };

/** Pick a Tachiyomi or Mihon backup, see what will come across, then import it into the shelf. */
export function TachiyomiImport() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: "idle" });

  const choose = async (file: File) => {
    setState({ phase: "reading" });
    try {
      const backup = parseTachiyomiBackup(new Uint8Array(await file.arrayBuffer()));
      const plan = planImport(backup, allSources());
      setState({ phase: "preview", backup, plan, name: file.name });
    } catch (error) {
      setState({ phase: "idle" });
      toast((error as Error).message, true);
    }
  };

  const run = async (backup: ParsedBackup, plan: ImportPlan) => {
    setState({ phase: "importing", done: 0, total: plan.matched.length });
    try {
      const result = await applyImport(backup, plan, (done, total) => setState({ phase: "importing", done, total }));
      setState({ phase: "done", result });
    } catch (error) {
      setState({ phase: "idle" });
      toast((error as Error).message, true);
    }
  };

  return (
    <section className="panel" data-hue={6}>
      <h2>Import from Tachiyomi or Mihon</h2>
      <p className="muted" style={{ marginBottom: 12, lineHeight: 1.65 }}>Bring your library, categories and reading progress across from a backup file (<span className="mono">.tachibk</span> or <span className="mono">.proto.gz</span>). Series from sources Comik has are added to your shelf. Nothing is uploaded: the file is read on this device.</p>
      <input ref={input} type="file" accept=".tachibk,.gz,.proto,application/gzip,application/octet-stream" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void choose(file);
      }} />

      {(state.phase === "idle" || state.phase === "done") && <button className="btn" onClick={() => input.current?.click()}>Choose backup file</button>}
      {state.phase === "reading" && <p className="muted">Reading the backup…</p>}

      {state.phase === "preview" && (
        <div className="stack">
          <p><strong>{state.name}</strong> has {state.backup.manga.length.toLocaleString()} series and {state.backup.categories.length} categories.</p>
          <ul className="account-data-list">
            <li><strong>{state.plan.matched.length.toLocaleString()}</strong> series will be imported, with {state.plan.chapters.toLocaleString()} chapters and your read progress.</li>
            {state.plan.unmatched.length > 0 && <li>{state.plan.unmatched.reduce((n, s) => n + s.count, 0).toLocaleString()} series are from sources Comik does not have, so they are skipped: {state.plan.unmatched.slice(0, 6).map((s) => `${s.name} (${s.count})`).join(", ")}{state.plan.unmatched.length > 6 ? `, and ${state.plan.unmatched.length - 6} more` : ""}.</li>}
            {state.plan.notInLibrary > 0 && <li>{state.plan.notInLibrary.toLocaleString()} entries were not on your library in Tachiyomi and are ignored.</li>}
          </ul>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={!state.plan.matched.length} onClick={() => void run(state.backup, state.plan)}>Import {state.plan.matched.length.toLocaleString()} series</button>
            <button className="btn" onClick={() => setState({ phase: "idle" })}>Cancel</button>
          </div>
        </div>
      )}

      {state.phase === "importing" && (
        <div>
          <p className="muted">Importing {state.done.toLocaleString()} of {state.total.toLocaleString()}…</p>
          <progress value={state.done} max={state.total} style={{ width: "100%" }} />
        </div>
      )}

      {state.phase === "done" && (
        <p style={{ marginTop: 12, lineHeight: 1.65 }}>Imported <strong>{state.result.series.toLocaleString()}</strong> series with {state.result.chapters.toLocaleString()} chapters ({state.result.read.toLocaleString()} read){state.result.categories ? ` and ${state.result.categories} new categories` : ""}. Open a series to load its latest chapters.</p>
      )}
    </section>
  );
}
