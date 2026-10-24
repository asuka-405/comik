import { create } from "zustand";
import { isNativeShell } from "./platform";

/**
 * In-app updates are plain full downloads. The app asks GitHub for the newest release, and if it is newer
 * than the running version it downloads that release's installer for this platform into the Downloads folder.
 * Installing is up to the person: tap the finished download on Android, or run the file on desktop.
 */
const REPO = "asuka-405/comik";

export interface UpdateCandidate {
  version: string;
  /** File name to save as, such as Comik-0.5.0-alpha-android.apk. */
  fileName: string;
  url: string;
  size: number;
  page: string;
}

interface ApiAsset { name: string; browser_download_url: string; size: number }
interface ApiRelease { tag_name: string; html_url: string; prerelease: boolean; draft: boolean; assets: ApiAsset[] }

interface AppUpdateState {
  candidate: UpdateCandidate | null;
  checking: boolean;
  checkedAt: number;
  downloading: boolean;
  /** 0 to 1, or 0 while the size is not known yet. */
  progress: number;
  /** Where the finished download was saved, as far as the platform tells us. */
  savedAs: string;
  error: string;
}

export const useAppUpdate = create<AppUpdateState>(() => ({ candidate: null, checking: false, checkedAt: 0, downloading: false, progress: 0, savedAs: "", error: "" }));

interface AndroidUpdateBridge {
  fetchUpdateInfo(requestId: string, url: string): void;
  downloadApk(url: string, fileName: string): boolean;
}

declare global {
  interface Window {
    ComikAndroidUpdates?: AndroidUpdateBridge;
    __comikAndroidUpdateResult?: (serialized: string) => void;
    __comikAndroidDownload?: (serialized: string) => void;
  }
}

/* ------------------------------------------------------------- versions */

function versionParts(version: string): { numbers: number[]; suffix: string } {
  const normalized = version.replace(/^v/, "");
  const [numeric, suffix = ""] = normalized.split("-", 2);
  return { numbers: numeric!.split(".").map((part) => Number(part) || 0), suffix };
}

/** Semantic order across any major, minor and patch, so 0.4.2 < 0.9.9 < 1.0.0. A pre-release sorts before its release. */
export function compareAppVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  if (!a.suffix && b.suffix) return 1;
  if (a.suffix && !b.suffix) return -1;
  return a.suffix.localeCompare(b.suffix, undefined, { numeric: true, sensitivity: "base" });
}

const isPrerelease = (version: string) => /-(alpha|beta|rc)(\.|$)/i.test(version);

/* ------------------------------------------------------------- platform */

type Platform = "android" | "linux" | "windows";

function platform(): Platform | null {
  if (window.ComikAndroidUpdates) return "android";
  if (!isNativeShell) return null;
  return /windows/i.test(navigator.userAgent) ? "windows" : "linux";
}

/** The release asset to download and the name to save it under. */
const ASSETS: Record<Platform, { asset: string; save: (version: string) => string }> = {
  android: { asset: "Comik-android.apk", save: (v) => `Comik-${v}-android.apk` },
  linux: { asset: "Comik-linux-x64.AppImage", save: (v) => `Comik-${v}-linux-x64.AppImage` },
  windows: { asset: "Comik-windows-x64.zip", save: (v) => `Comik-${v}-windows-x64.zip` },
};

/* ------------------------------------------------------- native fetching */

const androidRequests = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let androidRequestId = 0;

if (typeof window !== "undefined") {
  window.__comikAndroidUpdateResult = (serialized) => {
    let result: { requestId: string; data?: string; error?: string };
    try { result = JSON.parse(serialized) as typeof result; } catch { return; }
    const pending = androidRequests.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    androidRequests.delete(result.requestId);
    if (result.error || result.data === undefined) pending.reject(new Error(result.error || "The update check failed"));
    else pending.resolve(new TextDecoder().decode(Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))));
  };
}

/**
 * GitHub's API text. A WebView or desktop window cannot always call it directly (cross-origin rules, missing
 * network permission for the page), so the apps fetch it themselves and hand the text over.
 */
async function fetchReleaseText(url: string): Promise<string> {
  const android = window.ComikAndroidUpdates;
  if (android) {
    const requestId = `update-${++androidRequestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { androidRequests.delete(requestId); reject(new Error("GitHub did not answer. Check your connection and try again.")); }, 30_000);
      androidRequests.set(requestId, { resolve, reject, timer });
      try { android.fetchUpdateInfo(requestId, url); }
      catch (error) { clearTimeout(timer); androidRequests.delete(requestId); reject(error instanceof Error ? error : new Error("Could not start the update check")); }
    });
  }
  const response = isNativeShell
    ? await fetch(`/api/update/download?url=${encodeURIComponent(url)}`, { cache: "no-store" })
    : await fetch(url, { cache: "no-store", headers: { accept: "application/vnd.github+json" } });
  if (!response.ok) {
    const detail = await response.json().then((j: { error?: string }) => j.error).catch(() => undefined);
    throw new Error(response.status === 403 ? "GitHub is limiting update checks right now. Try again in a while." : detail || `Update check failed (${response.status})`);
  }
  return response.text();
}

/* ----------------------------------------------------------------- check */

/** The newest release that is newer than `currentVersion`, with the download for this platform, or null. */
export async function findAppUpdate(currentVersion: string): Promise<UpdateCandidate | null> {
  const target = platform();
  if (!target) return null;
  const releases = JSON.parse(await fetchReleaseText(`https://api.github.com/repos/${REPO}/releases?per_page=30`)) as ApiRelease[];
  // A pre-release build is offered newer pre-releases and stable releases. A stable build is offered stable releases only.
  const wantPre = isPrerelease(currentVersion);
  const newest = releases
    .filter((release) => !release.draft && (wantPre || !release.prerelease))
    .map((release) => ({ release, version: release.tag_name.replace(/^v/, "") }))
    .filter(({ version, release }) => compareAppVersions(version, currentVersion) > 0 && release.assets.some((asset) => asset.name === ASSETS[target].asset))
    .sort((a, b) => compareAppVersions(b.version, a.version))[0];
  if (!newest) return null;
  const asset = newest.release.assets.find((item) => item.name === ASSETS[target].asset)!;
  return { version: newest.version, fileName: ASSETS[target].save(newest.version), url: asset.browser_download_url, size: asset.size, page: newest.release.html_url };
}

export async function checkForAppUpdate(currentVersion: string): Promise<void> {
  useAppUpdate.setState({ checking: true, error: "" });
  try {
    useAppUpdate.setState({ candidate: await findAppUpdate(currentVersion), checking: false, checkedAt: Date.now() });
  } catch (error) {
    useAppUpdate.setState({ checking: false, checkedAt: Date.now(), error: (error as Error).message });
  }
}

/* -------------------------------------------------------------- download */

/** Save the update installer into the Downloads folder. */
export async function downloadAppUpdate(): Promise<void> {
  const { candidate } = useAppUpdate.getState();
  if (!candidate) return;
  useAppUpdate.setState({ downloading: true, progress: 0, savedAs: "", error: "" });
  const finish = (patch: Partial<AppUpdateState>) => useAppUpdate.setState({ downloading: false, ...patch });
  try {
    if (window.ComikAndroidUpdates) {
      window.__comikAndroidDownload = (serialized) => {
        const report = JSON.parse(serialized) as { status: "progress" | "done" | "error"; received?: number; total?: number; message?: string };
        if (report.status === "progress") useAppUpdate.setState({ progress: report.total ? (report.received ?? 0) / report.total : 0 });
        else if (report.status === "done") finish({ progress: 1, savedAs: `Downloads/${candidate.fileName}` });
        else finish({ error: report.message || "The download failed." });
      };
      if (!window.ComikAndroidUpdates.downloadApk(candidate.url, candidate.fileName)) throw new Error("Android could not start the download.");
      return;
    }
    const started = await fetch("/api/update/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: candidate.url, name: candidate.fileName }) });
    if (!started.ok) throw new Error(((await started.json().catch(() => ({}))) as { error?: string }).error || "Could not start the download.");
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const state = await (await fetch("/api/update/progress", { cache: "no-store" })).json() as { state: string; received: number; total: number; path: string; error: string };
      if (state.state === "error") throw new Error(state.error || "The download failed.");
      useAppUpdate.setState({ progress: state.total ? state.received / state.total : 0 });
      if (state.state === "done") return finish({ progress: 1, savedAs: state.path });
    }
  } catch (error) {
    finish({ error: (error as Error).message });
  }
}

/** Open the Downloads folder at the saved file (desktop only). */
export function revealAppUpdate(): void {
  void fetch("/api/update/reveal", { method: "POST" }).catch(() => {});
}
