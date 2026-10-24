export interface CatalogEntry {
  id: string;
  name: string;
  baseUrl: string;
  engine: "madara" | "themesia" | "heuristic" | "heancms" | "keyoapp";
  /** Madara: series path segment. Themesia: list path. Heuristic: unused. */
  path: string;
  /** Heuristic engine only. Templates take {page} and {query}. */
  listUrl?: string;
  searchUrl?: string;
  paged?: boolean;
  /** HeanCMS only: the JSON API address when it is not `api.` plus the site host. */
  apiUrl?: string;
  /** The extension is flagged 18+, so Safe mode hides it. */
  nsfw?: boolean;
}
