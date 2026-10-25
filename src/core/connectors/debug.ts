/**
 * The connector debugger: runs a connector's code through every step Comik takes with it (read, manifest, popular,
 * latest, search, details, episodes, streams) and records for each step what the connector returned, what Comik
 * made of it, every request, the log, and a list of problems with where they are and how to fix them.
 *
 * It runs a draft that is not installed yet, in the same sandbox the installed connector would use.
 */
import { checkManifest, checkResult, ConnectorFault, explainFault, lintCode, type Issue } from "./diagnose";
import { maskSecrets } from "./json";
import { ConnectorHost, type LogLine, type TraceEntry } from "./sandbox";
import { toSChapters, toSManga, toStreamSet, type ConnectorManifest } from "./schema";

export type StepId = "code" | "manifest" | "popular" | "latest" | "search" | "details" | "episodes" | "streams";
export type StepStatus = "waiting" | "running" | "pass" | "warn" | "fail" | "skipped";

export interface Step {
  id: StepId;
  label: string;
  /** What is being run, like `search("a", 1)`. */
  call: string;
  status: StepStatus;
  ms?: number;
  note?: string;
  issues: Issue[];
  /** Exactly what the connector returned. */
  raw?: unknown;
  /** What Comik keeps of it after checking. */
  mapped?: unknown;
  requests: TraceEntry[];
  logs: LogLine[];
}

export interface DebugReport {
  steps: Step[];
  manifest?: ConnectorManifest;
  rawManifest?: unknown;
  methods: string[];
  running: boolean;
}

export interface DebugOptions {
  settings?: Record<string, string>;
  query?: string;
  titleId?: string;
  episodeId?: string;
  signal?: AbortSignal;
}

const LABELS: Record<StepId, string> = {
  code: "Read the code",
  manifest: "Start it and read the manifest",
  popular: "Popular",
  latest: "Latest",
  search: "Search",
  details: "Title details",
  episodes: "Episodes",
  streams: "Streams",
};
const ORDER = Object.keys(LABELS) as StepId[];

const fresh = (): DebugReport => ({
  steps: ORDER.map((id) => ({ id, label: LABELS[id], call: "", status: "waiting", issues: [], requests: [], logs: [] })),
  methods: [],
  running: true,
});

const statusOf = (issues: Issue[]): StepStatus => (issues.some((i) => i.severity === "error") ? "fail" : issues.some((i) => i.severity === "warning") ? "warn" : "pass");

/** Turn any error from the sandbox into a problem card, with the code around the failing line. */
export function issueFromError(error: unknown, code: string, method?: string): Issue {
  if (error instanceof ConnectorFault) return explainFault({ message: error.message, name: error.info.name, line: error.info.line, column: error.info.column, phase: error.info.phase, method: error.info.method ?? method, code: error.info.code }, code);
  return explainFault({ message: (error as Error)?.message ?? String(error), phase: "call", method }, code);
}

/** The quick check done when someone presses Review: read the code, start it, and check the manifest. */
export async function reviewCode(code: string): Promise<{ manifest?: ConnectorManifest; issues: Issue[]; methods: string[] }> {
  const issues = await lintCode(code);
  if (issues.some((i) => i.severity === "error")) return { issues, methods: [] };
  const host = new ConnectorHost(code);
  try {
    const manifest = await host.load();
    issues.push(...checkManifest(host.rawManifest, manifest));
    return { manifest, issues, methods: host.methods };
  } catch (error) {
    issues.push(issueFromError(error, code));
    return { issues, methods: [] };
  } finally { host.dispose(); }
}

/** Run every step and report as it goes. Never throws: a failure becomes a failed step. */
export async function runDebug(code: string, options: DebugOptions, onUpdate: (report: DebugReport) => void): Promise<DebugReport> {
  const report = fresh();
  const step = (id: StepId) => report.steps.find((s) => s.id === id)!;
  const push = () => onUpdate({ ...report, steps: report.steps.map((s) => ({ ...s })) });
  const skip = (id: StepId, note: string) => { const s = step(id); s.status = "skipped"; s.note = note; };
  const aborted = () => options.signal?.aborted === true;
  push();

  // 1. Read the code.
  const read = step("code");
  read.status = "running"; read.call = "parse"; push();
  const started = performance.now();
  read.issues = await lintCode(code);
  read.ms = Math.round(performance.now() - started);
  read.status = statusOf(read.issues);
  push();
  if (read.status === "fail") {
    for (const id of ORDER.slice(1)) skip(id, "Fix the code first.");
    report.running = false; push();
    return report;
  }

  // 2. Start it.
  const host = new ConnectorHost(code, () => options.settings ?? {});
  host.onActivity = () => {
    const running = report.steps.find((s) => s.status === "running");
    if (running && running.id !== "code") { running.requests = host.trace.filter((t) => t.n > mark.trace); running.logs = host.lines.slice(mark.lines); push(); }
  };
  const mark = { trace: 0, lines: 0 };
  try {
    const boot = step("manifest");
    boot.status = "running"; boot.call = "load"; push();
    const t0 = performance.now();
    try {
      report.manifest = await host.load();
      report.rawManifest = host.rawManifest;
      report.methods = host.methods;
      boot.issues = checkManifest(host.rawManifest, report.manifest);
      for (const field of report.manifest.settings ?? []) {
        if (field.required && !(options.settings?.[field.key] ?? "").trim()) boot.issues.push({ severity: "warning", where: `settings.${field.key}`, title: `The setting "${field.label}" is empty`, fix: "Fill it in under Settings below and run again. Steps that need it will fail until then." });
      }
      for (const method of ["search", "details", "episodes", "streams"]) if (!host.methods.includes(method)) boot.issues.push({ severity: "error", where: method, title: `${method}() is not exported`, detail: "Comik cannot call it.", fix: `Add ${method}() to the exported object. If it is defined but not listed here, check it is inside module.exports and is a function.` });
      boot.raw = host.rawManifest;
      boot.mapped = report.manifest;
      boot.note = `Exports: ${host.methods.filter((m) => !m.startsWith("_")).join(", ") || "nothing"}`;
    } catch (error) {
      boot.issues = [issueFromError(error, code)];
    }
    boot.ms = Math.round(performance.now() - t0);
    boot.status = statusOf(boot.issues);
    push();
    if (!report.manifest) { for (const id of ORDER.slice(2)) skip(id, "The connector did not start."); return report; }
    const manifest = report.manifest;

    let titleId = options.titleId?.trim() || "";
    let episodeId = options.episodeId?.trim() || "";
    let episodeInfo: { titleId: string; number: number; season?: number } | null = null;

    const run = async (id: StepId, call: string, args: unknown[], display: string) => {
      const s = step(id);
      if (aborted()) { s.status = "skipped"; s.note = "Stopped."; return undefined; }
      mark.trace = host.trace.at(-1)?.n ?? 0;
      mark.lines = host.lines.length;
      s.status = "running"; s.call = display; push();
      const t = performance.now();
      let raw: unknown;
      try {
        raw = await host.call(call, args);
        s.raw = raw;
        s.issues = checkResult(call, raw, manifest);
      } catch (error) {
        s.issues = [issueFromError(error, code, call)];
        s.raw = undefined;
      }
      s.ms = Math.round(performance.now() - t);
      s.requests = host.trace.filter((x) => x.n > mark.trace);
      s.logs = host.lines.slice(mark.lines);
      s.status = statusOf(s.issues);
      return s.status === "fail" ? undefined : raw;
    };

    const keep = (s: Step, items: unknown[]) => {
      const mapped = items.flatMap((item) => { try { return [toSManga(item, manifest)]; } catch { return []; } });
      s.mapped = { kept: mapped.length, of: items.length, first: mapped.slice(0, 3) };
      return mapped;
    };
    const firstId = (items: unknown[]) => { for (const item of items) { const id = (item as { id?: unknown })?.id; if (id !== undefined && id !== null && String(id)) return String(id); } return ""; };

    // 3. Lists. popular and latest are optional: Comik falls back to search("").
    for (const id of ["popular", "latest"] as const) {
      if (!host.methods.includes(id)) { skip(id, `Not exported. Comik uses search("") instead, which is fine.`); continue; }
      const raw = await run(id, id, [1], `${id}(1)`);
      const items = (raw as { items?: unknown[] } | undefined)?.items;
      if (Array.isArray(items)) { keep(step(id), items); titleId ||= firstId(items); }
      push();
    }
    if (host.methods.includes("search")) {
      const query = options.query ?? "a";
      const raw = await run("search", "search", [query, 1, {}], `search(${JSON.stringify(query)}, 1)`);
      const items = (raw as { items?: unknown[] } | undefined)?.items;
      if (Array.isArray(items)) { keep(step("search"), items); titleId ||= firstId(items); }
      push();
    } else skip("search", "search() is not exported.");

    // 4. One title.
    if (!titleId) skip("details", "No title id to test with. Fix the lists above, or enter an id under Test with.");
    else if (!host.methods.includes("details")) skip("details", "details() is not exported.");
    else {
      const raw = await run("details", "details", [titleId], `details(${JSON.stringify(titleId)})`);
      if (raw) { try { step("details").mapped = toSManga(raw, manifest); } catch (error) { step("details").mapped = { error: (error as Error).message }; } }
      push();
    }

    // 5. Its episodes.
    if (!titleId) skip("episodes", "No title id to test with.");
    else if (!host.methods.includes("episodes")) skip("episodes", "episodes() is not exported.");
    else {
      const raw = await run("episodes", "episodes", [titleId], `episodes(${JSON.stringify(titleId)})`);
      if (Array.isArray(raw)) {
        try {
          const chapters = toSChapters(raw, manifest);
          step("episodes").mapped = { kept: chapters.length, of: raw.length, newest: chapters.slice(0, 3), oldest: chapters.slice(-1) };
          const oldest = chapters.at(-1);
          if (oldest) { episodeId ||= oldest.url; episodeInfo = { titleId, number: oldest.number ?? 1, season: oldest.season }; }
        } catch (error) { step("episodes").mapped = { error: (error as Error).message }; }
      }
      push();
    }

    // 6. One episode's video.
    if (!episodeId) skip("streams", "No episode id to test with. Fix episodes above, or enter an id under Test with.");
    else if (!host.methods.includes("streams")) skip("streams", "streams() is not exported.");
    else {
      const info = episodeInfo ?? { titleId, number: 1 };
      const raw = await run("streams", "streams", [episodeId, info], `streams(${JSON.stringify(episodeId)}, ${JSON.stringify(info)})`);
      if (raw) { try { step("streams").mapped = toStreamSet(raw, manifest); } catch (error) { step("streams").mapped = { error: (error as Error).message }; } }
      push();
    }
    return report;
  } finally {
    host.dispose();
    for (const s of report.steps) if (s.status === "running") s.status = "fail";
    report.running = false;
    push();
  }
}

export const summarise = (report: DebugReport) => {
  const count = (status: StepStatus) => report.steps.filter((s) => s.status === status).length;
  return { passed: count("pass"), warned: count("warn"), failed: count("fail"), skipped: count("skipped") };
};

/** What the person sees when a download fails, in the same format as other problems. */
export function explainDownload(message: string): Issue {
  const where = "Download";
  if (/web page, not code/i.test(message)) return { severity: "error", where, title: "That address is a web page", detail: message, fix: "Use the raw file link. On GitHub open the file and press Raw; the address starts with raw.githubusercontent.com." };
  if (/must start with https/i.test(message) || /full https address/i.test(message)) return { severity: "error", where, title: "The address is not a full https link", detail: message, fix: "Enter the whole address, starting with https://." };
  if (/larger than 512 KB/.test(message)) return { severity: "error", where, title: "The file is too large", detail: message, fix: "A connector is code, not data. Move large lists out of it." };
  const status = /\b(?:HTTP |status )?(40[134]|429|5\d\d)\b/.exec(message)?.[1];
  if (status === "404") return { severity: "error", where, title: "Nothing is at that address (404)", detail: message, fix: "Check the link for typos, the branch name and the file name. A private repository cannot be read." };
  if (status === "403" || status === "401") return { severity: "error", where, title: `The host refused the download (${status})`, detail: message, fix: "The file may be private. Use a public raw link, or paste the code instead." };
  return { severity: "error", where, title: "The file could not be downloaded", detail: message, fix: "Open the address in a browser tab to check it shows plain code. If it does, paste the code instead." };
}

/** The whole run as plain text to paste into a message or an issue. Secrets typed into settings are masked. */
export function reportText(report: DebugReport, secrets: string[] = []): string {
  const lines: string[] = [];
  const m = report.manifest;
  lines.push(`Connector debug report${m ? `: ${m.name} v${m.version} (${m.id})` : ""}`);
  if (m) lines.push(`Domains: ${m.domains.join(", ")}${m.direct ? " (direct)" : ""}`);
  for (const s of report.steps) {
    lines.push("", `[${s.status.toUpperCase()}] ${s.label}${s.call ? `  ${s.call}` : ""}${s.ms !== undefined ? `  ${s.ms} ms` : ""}`);
    if (s.note) lines.push(`  ${s.note}`);
    for (const i of s.issues) {
      lines.push(`  ${i.severity.toUpperCase()}: ${i.title}${i.where ? `  (${i.where})` : ""}${i.line ? `  line ${i.line}${i.column ? `:${i.column}` : ""}` : ""}`);
      if (i.detail) lines.push(`    ${i.detail}`);
      for (const l of i.snippet ?? []) lines.push(`    ${l.mark ? ">" : " "} ${String(l.n).padStart(4)} | ${l.text}`);
      if (i.fix) lines.push(`    Fix: ${i.fix}`);
    }
    for (const r of s.requests) lines.push(`  ${r.method} ${r.status ?? "---"} ${r.ms} ms ${r.bytes !== undefined ? `${r.bytes} B ` : ""}${r.url}${r.error ? `  ${r.error}` : ""}`);
    for (const l of s.logs) lines.push(`  log${l.level === "log" ? "" : `.${l.level}`}: ${l.text}`);
  }
  return maskSecrets(lines.join("\n"), secrets);
}
