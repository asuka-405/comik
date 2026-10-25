/**
 * The connector contract: what a connector declares (its manifest), what it returns, and the rules Comik
 * applies to both before anything reaches the app. Pure functions only, so it runs in tests and in the app.
 *
 * Connectors are for sites whose operators have given you permission. Comik does not review them and ships
 * none that point at third-party sites.
 */
import type { MangaStatus, SChapter, SManga, StreamSet, StreamSource, SubtitleTrack } from "../types";

export const CONNECTOR_API = 1;

export interface ConnectorSetting {
  key: string;
  label: string;
  /** Hide the value as it is typed, like a key. */
  secret?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface ConnectorManifest {
  /** Unique, lower case letters, digits and dashes. */
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  author?: string;
  homepage?: string;
  /** A square logo for the connector: an https address on an allowed host, or a small inline png, jpeg, webp or svg image. */
  icon?: string;
  /** Every host the connector may contact, for data and for video. "*.example.com" covers subdomains. */
  domains: string[];
  languages?: string[];
  /** Hidden by Safe mode. */
  nsfw?: boolean;
  /** Use the browser's own requests instead of Comik's proxy. The site must allow it with CORS headers. */
  direct?: boolean;
  settings?: ConnectorSetting[];
}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const list = (value: unknown, max: number, each = 120): string[] => (Array.isArray(value) ? value.map((item) => text(item, each)).filter((item): item is string => !!item).slice(0, max) : []);
/** A number, or a string that is plainly one ("12", "8.5"), which many sites send. */
const finite = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
};
/** An id: text, or a number turned into text, which is what most JSON APIs use. */
const idText = (value: unknown): string | undefined => (typeof value === "number" && Number.isFinite(value) ? String(value) : text(value, 300));

/** Check what a connector says about itself. Throws a message the person can act on. */
export function parseManifest(raw: unknown): ConnectorManifest {
  if (!raw || typeof raw !== "object") throw new Error("The connector has no manifest. Export an object with a `manifest` field.");
  const m = raw as Record<string, unknown>;
  const id = text(m.id, 41) ?? "";
  if (!ID.test(id)) throw new Error("manifest.id must be 2 to 41 lower-case letters, digits or dashes.");
  const name = text(m.name, 60);
  if (!name) throw new Error("manifest.name is required.");
  const version = text(m.version, 40) ?? "";
  if (!VERSION.test(version)) throw new Error("manifest.version must look like 1.0.0.");
  if (m.apiVersion !== CONNECTOR_API) throw new Error(`manifest.apiVersion must be ${CONNECTOR_API}. This Comik speaks connector API ${CONNECTOR_API}.`);
  const domains = list(m.domains, 12, 100).map((domain) => domain.toLowerCase());
  if (!domains.length) throw new Error("manifest.domains must list every host the connector contacts.");
  for (const domain of domains) if (!DOMAIN.test(domain)) throw new Error(`"${domain}" is not an allowed domain. Use a host like api.example.com or *.example.com.`);
  const settings = Array.isArray(m.settings) ? m.settings.slice(0, 8).map((entry): ConnectorSetting => {
    const s = (entry ?? {}) as Record<string, unknown>;
    const key = text(s.key, 40) ?? "";
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) throw new Error("Each setting needs a key made of letters, digits and underscores.");
    return { key, label: text(s.label, 60) ?? key, secret: s.secret === true, placeholder: text(s.placeholder, 80), required: s.required === true };
  }) : [];
  const homepage = text(m.homepage, 200);
  return {
    id, name, version, apiVersion: CONNECTOR_API,
    description: text(m.description, 400),
    author: text(m.author, 80),
    homepage: homepage && /^https:\/\//i.test(homepage) ? homepage : undefined,
    icon: image(m.icon, domains),
    domains: [...new Set(domains)],
    languages: list(m.languages, 6, 12),
    nsfw: m.nsfw === true,
    direct: m.direct === true,
    settings,
  };
}

/** Is `host` one the manifest allows? Exact match, or a subdomain of a "*." entry. */
export function hostAllowed(host: string, domains: string[]): boolean {
  const name = host.toLowerCase();
  return domains.some((entry) => (entry.startsWith("*.") ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1 : name === entry));
}

/** An address a connector may use for a request or a video: https, a plain hostname on the allowlist, no credentials. */
export function checkUrl(raw: unknown, domains: string[]): URL {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error(`"${String(raw).slice(0, 80)}" is not a valid address.`); }
  if (url.protocol !== "https:") throw new Error("Connectors may only use https addresses.");
  if (url.username || url.password) throw new Error("Addresses with a user name or password are not allowed.");
  if (!hostAllowed(url.hostname, domains)) throw new Error(`${url.hostname} is not in this connector's domains. Add it to manifest.domains if the operator permits it.`);
  return url;
}

/* ---------------------------------------------------------------- results */

/** What a connector returns for a title in a list or on its page. Everything except `id` and `title` is optional. */
export interface ConnectorTitle {
  id: string;
  title: string;
  cover?: string;
  banner?: string;
  description?: string;
  altTitles?: string[];
  year?: number;
  status?: string;
  tags?: string[];
  studios?: string[];
  rating?: number;
  contentRating?: string;
  trailerUrl?: string;
  episodeCount?: number;
}

export interface ConnectorEpisode {
  id: string;
  number: number;
  season?: number;
  seasonTitle?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  /** ISO date string or epoch milliseconds. */
  airDate?: string | number;
  /** Seconds. */
  duration?: number;
  filler?: boolean;
}

const IMAGE_DATA = /^data:image\/(png|jpeg|webp|svg\+xml);/i;

/** Pictures: an https address on an allowed host, or a small inline image. Anything else is dropped. */
function image(value: unknown, domains: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  if (IMAGE_DATA.test(value)) return value.length <= 40_000 ? value : undefined;
  try { return checkUrl(value, domains).toString(); } catch { return undefined; }
}

/** Why a picture would be dropped, in words the author can act on. Null when it is fine or absent. */
export function imageProblem(value: unknown, domains: string[]): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "it must be a string, an https address or a data: image";
  if (IMAGE_DATA.test(value)) return value.length <= 40_000 ? null : `the inline image is ${Math.round(value.length / 1000)} KB and the limit is 40 KB`;
  if (/^data:/i.test(value)) return "inline images must be png, jpeg, webp or svg";
  try { checkUrl(value, domains); return null; } catch (error) { return (error as Error).message; }
}

const STATUS: Record<string, MangaStatus> = { ongoing: "ongoing", airing: "ongoing", releasing: "ongoing", completed: "completed", finished: "completed", ended: "completed", hiatus: "hiatus", cancelled: "cancelled", canceled: "cancelled" };

export function toSManga(raw: unknown, manifest: ConnectorManifest): SManga {
  const t = (raw ?? {}) as Record<string, unknown>;
  const id = idText(t.id);
  const title = text(t.title, 200);
  if (!id || !title) throw new Error("A title needs an id and a title.");
  const rating = finite(t.rating);
  const year = finite(t.year);
  const count = finite(t.episodeCount);
  const trailer = text(t.trailerUrl, 500);
  let trailerUrl: string | undefined;
  if (trailer) try { trailerUrl = checkUrl(trailer, ["*.youtube.com", "youtu.be", ...manifest.domains]).toString(); } catch { trailerUrl = undefined; }
  return {
    url: id,
    title,
    kind: "anime",
    cover: image(t.cover, manifest.domains),
    banner: image(t.banner, manifest.domains),
    description: text(t.description, 4000),
    aliases: list(t.altTitles, 10, 200),
    genres: list(t.tags, 24, 40),
    studios: list(t.studios, 8, 80),
    status: STATUS[String(t.status ?? "").toLowerCase()] ?? "unknown",
    year: year !== undefined && year >= 1900 && year <= 2200 ? Math.round(year) : undefined,
    rating: rating !== undefined && rating >= 0 && rating <= 10 ? Math.round(rating * 10) / 10 : undefined,
    contentRating: text(t.contentRating, 20),
    trailerUrl,
    episodeCount: count !== undefined && count >= 0 && count <= 5000 ? Math.floor(count) : undefined,
  };
}

const toMs = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
  return 0;
};

/**
 * Episodes in the order the person reads them. Seasons often restart at 1, but Comik tracks each episode by one
 * running number, so season 2 episode 1 follows the last episode of season 1 and the original numbers stay in the name.
 */
export function toSChapters(raw: unknown, manifest: ConnectorManifest): SChapter[] {
  if (!Array.isArray(raw)) throw new Error("episodes() must return a list.");
  const episodes = raw.slice(0, 5000).flatMap((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const id = idText(e.id);
    const number = finite(e.number);
    return id && number !== undefined ? [{ e, id, number, season: finite(e.season) }] : [];
  });
  episodes.sort((a, b) => (a.season ?? 1) - (b.season ?? 1) || a.number - b.number);
  const offsets = new Map<number, number>();
  let running = 0;
  for (const season of [...new Set(episodes.map((ep) => ep.season ?? 1))]) {
    const inSeason = episodes.filter((ep) => (ep.season ?? 1) === season);
    const restarts = season !== (episodes[0]?.season ?? 1) && Math.min(...inSeason.map((ep) => ep.number)) <= running;
    offsets.set(season, restarts ? running : 0);
    running = Math.max(running, ...inSeason.map((ep) => ep.number + (restarts ? running : 0)));
  }
  const multiSeason = offsets.size > 1;
  const out = episodes.map(({ e, id, number, season }): SChapter => {
    const s = season ?? 1;
    const title = text(e.title, 200);
    const label = multiSeason ? `S${s} E${number}` : `Episode ${number}`;
    const duration = finite(e.duration);
    return {
      url: id,
      name: title ? `${label}: ${title}` : label,
      number: number + (offsets.get(s) ?? 0),
      season: season,
      seasonTitle: text(e.seasonTitle, 80),
      dateUpload: toMs(e.airDate),
      description: text(e.description, 2000),
      thumbnail: image(e.thumbnail, manifest.domains),
      duration: duration !== undefined && duration > 0 && duration < 86_400 ? Math.round(duration) : undefined,
      filler: e.filler === true ? true : undefined,
    };
  });
  // Newest first, like every other source.
  return out.reverse();
}

const STREAM_TYPES = new Set(["hls", "mp4", "webm"]);

/** Stream URLs must be https on an allowed host. A set with nothing playable is an error, not an empty player. */
export function toStreamSet(raw: unknown, manifest: ConnectorManifest): StreamSet {
  const r = (raw ?? {}) as Record<string, unknown>;
  const streams: StreamSource[] = [];
  for (const entry of Array.isArray(r.streams) ? r.streams.slice(0, 12) : []) {
    const s = (entry ?? {}) as Record<string, unknown>;
    try {
      const url = checkUrl(s.url, manifest.domains).toString();
      const type = STREAM_TYPES.has(String(s.type)) ? (s.type as StreamSource["type"]) : /\.m3u8(\?|$)/i.test(url) ? "hls" : /\.webm(\?|$)/i.test(url) ? "webm" : "mp4";
      const headers: Record<string, string> = {};
      if (s.headers && typeof s.headers === "object") for (const [k, v] of Object.entries(s.headers as Record<string, unknown>).slice(0, 6)) if (/^[A-Za-z-]{1,40}$/.test(k) && typeof v === "string" && v.length < 500 && !/^(host|cookie|content-length)$/i.test(k)) headers[k] = v;
      streams.push({ url, type, label: text(s.label, 24), proxy: s.proxy === true && type === "hls" ? true : undefined, headers: Object.keys(headers).length ? headers : undefined });
    } catch { /* dropped: not https or not on the allowlist */ }
  }
  if (!streams.length) throw new Error("This episode has no playable stream on the connector's allowed domains.");
  const subtitles: SubtitleTrack[] = [];
  for (const entry of Array.isArray(r.subtitles) ? r.subtitles.slice(0, 24) : []) {
    const s = (entry ?? {}) as Record<string, unknown>;
    try {
      const url = checkUrl(s.url, manifest.domains).toString();
      subtitles.push({ url, label: text(s.label, 40) ?? text(s.lang, 12) ?? "Subtitles", lang: (text(s.lang, 12) ?? "und").toLowerCase(), format: s.format === "srt" || /\.srt(\?|$)/i.test(url) ? "srt" : "vtt", default: s.default === true });
    } catch { /* dropped */ }
  }
  const skips = (Array.isArray(r.skips) ? r.skips.slice(0, 8) : []).flatMap((entry) => {
    const s = (entry ?? {}) as Record<string, unknown>;
    const start = finite(s.start), end = finite(s.end);
    const kind = String(s.kind);
    return start !== undefined && end !== undefined && end > start && start >= 0 && (kind === "intro" || kind === "outro" || kind === "recap") ? [{ kind: kind as "intro" | "outro" | "recap", start, end }] : [];
  });
  return { streams, subtitles, skips };
}
