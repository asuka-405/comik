/** DOM-free pieces shared by the runtime engines and the catalogue build script. */

export const MADARA_CARD = "div.page-item-detail, div.c-tabs-item__content";
export const MADARA_TITLE = "h3 a, h5 a, .post-title a";
export const THEMESIA_CARD = ".listupd .bs .bsx, .listupd .utao .uta";

export type EngineKind = "madara" | "themesia";

/** Fingerprint a site's homepage HTML. Returns null when it is neither theme. */
export function detectEngine(html: string): EngineKind | null {
  if (/wp-content\/themes\/madara|wp-manga|madara-core|class="[^"]*\bmadara\b/i.test(html)) return "madara";
  if (/ts_reader|themesia|mangareader|class="listupd"|class='listupd'|wp-content\/themes\/(mangastream|flavor|flavour)/i.test(html)) return "themesia";
  return null;
}

export const MADARA_SUBS = ["manga", "series", "webtoon", "comic", "manhwa", "manhua", "read", "title", "comics", "project"];
export const THEMESIA_PATHS = ["manga", "series", "comics", "list", "comic", "manhwa"];
