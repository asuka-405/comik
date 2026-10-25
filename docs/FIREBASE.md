# Comik and Firebase

Comik uses Firebase for three things, and a Cloud Function for a fourth. Which project provides each depends on where you run Comik.

## Public capacity and data visibility

The public catalog and schema view is available in the app at `/data`. It reads only the public feed and public-community metadata. Private-community posts and channels remain member-only. Every `users/{uid}` path is owner-only and is never queried by the public view.

The Firestore rules accept a read-only status document at `system/capacity`. If `state` is `closed`, `firestorePercent` is at least `95`, or `authUsersPercent` is at least `95`, rules reject new or edited sync and Community records. Deletes and reads remain available. The app displays the capacity notice and checks the status before its normal anonymous-account creation flow.

**This repository does not measure Google Cloud quota usage automatically.** An operator must monitor Firestore storage/operations and the applicable Auth user limit, then set `system/capacity` with the Firebase Admin SDK or console when a metric reaches 95%. Example document:

```json
{
   "state": "closed",
   "firestorePercent": 95,
   "authUsersPercent": 0,
   "updatedAt": 1792960000000
}
```

To reopen after capacity is available, set `state` to `open` and update both percentages below 95. This status document is client-read-only; only a trusted project administrator can change it. Firestore rules cannot prevent direct Firebase Authentication account creation, so a hard account-creation stop also requires an Auth blocking function and the required Identity Platform setup. The client check is for friendly feedback, not a security boundary.

Other server-side protections: the rules allow only bounded `users/{uid}/series`, `meta`, and `memberships` documents; Community create/update paths are gated and public post/comment/chat writes have an 8-second per-user cooldown. The Cloud Function proxy verifies every ID token, caps bodies at 2 MiB, and limits each UID to 600 requests per minute per function instance. The standalone Node proxy binds to `127.0.0.1` by default; remote binding requires `PROXY_AUTH_TOKEN`. It checks every redirect, blocks private/special-use IPs, pins the socket to the checked IP, and caps responses.

## What each Firebase does

| | Comik Firebase, web | Comik Firebase, Android / Linux / Windows | Your Firebase, any platform |
|---|---|---|---|
| Sign in (anonymous or Google) | yes | yes | yes |
| Library and progress sync | yes | yes | yes |
| Communities (public and private) | yes | yes | yes, still hosted on Comik's project |
| Read comics in the app | **no** | yes, from your device | yes, through your proxy |
| Where comic requests come from | nowhere | your device's connection | your Firebase project |
| Where your data is stored | Comik's project | Comik's project | **your project; Comik stores nothing** |

- **Comik Firebase** is project `comik-7157c`. Everyone gets it with no setup. It stores sign-in accounts, your synced library under `users/{uid}` (readable only by you, enforced by `firestore.rules`) and every Community: the shared feed plus all public and private communities, with their channels, roles and messages.
- **Your Firebase** is a project you create. It does everything above for you alone, plus, on the web, the comic proxy. Communities always live in Comik's project, so everyone can find and join the same ones; your own project holds your sync, your proxy and your account.

### Why bring your own, beyond reading on the web

With your own Firebase, **your data is stored with you and Comik holds nothing**. Your account, your synced library and progress live in your Google Cloud project, under your control. You can export, inspect or delete them from the Firebase console, set your own access rules, and shut it all down by deleting the project. Comik's project then has no copy of anything about you. With Comik's Firebase the data lives in Comik's project, protected by security rules that let only you read your library, but stored on our side.

## Why it works this way

Reading a comic means asking the comic site for its pages. Browsers cannot do that directly (no CORS headers, image hosts that check the referer), so something has to make the request on your behalf.

- **In the apps the device makes the request.** Every user has their own connection, so sources see ordinary readers. This works with Comik's Firebase and needs no setup.
- **On the web a server must make the request.** If that server were Comik's, every reader's traffic would leave from one address. Sources would see one very busy scraper and ban it, and reading would stop for everyone. The hosted site therefore never fetches comics. Its `/api` proxy does not exist.
- **So on the web you bring a proxy of your own.** It is a Cloud Function in your Firebase project (`functions/`). Requests leave from your Google Cloud address, only users signed in to your project can call it, and the limits and costs are yours alone.
- **Sign-in, sync and Community are safe to share.** They are small documents behind security rules, with no request to any comic site.

Caveats:

- Cloud Functions that contact outside websites need the **Blaze (pay as you go)** plan. Firebase includes a monthly free allowance and light personal reading usually stays inside it, but image traffic is the largest cost. Set a budget alert in Google Cloud.
- Some sources block cloud data center addresses. They can work in the apps and fail through the proxy.
- Anyone who can sign in to your project can use your proxy. Restrict it with `ALLOWED_EMAILS` (below) if your project is not private.

## Bring your own Firebase

You need Node.js 22 or newer and a Google account.

1. **Create a project and a web app.** In the [Firebase console](https://console.firebase.google.com) add a project, then Add app, Web. Copy the config object it shows.
2. **Turn on sign-in.** Authentication, Sign-in method: enable *Anonymous* and *Google*. Under Settings, Authorized domains, add the address you open Comik from. `localhost` is already allowed.
3. **Create Firestore.** Build, Firestore Database, Create database (production mode).
4. **Switch to Blaze.** Usage and billing, upgrade. Add a budget alert.
5. **Deploy the rules and the proxy** from a clone of this repository:

   ```sh
   git clone https://github.com/asuka-405/comik.git
   cd comik
   npm install
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,functions --project YOUR_PROJECT_ID
   ```

   Always pass `--project`. The repository's default project belongs to Comik. The deploy bundles the proxy (`scripts/build-functions.mjs`), uploads it as the function `comikProxy`, and prints its URL. Accept the prompts to enable Google Cloud APIs the first time.

   To limit the proxy to your own account, create `functions/.env` before deploying:

   ```
   ALLOWED_EMAILS=you@gmail.com
   ```

   With this set, anonymous sessions are refused, so sign in with Google first (Settings, Link Google).
6. **Paste the config into Comik.** Settings, Firebase, My Firebase, paste the config from step 1 and save. If you deployed to a region other than `us-central1`, set Proxy function region. Turn on Sync, then use Test on the proxy line.
7. **Android only: Google sign-in.** Add an Android app to your project with package name `in.archdev.comik` and the signing fingerprints listed on the Comik release page, then paste your project's Web client ID (Authentication, Google, Web SDK configuration) into *Google OAuth Web client ID* in Settings.

The same guide is available inside Comik at `/web/setup`.

## Troubleshooting

- **"Could not reach your Firebase proxy"**: the function is not deployed, or the region in Settings does not match. Run `firebase functions:list --project YOUR_PROJECT_ID`.
- **"Your sign-in expired"**: reload the page. If it persists, check Authentication is enabled and your domain is in Authorized domains.
- **"This account is not allowed to use this proxy"**: your account is not in `ALLOWED_EMAILS`.
- **Some sources fail only on the web**: they probably block data center addresses. Use the app for those.
- **Billing surprise**: lower `maxInstances` in `functions/src/index.ts` and redeploy, and keep a budget alert.
