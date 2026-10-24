# Comik

A web reader for manga, manhwa and webcomics. Local-first, with optional Firebase sync.
Visual language follows the Sutrid site (purple accent, square corners, hard offset shadows, drifting grid, three.js panel stream).

## Run

    npm install
    npm run dev        # web on :5173, proxy on :8787
    npm run build && npm start   # production: proxy serves dist/ on :8787
    npm test

## How it works

Browsers cannot read most comic sites (no CORS, referer-locked images), so something must make the request. The apps do it from the device. The web build uses a proxy in the user's own Firebase project (`functions/`, same code as `server/app.ts`, which blocks private networks). The hosted site never proxies comics itself, because one shared address would be banned by every source. Sources run in the app and parse HTML with DOMParser. See [docs/FIREBASE.md](docs/FIREBASE.md).

- `src/core/sources/` Webtoon (HTML), Madara and MangaThemesia engines, user-defined CSS-selector sources, local CBZ.
- `src/core/chapterRecognition.ts` chapter number parsing; `repo.ts` chapter list reconciliation (keeps read state, follows chapter numbers across re-uploads).
- `src/ui/reader/` paged (LTR/RTL/vertical, optional two-page spreads) and webtoon modes, crop borders, tall-image splitting, colour filters.
- Offline: downloads are stored as blobs in IndexedDB.

## Firebase

Comik's own Firebase project (`comik-7157c`) handles sign-in, library sync and the public Community for everyone. Users can bring their own project instead, which also enables the comic proxy on the web and keeps all their data in their own project, with nothing stored by Comik. The full split, the reasoning and step-by-step instructions are in [docs/FIREBASE.md](docs/FIREBASE.md).

Sync stays private under `users/{uid}`. Community contributions require a non-anonymous sign-in. Deploy the checked-in rules with `firebase deploy --only firestore:rules --project <project id>`. Deployments can override the built-in config at build time with `VITE_FIREBASE_CONFIG`.

Firebase Analytics requires `measurementId` in the selected config and remains disabled unless the reader opts in under Settings. Events contain generic screen names only. Community image uploads use an optional Imgur Client ID; without one, attached images are limited to 50 KB and stored as a data URL in the post document.

## Native Apps

Install dependencies with `npm install` first. Android builds require JDK 17, Gradle 8.9, and Android SDK Platform 35; open `android/` in Android Studio or run `npm run android:debug`. The APK is written to `android/app/build/outputs/apk/debug/`.

For native Google sign-in, register Android package `in.archdev.comik` in Firebase and add the signing certificate SHA-1 under Project settings > Your apps. This debug build uses `35:99:13:DA:33:07:47:A0:66:AB:A7:D4:B7:E2:19:67:B5:AA:BD:E0`; add the release certificate fingerprint too before distributing a signed release. Download the updated `google-services.json` into `android/app/` after registration.

Run `npm run desktop:linux` on Linux for an AppImage. Run `npm run desktop:windows:portable` on Linux for a Windows ZIP, or `npm run desktop:windows` on Windows for an NSIS installer. Artifacts are written to `release/`. There is no CI: apps are built on a developer machine and published with `node scripts/release.mjs --publish`, which uploads them to GitHub Releases (the files are too large for git, which rejects files over 100 MB). The website's releases page reads from there.

Android and desktop wrappers make source and image requests from the reader's device. Browser builds need a proxy: the reader's own Firebase function, or a proxy address set in Settings (`npm start` runs one).

## Known limits

- Sites behind Cloudflare challenges or logins cannot be fetched by the proxy.
