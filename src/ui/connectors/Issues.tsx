import { Copy } from "@phosphor-icons/react";
import type { Issue } from "@/core/connectors/diagnose";
import { toast } from "../common";

const LABEL = { error: "Error", warning: "Warning", info: "Note" } as const;

export const copy = (text: string, done = "Copied") => void navigator.clipboard.writeText(text).then(() => toast(done), () => toast("Could not copy", true));

/** One problem: what it is, where, the code around it, and how to fix it. */
export function IssueCard({ issue, onJump }: { issue: Issue; onJump?: (line: number, column?: number) => void }) {
  const marked = issue.snippet?.find((l) => l.mark);
  const width = String(issue.snippet?.at(-1)?.n ?? 0).length;
  return (
    <article className={`issue ${issue.severity}`}>
      <header>
        <span className="issue-sev">{LABEL[issue.severity]}</span>
        <strong>{issue.title}</strong>
        {issue.where && <code className="issue-where">{issue.where}</code>}
        {issue.line && (onJump
          ? <button className="btn sm" onClick={() => onJump(issue.line!, issue.column)} title="Select this spot in the code">Line {issue.line}{issue.column ? `, column ${issue.column}` : ""}</button>
          : <span className="tag dim mono">Line {issue.line}{issue.column ? `:${issue.column}` : ""}</span>)}
      </header>
      {issue.detail && <p className="issue-detail">{issue.detail}</p>}
      {issue.snippet && issue.snippet.length > 0 && (
        <pre className="issue-code" aria-label="Code around the problem" style={{ ["--ln-w" as string]: `${width}ch` }}>{issue.snippet.map((l) => (
          <div key={l.n} className={l.mark ? "mark" : ""}>
            <span className="ln">{String(l.n).padStart(width, " ")}</span>{l.text || " "}
            {l.mark && marked && issue.column ? <span className="caret" style={{ ["--col" as string]: Math.min(issue.column, 160) - 1 }} aria-hidden="true" /> : null}
          </div>
        ))}</pre>
      )}
      {issue.fix && <p className="issue-fix"><strong>How to fix: </strong>{issue.fix}</p>}
      {issue.example && (
        <div className="issue-example">
          <pre>{issue.example}</pre>
          <button className="btn sm" onClick={() => copy(issue.example!)} aria-label="Copy the example"><Copy size={13} /> Copy</button>
        </div>
      )}
    </article>
  );
}

export function IssueList({ issues, onJump, empty }: { issues: Issue[]; onJump?: (line: number, column?: number) => void; empty?: string }) {
  if (!issues.length) return empty ? <p className="muted">{empty}</p> : null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  return <div className="issue-list">{[...issues].sort((a, b) => order[a.severity] - order[b.severity]).map((issue, i) => <IssueCard key={i} issue={issue} onJump={onJump} />)}</div>;
}
