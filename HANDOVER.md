# Handover

Updated: 2026-10-24 (global search, source ordering, MangaDex removal)

## Next Release Target: 0.4.0-alpha

- Add light-novel support and dedicated light-novel sections. This is intentionally not part of the 0.3.5-alpha bug-fix release.
- In the chapter list, select an anchor chapter and mark every chapter before or after it read or unread, delete those chapters' downloads, or download them.
- Add download-next-10 and download-next-25 actions, starting after the selected chapter or, when none is selected, after the latest read chapter.
- Keep these chapter actions in 0.4.0-alpha, not the 0.3.5-alpha bug-fix release.

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

### Later in 0.2 beta (shipped as 0.2.1-beta; there is no 0.2.0 release)
- GitHub Actions removed. Build locally (Android: JDK 17 + Gradle 8.9 in `~/.local/opt/comik`, then `npm run desktop:linux` and `npm run desktop:windows:portable`), then `node scripts/release.mjs --publish`. Binaries go to GitHub Releases, not git: the AppImage and zip exceed git's 100 MB file limit.
- Private Community rooms are allowed on Comik Firebase and on the user's own project (the create-room selector defaults to Comik Firebase unless the user has their own config). Docs and the setup guide were corrected, since they previously said own-Firebase only.
- Bringing your own Firebase is now also sold as data ownership: everything lives in the user's project and Comik stores nothing (docs, setup guide, Settings panel, README, release notes).
- First-run walkthrough: `src/ui/Onboarding.tsx` with state in `src/core/onboarding.ts` (`comik.walkthrough.v1`). It spotlights nav items, then asks the two choices, Safe mode and anonymous analytics, both pre-selected; nothing is applied until "Start reading". Replay from Settings, About. Store defaults stay safeMode on and analytics off, so nobody is tracked without having seen the prompt. Note: a pre-selected consent box is not valid opt-in consent under GDPR-style rules; it was requested as a product decision.
- `analytics.ts` looked up the wrong Firebase app name, so analytics never initialised; it now uses the app name returned by `loadFirebase()`, and switching analytics off no longer initialises it.

### 0.2.2 beta
- **Tachiyomi/Mihon import.** `src/core/tachiyomi.ts` (pure decoder and planner, tested with a hand-built protobuf encoder in `tachiyomi.test.ts`) and `tachiyomiApply.ts` (writes manga, chapters and categories to IndexedDB). UI: `src/ui/components/TachiyomiImport.tsx`, shown in Settings, Downloads and storage. Sources match by Tachiyomi id (`mihon-<id>`), then by name. Imported chapters keep the backup's relative URLs, so the next chapter refresh merges by URL and, failing that, by chapter number. Checked end to end in a browser with a synthetic backup; not tried with a real `.tachibk` from the app.
- **Account menu.** `src/ui/AccountMenu.tsx` sits at the end of the top bar (`.shell-top`); Account and Settings are gone from the dock. The walkthrough still spotlights it through `aria-label="Account"`.
- **Android insets.** Padding now also includes display cutouts and never drops below the platform status bar height. Still untested on a device.

### 0.3 beta
- **Search UI.** `GlobalSearch` in `src/ui/pages/Browse.tsx` replaces the per-source rows: six workers, one progress bar, results appended as they arrive, empty and failing sources dropped. `filterSources` (`src/core/sources/filter.ts`, tested) matches names only.
- **Sources.** MangaDex restored (`mangadex.ts`, data-saver removed) and `mangakatana.ts` added. `catalog.json` has 96 entries; entries can carry `nsfw`. `scripts/build-catalog.ts` gained `WANTED`/`EXTRA` (adult or orphaned sites asked for by name), `ONLY`, `POOL` and `INDEX_CACHE` knobs. `scripts/check-sources.ts` is the end-to-end health check (needs the proxy running: `PROXY_PORT=8799 npx tsx server/index.ts`). Madara: `div.wp-manga-chapter` rows and an admin-ajax chapter fallback.
- **Wanted sources that are not in.** 33 of the 48 names are missing, mostly Cloudflare-challenged (403/503 to a plain fetch), client-rendered, bespoke markup, or dead domains (ManyToon and Manhwahentai.me now serve unrelated sites). The next real step is a browser-backed fetch inside the Android and desktop shells to pass Cloudflare; that needs a hidden WebView / BrowserWindow in `MainActivity` and `desktop/main.cjs`.
- **404 reports.** Only a handful of sources failed in the end-to-end check, so the 404s the user saw are not fully explained. Candidates: the hosted site no longer has an `/api` proxy, and a custom Firebase config whose `comikProxy` function is not deployed also answers 404 from Google. The Android app cannot send POST bodies, so the Madara ajax chapter paths cannot work there.

### 0.3.1 beta: Cloudflare and more sources
- **How Tachiyomi does it** (read from the public keiyoushi source, reimplemented here): its `CloudflareInterceptor` notices a 403/503 from Cloudflare, loads the site in a WebView that shares cookies with the HTTP client, waits for `cf_clearance`, and retries. Comik does the same in `desktop/main.cjs` (`solveCloudflare`, requests over Electron's `net` with the session cookie jar, a hop-by-hop redirect loop for SSRF checks, Referer dropped on http hops) and in `MainActivity.java` (`solveCloudflare` / `showCloudflareCheck`, cookies shared with `CookieManager`, check dialog shown only after 8 s). The web build has no equivalent; `ChallengeError` (`src/core/http.ts`) explains that.
- **Silent mode.** `silenceChallenges()` marks a source's hosts so requests carry `x-comik-no-challenge: 1`; both native proxies then return the challenge (`x-comik-challenge: cloudflare`) instead of solving it. `GlobalSearch` uses it and lists blocked sources with `VerifyRow` buttons that run `verifySite()` and then search that one source.
- **Engines.** `heancms.ts` (JSON API: `/query`, `/series/<slug>`, `/chapter/query`, `/chapter/<series>/<chapter>`), `keyoapp.ts` (`/series`, `/latest/`, `#chapters`, `#pages > img[uid]` plus a CDN template in a script). Catalog entries `mihon-manual-*` were added by hand; `build-catalog.ts` accepts `PROXY=http://localhost:41739` to probe through the desktop app, and no longer treats Cloudflare's passive script as a challenge.
- **Verification workflow.** Build the desktop app (`npm run build:native && npx electron-builder --projectDir desktop --linux dir`), run `release/linux-unpacked/comik-desktop`, then `PROXY=http://localhost:41739 npx tsx scripts/check-sources.ts` (set `SKIP="webtoonxyz|webtoonscan"` to avoid interactive checks popping windows).
- **Untested:** the Android check dialog (compiles, never run on a device), WebtoonXYZ and WebtoonScan (interactive checks), Windows.

### 0.3.2 beta
- **New sources** (dedicated modules, verified with `check-sources.ts` through the desktop app): `hentai2read.ts` (series at /doujinshi|/original|/imageset/<id>-<slug>, chapters at /reader/<slug>/<chapter id>/page-1, images derived from the first page's CDN url and the printed page count), `ehentai.ts` (drawn categories only via the f_cats bitmask and a category check, since the popular page ignores it; two-step page resolution, slow for long galleries and subject to the site's image limit), `cutiecomics.ts` (thumbnails in /thumbs/ map to full images one folder up).
- **Account reset and purge.** `src/core/sync/accountData.ts` (`wipeAccountData`, `purgeAccount`) and `DangerZone` in `Account.tsx`. Not run against a live Firebase project; deletes go through the security rules (own posts and ratings need a non-anonymous sign-in). Comments, likes and votes on other people's posts are not reachable without collection-group queries and index overrides, which were not added.
- **Dead domains.** Probed common alternatives through the desktop proxy: nothing legitimate found for Akai Comic, Free Comic Online, ManyToon or Manhwahentai.me.
- **Shelf selection.** `Shelf.tsx` holds the selection state; `Cover` takes a `select` prop and `onHold` (long press or right-click, `useLongPress` in `common.tsx`). Bulk writes live in `repo.ts` (`editCategoriesOf`, `removeFromLibrary`, `setSeriesRead`, `moveCategory`). Tab dialogs use `TextDialog` and `ConfirmDialog` from `common.tsx` because Electron has no `prompt()`. Selected series that leave the visible list are dropped from the selection.
- **History.** Deleting a history entry sets `readAt` to 0 and leaves `read` and `lastPage` alone (`removeFromHistory`, `clearHistory` in `repo.ts`). It syncs like any chapter change. The shelf's Continue row also reads `readAt`, so a series whose history is cleared drops out of Continue. `Timeline.tsx` clubs only neighbouring entries of one comic inside one day group.
- **Community.** Client-only: hashtags, `||spoilers||`, author filter, quick compose, trending panel. Nothing changed in `firestore.rules`. Cover thumbnails only show when the comic id exists in the viewer's local database, because `comic` in a post holds no cover url and the rules do not allow extra keys.
- **Themes.** `src/core/themes.ts` (presets, `resolveTheme`, `themeCss`, file format) and `ui/components/ThemeStudio.tsx`. `useTheme` in `App.tsx` writes `:root[data-theme]{...}` into `<style id="comik-theme">` and the user's CSS into `<style id="comik-custom-css">`, both appended last in `<head>`. `data-theme` stays `dark` or `light` (the base); `data-skin` is the theme id. The theme setting is now a string. User CSS should set variables on `body`, which beats `:root`. Radius applies through one selector list at the end of `styles.css`, since the original stylesheet hard-codes square corners. `userThemes`, `customCss` and `customCssOn` are in `SYNCED_SETTINGS`.

### Communities (unreleased, after 0.3.2)
- **Model.** Everything lives in the Comik project (`comik-7157c`). `"public"` is the original shared feed (`communityPosts`, no roles). Every other community is `communities/{id}` with `members/{uid}` (role owner, admin, mod or member), `bans/{uid}`, `private/invite` (the invite code, readable by staff only), `channels/{id}/messages`, `posts/{id}` (+ comments, likes, votes) and `ratings`. Each reader also has `users/{uid}/memberships/{cid}`, a mirror used to list their communities without a collection-group index. Stale mirrors are cleaned up when the community page finds the member missing.
- **Code.** `src/core/community.ts` (all Firestore access, role helpers, `write()` which retries a `permission-denied` once after renewing the ID token), `src/ui/community/` (`Directory`, `CommunityHome`, `Chat`, `Settings`, `Composer`, `Feed`, `shared`). Routes are in `App.tsx`: `/community`, `/community/new`, `/community/:cid`, `/community/:cid/chat/:chid`, `/community/:cid/settings`. `communityRooms.ts` and the per-room Firebase sessions were removed.
- **Rules.** `firestore.rules` was rewritten for this; it compiles (`firebase deploy --only firestore:rules --dry-run`) but has **not been run against the emulator or deployed**, because the emulator jar is not installed. Check these paths first once deployed: creating a community (two batches, the owner member document is accepted through `getAfter`), joining (member document plus `memberCount` increment in one batch, validated with `existsAfter`), kicking, ownership transfer, deleting a community (owner-only cascade).
- **The "authorization error" on posting.** Two likely causes: the rules were not deployed, or a freshly linked Google account kept an `anonymous` sign-in provider claim in its token. The second is handled in code (`getIdToken(true)` after linking and on connect, plus the retry); the first needs a deploy.
- **Not built:** join requests that an admin approves, member mutes, per-channel permissions, reactions on chat messages, editing posts in the UI (the rules allow author edits).
- **Checked:** typecheck, 23 tests, and in a browser at 360 px the pages render without horizontal overflow and the post form fits. Not checked with live data.
