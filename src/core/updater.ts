import { create } from "zustand";
import { db } from "./db";
import { getSource } from "./sources/registry";
import { getSettings } from "./settings";
import { syncChapters, upsertManga } from "./repo";
import type { MangaRow } from "./types";

export interface UpdateProgress {
  running: boolean;
  done: number;
  total: number;
  current?: string;
  newChapters: number;
  failed: { title: string; error: string }[];
}

export const useUpdater = create<UpdateProgress>(() => ({ running: false, done: 0, total: 0, newChapters: 0, failed: [] }));
const LS = "comik.lastUpdateRun";

/** Which library entries are worth polling. Mirrors Mihon's "update restrictions". */
export async function updateTargets(): Promise<MangaRow[]> {
  const s = getSettings();
  const all = await db.manga.filter((m) => m.inLibrary).toArray();
  const started = new Set<string>();
  if (s.updateSkipStarted) {
    for (const c of await db.chapters.filter((c) => c.read).toArray()) started.add(c.mangaId);
  }
  return all.filter((m) => m.sourceId !== "local" && !(s.updateSkipCompleted && m.status === "completed") && !(s.updateSkipStarted && started.has(m.id)));
}

export async function refreshManga(manga: MangaRow) {
  const source = getSource(manga.sourceId);
  if (!source) throw new Error(`Source ${manga.sourceId} is not installed`);
  const [details, chapters] = await Promise.all([source.getMangaDetails({ url: manga.url, title: manga.title }), source.getChapterList({ url: manga.url, title: manga.title })]);
  const row = await upsertManga(manga.sourceId, details);
  return syncChapters(row, chapters);
}

let running = false;

export async function updateLibrary(only?: MangaRow[]): Promise<void> {
  if (running) return;
  running = true;
  const targets = only ?? (await updateTargets());
  useUpdater.setState({ running: true, done: 0, total: targets.length, newChapters: 0, failed: [], current: undefined });

  // one worker per source so a slow site doesn't block the rest, and no site sees parallel requests
  const queues = new Map<string, MangaRow[]>();
  for (const m of targets) queues.set(m.sourceId, [...(queues.get(m.sourceId) ?? []), m]);

  await Promise.all(
    [...queues.values()].map(async (queue) => {
      for (const m of queue) {
        useUpdater.setState({ current: m.title });
        try {
          const r = await refreshManga(m);
          useUpdater.setState((s) => ({ newChapters: s.newChapters + r.added.length }));
        } catch (e) {
          useUpdater.setState((s) => ({ failed: [...s.failed, { title: m.title, error: (e as Error).message }] }));
        }
        useUpdater.setState((s) => ({ done: s.done + 1 }));
      }
    }),
  );
  localStorage.setItem(LS, String(Date.now()));
  useUpdater.setState({ running: false, current: undefined });
  running = false;
}

/** Called on app start: refresh if the last run is older than the configured interval. */
export async function maybeAutoUpdate() {
  const hours = getSettings().autoUpdateHours;
  if (!hours) return;
  const last = Number(localStorage.getItem(LS) ?? 0);
  if (Date.now() - last > hours * 36e5) void updateLibrary();
}
