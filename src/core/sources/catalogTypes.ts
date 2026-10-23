export interface CatalogEntry {
  id: string;
  name: string;
  baseUrl: string;
  engine: "madara" | "themesia" | "heuristic";
  /** Madara: series path segment. Themesia: list path. Heuristic: unused. */
  path: string;
  /** Heuristic engine only. Templates take {page} and {query}. */
  listUrl?: string;
  searchUrl?: string;
  paged?: boolean;
}
