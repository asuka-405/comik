# Handover

Updated: 2026-10-23 (catalogue, floating back, MangaDex fixes)

## Current Work

Comik has a dedicated Source Studio at `/source-studio`, linked from Settings > Sources and proxy. The studio is intended for sources the user owns or is authorized to access; it does not disguise requests or bypass site protections.

The studio currently provides:
- Config fields for site domain, source name, language, URL templates, page type, and CSS selector mappings.
- A sanitized page preview that retains linked stylesheets and routes images through Comik's proxy. Scripts, forms, frames, and page navigation are disabled.
- A searchable HTML tree. Hovering an element in the preview highlights its matching tree row, expands ancestors, and scrolls only the tree container.
- Saving into the existing selector-source registry after permission confirmation.
- A floating back button, viewport-bounded layout, compact copy, and responsive mobile pane tabs. The tree is positioned below the preview.

The series page renders chapters in pages of 50. This is render pagination only: all chapter rows are still read from IndexedDB for sorting, progress, filtering, and bulk actions.

## Changed Files

- `src/ui/components/SourceStudio.tsx`
- `src/ui/pages/Settings.tsx`
- `src/ui/App.tsx`
- `src/ui/pages/Series.tsx`
- `src/styles.css`

`HANDOVER.md` is new.

## Validation

- Editor diagnostics reported no errors in the changed TypeScript files.
- `git diff --check` passed.
- `npm run typecheck`, app launch, and browser verification were not run: `node` and `npm` are unavailable in the current terminal environment.

## MangaDex (investigated 2026-10-23)

List, search, details, chapter feed, at-home and page images all return valid data through the local proxy (checked with curl against `/api/fetch` and `/api/img`), so the proxy path is fine. Problems found and fixed in the app:
- The catalogue reloaded from page 1 when MangaDex tags finished loading (filter list identity changed), so the grid flickered and reset. `SourceView` now reloads only when the user changes filters.
- Titles whose English chapters are only links to the publisher (e.g. Solo Leveling) showed an empty list. `getChapterList` now throws an explanatory error naming the host.
- Several scanlation groups upload the same chapter, which inflated unread counts and "next chapter". `dedupeByNumber` in `core/progress.ts` is used by the series page (a chip reveals duplicates), stats, resume and the reader.

If a specific MangaDex failure persists, get the exact in-app error and check `HOST_ALLOWLIST` includes `api.mangadex.org`, `uploads.mangadex.org`, `mangadex.network`.

## Source catalogue (new)

100 English sources by default: MangaDex, Webtoon, Webtoon Canvas, plus 97 sites from the Mihon/keiyoushi extension index in `src/core/sources/catalog.json`.
- The index only has names and URLs, not scraping code. `scripts/build-catalog.ts` probes each non-adult English (and "all") site, maps it to an engine (Madara, MangaThemesia, or the structure-based `heuristic` engine in `heuristics.ts` / `heuristic.ts`) and keeps it only if the listing parses (heuristic sites also need chapters and 2+ reader images).
- Regenerate: `npx tsx scripts/build-catalog.ts --refresh`. Retry passes: `KEEP=1 GET_MS=25000 MIN_SERIES=4 MIN_PAGES=2 npx tsx scripts/build-catalog.ts`. `LANGS=en,all` picks languages.
- Excluded: adult-flagged extensions, Cloudflare-challenged sites (about 39), unreachable ones (about 58), bespoke sites with no shared structure. Some included sources still show mature covers even though the extension is not flagged adult.
- Sites change often. Re-run the script when sources start failing. Verification is at build time only, there is no runtime health check yet.
- Madara engine now lists via the GET archive (`/<sub>/?m_orderby=views`), the same URL the build verifies, not admin-ajax.

## UI

- Back buttons float (`FloatBack` in `ui/common.tsx`, `.float-back`) on Series and source catalogue pages instead of using a header row. Source Studio keeps its own floating bar.
- Discover has a source filter and a denser grid; global search is throttled to 4 sources at a time.

## Known issue: reader scroll stalls automated Chrome

In the webtoon reader, after the first screen the browser-automation tab stopped answering screenshots (rAF about 1-2 fps, even with the reader hidden). JS stayed healthy (0 ms timer latency, no DB or request loop). Not reproduced by hand. Try it in a normal browser; if it stalls there, test removing `.hud` gradients and the per-image `filter` var first.

## Suggested Next Steps

1. Typecheck, tests (9) and build pass as of this update. Start with `npm run dev`.
2. Check Source Studio at desktop and mobile widths: confirm the floating back button stays compact, the page does not overflow, and the tree scroll stays inside its own pane.
3. Test a permitted sample page with linked stylesheets and images; confirm selector hover and click mapping.
4. Spot-check more catalogue sources (reading, not just listing) and consider a runtime health flag for sources that stop working.
5. If improving chapter performance further, add indexed/count-first database paging while preserving the series page's read-state, sort, filters, and bulk actions.
