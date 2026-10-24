# Changelog

Each section becomes the release notes for that version on GitHub and on the releases page.

## 0.2.0-beta

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
