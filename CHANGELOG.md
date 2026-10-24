# Changelog

Each section becomes the release notes for that version on GitHub and on the releases page.

## 0.3.1-beta

### Cloudflare checks
- **The Android, Linux and Windows apps now pass Cloudflare checks**, the way Tachiyomi does: requests share a cookie jar with a real browser engine (Chromium on desktop, the system WebView on Android). When a site answers with a check, the app opens it in that engine, waits for the clearance cookie, then repeats the request. The same clearance covers pages and images afterwards.
- **Better than a silent wait.** The check runs in a hidden window and solves itself in a few seconds. Only if it needs a click does a window open, titled with the site's name, and you can cancel it.
- **Global search never opens check windows.** It searches about a hundred sites, so instead of a window per site, sites that need a check are listed in one panel, each with its own "Verify and search" button.
- **The website cannot pass these checks.** It now says so in plain words instead of showing a bare 403.

### Sources
- New and checked end to end: **Omega Scans** (a new engine for HeanCMS sites that read from a JSON API), **Grim Scans** (a new engine for Keyoapp sites), **ManhuaTop**, **Manhwatop**, **MangaDNA** and **Manhwa18.cc**.
- **WebtoonXYZ** and **WebtoonScan** are added from their known settings, but their check needs a click and I could not complete it here, so they are not tested. Use Verify and search once.
- Page detection now accepts the lazy-load classes many readers use ("loading", "lazy"), which was hiding the pages of several sites.
- The desktop app no longer breaks sites that redirect through plain http.
- All 104 sources were run through the health check from the desktop app: 99 work end to end. The ones that do not: Gourmet Scans (pages), MangaForFree.net (chapters, flaky), Akaza Scans (page 2) and two slow sites that sometimes time out (Bun Manga, Manhuanext).

### Still not available from your list
- **Dead or reused addresses:** Akai Comic, Free Comic Online, Oppai Stream, CulturedWorks, ManyToon and Manhwahentai.me no longer serve a comic site.
- **Next.js sites:** Comic Asura, Drake Scans and InfinityScans send their pages through server actions with changing ids. They need a dedicated reader each.
- **Own page layout, not yet written:** Cutie Comics, MurimScan, Doujin.io, Hentai2Read, E-Hentai, Luscious, Comic Fury, DeviantArt, Manhwa Hentai and izneo.
- **Left out on purpose:** Coomer, CosplayTele, Everia.club, Hentai Cosplay, Photos18 and Playmate Hunter. They publish photographs of real people, often taken from creators' paid or private pages without permission.

## 0.3.0-beta

### Search
- **Global search is rebuilt.** One loader with a progress bar covers the whole search. A source appears in the list below the moment it has results; sources with no match, or that fail, no longer show up at all. If nothing matches anywhere you get a single "No results" message.
- **No more sideways overflow.** Results sit in a wrapping grid instead of a row that ran off the right edge when a source returned more than a few series.
- **Filter by name now matches names.** It used to match the site address too, so typing "com" or "ar" matched nearly everything. Names that start with what you type come first.

### Sources
- **MangaDex is back** as a dedicated source, and **MangaKatana** is new, with its own reader support.
- New from your list: **ManhwaHub**, **HentaiWebtoon**, **Manga18.me** and **MangaForFree.net**. These are flagged 18+, so Safe mode hides them.
- **Fewer dead sources.** Every source was checked end to end through the real engines (list, search, series, chapters, pages) and five that no longer worked were removed. Newest chapters that are locked no longer make a working source look broken, and sites that list chapters in `div` rows or through admin-ajax now work.
- A new health check, `scripts/check-sources.ts`, repeats that test any time.
- **Not added yet, from the list you sent:** Akai Comic, CulturedWorks, E-Hentai, Free Comic Online, Hentai2Read, izneo, Manhwa Hentai, Manhwahentai.me, ManyToon, Comic Asura, Comic Fury, Coomer, CosplayTele, Cutie Comics, DeviantArt, Doujin.io, Drake Scans, Everia.club, Grim Scans, Hentai Cosplay, InfinityScans, Luscious, MangaDNA, ManhuaTop, Manhwa18.cc, Manhwatop, MurimScan, Omega Scans, Oppai Stream, Photos18, Playmate Hunter, WebtoonScan and WebtoonXYZ. Reasons: they sit behind Cloudflare checks that only a real browser passes, render their pages with JavaScript so there is nothing to read in the HTML, use their own page layout that needs a dedicated reader, or their address no longer serves a comic site. Cloudflare-protected sites need a built-in browser step in the apps, which is not in this release.

## 0.2.2-beta

### New
- **Import from Tachiyomi and Mihon.** Settings, Downloads and storage, Import from Tachiyomi or Mihon. Pick a `.tachibk` or `.proto.gz` backup and see what will come across before you import. Your library, categories, reading mode, read and bookmarked chapters, last page and read dates are added to your shelf. Series from sources Comik does not have are listed and skipped. The file is read on your device and never uploaded.
- **Account menu.** The account button now sits at the end of the search bar. It opens a menu with My account and App settings, so the dock keeps only Shelf, Discover, Timeline and Community.

### Fixes
- Android: the search bar could still sit slightly under the status bar on phones with a notch or punch-hole camera. The page now also accounts for display cutouts.

## 0.2.1-beta

Sign-in, sync and Community now work for everyone through Comik's Firebase, and reading comics in the browser moves to your own Firebase. Still a beta: some sources may stop working as their sites change.

### Firebase, split by what each one is good for
- **Comik Firebase** now handles sign-in, library sync and the public Community on every platform, with nothing to set up. Before, web users had to bring their own project just to open the app.
- **Private Community rooms** can be created on Comik Firebase or on your own project.
- **Your own Firebase** can do all of that for you alone, plus the comic proxy on the web. Everything is stored in your project and Comik holds nothing. Bring it under Settings, Firebase, My Firebase.
- **Reading comics in the browser needs your own Firebase.** The hosted site no longer proxies comics. One shared address making every reader's requests would be banned by the sources. Your project runs a small Cloud Function (`comikProxy`) instead, so requests leave from your own address and only your signed-in users can use it.
- **The Android, Linux and Windows apps need none of this.** They fetch comics from your device, so everything works with Comik's Firebase.
- New setup guide inside the app (`/web/setup`) and in `docs/FIREBASE.md`: what each Firebase does, why it is split this way, and step-by-step deployment. The web build shows a notice where reading is unavailable.
- Cloud Functions that contact outside sites need Firebase's Blaze (pay as you go) plan. There is a free monthly allowance, and you should set a budget alert.

### First run
- A short walkthrough for first-time visitors covers Discover, the shelf and reader, downloads, sign-in and sync. It ends with two choices, Safe mode and anonymous usage analytics, both pre-selected. You can change them any time in Settings, Privacy, and replay the walkthrough from Settings, About.
- Settings are now a category list that opens sub-pages, like Android's Settings app, instead of one long page.

### Distribution
- Builds are made on a developer machine and published to GitHub Releases. The release workflow in GitHub Actions is gone.

### Fixes
- Posting to the public community no longer asks for an invite link.
- Android: the top search bar no longer slides under the status bar. The page now starts below the system bars and keeps inputs above the keyboard.
- Anonymous usage analytics now actually reach Firebase when you opt in (the client was looking up the wrong app).
- Settings links such as the Firebase section now scroll to the right place.

### Android signing fingerprints
For Google sign-in on your own Firebase project, register Android package `in.archdev.comik` with these certificate fingerprints:
- SHA-1: `35:99:13:DA:33:07:47:A0:66:AB:A7:D4:B7:E2:19:67:B5:AA:BD:E0`
- SHA-256: `56:2C:F7:B2:46:19:10:AC:65:3F:E0:4C:20:BB:3E:06:57:79:BD:03:F6:D1:04:61:48:89:8B:9E:43:15:F7:80`

## 0.1.0-alpha

First public build of Comik for the web, Android, Linux and Windows. This is an alpha: expect rough edges, and some sources may stop working as their sites change.

### Reading
- About 100 English sources, including Webtoon, Webtoon Canvas and community sites from the Mihon extension index.
- Continuous webtoon scrolling plus right-to-left, left-to-right and vertical paged readers, with fit modes and tall-strip splitting.
- Per-chapter progress with resume, and duplicate uploads of the same chapter folded together.
- Offline downloads and one-pass library updates.

### Your data
- Local-first library. Optional sync through a Firebase project you control, with anonymous sign-in or a linked Google account.
- Backup and restore to a file.
- Safe mode hides adult-marked sources and is on by default.

### Community and tools
- Public community feed, ratings, polls, and private rooms joined by invite link.
- Source Studio for building a selector-based source for a site you are allowed to read.
- Command palette on Ctrl K.

### Apps
- Android APK (Android 6 and newer), Linux AppImage (x64) and a portable Windows build (x64).
- The Android build is signed with a debug key and the Windows build is unsigned, so each may show a warning on first launch.
