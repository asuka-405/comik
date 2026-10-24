const { app, BrowserWindow, net, session, shell } = require("electron");
const { createServer } = require("node:http");
const { lookup } = require("node:dns/promises");
const { isIP } = require("node:net");
const fs = require("node:fs/promises");
const path = require("node:path");

const DIST_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "dist")
  : path.resolve(__dirname, "../dist");
const HTML_LIMIT = 12 * 1024 * 1024;
const IMAGE_LIMIT = 40 * 1024 * 1024;
const UPDATE_FILE_LIMIT = 24 * 1024 * 1024;
const UPDATE_REQUEST_LIMIT = 36 * 1024 * 1024;
const APP_PORT = 41739;
const UPDATE_ROOT = path.join(app.getPath("userData"), "web-updates");

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

/**
 * Source requests go through Chromium's own network stack and cookie jar instead of Node's fetch.
 * Many sites sit behind Cloudflare, which checks the TLS fingerprint and, when unsure, serves a
 * JavaScript challenge. Chromium's fingerprint passes most checks, and for the rest solveCloudflare
 * runs the challenge in a real browser window. The clearance cookie lands in the same jar, so every
 * later request, including images, is let through.
 */
const isCloudflareChallenge = (response) =>
  response.headers.get("cf-mitigated") === "challenge"
  || ([403, 503].includes(response.status) && /cloudflare/i.test(response.headers.get("server") || ""));

const solving = new Map();

/** Open the site in a hidden window until Cloudflare hands out a clearance cookie. Shown only if a person has to act. */
function solveCloudflare(origin) {
  if (solving.has(origin)) return solving.get(origin);
  const host = new URL(origin).host;
  const job = new Promise((resolve) => {
    let finished = false;
    let window;
    const timers = [];
    const done = (ok) => {
      if (finished) return;
      finished = true;
      timers.forEach((timer) => clearTimeout(timer));
      if (window && !window.isDestroyed()) window.destroy();
      resolve(ok);
    };
    session.defaultSession.cookies.get({ url: origin })
      .then((cookies) => Promise.all(cookies.filter((c) => c.name === "cf_clearance").map((c) => session.defaultSession.cookies.remove(origin, c.name))))
      .catch(() => {})
      .then(() => {
        window = new BrowserWindow({
          show: false,
          width: 520,
          height: 680,
          title: `Verifying ${host}`,
          backgroundColor: "#111713",
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        window.setMenuBarVisibility(false);
        window.on("closed", () => done(false));
        const poll = async () => {
          if (finished) return;
          const cookies = await session.defaultSession.cookies.get({ url: origin }).catch(() => []);
          if (cookies.some((c) => c.name === "cf_clearance")) return done(true);
          timers.push(setTimeout(poll, 600));
        };
        void poll();
        // Most checks finish by themselves in a few seconds. A checkbox needs the window on screen.
        timers.push(setTimeout(() => { if (!finished && window && !window.isDestroyed()) window.show(); }, 8000));
        timers.push(setTimeout(() => done(false), 120000));
        window.loadURL(`${origin}/`).catch(() => {});
      });
  }).finally(() => solving.delete(origin));
  solving.set(origin, job);
  return job;
}

/**
 * One request over Chromium's network stack and the app's cookie jar, as a standard Response.
 * Redirects are not followed: a 3xx is returned so guardedFetch can vet each hop. (net.fetch cannot do
 * this, it throws "Redirect was cancelled" when asked for manual redirects.)
 */
function chromiumRequest(url, { method, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url: url.toString(), method, session: session.defaultSession, useSessionCookies: true, redirect: "manual" });
    const fail = (error) => { clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => {
      request.abort();
      fail(Object.assign(new Error("upstream timeout"), { name: "TimeoutError" }));
    }, 25000);
    const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers || {});
    for (const [name, value] of entries) {
      try { request.setHeader(name, String(value)); } catch { /* Chromium refuses a few headers (Host, Content-Length); the stack sets them itself */ }
    }
    request.on("redirect", (status, _method, redirectUrl) => {
      clearTimeout(timer);
      request.abort();
      resolve(new Response(null, { status, headers: { location: redirectUrl } }));
    });
    request.on("response", (incoming) => {
      const chunks = [];
      let total = 0;
      incoming.on("data", (chunk) => {
        total += chunk.length;
        if (total > IMAGE_LIMIT) { request.abort(); fail(new Error("upstream response too large")); return; }
        chunks.push(chunk);
      });
      incoming.on("end", () => {
        clearTimeout(timer);
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (name.toLowerCase() === "set-cookie") continue;
          responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
        }
        const empty = [101, 204, 205, 304].includes(incoming.statusCode);
        resolve(new Response(empty ? null : Buffer.concat(chunks), { status: incoming.statusCode, statusText: incoming.statusMessage, headers: responseHeaders }));
      });
      incoming.on("error", fail);
    });
    request.on("error", fail);
    if (body && body.byteLength) request.write(Buffer.from(body));
    request.end();
  });
}

async function guardedFetch(target, init) {
  let current = target.toString();
  let method = init.method;
  let body = init.body;
  for (let hop = 0; hop <= 5; hop++) {
    const url = await assertPublicUrl(current);
    // Chromium refuses to send an https Referer to an http address (some sites redirect through one), so drop it there.
    const hopHeaders = new Headers(init.headers);
    if (url.protocol === "http:") hopHeaders.delete("referer");
    const send = () => chromiumRequest(url, { method, headers: hopHeaders, body });
    let response = await send();
    if (!init.noChallenge && isCloudflareChallenge(response) && await solveCloudflare(url.origin)) {
      await response.body?.cancel().catch(() => {});
      response = await send();
    }
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      current = new URL(response.headers.get("location"), url).toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    // Chromium reports an empty url for manually followed redirects, so remember where the chain ended.
    response.finalUrl = url.toString();
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
    // Global search asks not to open check windows for every site; see silenceChallenges in the web code.
    noChallenge: request.headers.get("x-comik-no-challenge") === "1",
  });
  const bytes = await readBounded(upstream, HTML_LIMIT);
  return new Response([204, 205, 304].includes(upstream.status) ? null : bytes, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/octet-stream",
      "x-comik-final-url": upstream.finalUrl || upstream.url,
      ...(isCloudflareChallenge(upstream) ? { "x-comik-challenge": "cloudflare" } : {}),
      "cache-control": "no-store",
    },
  });
}

async function fetchImage(target, referer) {
  const upstream = await guardedFetch(target, {
    headers: {
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

function safeUpdateVersion(version) {
  return typeof version === "string" && /^[0-9]+\.[0-9]+\.[0-9]+-(alpha|beta|rc)(\.[0-9A-Za-z.-]+)?$/.test(version);
}

function safeUpdatePath(relative) {
  return typeof relative === "string" && /^(assets|web|releases)\/[A-Za-z0-9._/-]+$/.test(relative)
    && !relative.split("/").some((part) => !part || part === "." || part === "..");
}

function sha256(bytes) {
  return require("node:crypto").createHash("sha256").update(bytes).digest("hex");
}

const updateStatePath = () => path.join(UPDATE_ROOT, "active.json");

async function readUpdateState() {
  try { return JSON.parse(await fs.readFile(updateStatePath(), "utf8")); }
  catch { return { active: "", previous: "", pending: false }; }
}

async function writeUpdateState(state) {
  await fs.mkdir(UPDATE_ROOT, { recursive: true });
  const temp = `${updateStatePath()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state));
  await fs.rename(temp, updateStatePath());
}

async function recoverUnconfirmedUpdate() {
  const state = await readUpdateState();
  if (state.pending) await writeUpdateState({ active: state.previous || "", previous: "", pending: false });
}

async function handleUpdateRequest(request, url) {
  const requestOrigin = request.headers.get("origin");
  const expectedOrigin = `http://${request.headers.get("host") || "localhost"}`;
  if (requestOrigin && requestOrigin !== expectedOrigin) return jsonResponse({ error: "origin not allowed" }, 403);
  if (url.pathname === "/api/update/version" && request.method === "GET") {
    const state = await readUpdateState();
    return jsonResponse({ version: state.active || "" });
  }
  if (url.pathname === "/api/update/confirm" && request.method === "POST") {
    const state = await readUpdateState();
    await writeUpdateState({ active: state.active || "", previous: "", pending: false });
    return jsonResponse({ ok: true });
  }
  if (request.method !== "POST") return jsonResponse({ error: "POST required" }, 405);
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "invalid JSON" }, 400); }

  if (url.pathname === "/api/update/begin") {
    if (body.schema !== 1 || !safeUpdateVersion(body.version) || !Array.isArray(body.files) || !body.files.length || body.files.length > 5000) return jsonResponse({ error: "invalid update manifest" }, 400);
    let total = 0;
    let hasEntry = false;
    const seen = new Set();
    for (const item of body.files) {
      if (!safeUpdatePath(item.path) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > UPDATE_FILE_LIMIT || !/^[a-f0-9]{64}$/i.test(item.sha256) || seen.has(item.path)) return jsonResponse({ error: "invalid update file entry" }, 400);
      seen.add(item.path);
      total += item.size;
      if (item.path === "web/index.html") hasEntry = true;
    }
    if (!hasEntry || total > 160 * 1024 * 1024) return jsonResponse({ error: "update size or entry is invalid" }, 400);
    const directory = path.join(UPDATE_ROOT, `${body.version}.staging`);
    await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
    const active = (await readUpdateState()).active;
    if (active && safeUpdateVersion(active)) {
      const activeDirectory = path.join(UPDATE_ROOT, active);
      await fs.cp(activeDirectory, directory, { recursive: true, force: true }).catch(() => {});
    }
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(body));
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/update/file") {
    if (!safeUpdateVersion(body.version) || !safeUpdatePath(body.path) || typeof body.content !== "string") return jsonResponse({ error: "invalid update file" }, 400);
    const directory = path.join(UPDATE_ROOT, `${body.version}.staging`);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")); }
    catch { return jsonResponse({ error: "update was not prepared" }, 409); }
    const entry = manifest.files.find((item) => item.path === body.path);
    if (!entry || entry.sha256 !== body.sha256 || body.content.length > Math.ceil(UPDATE_FILE_LIMIT * 4 / 3) + 16) return jsonResponse({ error: "file is not in manifest" }, 400);
    const bytes = Buffer.from(body.content, "base64");
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) return jsonResponse({ error: "file integrity check failed" }, 400);
    const filePath = path.resolve(directory, body.path);
    if (!filePath.startsWith(`${directory}${path.sep}`)) return jsonResponse({ error: "invalid file path" }, 400);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return jsonResponse({ ok: true });
  }

  if (url.pathname === "/api/update/activate") {
    if (!safeUpdateVersion(body.version)) return jsonResponse({ error: "invalid version" }, 400);
    const directory = path.join(UPDATE_ROOT, `${body.version}.staging`);
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8")); }
    catch { return jsonResponse({ error: "update was not prepared" }, 409); }
    for (const item of manifest.files) {
      const filePath = path.join(directory, item.path);
      const bytes = await fs.readFile(filePath).catch(() => null);
      if (!bytes || bytes.length !== item.size || sha256(bytes) !== item.sha256) return jsonResponse({ error: `missing or invalid update file: ${item.path}` }, 409);
    }
    const installed = path.join(UPDATE_ROOT, body.version);
    await fs.rm(installed, { recursive: true, force: true });
    await fs.rename(directory, installed);
    const previous = (await readUpdateState()).active || "";
    await writeUpdateState({ active: body.version, previous, pending: true });
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "not found" }, 404);
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
    const state = await readUpdateState();
    if (safeUpdateVersion(state.active) && safeUpdatePath(relative)) {
      const overlayRoot = path.join(UPDATE_ROOT, state.active);
      const overlayFile = path.resolve(overlayRoot, relative);
      if (overlayFile.startsWith(`${overlayRoot}${path.sep}`) && await fs.stat(overlayFile).then((info) => info.isFile()).catch(() => false)) filePath = overlayFile;
    }
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

  if (url.pathname.startsWith("/api/update/")) return handleUpdateRequest(request, url);

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
  await recoverUnconfirmedUpdate();
  // Chromium's own agent string, without the Electron and app tokens that sites treat as a bot.
  session.defaultSession.setUserAgent(session.defaultSession.getUserAgent().replace(/\s(Electron|comik-desktop|Comik)\/\S+/gi, ""));
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || "/", `http://${incoming.headers.host || "localhost"}`);
      const method = incoming.method || "GET";
      let body;
      if (method !== "GET" && method !== "HEAD") {
        const chunks = [];
        let total = 0;
        for await (const chunk of incoming) {
          total += chunk.length;
          if (total > UPDATE_REQUEST_LIMIT) {
            const response = jsonResponse({ error: "request too large" }, 413);
            outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
            outgoing.end(Buffer.from(await response.arrayBuffer()));
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const request = new Request(url.toString(), {
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
