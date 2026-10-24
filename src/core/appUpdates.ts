import { unzipSync } from "fflate";
import { create } from "zustand";
import { isNativeShell } from "./platform";

const REPO = "asuka-405/comik";
const MANIFEST_ASSET = "Comik-app-update.json";
const ARCHIVE_ASSET = "Comik-app-update.zip";

interface ApiAsset { name: string; browser_download_url: string; digest?: string | null }
interface ApiRelease { tag_name: string; prerelease: boolean; draft: boolean; assets: ApiAsset[] }
export interface UpdateFile { path: string; size: number; sha256: string }
export interface UpdateManifest { schema: 1; version: string; baseVersion?: string | null; archiveSha256: string; files: UpdateFile[] }
export interface UpdateCandidate { version: string; manifestUrl: string; archiveUrl: string; manifestDigest?: string; archiveDigest?: string }

interface AppUpdateState {
  activeVersion: string;
  checking: boolean;
  installing: boolean;
  candidate: UpdateCandidate | null;
  error: string;
  checkedAt: number;
}

export const useAppUpdate = create<AppUpdateState>(() => ({ activeVersion: "", checking: false, installing: false, candidate: null, error: "", checkedAt: 0 }));

interface AndroidUpdateBridge {
  getActiveVersion(): string;
  downloadUpdateAsset(requestId: string, url: string): void;
  beginUpdate(manifestJson: string): boolean;
  writeUpdateFile(version: string, path: string, contentBase64: string, sha256: string): boolean;
  activateUpdate(version: string): boolean;
  confirmUpdate(): boolean;
}

declare global {
  interface Window {
    ComikAndroidUpdates?: AndroidUpdateBridge;
    __comikAndroidUpdateResult?: (serialized: string) => void;
  }
}

const androidDownloads = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let androidDownloadId = 0;

if (typeof window !== "undefined") {
  window.__comikAndroidUpdateResult = (serialized) => {
    let result: { requestId: string; data?: string; error?: string };
    try { result = JSON.parse(serialized) as typeof result; }
    catch { return; }
    const pending = androidDownloads.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    androidDownloads.delete(result.requestId);
    if (result.error || !result.data) { pending.reject(new Error(result.error || "Android update download failed")); return; }
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    pending.resolve(bytes);
  };
}

function versionParts(version: string): { numbers: number[]; suffix: string } {
  const normalized = version.replace(/^v/, "");
  const [numeric, suffix = ""] = normalized.split("-", 2);
  return { numbers: numeric!.split(".").map((part) => Number(part) || 0), suffix };
}

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

export function isSafeUpdatePath(value: string): boolean {
  return /^(assets|web|releases)\/[A-Za-z0-9._/-]+$/.test(value)
    && !value.split("/").some((part) => !part || part === "." || part === "..");
}

export function validateUpdateManifest(manifest: UpdateManifest, version: string): boolean {
  if (manifest.schema !== 1 || manifest.version !== version || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 5000) return false;
  let total = 0;
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!isSafeUpdatePath(file.path) || paths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 24 * 1024 * 1024 || !/^[a-f0-9]{64}$/i.test(file.sha256)) return false;
    paths.add(file.path);
    total += file.size;
  }
  return total <= 160 * 1024 * 1024 && paths.has("web/index.html");
}

export async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}

function releaseVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

export async function findAppUpdate(currentVersion: string): Promise<UpdateCandidate | null> {
  const releasesBytes = await fetchUpdateBytes(`https://api.github.com/repos/${REPO}/releases?per_page=50`, "application/vnd.github+json");
  const releases = JSON.parse(new TextDecoder().decode(releasesBytes)) as ApiRelease[];
  const channel = currentVersion.match(/-(alpha|beta|rc)(\.|$)/i)?.[1]?.toLowerCase() ?? "stable";
  const candidates = releases.filter((release) => !release.draft && (channel === "stable" ? !release.prerelease : release.prerelease))
    .map((release) => ({ release, version: releaseVersion(release.tag_name) }))
    .filter(({ version }) => (version.match(/-(alpha|beta|rc)(\.|$)/i)?.[1]?.toLowerCase() ?? "stable") === channel && compareAppVersions(version, currentVersion) > 0)
    .sort((a, b) => compareAppVersions(a.version, b.version));
  for (const { release, version } of candidates) {
    const manifest = release.assets.find((asset) => asset.name === MANIFEST_ASSET);
    const archive = release.assets.find((asset) => asset.name === ARCHIVE_ASSET);
    if (manifest && archive) return {
      version,
      manifestUrl: manifest.browser_download_url,
      archiveUrl: archive.browser_download_url,
      manifestDigest: manifest.digest?.replace(/^sha256:/, ""),
      archiveDigest: archive.digest?.replace(/^sha256:/, ""),
    };
  }
  return null;
}

async function postDesktop(path: string, body: unknown): Promise<void> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || `Native updater failed (${response.status})`);
  }
}

async function fetchUpdateBytes(url: string, accept = "application/octet-stream"): Promise<Uint8Array> {
  const android = window.ComikAndroidUpdates;
  if (android) {
    const requestId = `update-${++androidDownloadId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        androidDownloads.delete(requestId);
        reject(new Error("GitHub update download timed out. Try again."));
      }, 120_000);
      androidDownloads.set(requestId, { resolve, reject, timer });
      try { android.downloadUpdateAsset(requestId, url); }
      catch (error) {
        clearTimeout(timer);
        androidDownloads.delete(requestId);
        reject(error instanceof Error ? error : new Error("Could not start Android update download"));
      }
    });
  }
  if (isNativeShell) {
    const response = await fetch(`/api/update/download?url=${encodeURIComponent(url)}`, { cache: "no-store", headers: { accept } });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || `Update download failed (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  const response = await fetch(url, { cache: "no-store", headers: { accept } });
  if (!response.ok) throw new Error(response.status === 403 ? "GitHub update download is rate limited" : `Update download failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function activeAppVersion(bundledVersion: string): Promise<string> {
  if (window.ComikAndroidUpdates) return window.ComikAndroidUpdates.getActiveVersion() || bundledVersion;
  try {
    const response = await fetch("/api/update/version", { cache: "no-store" });
    if (response.ok) return ((await response.json()) as { version?: string }).version || bundledVersion;
  } catch { /* The browser/web build has no native updater endpoint. */ }
  return bundledVersion;
}

export function confirmActiveUpdate(): void {
  if (window.ComikAndroidUpdates) {
    window.ComikAndroidUpdates.confirmUpdate();
    return;
  }
  void fetch("/api/update/confirm", { method: "POST" }).catch(() => {});
}

export async function installAppUpdate(candidate: UpdateCandidate, activeVersion: string): Promise<void> {
  const [manifestBytes, archiveBytes] = await Promise.all([
    fetchUpdateBytes(candidate.manifestUrl, "application/json"),
    fetchUpdateBytes(candidate.archiveUrl),
  ]);
  if (!candidate.manifestDigest || !/^[a-f0-9]{64}$/i.test(candidate.manifestDigest)) throw new Error("The release does not include a trusted manifest digest");
  if (manifestBytes.length > 2 * 1024 * 1024) throw new Error("The update manifest is too large");
  if (await sha256Hex(manifestBytes) !== candidate.manifestDigest) throw new Error("The update manifest failed integrity verification");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as UpdateManifest;
  if (!validateUpdateManifest(manifest, candidate.version)) {
    throw new Error("The update manifest is invalid");
  }
  if (manifest.baseVersion && manifest.baseVersion !== activeVersion) throw new Error(`This update requires ${manifest.baseVersion}; current overlay is ${activeVersion}`);
  if (archiveBytes.length > 160 * 1024 * 1024) throw new Error("The update archive is too large");
  const archiveHash = await sha256Hex(archiveBytes);
  if (archiveHash !== manifest.archiveSha256 || (candidate.archiveDigest && archiveHash !== candidate.archiveDigest)) throw new Error("The update archive failed integrity verification");
  const files = unzipSync(archiveBytes);
  const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]));
  if (Object.keys(files).length !== manifest.files.length) throw new Error("The update contains unexpected files");
  for (const [path, content] of Object.entries(files)) {
    const entry = manifestFiles.get(path);
    if (!entry || !isSafeUpdatePath(path) || content.length !== entry.size || await sha256Hex(content) !== entry.sha256) {
      throw new Error(`Update file verification failed: ${path}`);
    }
  }

  const bridge = window.ComikAndroidUpdates;
  if (bridge) {
    if (!bridge.beginUpdate(JSON.stringify(manifest))) throw new Error("Android could not prepare the update");
    for (const [path, content] of Object.entries(files)) {
      const entry = manifestFiles.get(path)!;
      if (!bridge.writeUpdateFile(manifest.version, path, bytesToBase64(content), entry.sha256)) throw new Error(`Android could not store ${path}`);
    }
    if (!bridge.activateUpdate(manifest.version)) throw new Error("Android could not activate the update");
  } else {
    await postDesktop("/api/update/begin", manifest);
    for (const [path, content] of Object.entries(files)) {
      const entry = manifestFiles.get(path)!;
      await postDesktop("/api/update/file", { version: manifest.version, path, sha256: entry.sha256, content: bytesToBase64(content) });
    }
    await postDesktop("/api/update/activate", { version: manifest.version });
  }
  location.reload();
}

export async function checkForAppUpdate(currentVersion: string): Promise<void> {
  useAppUpdate.setState({ checking: true, error: "" });
  try {
    const activeVersion = await activeAppVersion(currentVersion);
    const candidate = await findAppUpdate(activeVersion);
    useAppUpdate.setState({ activeVersion, candidate, checking: false, checkedAt: Date.now(), error: "" });
  } catch (error) {
    useAppUpdate.setState({ checking: false, checkedAt: Date.now(), error: (error as Error).message });
  }
}

export async function applyAppUpdate(): Promise<void> {
  const candidate = useAppUpdate.getState().candidate;
  if (!candidate) return;
  useAppUpdate.setState({ installing: true, error: "" });
  try {
    await installAppUpdate(candidate, useAppUpdate.getState().activeVersion);
  } catch (error) {
    useAppUpdate.setState({ installing: false, error: (error as Error).message });
  }
}