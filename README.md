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

Settings > Sync lets a reader use the app server's Firebase project or bring their own. The app-server project has a built-in Firebase web config; deployments can override it at build time with `VITE_FIREBASE_CONFIG`. Readers can also select Own Firebase and enter their own project config.

Enable Google sign-in and Anonymous auth in Firebase Authentication, create Firestore, then apply the rules shown in Settings. Sync stays private under `users/{uid}`. Community posts, comments, ratings, and polls are shared only inside the selected Firebase project; community contributions require a non-anonymous sign-in. Each Firebase project uses its own named client app and user session.

This repository targets Firebase project ID `comik-7157c` via `.firebaserc`. Deploy the checked-in rules with `firebase deploy --only firestore:rules`. Google sign-in provider setup and OAuth consent/client IDs still need to be enabled in Firebase Console for the hosted project.

Firebase Analytics requires `measurementId` in the selected config and remains disabled unless the reader opts in under Settings. Events contain generic screen names only. Community image uploads use an optional Imgur Client ID; without one, attached images are limited to 50 KB and stored as a data URL in the post document.

## Known limits

- Sites behind Cloudflare challenges or logins cannot be fetched by the proxy.
- Some MangaDex titles only link out to publishers and have no readable chapters.
