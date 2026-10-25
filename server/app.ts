import { Hono } from "hono";
import { cors } from "hono/cors";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";

/**
 * Comik proxy app. It has no listener of its own so the same code can run behind the Node
 * server (server/index.ts) and inside a Firebase Cloud Function (functions/src/index.ts).
 *
 * Comik proxy.
 *
 * Browsers cannot read most manga sites (no CORS headers) and many image hosts
 * reject requests whose Referer is not the site itself. This server does the
 * network work on behalf of the client and hands back bytes with CORS enabled.
 *
 * It refuses to talk to private networks, so it is safe to expose publicly.
 */

const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 25_000;
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const hostAllowlist = (process.env.HOST_ALLOWLIST ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/.exec(v)?.[1];
    if (mapped) {
      if (mapped.includes(".")) return isPrivateAddress(mapped);
      const parts = mapped.split(":");
      if (parts.length !== 2 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return true;
      const high = Number.parseInt(parts[0]!, 16), low = Number.parseInt(parts[1]!, 16);
      return isPrivateAddress([high >>> 8, high & 255, low >>> 8, low & 255].join("."));
    }
    const first = Number.parseInt(v.split(":")[0] || "0", 16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return true;
    return v.startsWith("2001:db8:") || v.startsWith("2001:10:") || v.startsWith("2001:20:") || v.startsWith("2002:") || v.startsWith("3fff:");
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

type PublicUrl = URL & { comikResolvedAddress: string };

async function assertPublicUrl(raw: string): Promise<PublicUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "only http(s) allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (hostAllowlist.length && !hostAllowlist.some((h) => host === h || host.endsWith("." + h))) {
    throw new HttpError(403, "host not allowed");
  }
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpError(403, "private host blocked");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(502, "dns lookup failed");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new HttpError(403, "private address blocked");
  Object.defineProperty(url, "comikResolvedAddress", { value: addrs[0]!.address });
  return url as PublicUrl;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const STRIP_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "origin", "x-forwarded-for"]);

/** Follow redirects manually so every hop passes the private-network check. */
async function guardedFetch(
  target: string,
  init: { method: string; headers: Record<string, string>; body?: BodyInit | null },
): Promise<{ res: Response; finalUrl: string }> {
  let current = target;
  let method = init.method;
  let body = init.body ?? undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetchPinned(url, method, init.headers, body);
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return { res, finalUrl: url.toString() };
  }
  throw new HttpError(508, "too many redirects");
}

function fetchPinned(url: PublicUrl, method: string, headers: Record<string, string>, body?: BodyInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const address = url.comikResolvedAddress;
    const family = isIP(address);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method,
      headers,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options !== null && "all" in options && options.all) {
          (callback as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address, family }]);
        } else {
          (callback as (error: null, address: string, family: number) => void)(null, address, family);
        }
      },
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
      }
      resolve(new Response(Readable.toWeb(incoming) as ReadableStream, {
        status: incoming.statusCode ?? 502,
        statusText: incoming.statusMessage,
        headers: responseHeaders,
      }));
    });
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new HttpError(504, "upstream timeout")));
    request.on("error", reject);
    if (body !== undefined && body !== null) request.write(Buffer.from(body as ArrayBuffer));
    request.end();
  });
}

async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > cap) throw new HttpError(413, "response too large");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new HttpError(413, "response too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function refererFor(target: URL, explicit?: string | null): string {
  if (explicit) return explicit;
  return target.origin + "/";
}

export const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return "*";
      if (allowedOrigins.length === 0) return origin;
      return allowedOrigins.includes(origin) ? origin : "";
    },
    // A wildcard does not cover Authorization, which the Firebase proxy needs.
    allowHeaders: ["authorization", "content-type", "accept", "accept-language", "range", "x-comik-headers"],
    exposeHeaders: ["x-comik-final-url", "x-comik-set-cookie", "x-comik-challenge"],
    maxAge: 86400,
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, name: "comik-proxy" }));

/**
 * Generic fetch. Query: url, ref (optional referer).
 * Extra request headers are passed as JSON in `x-comik-headers`.
 * Method and body are forwarded as-is.
 */
app.all("/api/fetch", async (c) => {
  try {
    const target = c.req.query("url");
    if (!target) throw new HttpError(400, "missing url");
    const url = await assertPublicUrl(target);

    const headers: Record<string, string> = {
      "user-agent": UA,
      accept: c.req.header("accept") ?? "*/*",
      "accept-language": c.req.header("accept-language") ?? "en-US,en;q=0.9",
      referer: refererFor(url, c.req.query("ref")),
    };
    const content = c.req.header("content-type");
    if (content) headers["content-type"] = content;
    const extra = c.req.header("x-comik-headers");
    if (extra) {
      try {
        for (const [k, v] of Object.entries(JSON.parse(extra) as Record<string, string>)) {
          if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = String(v);
        }
      } catch {
        throw new HttpError(400, "bad x-comik-headers");
      }
    }

    const method = c.req.method === "OPTIONS" ? "GET" : c.req.method;
    const declaredLength = Number(c.req.header("content-length") ?? 0);
    if (declaredLength > MAX_REQUEST_BYTES) throw new HttpError(413, "request too large");
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer();
    if (body && body.byteLength > MAX_REQUEST_BYTES) throw new HttpError(413, "request too large");
    const { res, finalUrl } = await guardedFetch(url.toString(), { method, headers, body });
    const bytes = await readCapped(res, MAX_HTML_BYTES);

    const out = new Headers();
    out.set("content-type", res.headers.get("content-type") ?? "application/octet-stream");
    out.set("x-comik-final-url", finalUrl);
    // Lets the client explain a Cloudflare block instead of showing a bare 403.
    if (res.headers.get("cf-mitigated") === "challenge" || ([403, 503].includes(res.status) && /cloudflare/i.test(res.headers.get("server") ?? ""))) out.set("x-comik-challenge", "cloudflare");
    out.set("cache-control", "no-store");
    return new Response(bytes as unknown as BodyInit, { status: res.status, headers: out });
  } catch (err) {
    return errorResponse(err);
  }
});

/** Image passthrough with spoofed referer. Cacheable by the browser. */
app.get("/api/img", async (c) => {
  try {
    const target = c.req.query("url");
    if (!target) throw new HttpError(400, "missing url");
    const url = await assertPublicUrl(target);
    const headers: Record<string, string> = {
      "user-agent": UA,
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      referer: refererFor(url, c.req.query("ref")),
    };
    const range = c.req.header("range");
    if (range) headers.range = range;
    const { res } = await guardedFetch(url.toString(), { method: "GET", headers });
    if (!res.ok && res.status !== 206) throw new HttpError(res.status, `upstream ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/") && !type.startsWith("application/octet-stream")) {
      throw new HttpError(415, "not an image");
    }
    const bytes = await readCapped(res, MAX_IMAGE_BYTES);
    const out = new Headers();
    out.set("content-type", type || "image/jpeg");
    out.set("cache-control", "public, max-age=604800, immutable");
    out.set("cross-origin-resource-policy", "cross-origin");
    return new Response(bytes as unknown as BodyInit, { status: res.status, headers: out });
  } catch (err) {
    return errorResponse(err);
  }
});

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "proxy error";
  const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
  return Response.json({ error: timeout ? "upstream timeout" : message }, { status: timeout ? 504 : 502 });
}

