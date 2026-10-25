/**
 * Turns whatever goes wrong with a connector into something a person can act on: what the problem is, where it is
 * (method, line and column, with the surrounding code), and how to fix it. Everything here is pure, so it runs in
 * tests as well as in the app.
 */
import { checkUrl, imageProblem, type ConnectorManifest } from "./schema";
import { checkJson } from "./json";

export type Severity = "error" | "warning" | "info";

export interface SnippetLine { n: number; text: string; mark: boolean }

export interface Issue {
  severity: Severity;
  /** One line: what is wrong. */
  title: string;
  /** Why it matters, or what Comik saw. */
  detail?: string;
  /** Where in the connector's output the problem is, like `episodes() > [2].number`. */
  where?: string;
  line?: number;
  column?: number;
  snippet?: SnippetLine[];
  /** What to do about it. */
  fix?: string;
  /** Code that shows the fix. */
  example?: string;
}

export type Phase = "syntax" | "load" | "manifest" | "call" | "http" | "result";

/** An error from the sandbox with the position the sandbox could read from it. */
export class ConnectorFault extends Error {
  constructor(message: string, readonly info: { phase: Phase; name?: string; line?: number; column?: number; stack?: string; method?: string; code?: string } = { phase: "call" }) {
    super(message);
    this.name = "ConnectorFault";
  }
}

/** A few lines of the connector around a position, with the failing line marked. */
export function snippetAt(code: string, line: number, radius = 2): SnippetLine[] {
  const lines = code.split("\n");
  if (line < 1 || line > lines.length) return [];
  const from = Math.max(1, line - radius), to = Math.min(lines.length, line + radius);
  const out: SnippetLine[] = [];
  for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1]!.replace(/\t/g, "  ").slice(0, 160), mark: n === line });
  return out;
}

const withSnippet = (issue: Issue, code: string): Issue => (issue.line && !issue.snippet ? { ...issue, snippet: snippetAt(code, issue.line) } : issue);

/* ---------------------------------------------------------------- syntax */

const TEMPLATE_SKELETON = `async episodes(id, ctx) {
  const data = await ctx.http.getJson(\`https://api.example.com/anime/\${id}/episodes\`);
  return data.map((e) => ({ id: String(e.id), number: e.number, title: e.title }));
}`;

const METHOD_EXAMPLES: Record<string, string> = {
  popular: `async popular(page, ctx) {\n  return { items: [], hasNext: false };\n}`,
  latest: `async latest(page, ctx) {\n  return { items: [], hasNext: false };\n}`,
  search: `async search(query, page, filters, ctx) {\n  return { items: [{ id: "1", title: "Example" }], hasNext: false };\n}`,
  details: `async details(id, ctx) {\n  return { id, title: "Example", description: "..." };\n}`,
  episodes: TEMPLATE_SKELETON,
  streams: `async streams(episodeId, info, ctx) {\n  return { streams: [{ url: "https://cdn.example.com/ep.m3u8", type: "hls", label: "Auto" }] };\n}`,
};

/** Browsers and Node describe the same syntax error in different words; give the common ones a plain explanation. */
function syntaxAdvice(message: string, lineText: string, previousLine = ""): { title: string; fix: string; example?: string; column?: number } {
  const near = lineText.trim();
  if (/Unterminated string/i.test(message)) return { title: "A string is never closed", fix: "Add the closing quote on that line. A \" or ' string cannot continue onto the next line; use a template string with backticks for that." };
  if (/Unterminated template/i.test(message)) return { title: "A template string is never closed", fix: "Add the closing backtick, and check each ${ inside it has a matching }." };
  if (/Unterminated regular expression/i.test(message)) return { title: "A regular expression is never closed", fix: "Add the closing slash. If the slash is meant as division or inside a string, check the quotes around it." };
  if (/has already been declared/i.test(message)) return { title: message.replace(/ \(\d+:\d+\)$/, ""), fix: "Rename one of them, or remove const, let or var from the second one to reuse the first." };
  if (/'(import|export)' and 'export'|may appear only with 'sourceType: module'/i.test(message)) {
    return /\bimport\b/.test(near)
      ? { title: "Connectors cannot import other files", fix: "Put everything in one file. There are no modules and no npm packages; use ctx.http for requests and ctx.html for HTML." }
      : { title: "Only `export default` is understood", fix: "Replace this with module.exports = { ... } or a single export default { ... }.", example: "module.exports = {\n  manifest: { /* ... */ },\n};" };
  }
  if (/await/.test(message) && /async|outside|reserved/i.test(message)) return { title: "await is used in a function that is not async", fix: "Add async before the function that contains this await.", example: "async search(query, page, filters, ctx) {\n  const { text } = await ctx.http.get(url);\n}" };
  if (/Assigning to rvalue|Invalid left-hand side/i.test(message)) return { title: "An assignment has something that cannot be assigned to", fix: "To compare values use === instead of =." };
  if (/Unexpected end of input|Unexpected token/.test(message) && /[\w)\]]\?[A-Za-z_$[(]/.test(`${previousLine}\n${near}`)) {
    const hit = /[\w)\]]\?[A-Za-z_$[(]/.exec(near);
    return { title: "A `?` has no `.` or `:` after it", column: hit && lineText.includes(hit[0]) ? lineText.indexOf(hit[0]) + 2 : undefined, fix: "For optional chaining write ?. with the dot, like card.querySelector(\"a\")?.getAttribute(\"href\"). For a ternary write cond ? a : b." };
  }
  if (/Unexpected token/.test(message) && /^\s*[}\])]/.test(near)) return { title: "A closing bracket does not match", fix: "Count the opening and closing brackets above this line. One is missing or one too many." };
  if (/Unexpected token/.test(message)) return { title: "Something unexpected at this point", fix: "Look at the marked token and the line before it. A missing comma between properties, a missing colon after a key, or a stray bracket is the usual cause." };
  if (/Unexpected (strict mode )?reserved word|Unexpected identifier/i.test(message)) return { title: "An identifier is in the wrong place", fix: "A comma, operator or keyword is probably missing just before the marked word." };
  return { title: message.replace(/ \(\d+:\d+\)$/, ""), fix: "Fix the marked spot. The line before it is often where the mistake really is, such as a missing comma, bracket or quote." };
}

interface TokenLike { type: { label: string }; value?: unknown; start: number; end: number; loc?: { start: { line: number; column: number } } }

/** Find the bracket that was never closed, from the tokens read before the parser stopped. */
function unclosedBracket(tokens: TokenLike[]): { char: string; line: number; column: number } | null {
  const stack: { char: string; line: number; column: number }[] = [];
  for (const t of tokens) {
    const label = t.type.label;
    const loc = t.loc?.start;
    if (!loc) continue;
    if (label === "(" || label === "[" || label === "{" || label === "${") stack.push({ char: label === "${" ? "${" : label, line: loc.line, column: loc.column + 1 });
    else if (label === ")" || label === "]" || label === "}") stack.pop();
  }
  return stack.length ? stack[stack.length - 1]! : null;
}

const BLOCKED: Record<string, string> = {
  fetch: "fetch is blocked inside the sandbox. Use `await ctx.http.get(url)` or `ctx.http.getJson(url)`; they only reach hosts listed in manifest.domains.",
  XMLHttpRequest: "XMLHttpRequest is blocked inside the sandbox. Use ctx.http.get or ctx.http.post.",
  WebSocket: "WebSocket is blocked inside the sandbox. Connectors can only make https requests through ctx.http.",
  EventSource: "EventSource is blocked inside the sandbox. Use ctx.http.get.",
  localStorage: "Storage is not available in the sandbox. Keep values in a variable, or ask the person for them with manifest.settings.",
  sessionStorage: "Storage is not available in the sandbox. Keep values in a variable, or ask the person for them with manifest.settings.",
  indexedDB: "Storage is not available in the sandbox.",
  require: "require is not available, and there are no npm packages. Write the code inline, use ctx.http for requests and ctx.html for HTML.",
  importScripts: "Scripts cannot be loaded. Put everything in this one file.",
  axios: "axios is not available. Use ctx.http.get, ctx.http.getJson or ctx.http.post.",
  cheerio: "cheerio is not available. ctx.html(text) returns a normal DOM document, so use querySelector and querySelectorAll.",
  jQuery: "jQuery is not available. ctx.html(text) returns a normal DOM document, so use querySelector and querySelectorAll.",
  $: "jQuery is not available. ctx.html(text) returns a normal DOM document, so use querySelector and querySelectorAll.",
};

const LIST_ONLY_METHODS = new Set(["map", "filter", "reduce", "reduceRight", "find", "findLast", "findIndex", "some", "every", "slice", "flatMap", "sort", "includes", "indexOf", "join", "concat"]);

/** The index of the token that closes the bracket opened at `open`. */
function closeOf(tokens: TokenLike[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const label = tokens[i]!.type.label;
    if (label === "(" || label === "[" || label === "{" || label === "${") depth++;
    else if (label === ")" || label === "]" || label === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Read the connector's source without running it: syntax errors with their exact place, then patterns that
 * are known to fail inside the sandbox.
 */
export async function lintCode(code: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  if (!code.trim()) return [{ severity: "error", title: "There is no code", fix: "Paste the connector code, or insert the template to start from a working shape." }];
  if (/^\s*<(!doctype|html|head|body)/i.test(code)) {
    return [{ severity: "error", title: "This is a web page, not code", detail: "It starts with HTML.", fix: "If you downloaded it, use the raw file link (on GitHub, the Raw button) and not the page that shows the file." }];
  }
  const asJson = /^\s*[[{]/.test(code) ? checkJson(code) : null;
  if (asJson?.ok) {
    const keys = asJson.value && typeof asJson.value === "object" ? Object.keys(asJson.value) : [];
    return [{
      severity: "error", title: "This is JSON data, not connector code",
      detail: keys.includes("domains") || keys.includes("apiVersion") ? "It looks like only the manifest." : undefined,
      fix: "A connector is JavaScript that sets module.exports to an object with a manifest and methods. Put the JSON under the manifest key.",
      example: "module.exports = {\n  manifest: { /* your JSON here */ },\n  async search(query, page, filters, ctx) { return { items: [], hasNext: false }; },\n};",
    }];
  }

  // The sandbox rewrites a leading `export default` and runs the rest as a strict function body.
  const exportAt = /^\s*export\s+default\s+/m.exec(code);
  const body = exportAt ? code.replace(/^\s*export\s+default\s+/m, (m) => m.replace(/export\s+default\s+/, "module.exports = ")) : code;
  const exportLine = exportAt ? code.slice(0, exportAt.index + exportAt[0].length).split("\n").length : -1;

  const acorn = await import("acorn");
  const options = { ecmaVersion: "latest" as const, sourceType: "script" as const, allowReturnOutsideFunction: true, locations: true };
  try {
    acorn.parse(`"use strict";\n${body}`, options);
  } catch (raw) {
    const e = raw as { message: string; loc?: { line: number; column: number }; pos?: number };
    const line = (e.loc?.line ?? 2) - 1;
    let column = (e.loc?.column ?? 0) + 1;
    if (line === exportLine) column -= 2;
    const lineText = body.split("\n")[line - 1] ?? "";
    const advice = syntaxAdvice(e.message, lineText, body.split("\n")[line - 2] ?? "");
    let detail = e.message.replace(/ \(\d+:\d+\)$/, "");
    const tokens: TokenLike[] = [];
    try { for (const t of acorn.tokenizer(`"use strict";\n${body}`, options)) tokens.push(t as unknown as TokenLike); } catch { /* tokens up to the failure are enough */ }
    const open = unclosedBracket(tokens);
    const atEnd = (e.pos ?? 0) >= body.trimEnd().length + 14;
    let fix = advice.fix;
    let title = advice.title;
    let at = { line, column: advice.column ?? column };
    if (open && atEnd) {
      title = `The ${open.char} opened on line ${open.line - 1} is never closed`;
      fix = `Add the matching ${open.char === "(" ? ")" : open.char === "[" ? "]" : "}"} before the end of the file, or remove an extra opening bracket.`;
      detail = `${detail}. The parser ran out of code while that ${open.char} was still open.`;
      at = { line: open.line - 1, column: open.column };
    }
    issues.push(withSnippet({ severity: "error", title, detail, line: at.line, column: at.column, fix, example: advice.example }, code));
    return issues;
  }

  if (!/\bmodule\s*\.\s*exports\b|\bexport\s+default\b|\bexports\s*\.\s*default\b/.test(code)) {
    issues.push({ severity: "error", title: "Nothing is exported", detail: "The code never sets module.exports.", fix: "Wrap the manifest and methods in module.exports = { ... }.", example: "module.exports = {\n  manifest: { id: \"my-service\", name: \"My Service\", version: \"1.0.0\", apiVersion: 1, domains: [\"api.example.com\"] },\n  async search(query, page, filters, ctx) { return { items: [], hasNext: false }; },\n};" });
  }

  const tokens: TokenLike[] = [];
  for (const t of acorn.tokenizer(`"use strict";\n${body}`, options)) tokens.push(t as unknown as TokenLike);
  const declared = new Set<string>();
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (t.type.label === "name" && prev && ["const", "let", "var", "function", "class"].includes(prev.type.label === "name" ? String(prev.value) : prev.type.label)) declared.add(String(t.value));
  });
  const place = (t: TokenLike) => ({ line: (t.loc?.start.line ?? 2) - 1, column: (t.loc?.start.column ?? 0) + 1 });
  const seen = new Set<string>();
  const add = (issue: Issue) => { const key = `${issue.title}@${issue.line}`; if (!seen.has(key)) { seen.add(key); issues.push(withSnippet(issue, code)); } };

  tokens.forEach((t, i) => {
    const prev = tokens[i - 1], next = tokens[i + 1];
    const label = t.type.label;
    if (label === "name" || label === "import") {
      const name = String(t.value ?? label);
      const member = prev?.type.label === "." || prev?.type.label === "?.";
      const key = next?.type.label === ":" && prev?.type.label !== "?";
      if (label === "name" && !member && !key && !declared.has(name) && BLOCKED[name]) add({ severity: "warning", title: `${name} is not available in the sandbox`, ...place(t), fix: BLOCKED[name] });
      if (label === "name" && !member && !key && !declared.has(name) && (name === "document" || name === "window") && next?.type.label === ".") {
        add({ severity: "warning", title: `${name} is an empty page inside the sandbox`, ...place(t), fix: "To read HTML you downloaded, use `const doc = ctx.html(text)` and query that document." });
      }
      if (label === "import" && next?.type.label === "(") add({ severity: "warning", title: "Dynamic import() is blocked", ...place(t), fix: "Connectors are one file with no imports. Inline the code you need." });
    }
    if (label === "string" || label === "template") {
      const value = String(t.value ?? "");
      if (/^http:\/\/[^/]/i.test(value)) add({ severity: "warning", title: "An address uses http://", ...place(t), detail: value.slice(0, 80), fix: "Connectors may only use https. Change it to https:// (the site must support it)." });
    }
    // querySelectorAll(...).map(...): a NodeList has forEach but not map, filter and the other list methods.
    if (label === "name" && t.value === "querySelectorAll" && next?.type.label === "(") {
      const end = closeOf(tokens, i + 1);
      const dot = tokens[end + 1], method = tokens[end + 2];
      if (end > 0 && (dot?.type.label === "." || dot?.type.label === "?.") && method && LIST_ONLY_METHODS.has(String(method.value))) {
        add({ severity: "error", title: `querySelectorAll(...).${String(method.value)} is not a function`, ...place(method), detail: "querySelectorAll returns a NodeList, which has no list methods other than forEach.", fix: "Turn it into a real list first.", example: `Array.from(doc.querySelectorAll(".card")).${String(method.value)}(...)\n// or\n[...doc.querySelectorAll(".card")].${String(method.value)}(...)` });
      }
    }
    // ctx.http.get(...).text: the promise is never awaited.
    if (label === "name" && t.value === "ctx" && tokens[i + 1]?.type.label === "." && tokens[i + 2]?.value === "http" && tokens[i + 3]?.type.label === "." && ["get", "getJson", "post"].includes(String(tokens[i + 4]?.value)) && tokens[i + 5]?.type.label === "(") {
      const end = closeOf(tokens, i + 5);
      const dot = tokens[end + 1], member = tokens[end + 2];
      const awaited = tokens[i - 1]?.value === "await" || tokens[i - 1]?.type.label === "(" && tokens[i - 2]?.value === "await";
      if (end > 0 && !awaited && dot?.type.label === "." && member && !["then", "catch", "finally"].includes(String(member.value))) {
        add({ severity: "error", title: "A request is used before it finishes", ...place(t), detail: `ctx.http.${String(tokens[i + 4]!.value)}(...) returns a promise, so .${String(member.value)} is undefined.`, fix: "Put await in front of the call.", example: `const { text } = await ctx.http.get(url);\n// or\n(await ctx.http.getJson(url)).${String(member.value)}` });
      }
    }
  });

  const text = body;
  for (const method of ["search", "details", "episodes", "streams"]) {
    if (!new RegExp(`(^|[\\s,{])(async\\s+)?${method}\\s*(\\(|:)`, "m").test(text)) {
      issues.push({ severity: "warning", title: `${method}() is not defined`, detail: "The debugger found no method with this name.", fix: method === "search" ? "Comik needs search() for Discover. popular() and latest() are optional." : `Comik calls ${method}() ${method === "details" ? "when a title is opened" : method === "episodes" ? "to list a title's episodes" : "to find the video of an episode"}.`, example: METHOD_EXAMPLES[method] });
    }
  }
  return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/* --------------------------------------------------------- runtime errors */

export interface FaultInfo { message: string; name?: string; line?: number; column?: number; phase: Phase; method?: string; code?: string }

const HTTP_ADVICE: Record<string, string> = {
  "400": "The request was malformed. Check the query string and the body, and encode values with encodeURIComponent.",
  "401": "The site wants credentials. Add the key in the connector's settings (manifest.settings) and send it in a header, as in the API key example.",
  "403": "The site refused the request. If it needs a key, check it is set and sent. If it works in a browser but not here, the site may block automated access, which only its operator can change.",
  "404": "That address does not exist. Open the Requests tab to see the exact address; an id may be wrong or the path may have changed.",
  "429": "The site is rate limiting. Make fewer requests per call, or wait a moment and run again.",
};

const exampleManifest = `manifest: {\n  id: "my-service",\n  name: "My Service",\n  version: "1.0.0",\n  apiVersion: 1,\n  domains: ["api.example.com", "*.cdn.example.com"],\n},`;

/** Explain one failure: what it means in plain words and how to fix it. */
export function explainFault(fault: FaultInfo, code = ""): Issue {
  const m = fault.message;
  const where = fault.method ? `${fault.method}()` : undefined;
  const base = { severity: "error" as const, where, line: fault.line, column: fault.column };
  const pos = (issue: Issue) => withSnippet(issue, code);

  let hit: RegExpExecArray | null;
  if ((hit = /^(\S+) is not in this connector's domains/.exec(m))) {
    return pos({ ...base, title: `${hit[1]} is not in manifest.domains`, detail: "Connectors may only contact hosts they declare, so the person can see them before installing.", fix: `Add the host to manifest.domains, if the site's operator permits it. Use *.${hit[1]!.split(".").slice(-2).join(".")} to cover its subdomains.`, example: `domains: ["…", "${hit[1]}"],` });
  }
  if (/only use https/.test(m)) return pos({ ...base, title: "An address is not https", fix: "Change the address to https://. If the site only offers http, it cannot be used." });
  if (/is not a valid address|Invalid URL/.test(m)) {
    return pos({ ...base, title: "An address is not a full URL", detail: m, fix: "A relative link such as /show/12 or //cdn.x.com/a.jpg needs its site in front of it.", example: `const SITE = "https://anime.example.com";\nconst url = new URL(href, SITE).href;` });
  }
  if ((hit = /answered HTTP (\d{3})/.exec(m))) {
    const status = hit[1]!;
    return pos({ ...base, title: `The site answered HTTP ${status}`, detail: m, fix: HTTP_ADVICE[status] ?? (status.startsWith("5") ? "The site had an error or is down. Try again in a moment; if it keeps happening the address or the site is the problem." : "Open the Requests tab to see the exact address and what the site returned.") });
  }
  if ((hit = /^Could not reach (\S+?):/.exec(m))) {
    return pos({ ...base, title: `${hit[1]} could not be reached`, detail: m, fix: "Check the address is spelled right and the site is online. If manifest.direct is true the site must also send CORS headers, so try removing direct. The hosted website has no proxy, so connectors there need direct and a site that allows it.", example: undefined });
  }
  if (/at most \d+ requests/.test(m)) return pos({ ...base, title: "Too many requests in one call", fix: "Fetch fewer pages per call. Return one page and let hasNext drive \"load more\", or read an API endpoint that returns everything at once." });
  if (/took longer than|did not start/.test(m)) {
    return pos({ ...base, title: /did not start/.test(m) ? "The connector did not start" : "A call took too long", detail: m, fix: /did not start/.test(m) ? "Something at the top level of the file never finishes, such as a loop. Move work into the methods." : "Check for a missing await, a loop that never ends, or a very slow site. The Requests tab shows how long each request took." });
  }
  if (/response is too large|request body is too large/.test(m)) return pos({ ...base, title: "A response or request is too large", fix: "Ask the API for less: a smaller page size, a limit parameter, or only the fields you use." });
  if ((hit = /does not implement (\w+)\(\)/.exec(m))) {
    return pos({ ...base, title: `${hit[1]}() is missing`, fix: "Add the method to the object you export.", example: METHOD_EXAMPLES[hit[1]!] });
  }
  if (/must set module\.exports/.test(m)) return pos({ ...base, title: "module.exports is not an object", fix: "Export an object with a manifest and the methods.", example: `module.exports = {\n  ${exampleManifest.replace(/\n/g, "\n  ")}\n  async search(query, page, filters, ctx) { return { items: [], hasNext: false }; },\n};` });

  if (fault.phase === "manifest" || /^manifest\./.test(m) || /no manifest/.test(m)) {
    const field = /manifest\.(\w+)/.exec(m)?.[1];
    const examples: Record<string, string> = {
      id: `id: "my-service", // 2 to 41 lower-case letters, digits and dashes`,
      name: `name: "My Service",`,
      version: `version: "1.0.0",`,
      apiVersion: `apiVersion: 1,`,
      domains: `domains: ["api.example.com", "*.cdn.example.com"],`,
    };
    return pos({ ...base, title: field ? `manifest.${field} is not valid` : "The manifest is not valid", detail: m, fix: "Fix this field in the manifest.", example: field ? examples[field] : exampleManifest });
  }
  if (/is not an allowed domain/.test(m)) return pos({ ...base, title: "A domain in manifest.domains is not allowed", detail: m, fix: "List bare host names only: no https://, no path, no port, no IP address. A *. prefix covers subdomains.", example: `domains: ["api.example.com", "*.cdn.example.com"],` });
  if (/needs a key made of/.test(m)) return pos({ ...base, title: "A setting has no valid key", detail: m, fix: "Each manifest.settings entry needs a key of letters, digits and underscores.", example: `settings: [{ key: "apiKey", label: "API key", secret: true, required: true }],` });
  if (/needs an id and a title/.test(m)) return pos({ ...base, title: "A title has no id or no title", fix: "Every item needs both. Map your site's fields onto id and title.", example: `{ id: String(item.id), title: item.name }` });

  // Errors thrown by the connector's own code.
  if (/is not valid JSON|JSON\.parse|Unexpected end of JSON|Unexpected token .* in JSON|JSON input/.test(m)) {
    const html = /Unexpected token '?<|<!DOCTYPE|<html/i.test(m);
    return pos({ ...base, title: html ? "The site returned a web page where JSON was expected" : "The response is not valid JSON", detail: m, fix: html ? "The address may be wrong, or the site answered with an error or block page. Open the Requests tab to read what came back. For pages, use ctx.http.get and ctx.html instead of getJson." : "Open the Requests tab to see the body that came back and paste it into the JSON formatter to find the broken spot." });
  }
  if ((hit = /^(\w+) is not defined/.exec(m))) {
    const name = hit[1]!;
    if (BLOCKED[name]) return pos({ ...base, title: `${name} is not available in the sandbox`, fix: BLOCKED[name] });
    if (name === "ctx") return pos({ ...base, title: "ctx is not defined here", detail: "ctx is passed as the last argument of each method. Helper functions do not see it unless you pass it.", fix: "Add ctx as a parameter of the helper and pass it when you call it.", example: `async function grab(url, ctx) {\n  return (await ctx.http.get(url)).text;\n}\n// inside a method:\nconst text = await grab(url, ctx);` });
    if (name === "document" || name === "window") return pos({ ...base, title: `${name} is not available`, fix: "Use ctx.html(text) to turn downloaded HTML into a document." });
    return pos({ ...base, title: `${name} is not defined`, detail: m, fix: `Check the spelling of ${name}. If it is a helper, declare it with const or function in this file before it is used, or as a method on the exported object and call it as this.${name}(...).` });
  }
  if (/Assignment to constant variable/.test(m)) return pos({ ...base, title: "A const is being reassigned", fix: "Declare it with let instead of const." });
  if ((hit = /Cannot access '(\w+)' before initialization/.exec(m))) return pos({ ...base, title: `${hit[1]} is used before it is declared`, fix: `Move the declaration of ${hit[1]} above the first place it is used.` });
  const chrome = /Cannot (?:read|set) propert(?:y|ies) of (null|undefined) \((?:reading|setting) '(.+)'\)/.exec(m);
  const firefox = /can't access property "(.+?)", (.+?) is (null|undefined)/.exec(m);
  const nullish = chrome ? { kind: chrome[1]!, prop: chrome[2]! } : firefox ? { kind: firefox[3]!, prop: firefox[1]! } : null;
  if (nullish) {
    const { kind, prop } = nullish;
    const lineText = fault.line ? code.split("\n")[fault.line - 1] ?? "" : "";
    const selector = /querySelector|getAttribute|\.closest\(/.test(lineText);
    return pos({
      ...base,
      title: `Reading .${prop} of ${kind}`,
      detail: selector ? "A selector matched nothing, so the element is null." : "A value you expected is missing from the data.",
      fix: selector
        ? "The page's markup is not what the selector expects. Open the Requests tab, read the HTML that came back, and fix the selector. Use ?. and a fallback when an element is optional."
        : "Open the Requests tab and look at the real response: a field is named differently, nested deeper, or absent for some items. Guard optional values with ?. and ?? .",
      example: selector ? `const title = card.querySelector(".title")?.textContent.trim() ?? "";` : `const list = data?.results ?? [];\nconst name = item.title?.en ?? item.name;`,
    });
  }
  if ((hit = /^(.+?) is not a function/.exec(m)) || (hit = /^(.+?) is not iterable/.exec(m))) {
    const what = hit[1]!;
    const member = /\.(\w+)$/.exec(what)?.[1];
    if (/is not iterable/.test(m)) return pos({ ...base, title: `${what} is not a list`, detail: m, fix: "A spread or for...of got something that is not a list, usually undefined because the field is missing. Check the real response in the Requests tab and fall back with ?? [].", example: `const items = data.results ?? [];` });
    if (member && LIST_ONLY_METHODS.has(member)) return pos({ ...base, title: `.${member} was called on something that is not a list`, detail: m, fix: "A NodeList (from querySelectorAll) or an object has no ." + member + ". Convert it, or read the right field of the response.", example: `Array.from(doc.querySelectorAll(".card")).${member}(...)\n// for JSON, make sure it is a list:\n(Array.isArray(data) ? data : data.results ?? []).${member}(...)` });
    return pos({ ...base, title: `${what} is not a function`, detail: m, fix: "Check the spelling, and check the value is what you expect: an object where a function was expected, or a method called on the wrong thing. Helper methods on the exported object are called as this.name(...)." });
  }
  if (fault.name === "SyntaxError") return pos({ ...base, title: "Syntax error", detail: m, fix: "Fix the marked spot. The line before it is often where the mistake really is." });
  if (/was stopped/.test(m)) return pos({ ...base, severity: "info", title: "The connector was restarted while this ran", fix: "Run it again." });
  return pos({ ...base, title: fault.name && fault.name !== "Error" ? `${fault.name}: ${m}` : m, detail: fault.line ? undefined : "The sandbox did not report a line for this error.", fix: "Add ctx.log(value) just before the failing line to see what you are working with, then run this step again. Logs appear under the step." });
}

/* ---------------------------------------------------------------- results */

function dropped(field: string, value: unknown, problem: string, where: string): Issue {
  return {
    severity: "warning", where,
    title: `${field} was dropped`,
    detail: `${String(value).slice(0, 120)}: ${problem}`,
    fix: /not a valid address/.test(problem)
      ? "Make the address absolute before returning it."
      : /not in this connector's domains/.test(problem) ? "Add the image host to manifest.domains, or return an inline data: image." : "Return an https address on an allowed host.",
    example: /not a valid address/.test(problem) ? `new URL(src, SITE).href` : undefined,
  };
}

function checkTitle(raw: unknown, manifest: ConnectorManifest, path: string, out: Issue[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    out.push({ severity: "error", where: path, title: "A title must be an object", detail: `Got ${Array.isArray(raw) ? "a list" : typeof raw}.`, fix: "Return objects like { id, title, cover }.", example: `{ id: String(item.id), title: item.name, cover: item.poster }` });
    return;
  }
  const t = raw as Record<string, unknown>;
  const id = t.id;
  if (id === undefined || id === null || id === "") out.push({ severity: "error", where: `${path}.id`, title: "id is missing", detail: "Without an id Comik cannot open the title, so it is skipped.", fix: "Return a stable id for each title, such as the site's slug or number.", example: `id: String(item.id),` });
  else if (typeof id !== "string" && typeof id !== "number") out.push({ severity: "error", where: `${path}.id`, title: "id must be text", detail: `Got ${typeof id}.`, fix: "Convert it with String(...)." });
  if (typeof t.title !== "string" || !t.title.trim()) out.push({ severity: "error", where: `${path}.title`, title: "title is missing", detail: typeof t.title === "string" ? "It is empty." : `Got ${t.title === undefined ? "nothing" : typeof t.title}.`, fix: "Return the title as a string. If your API has several languages, pick one.", example: `title: item.title?.en ?? item.title?.romaji ?? item.name,` });
  for (const field of ["cover", "banner"] as const) {
    const problem = imageProblem(t[field], manifest.domains);
    if (problem) out.push(dropped(field, t[field], problem, `${path}.${field}`));
  }
  if (t.tags !== undefined && !Array.isArray(t.tags)) out.push({ severity: "warning", where: `${path}.tags`, title: "tags must be a list", detail: `Got ${typeof t.tags}.`, fix: "Return an array of strings.", example: `tags: String(item.genres).split(",").map((g) => g.trim()),` });
  if (t.altTitles !== undefined && !Array.isArray(t.altTitles)) out.push({ severity: "warning", where: `${path}.altTitles`, title: "altTitles must be a list", fix: "Return an array of strings." });
  if (t.rating !== undefined && t.rating !== null && !(Number(t.rating) >= 0 && Number(t.rating) <= 10)) out.push({ severity: "warning", where: `${path}.rating`, title: "rating was dropped", detail: `${String(t.rating)} is outside 0 to 10.`, fix: "Scale it to 0 to 10, for example score / 10 when the site uses 0 to 100." });
  if (t.year !== undefined && t.year !== null && !(Number(t.year) >= 1900 && Number(t.year) <= 2200)) out.push({ severity: "warning", where: `${path}.year`, title: "year was dropped", detail: `${String(t.year)} is not a year between 1900 and 2200.`, fix: "Return a four digit number such as 2021." });
  if (typeof t.status === "string" && !/^(ongoing|airing|releasing|completed|finished|ended|hiatus|cancell?ed)$/i.test(t.status)) out.push({ severity: "info", where: `${path}.status`, title: `status "${t.status}" is shown as unknown`, fix: "Use one of ongoing, airing, completed, finished, hiatus, cancelled." });
  if (typeof t.trailerUrl === "string" && t.trailerUrl) { try { checkUrl(t.trailerUrl, ["*.youtube.com", "youtu.be", ...manifest.domains]); } catch (error) { out.push({ severity: "warning", where: `${path}.trailerUrl`, title: "trailerUrl was dropped", detail: (error as Error).message, fix: "Use an https address on an allowed host or YouTube." }); } }
}

/** What a list method returned, checked the way Comik will read it. Warnings name each silently dropped value. */
export function checkResult(method: string, raw: unknown, manifest: ConnectorManifest): Issue[] {
  const out: Issue[] = [];
  const where = `${method}()`;
  if (method === "popular" || method === "latest" || method === "search") {
    if (Array.isArray(raw)) {
      out.push({ severity: "error", where, title: "A list was returned, not { items, hasNext }", detail: "Comik reads the titles from the items field, so this shows nothing.", fix: "Wrap the list.", example: `return { items: list, hasNext: false };` });
      raw.slice(0, 3).forEach((item, i) => checkTitle(item, manifest, `${where} > [${i}]`, out));
      return out;
    }
    const r = raw as { items?: unknown; hasNext?: unknown } | null;
    if (!r || typeof r !== "object") return [{ severity: "error", where, title: `It returned ${r === null ? "nothing" : typeof r}`, fix: "Return { items: [...], hasNext: false }.", example: `return { items, hasNext: false };` }];
    if (!Array.isArray(r.items)) return [{ severity: "error", where, title: "items is missing or not a list", detail: `Got ${r.items === undefined ? "no items field" : typeof r.items}.`, fix: "Return an object with an items array.", example: `return { items: data.results.map(map), hasNext: !!data.next };` }];
    if (!r.items.length) out.push({ severity: "warning", where, title: "No titles came back", fix: "Check the request and the mapping in the Requests tab. A selector or a field name may not match the real response." });
    r.items.slice(0, 3).forEach((item, i) => checkTitle(item, manifest, `${where} > items[${i}]`, out));
    const bad = r.items.filter((item) => !item || typeof item !== "object" || !(item as { id?: unknown }).id && (item as { id?: unknown }).id !== 0 || typeof (item as { title?: unknown }).title !== "string" || !(item as { title: string }).title.trim()).length;
    if (bad > 3) out.push({ severity: "warning", where, title: `${bad} of ${r.items.length} titles are skipped`, detail: "They have no id or no title. Only the first three are listed above.", fix: "Make sure every item has both." });
    if (r.hasNext !== undefined && typeof r.hasNext !== "boolean") out.push({ severity: "info", where: `${where} > hasNext`, title: "hasNext should be true or false", detail: "Anything other than true counts as false.", fix: "Return a boolean.", example: `hasNext: !!data.next,` });
    const ids = r.items.map((item) => String((item as { id?: unknown })?.id)).filter((id) => id !== "undefined");
    if (new Set(ids).size < ids.length) out.push({ severity: "warning", where, title: "Some ids repeat", fix: "Each title needs its own id, or the second one replaces the first on the shelf." });
    return out;
  }
  if (method === "details") {
    checkTitle(raw, manifest, where, out);
    return out;
  }
  if (method === "episodes") {
    if (!Array.isArray(raw)) return [{ severity: "error", where, title: "episodes() must return a list", detail: `Got ${raw === null ? "nothing" : typeof raw}.`, fix: "Return an array of episodes, not an object.", example: `return data.episodes.map((e) => ({ id: String(e.id), number: e.number }));` }];
    if (!raw.length) out.push({ severity: "warning", where, title: "No episodes came back", fix: "Check the request in the Requests tab. The title may have none yet, or the selector or path is wrong." });
    const seen = new Map<string, number>();
    let skipped = 0;
    raw.forEach((entry, i) => {
      const path = `${where} > [${i}]`;
      const e = (entry ?? {}) as Record<string, unknown>;
      const num = typeof e.number === "number" ? e.number : typeof e.number === "string" && e.number.trim() && Number.isFinite(Number(e.number)) ? Number(e.number) : NaN;
      let bad = false;
      if (!entry || typeof entry !== "object") { bad = true; if (i < 3) out.push({ severity: "error", where: path, title: "An episode must be an object", fix: "Return { id, number, ... }." }); }
      else {
        if (e.id === undefined || e.id === null || e.id === "") { bad = true; if (skipped < 3) out.push({ severity: "error", where: `${path}.id`, title: "id is missing", detail: "Episodes without an id are skipped.", fix: "Return a stable id used to look up the video.", example: `id: String(e.id),` }); }
        if (!Number.isFinite(num)) { bad = true; if (skipped < 3) out.push({ severity: "error", where: `${path}.number`, title: "number is missing or not a number", detail: `Got ${e.number === undefined ? "nothing" : JSON.stringify(e.number)}. Episodes without a number are skipped.`, fix: "Return the episode number as a number. Parse it from the title if the site has no field.", example: `number: Number(e.number) || Number(/\\d+(\\.\\d+)?/.exec(e.title)?.[0]),` }); }
      }
      if (bad) { skipped++; return; }
      const key = `${e.season ?? 1}:${num}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (i < 3) {
        const thumb = imageProblem(e.thumbnail, manifest.domains);
        if (thumb) out.push(dropped("thumbnail", e.thumbnail, thumb, `${path}.thumbnail`));
      }
      if (e.airDate !== undefined && e.airDate !== null && e.airDate !== "" && !Number.isFinite(typeof e.airDate === "number" ? e.airDate : Date.parse(String(e.airDate)))) {
        if (i < 3) out.push({ severity: "info", where: `${path}.airDate`, title: "airDate could not be read", detail: JSON.stringify(e.airDate), fix: "Use an ISO date such as 2024-05-01, or epoch milliseconds." });
      }
    });
    if (skipped > 3) out.push({ severity: "warning", where, title: `${skipped} of ${raw.length} episodes are skipped`, detail: "Only the first three problems are listed.", fix: "Make sure every episode has an id and a number." });
    else if (skipped && skipped < 4 && out.every((x) => x.severity !== "error")) out.push({ severity: "warning", where, title: `${skipped} episodes are skipped`, fix: "Make sure every episode has an id and a number." });
    const dupes = [...seen.values()].filter((n) => n > 1).length;
    if (dupes) out.push({ severity: "warning", where, title: "Some episode numbers repeat", detail: `${dupes} number${dupes === 1 ? "" : "s"} appear more than once within a season.`, fix: "If the site has several seasons, send season on every episode. If it has alternate versions of an episode, return only one of them." });
    const withSeason = raw.filter((x) => (x as { season?: unknown })?.season !== undefined && (x as { season?: unknown })?.season !== null).length;
    if (withSeason && withSeason < raw.length) out.push({ severity: "warning", where, title: "Only some episodes have a season", fix: "Send season on every episode, or on none." });
    return out;
  }
  if (method === "streams") {
    const r = raw as { streams?: unknown; subtitles?: unknown; skips?: unknown } | null;
    if (!r || typeof r !== "object" || Array.isArray(r)) return [{ severity: "error", where, title: "streams() must return { streams, subtitles, skips }", detail: `Got ${Array.isArray(r) ? "a list" : r === null ? "nothing" : typeof r}.`, fix: "Return an object. A list of streams goes in the streams field.", example: METHOD_EXAMPLES.streams }];
    if (!Array.isArray(r.streams) || !r.streams.length) return [{ severity: "error", where: `${where} > streams`, title: "There are no streams", detail: Array.isArray(r.streams) ? "The list is empty." : "streams is missing or not a list.", fix: "Return at least one { url, type, label }. If the page has no video yet, throw an Error saying so.", example: METHOD_EXAMPLES.streams }];
    let playable = 0;
    r.streams.forEach((s, i) => {
      const path = `${where} > streams[${i}]`;
      const url = (s as { url?: unknown })?.url;
      try {
        checkUrl(url, manifest.domains); playable++;
        const type = (s as { type?: unknown }).type;
        if (type !== undefined && !["hls", "mp4", "webm"].includes(String(type))) out.push({ severity: "info", where: `${path}.type`, title: `type "${String(type)}" is guessed from the file name`, fix: "Use hls, mp4 or webm." });
        const sx = s as { proxy?: unknown; headers?: Record<string, unknown> };
        if (sx.proxy === true && type !== "hls" && !/\.m3u8/i.test(String(url))) out.push({ severity: "warning", where: `${path}.proxy`, title: "proxy is only used for hls", fix: "Plain mp4 and webm files are loaded directly by the player and cannot carry headers." });
        for (const key of Object.keys(sx.headers ?? {})) if (/^(host|cookie|content-length)$/i.test(key)) out.push({ severity: "warning", where: `${path}.headers.${key}`, title: `The ${key} header is not sent`, fix: "Comik does not allow that header." });
      } catch (error) {
        out.push({ severity: (r.streams as unknown[]).length === 1 ? "error" : "warning", where: `${path}.url`, title: "This stream was dropped", detail: `${String(url).slice(0, 120)}: ${(error as Error).message}`, fix: /not in this connector's domains/.test((error as Error).message) ? "Add the video host to manifest.domains." : /https/.test((error as Error).message) ? "Return the https version of the address." : "Return a full https address." });
      }
    });
    if (!playable && !out.length) out.push({ severity: "error", where, title: "No stream is playable", fix: "Check the video hosts are in manifest.domains and the addresses are https." });
    for (const [field, label] of [["subtitles", "subtitle"], ["skips", "skip"]] as const) {
      const list = r[field];
      if (list !== undefined && !Array.isArray(list)) out.push({ severity: "warning", where: `${where} > ${field}`, title: `${field} must be a list`, fix: "Return an array." });
      else if (Array.isArray(list)) list.slice(0, 5).forEach((entry, i) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        if (field === "subtitles") {
          try { checkUrl(e.url, manifest.domains); } catch (error) { out.push({ severity: "warning", where: `${where} > subtitles[${i}].url`, title: "This subtitle was dropped", detail: (error as Error).message, fix: "Add the subtitle host to manifest.domains, and use https." }); }
        } else if (!(Number.isFinite(Number(e.start)) && Number.isFinite(Number(e.end)) && Number(e.end) > Number(e.start) && Number(e.start) >= 0 && ["intro", "outro", "recap"].includes(String(e.kind)))) {
          out.push({ severity: "warning", where: `${where} > skips[${i}]`, title: `This ${label} range was dropped`, detail: JSON.stringify(entry)?.slice(0, 100), fix: "A skip needs kind (intro, outro or recap) and start and end in seconds, with end after start.", example: `{ kind: "intro", start: 62, end: 151 }` });
        }
      });
    }
    return out;
  }
  return out;
}

/** Checks on the manifest as the author wrote it, before Comik tidies it. */
export function checkManifest(raw: unknown, manifest: ConnectorManifest): Issue[] {
  const out: Issue[] = [];
  const m = (raw ?? {}) as Record<string, unknown>;
  const problem = imageProblem(m.icon, manifest.domains);
  if (problem) out.push({ severity: "warning", where: "manifest.icon", title: "icon was dropped", detail: `${String(m.icon).slice(0, 100)}: ${problem}`, fix: "Use an https address on a host in domains, or a small inline data: image (png, jpeg, webp or svg, up to 40 KB).", example: `icon: "https://cdn.example.com/logo-128.png",` });
  if (!m.icon) out.push({ severity: "info", where: "manifest.icon", title: "No icon", detail: "Comik shows the first letters of the name instead.", fix: "Add an icon so the connector is easy to spot in Discover.", example: `icon: "https://cdn.example.com/logo-128.png",` });
  if (!m.description) out.push({ severity: "info", where: "manifest.description", title: "No description", fix: "A one line description tells people what the connector is for." });
  if (typeof m.homepage === "string" && m.homepage && !manifest.homepage) out.push({ severity: "warning", where: "manifest.homepage", title: "homepage was dropped", fix: "It must start with https://." });
  if (Array.isArray(m.domains)) {
    const odd = (m.domains as unknown[]).filter((d) => typeof d === "string" && /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,24}$/i.test(d) && d !== (d as string).toLowerCase());
    if (odd.length) out.push({ severity: "info", where: "manifest.domains", title: "Domains are lower-cased", detail: odd.join(", "), fix: "Write them in lower case." });
  }
  return out;
}

export const countBy = (issues: Issue[], severity: Severity) => issues.filter((i) => i.severity === severity).length;
export const worst = (issues: Issue[]): Severity | null => (issues.some((i) => i.severity === "error") ? "error" : issues.some((i) => i.severity === "warning") ? "warning" : issues.length ? "info" : null);
