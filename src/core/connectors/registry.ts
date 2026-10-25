import { db, type ConnectorRow } from "../db";
import { request } from "../http";
import type { Source } from "../types";
import { ConnectorHost } from "./sandbox";
import { parseManifest, type ConnectorManifest } from "./schema";
import { createConnectorSource, stopHost } from "./source";

const MAX_CODE = 512 * 1024;

let sources = new Map<string, Source>();
const listeners = new Set<() => void>();
export const onConnectorsChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const connectorSources = (): Source[] => [...sources.values()];

/** Read the installed connectors and make a source of each enabled one. Called on start and after every change. */
export async function loadConnectors(): Promise<void> {
  const rows = await db.connectors.toArray();
  const next = new Map<string, Source>();
  for (const row of rows) {
    if (!row.enabled) continue;
    try {
      next.set(row.id, createConnectorSource(row, parseManifest(row.manifest)));
    } catch { /* A broken connector stays listed on the Connectors page with its error; it just adds no source. */ }
  }
  sources = next;
  listeners.forEach((fn) => fn());
}

/** Run the code once in a throwaway sandbox to read and check its manifest. Nothing is saved. */
export async function inspectConnector(code: string): Promise<ConnectorManifest> {
  if (!code.trim()) throw new Error("Paste the connector code first.");
  if (code.length > MAX_CODE) throw new Error("The connector is larger than 512 KB.");
  const host = new ConnectorHost(code);
  try { return await host.load(); } finally { host.dispose(); }
}

/** Download connector code from a raw file address. */
export async function fetchConnectorCode(address: string): Promise<string> {
  let url: URL;
  try { url = new URL(address.trim()); } catch { throw new Error("Enter the full https address of the raw connector file."); }
  if (url.protocol !== "https:") throw new Error("The connector address must start with https://.");
  let text: string;
  try {
    const direct = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
    text = await direct.text();
  } catch {
    // Some hosts send no CORS headers; Comik's proxy can fetch the file instead.
    const proxied = await request(url.toString(), { minGapMs: 0, retries: 0 });
    text = await proxied.text();
  }
  if (text.length > MAX_CODE) throw new Error("The connector file is larger than 512 KB.");
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("That address returned a web page, not code. Use the raw file link.");
  return text;
}

export interface InstallInput { code: string; sourceUrl?: string; attested: boolean }

/** Save a connector. The person must have confirmed they have permission from the site's operator. */
export async function installConnector({ code, sourceUrl = "", attested }: InstallInput): Promise<ConnectorRow> {
  if (!attested) throw new Error("Confirm that you have permission from the site's operator first.");
  const manifest = await inspectConnector(code);
  const now = Date.now();
  const previous = await db.connectors.get(manifest.id);
  const row: ConnectorRow = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    manifest: manifest as unknown as Record<string, unknown>,
    code,
    sourceUrl,
    domains: manifest.domains,
    nsfw: !!manifest.nsfw,
    enabled: previous?.enabled ?? true,
    settings: previous?.settings ?? {},
    attestedAt: now,
    installedAt: previous?.installedAt ?? now,
    updatedAt: now,
  };
  await db.connectors.put(row);
  stopHost(row.id);
  await loadConnectors();
  return row;
}

export async function removeConnector(id: string) {
  await db.connectors.delete(id);
  stopHost(id);
  await loadConnectors();
}

export async function setConnectorEnabled(id: string, enabled: boolean) {
  const row = await db.connectors.get(id);
  if (row) await db.connectors.put({ ...row, enabled, updatedAt: Date.now() });
  stopHost(id);
  await loadConnectors();
}

export async function setConnectorSettings(id: string, settings: Record<string, string>) {
  const row = await db.connectors.get(id);
  if (row) await db.connectors.put({ ...row, settings, updatedAt: Date.now() });
  stopHost(id);
  await loadConnectors();
}

/** What an update would change, so the person can decide. */
export async function checkConnectorUpdate(id: string): Promise<{ code: string; manifest: ConnectorManifest; newDomains: string[]; sameVersion: boolean } | null> {
  const row = await db.connectors.get(id);
  if (!row?.sourceUrl) return null;
  const code = await fetchConnectorCode(row.sourceUrl);
  const manifest = await inspectConnector(code);
  if (manifest.id !== row.id) throw new Error("The file at that address is a different connector now.");
  return { code, manifest, newDomains: manifest.domains.filter((domain) => !row.domains.includes(domain)), sameVersion: code === row.code };
}

/** A connector's own view: does it answer at all? Used by the Test button. */
export async function testConnector(id: string): Promise<{ titles: number; first?: string; log: string[] }> {
  const row = await db.connectors.get(id);
  if (!row) throw new Error("That connector is not installed.");
  const source = sources.get(id);
  if (!source) throw new Error("This connector is turned off or failed to load.");
  const { hostFor } = await import("./source");
  const page = await source.getPopular(1);
  return { titles: page.mangas.length, first: page.mangas[0]?.title, log: hostFor(row).log.slice(-20) };
}
