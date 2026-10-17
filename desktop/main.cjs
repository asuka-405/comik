const { app, BrowserWindow, shell } = require("electron");
const { createServer } = require("node:http");
const { lookup } = require("node:dns/promises");
const { isIP } = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");

const DIST_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "dist")
  : path.resolve(__dirname, "../dist");
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const HTML_LIMIT = 12 * 1024 * 1024;
const IMAGE_LIMIT = 40 * 1024 * 1024;
const APP_PORT = 41739;

const MIME = {
  ".avif": "image/avif",
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isPrivateAddress(ip) {
  if (ip.includes(":")) {
    const address = ip.toLowerCase();
    if (address === "::" || address === "::1" || address.startsWith("fe80") || address.startsWith("fc") || address.startsWith("fd")) return true;
    if (address.startsWith("::ffff:")) return isPrivateAddress(address.slice(7));
    return false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0)) || a >= 224;
}

async function assertPublicUrl(raw) {
  const target = new URL(raw);
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("only http(s) allowed");
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("private host blocked");
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("private address blocked");
  }
  return target;
}

function upstreamHeaders(request, target, referer) {
  const headers = new Headers({
    "user-agent": USER_AGENT,
    accept: request.headers.get("accept") || "*/*",
    "accept-language": request.headers.get("accept-language") || "en-US,en;q=0.9",
    referer: referer || `${target.origin}/`,
  });
  const encoded = request.headers.get("x-comik-headers");
  if (encoded) {
    let extra;
    try {
      extra = JSON.parse(encoded);
    } catch {
      throw new Error("bad x-comik-headers");
    }
    for (const [name, value] of Object.entries(extra)) {
      if (!["host", "content-length", "connection", "origin", "x-forwarded-for"].includes(name.toLowerCase())) {
        headers.set(name, String(value));
      }
    }
  }
  return headers;
}

async function readBounded(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("upstream response too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("upstream response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function guardedFetch(target, init) {
  let current = target.toString();
  let method = init.method;
  let body = init.body;
  for (let hop = 0; hop <= 5; hop++) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, {
      method,
      headers: init.headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      current = new URL(response.headers.get("location"), url).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return response;
  }
  throw new Error("too many redirects");
}

async function fetchSource(request, target, referer) {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await guardedFetch(target, {
    method,
    headers: upstreamHeaders(request, target, referer),
    body,
  });
  const bytes = await readBounded(upstream, HTML_LIMIT);
  return new Response([204, 205, 304].includes(upstream.status) ? null : bytes, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "x-comik-final-url": upstream.url,
      "cache-control": "no-store",
    },
  });
}

async function fetchImage(target, referer) {
  const upstream = await guardedFetch(target, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      referer: referer || `${target.origin}/`,
    },
  });
  if (!upstream.ok && upstream.status !== 206) return jsonResponse({ error: `upstream ${upstream.status}` }, upstream.status);
  const contentType = upstream.headers.get("content-type") || "";
  if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
    return jsonResponse({ error: "not an image" }, 415);
  }
  const bytes = await readBounded(upstream, IMAGE_LIMIT);
  return new Response(bytes, {
    status: upstream.status,
    headers: {
      "content-type": contentType || "image/jpeg",
      "cache-control": "public, max-age=604800, immutable",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

async function serveAsset(url) {
  let relative;
  try {
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  } catch {
    return new Response("invalid path", { status: 400 });
  }
  let filePath = path.resolve(DIST_ROOT, relative);
  if (filePath !== DIST_ROOT && !filePath.startsWith(`${DIST_ROOT}${path.sep}`)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const info = await fs.stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    const body = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mime = MIME[extension] || "application/octet-stream";
    const textual = mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript") || mime.includes("svg");
    return new Response(body, {
      headers: {
        "content-type": textual ? `${mime}; charset=utf-8` : mime,
        "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

async function handleAppRequest(request, url) {
  if (url.pathname === "/api/health") return jsonResponse({ ok: true, name: "comik-desktop" });

  if (url.pathname === "/api/fetch" || url.pathname === "/api/img") {
    const rawTarget = url.searchParams.get("url");
    if (!rawTarget) return jsonResponse({ error: "missing url" }, 400);
    let target;
    try {
      target = new URL(rawTarget);
    } catch {
      return jsonResponse({ error: "invalid url" }, 400);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return jsonResponse({ error: "only http(s) allowed" }, 400);
    }
    try {
      const referer = url.searchParams.get("ref");
      return url.pathname === "/api/img"
        ? await fetchImage(target, referer)
        : await fetchSource(request, target, referer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return jsonResponse({ error: timedOut ? "upstream timeout" : message }, timedOut ? 504 : 502);
    }
  }

  return serveAsset(url);
}

let mainWindow = null;

// A second launch would fail to bind the fixed port, so hand focus to the running window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.quit();
  });
}

async function listen(server) {
  // The port is fixed so the origin, and with it IndexedDB, stays the same between launches.
  // If something else owns it, fall back to a random port rather than failing to start.
  for (const port of [APP_PORT, 0]) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "localhost", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return;
    } catch (error) {
      if (port === 0 || error.code !== "EADDRINUSE") throw error;
    }
  }
}

async function start() {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || "/", "http://localhost");
      const method = incoming.method || "GET";
      let body;
      if (method !== "GET" && method !== "HEAD") {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }
      const request = new Request(`http://localhost${url.pathname}${url.search}`, {
        method,
        headers: incoming.headers,
        body,
      });
      const response = await handleAppRequest(request, url);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const response = jsonResponse({ error: error instanceof Error ? error.message : "request failed" }, 500);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    }
  });
  await listen(server);
  const address = server.address();
  const appOrigin = `http://localhost:${address.port}`;

  const window = mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: "#111713",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return { action: "deny" };
    }
    const firebaseHandler = (target.hostname.endsWith(".firebaseapp.com") || target.hostname.endsWith(".web.app"))
      && target.pathname.startsWith("/__/auth/");
    if (firebaseHandler || target.hostname === "accounts.google.com") return { action: "allow" };
    if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(`${appOrigin}/`)) {
      event.preventDefault();
      if (target.startsWith("https://") || target.startsWith("http://")) void shell.openExternal(target);
    }
  });
  window.on("closed", () => {
    mainWindow = null;
    server.close();
  });
  await window.loadURL(`${appOrigin}/web/index.html`);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
