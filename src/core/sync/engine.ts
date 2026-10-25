import { db, type ChapterState } from "../db";
import { onLocalChange } from "../bus";
import { archiveLocalData } from "../backup";
import { hash53 } from "../hash";
import { useSettings } from "../settings";
import type { CategoryRow, ChapterRow, MangaRow } from "../types";
import { ensureSignedIn, loadFirebase, useSync, watchAuth } from "./firebase";

/**
 * Last-write-wins sync over Firestore.
 *
 *   users/{uid}/series/{hash(mangaId)}   one doc per library series (meta + compact chapter states)
 *   users/{uid}/meta/categories          category list
 *   users/{uid}/meta/settings            reader/library preferences
 *
 * Every entity carries a `modifiedAt` clock; the higher one wins. Chapter lists themselves are
 * never synced, they are re-fetched from the source. Only read state travels, keyed by a hash of
 * the chapter URL, which keeps docs far below Firestore's 1 MiB limit.
 */

const LS_PUSHED = "comik.sync.pushedAt";
const SYNCED_SETTINGS: (keyof ReturnType<typeof useSettings.getState>)[] = [
  "theme", "userThemes", "customCss", "customCssOn", "cornerRadius", "librarySort", "librarySortAsc", "libraryDensity", "libraryGridColumns", "globalSearchGridColumns", "libraryUnreadBadge", "readerMode", "fit", "webtoonGap", "webtoonSidePadding",
  "doublePages", "smartSpreads", "cropBorders", "splitTall", "preload", "tapZones", "invertTaps", "showPageNumber", "brightness", "grayscale", "communityProfile", "tastePreferences",
  "invert", "sepia", "novelFontSize", "novelLineHeight", "novelFont", "autoNextChapter", "skipReadChapters", "updateSkipCompleted", "autoUpdateHours",
];

type SeriesDoc = Omit<MangaRow, "id"> & { id: string; chapters: Record<string, ChapterState> };
export type AccountSyncChoice = "combine" | "park-local" | "cloud" | "local";

const seriesKey = (id: string) => hash53(id);
const strip = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)) as T; // Firestore rejects undefined

let stopFns: (() => void)[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let pushing = false;
let again = false;
let applyingRemote = false;

const pushedAt = () => Number(localStorage.getItem(LS_PUSHED) ?? 0);

/* ------------------------------- apply remote ------------------------------ */

async function applySeries(d: SeriesDoc) {
  const { chapters, ...manga } = d;
  const local = await db.manga.get(manga.id);
  if (!local || manga.modifiedAt > local.modifiedAt) {
    await db.manga.put({ ...manga, libraryFlag: manga.inLibrary ? 1 : 0, genres: manga.genres ?? [], categoryIds: manga.categoryIds ?? [] } as MangaRow);
  }
  const rows = await db.chapters.where("mangaId").equals(manga.id).toArray();
  if (!rows.length) {
    const pending = await db.pendingStates.get(manga.id);
    const merged = { ...(pending?.states ?? {}) };
    for (const [k, st] of Object.entries(chapters ?? {})) if (!merged[k] || st.m > merged[k]!.m) merged[k] = st;
    await db.pendingStates.put({ mangaId: manga.id, states: merged });
    return;
  }
  const updates: ChapterRow[] = [];
  for (const r of rows) {
    const st = chapters?.[hash53(r.url)];
    if (st && st.m > r.modifiedAt) updates.push({ ...r, read: !!st.r, bookmark: !!st.b, lastPage: st.p, readAt: st.t, modifiedAt: st.m });
  }
  if (updates.length) await db.chapters.bulkPut(updates);
}

async function applyCategories(items: CategoryRow[]) {
  const local = new Map((await db.categories.toArray()).map((c) => [c.id, c]));
  const normalized = items.map((category) => ({ ...category, kind: category.kind ?? "comic" as const }));
  const puts = normalized.filter((c) => !local.has(c.id) || c.modifiedAt > local.get(c.id)!.modifiedAt);
  if (puts.length) await db.categories.bulkPut(puts);
}

function applySettings(values: Record<string, unknown>, modifiedAt: number) {
  const localAt = Number(localStorage.getItem("comik.settings.at") ?? 0);
  if (modifiedAt > localAt) {
    localStorage.setItem("comik.settings.at", String(modifiedAt));
    applyingRemote = true;
    useSettings.setState(values);
    applyingRemote = false;
  }
}

async function clearLocalSyncData() {
  await db.transaction("rw", db.manga, db.chapters, db.categories, db.pendingStates, async () => {
    await Promise.all([db.manga.clear(), db.chapters.clear(), db.categories.clear(), db.pendingStates.clear(), db.shelfStats.clear()]);
  });
  await db.transaction("rw", db.downloads, db.pageCache, db.pageBlobs, db.localFiles, async () => {
    await Promise.all([db.downloads.clear(), db.pageCache.clear(), db.pageBlobs.clear(), db.localFiles.clear()]);
  });
}

async function deleteCloudDocuments(uid: string, name: "series" | "meta") {
  const { fs, fsMod } = await loadFirebase();
  const snapshot = await fsMod.getDocs(fsMod.collection(fs, "users", uid, name));
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = fsMod.writeBatch(fs);
    for (const item of snapshot.docs.slice(offset, offset + 400)) batch.delete(item.ref);
    await batch.commit();
  }
}

async function prepareAccountSync(uid: string, choice: AccountSyncChoice, previousUid: string | null) {
  const { fs, fsMod } = await loadFirebase();
  if (choice === "park-local") await archiveLocalData(previousUid);
  if (choice === "local") {
    await deleteCloudDocuments(uid, "series");
    await deleteCloudDocuments(uid, "meta");
    const timestamp = Date.now();
    const localManga = await db.manga.filter((manga) => manga.inLibrary).toArray();
    const ids = new Set(localManga.map((manga) => manga.id));
    const localChapters = (await db.chapters.toArray()).filter((chapter) => ids.has(chapter.mangaId));
    const localCategories = await db.categories.toArray();
    await db.transaction("rw", db.manga, db.chapters, db.categories, async () => {
      await db.manga.bulkPut(localManga.map((manga) => ({ ...manga, libraryFlag: manga.inLibrary ? 1 : 0, modifiedAt: timestamp })));
      await db.chapters.bulkPut(localChapters.map((chapter) => ({ ...chapter, modifiedAt: timestamp })));
      await db.categories.bulkPut(localCategories.map((category) => ({ ...category, modifiedAt: timestamp })));
    });
    localStorage.setItem("comik.settings.at", String(timestamp));
    resetPushCursor();
    return;
  }

  const [series, meta] = await Promise.all([
    fsMod.getDocs(fsMod.collection(fs, "users", uid, "series")),
    fsMod.getDocs(fsMod.collection(fs, "users", uid, "meta")),
  ]);
  if (choice === "cloud" || choice === "park-local") {
    await clearLocalSyncData();
    localStorage.setItem("comik.settings.at", "0");
    const defaults = useSettings.getInitialState();
    const values = Object.fromEntries(SYNCED_SETTINGS.map((key) => [key, defaults[key]]));
    applyingRemote = true;
    useSettings.setState(values);
    applyingRemote = false;
  }
  for (const item of series.docs) await applySeries(item.data() as SeriesDoc);
  for (const item of meta.docs) {
    const data = item.data();
    if (item.id === "categories") {
      if (choice === "cloud" || choice === "park-local") await db.categories.clear();
      await applyCategories((data.items ?? []) as CategoryRow[]);
    }
    if (item.id === "settings") applySettings(data.values ?? {}, data.modifiedAt ?? 0);
  }
  if (!Number(localStorage.getItem("comik.settings.at") ?? 0)) localStorage.setItem("comik.settings.at", String(Date.now()));
  resetPushCursor();
}

/* ---------------------------------- push ---------------------------------- */

function stateOf(c: ChapterRow): ChapterState {
  return { r: c.read ? 1 : 0, b: c.bookmark ? 1 : 0, p: c.lastPage, t: c.readAt, m: c.modifiedAt };
}

async function pushNow(uid: string) {
  const { fs, fsMod } = await loadFirebase();
  const since = pushedAt();
  const started = Date.now();

  const changedManga = await db.manga.where("modifiedAt").above(since).toArray();
  const changedChapters = await db.chapters.where("modifiedAt").above(since).toArray();
  const ids = new Set(changedManga.map((m) => m.id));
  for (const c of changedChapters) ids.add(c.mangaId);

  const batch = fsMod.writeBatch(fs);
  let ops = 0;
  for (const id of ids) {
    const m = changedManga.find((x) => x.id === id) ?? (await db.manga.get(id));
    if (!m || (m.modifiedAt === 0 && !m.inLibrary)) continue; // never touched by the user
    const chapters: Record<string, ChapterState> = {};
    for (const c of await db.chapters.where("mangaId").equals(id).toArray()) {
      if (c.read || c.bookmark || c.lastPage > 0) chapters[hash53(c.url)] = stateOf(c);
    }
    batch.set(fsMod.doc(fs, "users", uid, "series", seriesKey(id)), strip({ ...m, chapters } as SeriesDoc));
    if (++ops >= 400) break;
  }

  const cats = await db.categories.where("order").aboveOrEqual(0).toArray();
  if (cats.some((c) => c.modifiedAt > since)) batch.set(fsMod.doc(fs, "users", uid, "meta", "categories"), { items: strip(cats), modifiedAt: started });

  const s = useSettings.getState();
  const settingsAt = Number(localStorage.getItem("comik.settings.at") ?? 0);
  if (settingsAt > since) {
    const values: Record<string, unknown> = {};
    for (const k of SYNCED_SETTINGS) values[k] = s[k];
    batch.set(fsMod.doc(fs, "users", uid, "meta", "settings"), { values, modifiedAt: settingsAt });
  }

  if (ops || cats.some((c) => c.modifiedAt > since) || settingsAt > since) await batch.commit();
  if (ops < 400) localStorage.setItem(LS_PUSHED, String(started));
  else schedulePush(uid, 200);
}

function schedulePush(uid: string, delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (pushing) {
      again = true;
      return;
    }
    pushing = true;
    useSync.getState().patch({ syncing: true });
    try {
      await pushNow(uid);
      const at = Date.now();
      localStorage.setItem("comik.sync.last", String(at));
      useSync.getState().patch({ lastSyncedAt: at, error: undefined, status: "ready" });
    } catch (e) {
      useSync.getState().patch({ status: "error", error: (e as Error).message });
    } finally {
      pushing = false;
      useSync.getState().patch({ syncing: false });
      if (again) {
        again = false;
        schedulePush(uid, 500);
      }
    }
  }, delay);
}

/* --------------------------------- lifecycle -------------------------------- */

export async function startSync(choice: AccountSyncChoice = "combine", previousUid: string | null = null): Promise<void> {
  stopSync();
  const store = useSync.getState();
  store.patch({ status: "connecting", error: undefined });
  try {
    const user = await ensureSignedIn();
    await prepareAccountSync(user.uid, choice, previousUid);
    const { fs, fsMod } = await loadFirebase();
    const base = (...p: string[]) => fsMod.collection(fs, "users", user.uid, ...p as [string]);

    const unsubSeries = fsMod.onSnapshot(
      base("series"),
      async (snap) => {
        for (const ch of snap.docChanges()) if (ch.type !== "removed") await applySeries(ch.doc.data() as SeriesDoc);
        const at = Date.now();
        localStorage.setItem("comik.sync.last", String(at));
        useSync.getState().patch({ lastSyncedAt: at, status: "ready" });
      },
      (e) => useSync.getState().patch({ status: "error", error: e.message }),
    );
    const unsubMeta = fsMod.onSnapshot(base("meta"), async (snap) => {
      for (const ch of snap.docChanges()) {
        const data = ch.doc.data();
        if (ch.doc.id === "categories") await applyCategories((data.items ?? []) as CategoryRow[]);
        if (ch.doc.id === "settings") applySettings(data.values ?? {}, data.modifiedAt ?? 0);
      }
    });
    const unsubLocal = onLocalChange(() => schedulePush(user.uid));
    const unsubSettings = useSettings.subscribe((s, prev) => {
      if (applyingRemote) return;
      if (SYNCED_SETTINGS.some((k) => s[k] !== prev[k])) {
        localStorage.setItem("comik.settings.at", String(Date.now()));
        schedulePush(user.uid);
      }
    });
    const unsubAuth = await watchAuth((u) => {
      if (!u || u.uid !== user.uid) {
        resetPushCursor();
        void startSync();
      }
    });
    stopFns = [unsubSeries, unsubMeta, unsubLocal, unsubSettings, unsubAuth];
    schedulePush(user.uid, 800);
  } catch (e) {
    store.patch({ status: "error", error: (e as Error).message });
  }
}

export function stopSync() {
  clearTimeout(timer);
  stopFns.forEach((f) => f());
  stopFns = [];
}

/** Force a full push next cycle (used by the "Sync now" button). */
export function syncNow() {
  const u = useSync.getState().user;
  if (u) schedulePush(u.uid, 0);
}

/** Forget what was pushed so everything uploads again, e.g. after switching accounts. */
export function resetPushCursor() {
  localStorage.removeItem(LS_PUSHED);
}
