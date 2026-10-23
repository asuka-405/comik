# Comik

A web reader for manga, manhwa and webcomics. Local-first, with optional Firebase sync.
Visual language follows the Sutrid site (purple accent, square corners, hard offset shadows, drifting grid, three.js panel stream).

## Run

    npm install
    npm run dev        # web on :5173, proxy on :8787
    npm run build && npm start   # production: proxy serves dist/ on :8787
    npm test

## How it works

Browsers cannot read most comic sites (no CORS, referer-locked images). `server/index.ts` is a small proxy
(`/api/fetch`, `/api/img`) that blocks private networks. Sources run in the browser and parse HTML with DOMParser.

- `src/core/sources/` MangaDex (JSON API), Webtoon (HTML), Madara and MangaThemesia engines, user-defined CSS-selector sources, local CBZ.
- `src/core/chapterRecognition.ts` chapter number parsing; `repo.ts` chapter list reconciliation (keeps read state, follows chapter numbers across re-uploads).
- `src/ui/reader/` paged (LTR/RTL/vertical, optional two-page spreads) and webtoon modes, crop borders, tall-image splitting, colour filters.
- Offline: downloads are stored as blobs in IndexedDB.

## Sync (optional)

Settings > Sync: paste a Firebase web config, enable Anonymous auth and Firestore, apply the rules shown in the app.
Last-write-wins per series. Link Google to reach the same data from other devices. Without it everything stays in localStorage/IndexedDB.

## Known limits

- Sites behind Cloudflare challenges or logins cannot be fetched by the proxy.
- Some MangaDex titles only link out to publishers and have no readable chapters.
