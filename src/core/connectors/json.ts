/**
 * A strict JSON reader that says where it failed. `JSON.parse` messages differ between browsers and often give only
 * a character offset, so the connector tools use this one to point at a line and column and to suggest a fix.
 */

export interface JsonProblem { message: string; line: number; column: number; offset: number; fix?: string }
export type JsonCheck = { ok: true; value: unknown } | ({ ok: false } & JsonProblem);

const WS = new Set([" ", "\t", "\n", "\r"]);
const ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

class Stop extends Error {
  constructor(readonly at: number, readonly why: string, readonly fix?: string) { super(why); }
}

function parse(text: string): unknown {
  let i = 0;
  const skip = () => { while (i < text.length && WS.has(text[i]!)) i++; };
  const shown = (c: string | undefined) => (c === undefined ? "the end of the text" : c === "\n" ? "a line break" : `"${c}"`);

  const string = (): string => {
    const start = i;
    i++;
    let out = "";
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"') { i++; return out; }
      if (c === "\n") throw new Stop(i, "A string runs onto a new line.", "End the string with a closing double quote, or write the line break as \\n.");
      if (c === "\\") {
        const next = text[i + 1];
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Stop(i, "A \\u escape needs four hex digits.", "Write it like \\u00e9.");
          out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
        }
        if (next === undefined || !ESCAPES.has(next)) throw new Stop(i, `"\\${next ?? ""}" is not a valid escape.`, "Use \\\\ for a backslash, \\\" for a quote, or \\n for a line break.");
        out += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next === "b" ? "\b" : next === "f" ? "\f" : next; i += 2; continue;
      }
      if (c < " ") throw new Stop(i, "A control character is inside a string.", "Escape tabs and line breaks as \\t and \\n.");
      out += c; i++;
    }
    throw new Stop(start, "A string is never closed.", "Add the closing double quote.");
  };

  const value = (): unknown => {
    skip();
    const c = text[i];
    if (c === "{") {
      i++; skip();
      const out: Record<string, unknown> = {};
      if (text[i] === "}") { i++; return out; }
      for (;;) {
        skip();
        if (text[i] === "}") throw new Stop(i, "A trailing comma comes before this closing brace.", "Delete the last comma. JSON does not allow one after the final entry.");
        if (text[i] !== '"') {
          if (text[i] === "'") throw new Stop(i, "Keys must use double quotes, not single quotes.", "Replace the single quotes with double quotes.");
          if (text[i] !== undefined && /[A-Za-z_$]/.test(text[i]!)) throw new Stop(i, "This key has no quotes.", "Put double quotes around the key, like \"name\".");
          throw new Stop(i, `Expected a key in double quotes but found ${shown(text[i])}.`);
        }
        const key = string();
        skip();
        if (text[i] !== ":") throw new Stop(i, `Expected ":" after the key "${key}" but found ${shown(text[i])}.`, "Put a colon between the key and its value.");
        i++;
        out[key] = value();
        skip();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return out; }
        throw new Stop(i, `Expected "," or "}" but found ${shown(text[i])}.`, text[i] === undefined ? "A { was never closed. Add a closing }." : "Separate entries with a comma, and close the object with }.");
      }
    }
    if (c === "[") {
      i++; skip();
      const out: unknown[] = [];
      if (text[i] === "]") { i++; return out; }
      for (;;) {
        skip();
        if (text[i] === "]") throw new Stop(i, "A trailing comma comes before this closing bracket.", "Delete the last comma. JSON does not allow one after the final item.");
        out.push(value());
        skip();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return out; }
        throw new Stop(i, `Expected "," or "]" but found ${shown(text[i])}.`, text[i] === undefined ? "A [ was never closed. Add a closing ]." : "Separate items with a comma, and close the list with ].");
      }
    }
    if (c === '"') return string();
    if (c === "'") throw new Stop(i, "Strings must use double quotes, not single quotes.", "Replace the single quotes with double quotes.");
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (number) { i += number[0].length; return Number(number[0]); }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) if (text.startsWith(word, i)) { i += word.length; return v; }
    if (c === "/") throw new Stop(i, "JSON does not allow comments.", "Delete the comment.");
    if (/^(undefined|NaN|Infinity)/.test(text.slice(i, i + 9))) throw new Stop(i, "undefined, NaN and Infinity are not valid JSON values.", "Use null, or leave the key out.");
    if (c === undefined) throw new Stop(i, "The text ends where a value was expected.", "Finish the value, or close the open brackets.");
    if (c === "<") throw new Stop(i, "This looks like HTML, not JSON.", "The site returned a web page. Check the address, or read it with ctx.http.get and ctx.html instead of getJson.");
    throw new Stop(i, `Unexpected ${shown(c)}.`, "A value must be a string, number, true, false, null, an object or a list.");
  };

  const result = value();
  skip();
  if (i < text.length) throw new Stop(i, `Extra text after the JSON ends: ${shown(text[i])}.`, "Delete everything after the closing bracket, or separate values with a list.");
  return result;
}

export function locate(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

export function checkJson(text: string): JsonCheck {
  try { return { ok: true, value: parse(text.replace(/^﻿/, "")) }; }
  catch (error) {
    if (!(error instanceof Stop)) throw error;
    return { ok: false, message: error.why, fix: error.fix, offset: error.at, ...locate(text, error.at) };
  }
}

const sortKeys = (value: unknown): unknown => (Array.isArray(value) ? value.map(sortKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)])) : value);

/** Pretty-print JSON, or say why it cannot be. */
export function formatJson(text: string, options: { indent?: number; sort?: boolean; minify?: boolean } = {}): { ok: true; text: string } | ({ ok: false } & JsonProblem) {
  const checked = checkJson(text);
  if (!checked.ok) return checked;
  const value = options.sort ? sortKeys(checked.value) : checked.value;
  return { ok: true, text: options.minify ? JSON.stringify(value) : JSON.stringify(value, null, options.indent ?? 2) };
}

/** Tidy pasted text: JSON is pretty-printed, code gets consistent line endings, indentation and spacing. */
export function tidyText(text: string): { text: string; kind: "json" | "code" } {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    const formatted = formatJson(trimmed);
    if (formatted.ok) return { text: formatted.text + "\n", kind: "json" };
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "").replace(/^\t+/, (tabs) => "  ".repeat(tabs.length)));
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n*$/, "\n"), kind: "code" };
}

/** A copyable report must not carry the secrets the person typed into a connector's settings. */
export const maskSecrets = (text: string, secrets: string[]): string => secrets.filter((s) => s.length >= 4).reduce((out, secret) => out.split(secret).join("•••"), text);
