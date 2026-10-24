import { unzipSync } from "fflate";
import { create } from "zustand";

const REPO = "asuka-405/comik";
const MANIFEST_ASSET = "Comik-app-update.json";
const ARCHIVE_ASSET = "Comik-app-update.zip";

interface ApiAsset { name: string; browser_download_url: string; digest?: string | null }
interface ApiRelease { tag_name: string; prerelease: boolean; draft: boolean; assets: ApiAsset[] }
export interface UpdateFile { path: string; size: number; sha256: string }
export interface UpdateManifest { schema: 1; version: string; archiveSha256: string; files: UpdateFile[] }
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
  beginUpdate(manifestJson: string): boolean;
  writeUpdateFile(version: string, path: string, contentBase64: string, sha256: string): boolean;
  activateUpdate(version: string): boolean;
  confirmUpdate(): boolean;
}

declare global {
  interface Window { ComikAndroidUpdates?: AndroidUpdateBridge }
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

export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
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
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
    headers: { accept: "application/vnd.github+json" }, cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 403 ? "GitHub update check is rate limited" : `Update check failed (${response.status})`);
  const releases = await response.json() as ApiRelease[];
  const channel = currentVersion.match(/-(alpha|beta|rc)(\.|$)/i)?.[1]?.toLowerCase() ?? "stable";
  const candidates = releases.filter((release) => !release.draft && (channel === "stable" ? !release.prerelease : release.prerelease))
    .map((release) => ({ release, version: releaseVersion(release.tag_name) }))
    .filter(({ version }) => (version.match(/-(alpha|beta|rc)(\.|$)/i)?.[1]?.toLowerCase() ?? "stable") === channel && compareAppVersions(version, currentVersion) > 0)
    .sort((a, b) => compareAppVersions(b.version, a.version));
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

export async function installAppUpdate(candidate: UpdateCandidate): Promise<void> {
  const [manifestResponse, archiveResponse] = await Promise.all([fetch(candidate.manifestUrl, { cache: "no-store" }), fetch(candidate.archiveUrl, { cache: "no-store" })]);
  if (!manifestResponse.ok || !archiveResponse.ok) throw new Error("Could not download the update files");
  if (!candidate.manifestDigest || !/^[a-f0-9]{64}$/i.test(candidate.manifestDigest)) throw new Error("The release does not include a trusted manifest digest");
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  if (manifestBytes.length > 2 * 1024 * 1024) throw new Error("The update manifest is too large");
  if (await sha256Hex(manifestBytes) !== candidate.manifestDigest) throw new Error("The update manifest failed integrity verification");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as UpdateManifest;
  if (!validateUpdateManifest(manifest, candidate.version)) {
    throw new Error("The update manifest is invalid");
  }
  const archiveBytes = new Uint8Array(await archiveResponse.arrayBuffer());
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
    await installAppUpdate(candidate);
  } catch (error) {
    useAppUpdate.setState({ installing: false, error: (error as Error).message });
  }
}