import { db, type CustomSourceRow } from "../db";
import { createMangaDex, loadMangaDexTags } from "./mangadex";
import { createWebtoons } from "./webtoons";
import { createMadara } from "./madara";
import { createThemesia } from "./themesia";
import { createSelectorSource } from "./selector";
import { localSource } from "./local";
import type { Source } from "../types";

const MD_LANGS: [string, string][] = [
  ["en", "English"], ["es", "Spanish"], ["fr", "French"], ["pt-br", "Portuguese (BR)"], ["id", "Indonesian"], ["ru", "Russian"], ["de", "German"], ["it", "Italian"], ["ja", "Japanese"], ["tr", "Turkish"],
];
const WT_LANGS: [string, string][] = [["en", "English"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["id", "Indonesian"], ["th", "Thai"]];

const builtin: Source[] = [
  ...MD_LANGS.map(([l, n]) => createMangaDex(l, n)),
  ...WT_LANGS.map(([l, n]) => createWebtoons(l, n)),
  localSource,
];

let custom = new Map<string, Source>();
const subs = new Set<() => void>();

export function buildCustom(row: CustomSourceRow): Source {
  const init = { id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, config: row.config };
  if (row.kind === "madara") return createMadara({ id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, nsfw: row.config.nsfw === "1" });
  if (row.kind === "themesia") return createThemesia({ id: row.id, name: row.name, baseUrl: row.baseUrl, lang: row.lang, listPath: row.config.listPath || undefined, nsfw: row.config.nsfw === "1" });
  return createSelectorSource(init);
}

export async function loadCustomSources() {
  const rows = await db.customSources.toArray();
  custom = new Map(rows.map((r) => [r.id, buildCustom(r)]));
  subs.forEach((f) => f());
}

export async function addCustomSource(row: Omit<CustomSourceRow, "id" | "createdAt">): Promise<Source> {
  const full: CustomSourceRow = { ...row, id: `custom-${row.kind}-${crypto.randomUUID().slice(0, 8)}`, createdAt: Date.now() };
  await db.customSources.put(full);
  await loadCustomSources();
  return custom.get(full.id)!;
}

export async function removeCustomSource(id: string) {
  await db.customSources.delete(id);
  await loadCustomSources();
}

export const onSourcesChange = (fn: () => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

export const allSources = (): Source[] => [...builtin, ...custom.values()];
export const getSource = (id: string): Source | undefined => allSources().find((s) => s.id === id);
export const isCustom = (id: string) => custom.has(id);

export async function ensureSourceReady(source: Source) {
  if (source.id.startsWith("mangadex")) await loadMangaDexTags().catch(() => {});
}
