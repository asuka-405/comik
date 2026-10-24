# Handover

Updated: 2026-10-24 (global search, source ordering, MangaDex removal)

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

## Source catalogue (new)

99 English sources by default: Webtoon, Webtoon Canvas, plus 97 sites from the Mihon/keiyoushi extension index in `src/core/sources/catalog.json`.
- The index only has names and URLs, not scraping code. `scripts/build-catalog.ts` probes each non-adult English (and "all") site, maps it to an engine (Madara, MangaThemesia, or the structure-based `heuristic` engine in `heuristics.ts` / `heuristic.ts`) and keeps it only if the listing parses (heuristic sites also need chapters and 2+ reader images).
- Regenerate: `npx tsx scripts/build-catalog.ts --refresh`. Retry passes: `KEEP=1 GET_MS=25000 MIN_SERIES=4 MIN_PAGES=2 npx tsx scripts/build-catalog.ts`. `LANGS=en,all` picks languages.
- Excluded: adult-flagged extensions, Cloudflare-challenged sites (about 39), unreachable ones (about 58), bespoke sites with no shared structure. Some included sources still show mature covers even though the extension is not flagged adult.
- Sites change often. Re-run the script when sources start failing. Verification is at build time only, there is no runtime health check yet.
- Madara engine now lists via the GET archive (`/<sub>/?m_orderby=views`), the same URL the build verifies, not admin-ajax.

## UI

- Back buttons float (`FloatBack` in `ui/common.tsx`, `.float-back`) on Series and source catalogue pages instead of using a header row. Source Studio keeps its own floating bar.
- Discover lists sources alphabetically. Global search starts source requests near the viewport, limits concurrency to four, and displays a per-source loading indicator with at most 12 results.
- Generic source requests still use the proxy: browser CORS restrictions and referer-locked sites prevent reliable device-only scraping for most catalog sources. Global search avoids loading every source at once to reduce proxy traffic.

## Known issue: reader scroll stalls automated Chrome

In the webtoon reader, after the first screen the browser-automation tab stopped answering screenshots (rAF about 1-2 fps, even with the reader hidden). JS stayed healthy (0 ms timer latency, no DB or request loop). Not reproduced by hand. Try it in a normal browser; if it stalls there, test removing `.hud` gradients and the per-image `filter` var first.

## Suggested Next Steps

1. Typecheck, tests (9) and build pass as of this update. Start with `npm run dev`.
2. Check Source Studio at desktop and mobile widths: confirm the floating back button stays compact, the page does not overflow, and the tree scroll stays inside its own pane.
3. Test a permitted sample page with linked stylesheets and images; confirm selector hover and click mapping.
4. Spot-check more catalogue sources (reading, not just listing) and consider a runtime health flag for sources that stop working.
5. If improving chapter performance further, add indexed/count-first database paging while preserving the series page's read-state, sort, filters, and bulk actions.

## Continuation: Safe Mode, Community, and Web

### Implemented

- Safe mode is persisted in `src/core/settings.ts`, enabled by default, and filters adult-marked sources from Discover/global search, the shelf, timeline, series, reader, and community comic posts.
- Community operations now carry the selected `CommunityTarget` through post creation, comments, likes, polls, ratings, and subscriptions. Private-room compose and share links preserve the selected room and post.
- Community links use BrowserRouter paths on web and HashRouter paths on Android. The Account settings link now uses React Router.
- `src/ui/App.tsx` runs hooks consistently before the Firebase onboarding return.
- `src/ui/pages/WebSetup.tsx` imports `src/landing.css`; document-level landing styles are scoped so they do not override reader theme colors.
- Vite now falls back to `web/index.html` for `/web` deep links in development. Netlify already has the production `/web/*` rewrite.

### Verification

- `npm run build` passed. Vite still reports the existing large-chunk and Firebase dynamic-import warnings.
- `npm test` passed: 9 tests.
- `git diff --check` and editor diagnostics passed for the touched files.
- Live browser checks confirmed `/web/community` deep links, settings/onboarding navigation, default-on Safe mode, and loaded setup-page styles. No screenshots were taken.
- Firebase sign-in and live posting were not verified against an authenticated project.

### Local Environment / Next Checks

- At last check, the user's Vite page was on `localhost:5173`; port `8787` was already occupied by another proxy process. Avoid stopping those existing processes. A temporary Vite server started on `5174` for verification was stopped.
- Continue with end-to-end public and private community sign-in/posting tests when Firebase credentials and project rules are available. Preserve the existing uncommitted worktree changes.

## Continuation: native shells

- Native builds (`COMIK_NATIVE_BUILD=1`, used by Android and desktop) now route with `HashRouter` and skip the service worker. Both shells serve static files with no SPA fallback, so deep links under BrowserRouter used to 404 on desktop. `src/core/platform.ts` exports `isNativeShell` and `appLink()`, which replace the old `appassets.androidplatform.net` hostname checks for invite and share links.
- Desktop (`desktop/main.cjs`): single-instance lock, falls back to a random port if 41739 is taken (the fixed port keeps the IndexedDB origin stable), loads `/web/index.html`. Verified by launching the unpacked Linux build: shelf renders, `/api/fetch` works, a second launch exits.
- Android (`MainActivity.java`): redirects are followed manually because `HttpURLConnection` refuses http-to-https hops, the `Accept` header is forwarded, and a launcher icon was added. WebView does not expose request bodies to `shouldInterceptRequest`, so POSTs (Madara `ajax/chapters/`) still go out empty. No device or emulator was available, so only `assembleDebug` was verified.
- Build locally with the toolchain in `~/.local/opt/comik` (`jdk17`, `gradle-8.9`), `ANDROID_HOME=~/Android/Sdk` and `android/local.properties` (git-ignored). Artifacts: `release/Comik-0.1.0.AppImage`, `release/Comik-0.1.0-win-x64.zip`, `android/app/build/outputs/apk/debug/app-debug.apk`. The Windows build was not run on Windows.
- Desktop builds still use Electron's default icon.

## Continuation: releases page

- `/releases/` is a new Vite entry (`releases/index.html`, `src/releases.tsx`, `src/releases.css`). It lists features, install steps, direct downloads with size and SHA-256, the latest release notes, and every older release.
- Data comes from the public GitHub API (`src/core/releases.ts`, cached for 10 minutes in sessionStorage). Publishing a GitHub release updates the page with no redeploy. If the API fails, download buttons fall back to `releases/latest/download/<stable name>`. Release notes render through `src/core/markdown.ts`, which parses to data and never injects HTML.
- Stable asset names: `Comik-android.apk`, `Comik-linux-x64.AppImage`, `Comik-windows-x64.zip`, plus `SHA256SUMS.txt`. The landing page links use the same names.
- Release flow: add a `## <version>` section to `CHANGELOG.md` (it becomes the notes), build the three apps, then `node scripts/release.mjs` (dry run, stages `release/upload/`) or `--publish` (runs `gh release create`). There is no GitHub Actions workflow any more: builds are made locally and uploaded with `gh release create` (binaries are over git's 100 MB limit, so they live in Releases, not in the repo).
- Published: tag `v0.1.0-alpha`, release "Comik 0.1 alpha" (not flagged pre-release, because GitHub's `releases/latest/download` links only resolve for non-pre-releases). Version is `0.1.0-alpha` in `package.json`, `desktop/package.json` and the Android `versionName`.
- The website deploys from `master` through Netlify (config in `netlify.toml`). The deploy was not observed from here, so confirm `/releases/` is live after the push.

## Continuation: 0.2 beta (Firebase split, settings, Android insets)

- **Firebase split.** `readFirebaseConfig()` now returns the user's own project, or the built-in Comik project (`comik-7157c`), so sign-in and library sync work for everyone. `readCustomFirebaseConfig()` is the user's project or null; private Community rooms use only that. In default mode `loadFirebase()` reuses the public Community app, so sync and Community share one signed-in user (`publishUser()` keeps both stores current).
- **Comic fetching never uses the Comik project.** `proxyBase()` in `src/core/http.ts` returns: the Settings proxy address if set; `/api` in native shells and the dev server; otherwise the user's `comikProxy` Cloud Function; otherwise `""`, and `request()` throws `ProxyUnavailableError`. The web build shows `ReadingNotice` where reading is unavailable. Function requests carry an ID token (`Authorization` header, or `?t=` on image URLs); `App.tsx` refreshes the cached token.
- **Proxy function.** `server/app.ts` is the Hono proxy with no listener (`server/index.ts` starts it for `npm start`). `functions/src/index.ts` wraps it, verifies the Firebase ID token and optionally `ALLOWED_EMAILS`. `scripts/build-functions.mjs` bundles it into `functions/index.js` (git-ignored); `firebase.json` runs it as a predeploy step. Requires the Blaze plan. Tested locally against stubbed token verification (401, 403, health, preflight, SSRF block); not deployed to a real project.
- **Netlify function removed.** The old `/api` function would have proxied from Netlify's shared address. `netlify.toml` no longer routes `/api`.
- **Docs.** `docs/FIREBASE.md` and the in-app guide at `/web/setup` (`WebSetup.tsx`) describe who uses which Firebase, why, and how to bring your own. The deploy command always passes `--project`, because `.firebaserc` defaults to the Comik project.
- **Settings** are now a category list opening sub-pages (`SettingsLayout`, nested routes under `/settings/*`), side by side on wide screens. `/settings/sources` (enable/disable sources) stays a separate page.
- **Android.** `MainActivity` wraps the WebView in a `FrameLayout` and pads that for system bars and the keyboard, because WebView ignores its own padding and the top bar slid under the status bar. Not run on a device or emulator.
- **Before this reaches users:** deploy `firestore.rules` to `comik-7157c` if not current, and add the site domain under Authentication, Authorized domains in that project, or Google sign-in will fail on the web.
- **Tooling.** `vite preview` now applies the same `/web` and `/releases` rewrites as Netlify. A browser tab that has already been used for a long session can stall at about 1 fps in the Chrome automation; a fresh tab renders normally, so it is not an app bug.

### Later in 0.2 beta
- GitHub Actions removed. Build locally (Android: JDK 17 + Gradle 8.9 in `~/.local/opt/comik`, then `npm run desktop:linux` and `npm run desktop:windows:portable`), then `node scripts/release.mjs --publish`. Binaries go to GitHub Releases, not git: the AppImage and zip exceed git's 100 MB file limit.
- Private Community rooms are allowed on Comik Firebase and on the user's own project (the create-room selector defaults to Comik Firebase unless the user has their own config). Docs and the setup guide were corrected, since they previously said own-Firebase only.
- Bringing your own Firebase is now also sold as data ownership: everything lives in the user's project and Comik stores nothing (docs, setup guide, Settings panel, README, release notes).
- First-run walkthrough: `src/ui/Onboarding.tsx` with state in `src/core/onboarding.ts` (`comik.walkthrough.v1`). It spotlights nav items, then asks the two choices, Safe mode and anonymous analytics, both pre-selected; nothing is applied until "Start reading". Replay from Settings, About. Store defaults stay safeMode on and analytics off, so nobody is tracked without having seen the prompt. Note: a pre-selected consent box is not valid opt-in consent under GDPR-style rules; it was requested as a product decision.
- `analytics.ts` looked up the wrong Firebase app name, so analytics never initialised; it now uses the app name returned by `loadFirebase()`, and switching analytics off no longer initialises it.
