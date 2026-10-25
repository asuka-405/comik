/**
 * Runs connector code in a sandboxed frame and lets it talk to Comik only through a small message channel.
 *
 * The frame is `sandbox="allow-scripts"` without `allow-same-origin`, so the code has an opaque origin: no
 * access to Comik's storage, cookies, or page. Its Content-Security-Policy is `default-src 'none'`, which blocks
 * fetch, XHR, WebSocket, dynamic imports, images and frames from inside. The only way out is `ctx.http`, and
 * that is answered here: https only, hosts from the manifest only, size and rate limits, through Comik's proxy
 * (or directly when the manifest asks for it).
 *
 * Every failure carries what the debugger needs: the phase, the method, the line and column inside the
 * connector's own code, and a record of each request the connector made.
 */
import { request } from "../http";
import { ConnectorFault } from "./diagnose";
import { checkUrl, parseManifest, type ConnectorManifest } from "./schema";

const CALL_TIMEOUT = 45_000;
const MAX_BODY = 10 * 1024 * 1024;
const MAX_REQUESTS_PER_CALL = 60;
/** How much of each response the debugger keeps for display. */
const KEEP_BODY = 40_000;

const BOOT = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"><script>
(() => {
  const host = window.parent;
  let pending = new Map(), seq = 0, connector = null, settings = {};
  const send = (message) => host.postMessage(message, "*");
  const rpc = (method, args) => {
    const site = new Error("site");
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject: (message, code) => {
        const error = new Error(message);
        error.code = code;
        // Keep the frames from the connector's own call so a failed request points at the line that made it.
        error.stack = "Error: " + message + "\\n" + String(site.stack).split("\\n").slice(1).join("\\n");
        reject(error);
      } });
      send({ t: "rpc", id, method, args });
    });
  };
  const show = (p) => { if (typeof p === "string") return p; if (p instanceof Error) return p.message; try { const s = JSON.stringify(p); return s === undefined ? String(p) : s; } catch { return String(p); } };
  const line = (level, parts) => send({ t: "log", level, text: parts.map(show).join(" ").slice(0, 500) });
  const ctx = {
    http: {
      get: (url, options) => rpc("http", [{ ...(options || {}), url, method: "GET" }]),
      getJson: (url, options) => rpc("http", [{ ...(options || {}), url, method: "GET" }]).then((r) => JSON.parse(r.text)),
      post: (url, body, options) => rpc("http", [{ ...(options || {}), url, method: "POST", body }]),
    },
    html: (text) => new DOMParser().parseFromString(text, "text/html"),
    log: (...parts) => line("log", parts),
    get settings() { return settings; },
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) console[level] = (...parts) => line(level === "debug" ? "log" : level, parts);
  window.addEventListener("error", (event) => line("error", ["Uncaught: " + event.message]));
  window.addEventListener("unhandledrejection", (event) => line("error", ["Unhandled promise rejection: " + show(event.reason)]));

  // Engines number the lines of a Function body differently. Throw from a known line once to learn the offset.
  const where = (error, name) => { const m = new RegExp(name.replace(".", "\\\\.") + ":(\\\\d+):(\\\\d+)").exec(String((error && error.stack) || "")); return m ? { line: +m[1], column: +m[2] } : null; };
  let shift = null;
  try { new Function('"use strict";\\nthrow new Error("probe")\\n//# sourceURL=comik-probe.js')(); } catch (error) { const w = where(error, "comik-probe.js"); if (w) shift = w.line - 2; }
  const position = (error) => { const w = where(error, "comik-connector.js"); if (!w || shift === null) return {}; const l = w.line - shift - 1; return l >= 1 ? { line: l, column: w.column } : {}; };
  const fail = (t, id, error) => send({ t, id, message: String((error && error.message) || error), name: error && error.name, code: error && error.code, stack: String((error && error.stack) || "").slice(0, 1500), ...position(error) });

  window.addEventListener("message", async (event) => {
    if (event.source !== host) return;
    const m = event.data || {};
    try {
      if (m.t === "load") {
        const module = { exports: {} };
        const code = String(m.code).replace(/^\\s*export\\s+default\\s+/m, "module.exports = ");
        new Function("module", "exports", "ctx", '"use strict";\\n' + code + '\\n//# sourceURL=comik-connector.js')(module, module.exports, ctx);
        connector = module.exports && module.exports.default ? module.exports.default : module.exports;
        if (!connector || typeof connector !== "object") throw new Error("The connector must set module.exports to an object.");
        send({ t: "loaded", manifest: JSON.parse(JSON.stringify(connector.manifest || null)), methods: Object.keys(connector).filter((key) => typeof connector[key] === "function") });
      } else if (m.t === "call") {
        settings = m.settings || {};
        const fn = connector && connector[m.method];
        if (typeof fn !== "function") throw new Error("This connector does not implement " + m.method + "().");
        const value = await fn.apply(connector, [...m.args, ctx]);
        send({ t: "result", id: m.id, value: JSON.parse(JSON.stringify(value === undefined ? null : value)) });
      } else if (m.t === "rpcResult") {
        const p = pending.get(m.id); pending.delete(m.id);
        if (p) (m.error ? p.reject(m.error, m.code) : p.resolve(m.value));
      }
    } catch (error) {
      fail(m.t === "load" ? "loadError" : "error", m.id, error);
    }
  });
  send({ t: "ready" });
})();
<\/script>`;

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/** One request a connector made, kept for the debugger. */
export interface TraceEntry {
  n: number;
  /** The connector method that was running, like "episodes". */
  call: string;
  method: "GET" | "POST";
  url: string;
  status?: number;
  ms: number;
  bytes?: number;
  contentType?: string;
  /** The start of the response, even when the status was an error. */
  body?: string;
  truncated?: boolean;
  /** Where the request ended up after redirects, when that differs. */
  finalUrl?: string;
  error?: string;
  code?: string;
}

export interface LogLine { level: "log" | "info" | "warn" | "error"; text: string; call: string }

/** A failure of a request, with a short code so the debugger can explain it. */
class HostError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export class ConnectorHost {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private calls = new Map<number, Pending>();
  private seq = 0;
  private listener: ((event: MessageEvent) => void) | null = null;
  private requests = 0;
  private current = "load";
  private traceSeq = 0;
  private onLoaded?: (manifest: unknown, methods: string[]) => void;
  private onLoadError?: (fault: ConnectorFault) => void;
  manifest: ConnectorManifest | null = null;
  /** The manifest exactly as the connector wrote it, before Comik tidied it. */
  rawManifest: unknown = null;
  /** The functions the connector exports, including helpers. */
  methods: string[] = [];
  readonly log: string[] = [];
  readonly lines: LogLine[] = [];
  readonly trace: TraceEntry[] = [];
  /** Called after each request finishes and each log line arrives, so a debugger can show progress. */
  onActivity?: () => void;

  constructor(private code: string, private settings: () => Record<string, string> = () => ({})) {}

  /** Start the frame, run the code, and return its validated manifest. */
  load(): Promise<ConnectorManifest> {
    if (this.ready) return this.ready.then(() => this.manifest!);
    this.ready = new Promise<void>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
      this.listener = (event) => { if (event.source === frame.contentWindow) void this.onMessage(event.data); };
      window.addEventListener("message", this.listener);
      const timer = setTimeout(() => { this.dispose(); reject(new ConnectorFault("The connector did not start.", { phase: "load" })); }, 10_000);
      this.onLoaded = (raw, methods) => {
        clearTimeout(timer);
        this.rawManifest = raw;
        this.methods = methods;
        try { this.manifest = parseManifest(raw); resolve(); }
        catch (error) { this.dispose(); reject(new ConnectorFault((error as Error).message, { phase: "manifest" })); }
      };
      this.onLoadError = (fault) => { clearTimeout(timer); this.dispose(); reject(fault); };
      frame.srcdoc = BOOT;
      document.body.appendChild(frame);
      this.frame = frame;
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready.then(() => this.manifest!);
  }

  /** Call a connector method. The reply is plain data; the caller validates it. */
  async call(method: string, args: unknown[]): Promise<unknown> {
    await this.load();
    this.requests = 0;
    this.current = method;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new ConnectorFault(`${method}() took longer than ${CALL_TIMEOUT / 1000} seconds.`, { phase: "call", method }));
      }, CALL_TIMEOUT);
      this.calls.set(id, { resolve, reject, timer });
      this.frame?.contentWindow?.postMessage({ t: "call", id, method, args, settings: this.settings() }, "*");
    });
  }

  dispose() {
    if (this.listener) window.removeEventListener("message", this.listener);
    this.listener = null;
    this.frame?.remove();
    this.frame = null;
    for (const pending of this.calls.values()) { clearTimeout(pending.timer); pending.reject(new ConnectorFault("The connector was stopped.", { phase: "call" })); }
    this.calls.clear();
    this.ready = null;
  }

  private reply(message: unknown) { this.frame?.contentWindow?.postMessage(message, "*"); }

  private fault(data: { [key: string]: unknown }, phase: "load" | "call", method?: string) {
    return new ConnectorFault(String(data.message), {
      phase, method, name: typeof data.name === "string" ? data.name : undefined, code: typeof data.code === "string" ? data.code : undefined,
      line: typeof data.line === "number" ? data.line : undefined, column: typeof data.column === "number" ? data.column : undefined,
      stack: typeof data.stack === "string" ? data.stack : undefined,
    });
  }

  private async onMessage(data: { t?: string; [key: string]: unknown }) {
    switch (data?.t) {
      case "ready":
        this.frame?.contentWindow?.postMessage({ t: "load", code: this.code }, "*");
        break;
      case "loaded": this.onLoaded?.(data.manifest, Array.isArray(data.methods) ? data.methods.map(String) : []); break;
      case "loadError": this.onLoadError?.(this.fault(data, "load")); break;
      case "log": {
        const text = String(data.text);
        const level = (["info", "warn", "error"].includes(String(data.level)) ? data.level : "log") as LogLine["level"];
        this.log.push(level === "log" ? text : `${level}: ${text}`);
        if (this.log.length > 200) this.log.shift();
        this.lines.push({ level, text, call: this.current });
        if (this.lines.length > 400) this.lines.shift();
        this.onActivity?.();
        break;
      }
      case "result": case "error": {
        const pending = this.calls.get(Number(data.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.calls.delete(Number(data.id));
        if (data.t === "error") pending.reject(this.fault(data, "call", this.current));
        else pending.resolve(data.value);
        break;
      }
      case "rpc": {
        const id = Number(data.id);
        try {
          if (data.method !== "http") throw new HostError("Unknown request.", "unknown");
          this.reply({ t: "rpcResult", id, value: await this.http((data.args as unknown[])[0] as HttpRequest) });
        } catch (error) {
          this.reply({ t: "rpcResult", id, error: (error as Error).message, code: error instanceof HostError ? error.code : "network" });
        }
        break;
      }
    }
  }

  private async http(req: HttpRequest): Promise<{ status: number; url: string; text: string }> {
    const entry: TraceEntry = { n: ++this.traceSeq, call: this.current, method: req.method === "POST" ? "POST" : "GET", url: String(req.url).slice(0, 2000), ms: 0 };
    const started = performance.now();
    this.trace.push(entry);
    if (this.trace.length > 300) this.trace.shift();
    try {
      const manifest = this.manifest;
      if (!manifest) throw new HostError("The connector has not loaded.", "state");
      if (++this.requests > MAX_REQUESTS_PER_CALL) throw new HostError(`A single call may make at most ${MAX_REQUESTS_PER_CALL} requests.`, "limit");
      let url: URL;
      try { url = checkUrl(req.url, manifest.domains); }
      catch (error) { throw new HostError((error as Error).message, /not in this connector/.test((error as Error).message) ? "domain" : /https/.test((error as Error).message) ? "scheme" : "url"); }
      const method = req.method === "POST" ? "POST" : "GET";
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers ?? {}).slice(0, 10)) if (/^[A-Za-z-]{1,40}$/.test(key) && typeof value === "string" && value.length < 2000 && !/^(host|cookie|content-length|origin|referer)$/i.test(key)) headers[key] = value;
      let body: string | undefined;
      if (method === "POST" && req.body !== undefined && req.body !== null) {
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        if (typeof req.body !== "string" && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
        if (body.length > 1_000_000) throw new HostError("The request body is too large.", "size");
      }
      let response: Response;
      try {
        response = manifest.direct
          ? await fetch(url, { method, headers, body, credentials: "omit", redirect: "follow" })
          : await request(url.toString(), { method, headers, body, referer: manifest.homepage ?? `https://${url.hostname}/`, minGapMs: 300 });
      } catch (error) {
        throw new HostError(`Could not reach ${url.hostname}: ${(error as Error).message || "network error"}.`, "network");
      }
      entry.status = response.status;
      entry.contentType = response.headers.get("content-type") ?? undefined;
      // Keep the body of errors too: it usually says what was wrong with the request.
      const text = await response.text();
      entry.bytes = text.length;
      entry.body = text.slice(0, KEEP_BODY);
      entry.truncated = text.length > KEEP_BODY;
      if (!response.ok) throw new HostError(`${url.hostname} answered HTTP ${response.status}.`, "status");
      // A redirect may not leave the allowlist. Through the proxy the final address is in a header.
      const finalUrl = manifest.direct ? response.url : response.headers.get("x-comik-final-url");
      if (finalUrl && finalUrl !== url.toString()) entry.finalUrl = finalUrl;
      if (finalUrl) { try { checkUrl(finalUrl, manifest.domains); } catch (error) { throw new HostError(`The request was redirected off the allowed hosts. ${(error as Error).message}`, "redirect"); } }
      if (text.length > MAX_BODY) throw new HostError("The response is too large.", "size");
      return { status: response.status, url: finalUrl || url.toString(), text };
    } catch (error) {
      entry.error = (error as Error).message;
      entry.code = error instanceof HostError ? error.code : "network";
      throw error;
    } finally {
      entry.ms = Math.round(performance.now() - started);
      this.onActivity?.();
    }
  }
}

interface HttpRequest { url: string; method?: string; headers?: Record<string, string>; body?: unknown }
