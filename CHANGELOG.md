# Changelog

Each section becomes the release notes for that version on GitHub and on the releases page.

## 0.5.1-alpha

### Shelves
- **Web novels and anime now have the same shelf as comics**: cover grid or list, shelf tabs, sort, filter, only-unread, density, multi-select, Continue row and an Update button. Novels keep their Import button.
- **The shelf tools are tucked away.** Under the tabs there is now one compact row with "Filter and sort" and "Update". Filter, sort, columns, only-unread, density and Select all open from the first button, closed by default. The separate select checkbox is gone; long-press or right-click a title, or press Select all, to start selecting.

### Timeline
- History and Updates each have separate **Comics, Web novels and Anime** tabs, with chapter or episode wording to match.

### Vault
- New **Vault** for titles you want kept apart, with Comics, Web novels and Anime sections. Move a title in from its page or from a shelf's selection bar. Vault titles are left out of the shelf, timeline, update badge and community suggestions, and they keep updating and syncing.
- An optional PIN hides the Vault page. It keeps casual eyes out; it is not encryption.

### Community
- **Reference a title** is split into Comics, Web novels and Anime, each listing only your titles of that kind. Vault titles are never offered.
- The reference box no longer runs off the edge of small screens.

## 0.5.0-alpha

### Updates
- **Updates are now plain downloads.** The over-the-air web updater is gone. Settings > About checks GitHub for a newer release (any newer version, including the next major) and, on your say-so, downloads the installer for your platform into the Downloads folder: the APK on Android (Android shows its own progress and a notification you tap to install), the AppImage on Linux and the zip on Windows (with a "Show in folder" button).
- This release has to be installed by hand once. Earlier 0.4.x builds only look for over-the-air packages, so they will not offer it.

### Web novels
- Five new web-novel sources, each checked end to end (list, search, novel page, full chapter list and chapter text): **FreeWebNovel**, **ReadNovelFull**, **NovelFull**, **NovelFull.net** and **WuxiaBox** (the former ReadWN). They appear under Discover > Web novels next to Project Gutenberg and Royal Road.
- FreeWebNovel, NovelFull and Royal Road sit behind Cloudflare, so in the Android, Linux and Windows apps the first request may show the verification window.
- Not added: Readlightnovel.me and LTNovel are offline; NovelFull.me now redirects to NovelBuddy; Ranobes, LightNovelPub, LightNovelWorld and LightNovelCave refuse automated checks, and Wuxiaworld and NovelFire load their chapter text with scripts that could not be verified.

### Anime
- Anime still lists official streaming links through AniList. Streaming-site scrapers are not included.

## 0.4.2-alpha

### Internal updates
- Fixed "failed to fetch" when checking for or downloading an update. Android now downloads update files through its own HTTP client and the desktop apps through their built-in proxy, and every file is still checked against its SHA-256 before it is used.
- Updates are applied one release at a time, so 0.4.0 can move up through 0.4.x, 0.5, ... 0.9.9 and on to 1.0 and later major versions. A release that only changes web assets installs over the air. A delta that was built for a different base version is refused. A release that changes the native shell still needs a normal installer.

### Web novels
- Discover now has **Comics**, **Web novels** and **Anime** tabs.
- New web-novel sources: **Project Gutenberg** (public-domain books, split into chapters) and **Royal Road** (creator-published fiction; it sits behind Cloudflare, so it works in the Android, Linux and Windows apps).
- Novels read in the text reader, with progress that syncs like comic progress.

### Anime
- New **Anime** section in the library and a **AniList Anime** source in Discover, with trending, latest and search.
- Each anime lists its episodes, tracks which ones you have watched, and links out to the official streaming services AniList lists for it. Comik does not host or scrape video, and it does not include unlicensed streaming sites.
- Anime still airing shows the episodes already out.

### Community and sync
- Posts can reference a web novel or an anime as well as a comic, with a matching label and rating. Deploy `firestore.rules` for this to work.
- Web novels and anime sync with your library, progress and categories on every device, in the same documents as comics.

## 0.4.0-alpha

### Light novels
- Added a separate Novels section with local EPUB and TXT import, EPUB spine chapter ordering, and a text-first reader with chapter navigation, font sizing, bookmarks, and scroll progress.
- Imported novel text is included in Comik backups and remains local to the device unless included in a backup.

### Chapter actions
- Select a chapter and apply read/unread, download, or delete-download actions to every chapter before or after it.
- Download the next 10 or 25 unread chapters after the selected chapter, or after the latest read chapter when nothing is selected.

### Migration
- Search all safe, enabled sources by the comic's canonical and alternate titles, then show deduplicated candidates ranked by exact-name match.

### Internal updates
- Android, Windows, and Linux can install verified incremental web-asset updates without downloading a new installer.
- The 0.4.1-alpha follow-up is published as an OTA-only delta so the update can be exercised from this 0.4.0-alpha baseline.

## 0.4.1-alpha

### OTA test delta
- The About page reports the active overlay version. Install 0.4.0-alpha first, then use Internal app updates to move to 0.4.1-alpha without downloading a new installer.

## 0.3.5-alpha

### Global search
- Search waits for typing to pause, remembers results when returning from a series, and offers adjustable columns that adapt to narrow screens.
- Long-press or right-click to select multiple results and add them to a category.

### Library
- Migrate a series to another source while preserving its shelf categories, reader preferences, and matching chapter progress. The original record stays available off the shelf.

### Accounts and sync
- Choose how to handle local and cloud data when signing in with a different account: combine, archive local and show cloud, keep local without sync, replace local from cloud, or replace cloud from local.
- Parked local archives include series, chapter state, categories, preferences, offline downloads, and imported files, and can be restored from Account.
- Personal library data syncs across devices; public Community posts and ratings remain shared and attached to their original account.

## 0.3.4-beta

### Community
- **Fixed posting with a comic reference.** The security rules checked the comic's link in a way that rejected every real link, so posts that referenced a comic from a source site failed with "Not allowed". Image links were affected the same way. Deploy `firestore.rules` for this to take effect.
- **The Spoiler button now works.** With text selected it wraps it; with nothing selected it inserts a placeholder you can type over.
- **Image attachments ask first.** Picking an image offers to upload it to ImgBB, an outside image host (nothing is sent until you post). Decline, and the image is shrunk to 50 KB and stored in the post. If the upload fails, the image is kept in the post the same way.
- No account or key is needed from readers. Larger images up to 32 MB upload to ImgBB.

## 0.3.3-beta

### Community
- **Communities, public and private.** The Community tab opens a directory that lists every community, with search and filters for Joined, Public and Private. Create your own, join a public one with a tap, or join a private one with its invite code or link.
- **Each community has its own page** with a feed, channels and a member list, and a pinned strip of the latest announcements.
- **Channels.** Every community gets an announcements channel and a general chat, and admins can add more chat rooms or announcement channels. Chat is live, with day dividers and grouped messages.
- **Roles: owner, admin, moderator, member.** Moderators delete posts, replies and messages, pin posts, post announcements and remove or ban members. Admins also edit settings and channels and manage moderators. The owner can hand the community to someone else or delete it.
- **A settings page per community** with About (rules and what each role can do), General, Channels, Members and roles with bans, Invite (link, code and a button to replace the code), and Leave or Delete.
- **Delete and leave.** You can delete your own posts (moderators can delete anyone's in their community), leave any community you do not own, and delete a community you own. Deleting a community removes its posts, channels, messages and memberships.
- **Fixed the "not authorized" error when posting.** A Google account linked to an anonymous one kept its old login token, which the security rules rejected. The token is now renewed after sign-in, and a refused write is retried once with a fresh token. If a refusal remains, the message says what to check.
- **Fixed the post form overflowing on small screens.**
- Old private rooms (invite-only rooms stored per device) are replaced by private communities. Links shaped like `/community?room=<id>&post=<id>` still open the right place for the shared feed.

## 0.3.2-beta

### Shelf
- **Select several series at once.** Press the select button, or long-press (right-click on desktop) any series. A bar offers All or None, Tabs, Move to, Read and Remove.
  - **Tabs** ticks series into or out of tabs; a dash means only some of the selection is in that tab.
  - **Move to** puts the selection in exactly one tab, or in none.
  - **Read** marks every chapter of the selection read. **Remove** takes them off the shelf and keeps their progress.
- **Manage tabs** lists every tab with its count, and lets you rename, reorder and delete each one. Deleting a tab keeps its series on the shelf.
- **Adding and deleting a tab works on the desktop and Android apps.** They used the browser's `prompt()` and `confirm()`, which Electron and the Android WebView do not show, so those buttons did nothing. They are now in-app dialogs.

### Timeline
- **History can be edited.** Remove one entry, or a whole run of chapters, with the bin button, and clear history for the last hour, 24 hours, 7 days, 30 days or all of it. Chapters stay marked as read.
- **Neighbouring chapters of the same comic are clubbed** in both Updates and History into one row such as "Ch. 12 to 15, 4 chapters", which opens to show each chapter.

### Community
- **Hashtags, spoilers and profiles.** `#tags` in a post filter the feed when tapped, `||text||` is hidden until tapped, and tapping a name shows that reader's posts.
- **Quick compose box** at the top of the feed with one-tap "Share a read" chips for what you read recently, and a Share button on every series on your shelf.
- **Posts show covers** for comics that are also on your shelf, with a link to the series.
- **Side panel** with trending tags, the comics people mention most and the most active readers, worked out from the posts loaded.

### Themes
- **Eleven new themes**: Midnight, Pure black, Nord, Dracula, Neon city, Deep forest, Ocean, Sakura, Paper and Snow.
- **Your own themes.** Make a theme from any other: fourteen colours, corner roundness and font. Duplicate, delete, copy to share, paste or import a theme file.
- **Custom CSS** applied over the whole app, with a switch to turn it off. CSS cannot run code but can load content from the web, so only use CSS from people you trust.
- Themes and custom CSS sync with your other settings.

### Account
- **Reset account** keeps your Firebase account and deletes everything stored in it: the synced library and settings, your Community posts and ratings, and the likes, votes and comments you left on your own posts.
- **Purge account** does the same and then deletes the account itself. Firebase may ask you to sign in again to confirm.
- Both are on the Account page, ask you to type a word to confirm, and switch sync off so your device cannot upload the library again by itself. Nothing on the device is deleted. Comments, likes and votes you left on other people's posts cannot be searched for, so they stay.

### Sources
- **New, checked end to end:** Hentai2Read (rebuilt for its new site), E-Hentai (drawn categories only: doujinshi, manga, artist CG and game CG) and Cutie Comics. All three are 18+, so Safe mode hides them.
- **Where the dead sites went.** Akai Comic and Oppai Stream have no working address (Oppai Stream shows a maintenance page). CulturedWorks answers with an invalid certificate. Free Comic Online, ManyToon and Manhwahentai.me still resolve, but their domains now belong to someone else: an advertising redirect, a webcam site and an AI image generator. manytoon.pro is a mirror of Manhwa18.cc, which Comik already has.
- **Not built, and why:**
  - Comic Asura, Drake Scans and InfinityScans load their pages with scripts after the page opens, from endpoints that need the running page.
  - Doujin.io scrambles its images and needs a login.
  - MurimScan has five titles and builds its chapter lists with a script.
  - Comic Fury is a webcomic host with a different structure.
  - DeviantArt needs an approved app key.
  - Luscious mixes comics with explicit photos of real people.
  - izneo is a paid store with DRM.

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
