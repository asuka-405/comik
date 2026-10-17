export const REPO = "asuka-405/comik";
export const REPO_URL = `https://github.com/${REPO}`;

export type Platform = "android" | "linux" | "windows";

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
  sha256?: string;
  downloads: number;
}

export interface Release {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  prerelease: boolean;
  url: string;
  assets: ReleaseAsset[];
}

export interface PlatformInfo {
  platform: Platform;
  title: string;
  detail: string;
  /** Stable asset name, so `releases/latest/download/<name>` always resolves. */
  assetName: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { platform: "android", title: "Android", detail: "APK for Android 6 and newer", assetName: "Comik-android.apk" },
  { platform: "linux", title: "Linux", detail: "AppImage for x64", assetName: "Comik-linux-x64.AppImage" },
  { platform: "windows", title: "Windows", detail: "Portable x64 build in a zip", assetName: "Comik-windows-x64.zip" },
];

/** Which platform an uploaded file is for, or undefined for checksums and other extras. */
export function classifyAsset(name: string): Platform | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".apk")) return "android";
  if (lower.endsWith(".appimage")) return "linux";
  if (lower.endsWith(".exe") || (lower.endsWith(".zip") && /win/.test(lower))) return "windows";
  return undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The first asset for each platform, in the order the page lists them. */
export function downloadsFor(release: Release | undefined): { info: PlatformInfo; asset?: ReleaseAsset }[] {
  return PLATFORMS.map((info) => ({
    info,
    asset: release?.assets.find((asset) => classifyAsset(asset.name) === info.platform),
  }));
}

export function fallbackUrl(info: PlatformInfo): string {
  return `${REPO_URL}/releases/latest/download/${info.assetName}`;
}

interface ApiAsset {
  name: string;
  size: number;
  browser_download_url: string;
  download_count: number;
  digest?: string | null;
}

interface ApiRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  created_at: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: ApiAsset[];
}

export function parseReleases(raw: unknown): Release[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ApiRelease[])
    .filter((r) => r && !r.draft && typeof r.tag_name === "string")
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      body: r.body ?? "",
      publishedAt: r.published_at ?? r.created_at,
      prerelease: r.prerelease,
      url: r.html_url,
      assets: (r.assets ?? []).map((a) => ({
        name: a.name,
        size: a.size,
        url: a.browser_download_url,
        downloads: a.download_count,
        sha256: a.digest?.startsWith("sha256:") ? a.digest.slice(7) : undefined,
      })),
    }));
}

const CACHE_KEY = "comik.releases.v1";
const CACHE_MS = 10 * 60 * 1000;

/** Releases come straight from GitHub, so publishing a release updates the page with no redeploy. */
export async function fetchReleases(signal?: AbortSignal): Promise<Release[]> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as { at: number; releases: Release[] } | null;
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.releases;
  } catch {
    // Storage can be unavailable; fetch instead.
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { accept: "application/vnd.github+json" },
    signal,
  });
  if (!res.ok) throw new Error(res.status === 403 ? "GitHub rate limit reached. Try again in a few minutes." : `GitHub returned ${res.status}`);
  const releases = parseReleases(await res.json());
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), releases }));
  } catch {
    // Not cached; harmless.
  }
  return releases;
}
