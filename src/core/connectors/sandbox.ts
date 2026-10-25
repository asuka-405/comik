/**
 * Runs connector code in a sandboxed frame and lets it talk to Comik only through a small message channel.
 *
 * The frame is `sandbox="allow-scripts"` without `allow-same-origin`, so the code has an opaque origin: no
 * access to Comik's storage, cookies, or page. Its Content-Security-Policy is `default-src 'none'`, which blocks
 * fetch, XHR, WebSocket, dynamic imports, images and frames from inside. The only way out is `ctx.http`, and
 * that is answered here: https only, hosts from the manifest only, size and rate limits, through Comik's proxy
 * (or directly when the manifest asks for it).
 */
import { request } from "../http";
import { checkUrl, parseManifest, type ConnectorManifest } from "./schema";

const CALL_TIMEOUT = 45_000;
const MAX_BODY = 10 * 1024 * 1024;
const MAX_REQUESTS_PER_CALL = 60;

const BOOT = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"><script>
(() => {
  const host = window.parent;
  let pending = new Map(), seq = 0, connector = null, settings = {};
  const send = (message) => host.postMessage(message, "*");
  const rpc = (method, args) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); send({ t: "rpc", id, method, args }); });
  const ctx = {
    http: {
      get: (url, options) => rpc("http", [{ ...(options || {}), url, method: "GET" }]),
      getJson: (url, options) => rpc("http", [{ ...(options || {}), url, method: "GET" }]).then((r) => JSON.parse(r.text)),
      post: (url, body, options) => rpc("http", [{ ...(options || {}), url, method: "POST", body }]),
    },
    html: (text) => new DOMParser().parseFromString(text, "text/html"),
    log: (...parts) => send({ t: "log", text: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ").slice(0, 500) }),
    get settings() { return settings; },
  };
  window.addEventListener("message", async (event) => {
    if (event.source !== host) return;
    const m = event.data || {};
    try {
      if (m.t === "load") {
        const module = { exports: {} };
        const code = String(m.code).replace(/^\\s*export\\s+default\\s+/m, "module.exports = ");
        new Function("module", "exports", "ctx", '"use strict";\\n' + code)(module, module.exports, ctx);
        connector = module.exports && module.exports.default ? module.exports.default : module.exports;
        if (!connector || typeof connector !== "object") throw new Error("The connector must set module.exports to an object.");
        send({ t: "loaded", manifest: JSON.parse(JSON.stringify(connector.manifest || null)) });
      } else if (m.t === "call") {
        settings = m.settings || {};
        const fn = connector && connector[m.method];
        if (typeof fn !== "function") throw new Error("This connector does not implement " + m.method + "().");
        const value = await fn.apply(connector, [...m.args, ctx]);
        send({ t: "result", id: m.id, value: JSON.parse(JSON.stringify(value === undefined ? null : value)) });
      } else if (m.t === "rpcResult") {
        const p = pending.get(m.id); pending.delete(m.id);
        if (p) (m.error ? p.reject(new Error(m.error)) : p.resolve(m.value));
      }
    } catch (error) {
      send({ t: m.t === "load" ? "loadError" : "error", id: m.id, message: String((error && error.message) || error) });
    }
  });
  send({ t: "ready" });
})();
<\/script>`;

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export class ConnectorHost {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<void> | null = null;
  private calls = new Map<number, Pending>();
  private seq = 0;
  private listener: ((event: MessageEvent) => void) | null = null;
  private requests = 0;
  private onLoaded?: (manifest: unknown) => void;
  private onLoadError?: (message: string) => void;
  manifest: ConnectorManifest | null = null;
  readonly log: string[] = [];

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
      const timer = setTimeout(() => { this.dispose(); reject(new Error("The connector did not start.")); }, 10_000);
      this.onLoaded = (raw) => {
        clearTimeout(timer);
        try { this.manifest = parseManifest(raw); resolve(); } catch (error) { this.dispose(); reject(error as Error); }
      };
      this.onLoadError = (message) => { clearTimeout(timer); this.dispose(); reject(new Error(`The connector failed to load: ${message}`)); };
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
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`${method}() took longer than ${CALL_TIMEOUT / 1000} seconds.`));
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
    for (const pending of this.calls.values()) { clearTimeout(pending.timer); pending.reject(new Error("The connector was stopped.")); }
    this.calls.clear();
    this.ready = null;
  }

  private reply(message: unknown) { this.frame?.contentWindow?.postMessage(message, "*"); }

  private async onMessage(data: { t?: string; [key: string]: unknown }) {
    switch (data?.t) {
      case "ready":
        this.frame?.contentWindow?.postMessage({ t: "load", code: this.code }, "*");
        break;
      case "loaded": this.onLoaded?.(data.manifest); break;
      case "loadError": this.onLoadError?.(String(data.message)); break;
      case "log": this.log.push(String(data.text)); if (this.log.length > 200) this.log.shift(); break;
      case "result": case "error": {
        const pending = this.calls.get(Number(data.id));
        if (!pending) return;
        clearTimeout(pending.timer);
        this.calls.delete(Number(data.id));
        if (data.t === "error") pending.reject(new Error(String(data.message)));
        else pending.resolve(data.value);
        break;
      }
      case "rpc": {
        const id = Number(data.id);
        try {
          if (data.method !== "http") throw new Error("Unknown request.");
          this.reply({ t: "rpcResult", id, value: await this.http((data.args as unknown[])[0] as HttpRequest) });
        } catch (error) {
          this.reply({ t: "rpcResult", id, error: (error as Error).message });
        }
        break;
      }
    }
  }

  private async http(req: HttpRequest): Promise<{ status: number; url: string; text: string }> {
    const manifest = this.manifest;
    if (!manifest) throw new Error("The connector has not loaded.");
    if (++this.requests > MAX_REQUESTS_PER_CALL) throw new Error(`A single call may make at most ${MAX_REQUESTS_PER_CALL} requests.`);
    const url = checkUrl(req.url, manifest.domains);
    const method = req.method === "POST" ? "POST" : "GET";
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers ?? {}).slice(0, 10)) if (/^[A-Za-z-]{1,40}$/.test(key) && typeof value === "string" && value.length < 2000 && !/^(host|cookie|content-length|origin|referer)$/i.test(key)) headers[key] = value;
    let body: string | undefined;
    if (method === "POST" && req.body !== undefined && req.body !== null) {
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (typeof req.body !== "string" && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      if (body.length > 1_000_000) throw new Error("The request body is too large.");
    }
    const response = manifest.direct
      ? await fetch(url, { method, headers, body, credentials: "omit", redirect: "follow" })
      : await request(url.toString(), { method, headers, body, referer: manifest.homepage ?? `https://${url.hostname}/`, minGapMs: 300 });
    if (!response.ok) throw new Error(`${url.hostname} answered HTTP ${response.status}.`);
    // A redirect may not leave the allowlist. Through the proxy the final address is in a header.
    const finalUrl = manifest.direct ? response.url : response.headers.get("x-comik-final-url");
    if (finalUrl) checkUrl(finalUrl, manifest.domains);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_BODY) throw new Error("The response is too large.");
    const text = await response.text();
    if (text.length > MAX_BODY) throw new Error("The response is too large.");
    return { status: response.status, url: finalUrl || url.toString(), text };
  }
}

interface HttpRequest { url: string; method?: string; headers?: Record<string, string>; body?: unknown }
