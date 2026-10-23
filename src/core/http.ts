import { getSettings } from "./settings";

/**
 * All network I/O goes through here so sources stay free of CORS / referer concerns.
 * The proxy does the real request; we add per-host rate limiting like Mihon's
 * rateLimit interceptor so sources don't get us banned.
 */

export function proxyBase(): string {
  const url = getSettings().proxyUrl.trim().replace(/\/+$/, "");
  return url ? `${url}/api` : "/api";
}

class HostLimiter {
  private last = new Map<string, number>();
  private chain = new Map<string, Promise<void>>();

  /** Wait until `minGapMs` has passed since the previous request to this host. */
  async wait(host: string, minGapMs: number): Promise<void> {
    const prev = this.chain.get(host) ?? Promise.resolve();
    const next = prev.then(async () => {
      const gap = Date.now() - (this.last.get(host) ?? 0);
      if (gap < minGapMs) await sleep(minGapMs - gap);
      this.last.set(host, Date.now());
    });
    this.chain.set(host, next.catch(() => {}));
    return next;
  }
}
const limiter = new HostLimiter();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FetchOpts {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | URLSearchParams | FormData;
  referer?: string;
  /** Minimum ms between requests to this host. */
  minGapMs?: number;
  signal?: AbortSignal;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function request(url: string, opts: FetchOpts = {}): Promise<Response> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.minGapMs) await limiter.wait(host, opts.minGapMs);
    try {
      const qs = new URLSearchParams({ url });
      if (opts.referer) qs.set("ref", opts.referer);
      const headers: Record<string, string> = {};
      if (opts.headers) headers["x-comik-headers"] = JSON.stringify(opts.headers);
      const res = await fetch(`${proxyBase()}/fetch?${qs}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body,
        signal: opts.signal,
      });
      if (res.status === 429 || res.status >= 502) {
        lastErr = new HttpError(res.status, `HTTP ${res.status}`, url);
        await sleep(600 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const detail = await res.json().then((j: { error?: string }) => j.error).catch(() => undefined);
        throw new HttpError(res.status, detail ?? `HTTP ${res.status}`, url);
      }
      return res;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("request failed");
}

export async function fetchText(url: string, opts?: FetchOpts): Promise<string> {
  return (await request(url, opts)).text();
}

export async function fetchJson<T = unknown>(url: string, opts?: FetchOpts): Promise<T> {
  const res = await request(url, { ...opts, headers: { accept: "application/json", ...opts?.headers } });
  return (await res.json()) as T;
}

export async function fetchDoc(url: string, opts?: FetchOpts): Promise<Document> {
  const html = await fetchText(url, opts);
  return parseHtml(html, url);
}

export function parseHtml(html: string, baseUrl: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // make relative URLs resolvable; DOMParser documents have no base
  const base = doc.createElement("base");
  base.href = baseUrl;
  doc.head.prepend(base);
  return doc;
}

/** Route an image through the proxy so referer-locked hosts work and canvas stays untainted. */
export function imageUrl(raw: string, referer?: string, direct?: boolean): string {
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  if (direct) return raw;
  const qs = new URLSearchParams({ url: raw });
  if (referer) qs.set("ref", referer);
  return `${proxyBase()}/img?${qs}`;
}

/* ------------------------------ html helpers ------------------------------ */

export const text = (el: Element | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function absUrl(href: string | null | undefined, base: string): string {
  if (!href) return "";
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** Read the best image URL off an <img> including common lazy-load attributes. */
export function imgSrc(el: Element | null | undefined, base: string): string {
  if (!el) return "";
  const attrs = ["data-lazy-src", "data-src", "data-cfsrc", "data-original", "data-url", "srcset", "data-srcset", "src"];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (!v || v.startsWith("data:")) continue;
    const first = a.includes("srcset") ? v.split(",")[0]!.trim().split(/\s+/)[0]! : v.trim();
    if (first) return absUrl(first, base);
  }
  return "";
}

export function pathOf(url: string, origin: string): string {
  try {
    const u = new URL(url, origin);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Map relative dates ("3 days ago") and common absolute formats to epoch ms. */
export function parseDate(input: string | null | undefined, now = Date.now()): number {
  if (!input) return 0;
  const s = input.trim().toLowerCase();
  if (!s) return 0;
  const rel = s.match(/(\d+|an?|one)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s*ago/);
  if (rel) {
    const n = /^\d+$/.test(rel[1]!) ? Number(rel[1]) : 1;
    const unit: Record<string, number> = {
      second: 1e3, sec: 1e3, minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5,
      day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6,
    };
    return now - n * unit[rel[2]!]!;
  }
  if (s === "today" || s.includes("just now")) return now;
  if (s === "yesterday") return now - 864e5;
  const t = Date.parse(input);
  return Number.isNaN(t) ? 0 : t;
}
