import type { ConnectorRow } from "../db";
import type { Filter, MangasPage, SChapter, SManga, Source, StreamSet } from "../types";
import { ConnectorHost } from "./sandbox";
import { toSChapters, toSManga, toStreamSet, type ConnectorManifest } from "./schema";

const hosts = new Map<string, ConnectorHost>();

/** The running sandbox for an installed connector. Replaced when its code changes. */
export function hostFor(row: ConnectorRow): ConnectorHost {
  const existing = hosts.get(row.id);
  if (existing) return existing;
  const host = new ConnectorHost(row.code, () => row.settings);
  hosts.set(row.id, host);
  return host;
}

export function stopHost(id: string) {
  hosts.get(id)?.dispose();
  hosts.delete(id);
}

/** Make an installed connector look like any other Comik source, so Discover, the shelf and the reader treat it alike. */
export function createConnectorSource(row: ConnectorRow, manifest: ConnectorManifest): Source {
  const host = () => hostFor(row);
  const page = async (method: string, args: unknown[]): Promise<MangasPage> => {
    const raw = (await host().call(method, args)) as { items?: unknown[]; hasNext?: boolean } | null;
    const items = Array.isArray(raw?.items) ? raw!.items : [];
    return { mangas: items.flatMap((item): SManga[] => { try { return [toSManga(item, manifest)]; } catch { return []; } }), hasNext: raw?.hasNext === true };
  };
  const implemented = (method: string) => async (...args: unknown[]) => {
    try { return await page(method, args); }
    catch (error) {
      // A connector without popular() or latest() still works through search.
      if (/does not implement/.test((error as Error).message) && method !== "search") return page("search", ["", args[0] ?? 1, {}]);
      throw error;
    }
  };

  return {
    id: `connector-${row.id}`,
    name: row.name,
    lang: manifest.languages?.[0] || "all",
    baseUrl: manifest.homepage ?? `https://${manifest.domains[0]!.replace(/^\*\./, "")}`,
    blurb: manifest.description ?? `Connector by ${manifest.author ?? "unknown"}`,
    tint: "#2f79c7",
    icon: manifest.icon,
    supportsLatest: true,
    mediaType: "anime",
    directImages: !!manifest.direct,
    isNsfw: manifest.nsfw,
    isConnector: true,
    getPopular: (p) => implemented("popular")(p),
    getLatest: (p) => implemented("latest")(p),
    search: (p, query) => page("search", [query.trim(), p, {}]),
    getFilterList: (): Filter[] => [],
    async getMangaDetails(manga) {
      const raw = await host().call("details", [manga.url]);
      return { ...manga, ...toSManga(raw, manifest), url: manga.url };
    },
    async getChapterList(manga): Promise<SChapter[]> {
      return toSChapters(await host().call("episodes", [manga.url]), manifest);
    },
    async getPageList() { return []; },
    async getStreams(chapter, manga): Promise<StreamSet> {
      return toStreamSet(await host().call("streams", [chapter.url, { titleId: manga.url, number: chapter.number, season: chapter.season }]), manifest);
    },
  };
}
