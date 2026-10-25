# Anime connectors

A connector is a small piece of JavaScript that tells Comik how to read **one anime site you have permission to use**. It fetches the site's data and hands it to Comik in a fixed shape. Comik does the rest: the library, episode tracking, the player, subtitles, progress, sync, community posts.

Comik ships no connector for any third-party site and does not review the ones you install. Use connectors only for sites whose operators have given you permission, such as your own service, a licensed provider's partner API, or a site that allows it in writing.

Open **Settings > Anime connectors** to add one. You can paste the code, or give the address of a raw file and Comik downloads and stores it.

## How it works

- The code runs inside a locked-down sandbox frame. It cannot touch Comik's data, your shelf, your account or other pages.
- It cannot use the network by itself. Everything goes through `ctx.http`, which only talks to the hosts listed in the connector's `manifest.domains`, only over https.
- Whatever it returns is checked and cleaned before Comik uses it. Addresses off the allowlist are dropped.
- The connector shows up as a source under **Discover > Anime**, next to the built-in ones, and its episodes play in Comik's own player.

## The shape of a connector

A connector sets `module.exports` to an object with a `manifest` and the methods it supports. `export default { ... }` works too.

```js
module.exports = {
  manifest: { /* who you are and which hosts you contact */ },
  async popular(page, ctx)                 { /* -> { items, hasNext } */ },
  async latest(page, ctx)                  { /* -> { items, hasNext } */ },
  async search(query, page, filters, ctx)  { /* -> { items, hasNext } */ },
  async details(id, ctx)                   { /* -> title */ },
  async episodes(id, ctx)                  { /* -> episode[] */ },
  async streams(episodeId, info, ctx)      { /* -> { streams, subtitles, skips } */ },
};
```

Only `manifest`, `search`, `details`, `episodes` and `streams` are needed. If `popular` or `latest` is missing, Comik uses `search("")` instead. Every method receives `ctx` as its **last** argument and may be `async`.

## The manifest

- `id`: unique name, 2 to 41 lower-case letters, digits and dashes. Installing the same id again updates the connector.
- `name`: shown in Discover.
- `version`: like `1.0.0`. Bump it when you change the code.
- `apiVersion`: must be `1`.
- `domains`: **every host the connector contacts**, for data, images and video. Use exact hosts (`api.example.com`) or `*.example.com` for subdomains. At least one is required. IP addresses, `localhost` and bare `*` are rejected.
- `description`, `author`, `homepage` (https): shown when someone installs it.
- `languages`: for example `["en", "ja"]`.
- `nsfw`: `true` hides it when Safe mode is on.
- `direct`: `true` makes requests with the browser's own network stack instead of Comik's proxy. The site must send CORS headers for this to work. Leave it off for sites that do not.
- `settings`: values the person fills in for this connector, such as an API key. Each entry is `{ key, label, secret?, placeholder?, required? }`. Read them from `ctx.settings.key`.

If an update adds a domain, Comik asks the person to confirm again before installing it.

## The `ctx` object

- `await ctx.http.get(url, { headers })`: returns `{ status, url, text }`.
- `await ctx.http.getJson(url, { headers })`: the same request, with the body parsed as JSON.
- `await ctx.http.post(url, body, { headers })`: `body` is a string, or an object that is sent as JSON.
- `ctx.html(text)`: parses HTML into a normal DOM document, so `querySelector` works.
- `ctx.log(...)`: writes a line to the log shown by the **Test** button.
- `ctx.settings`: the values typed for `manifest.settings`.

A response that is not 2xx throws an error that mentions the status, so a failing site shows a clear message instead of garbage data.

Limits: 60 requests per call, 10 MB per response, 45 seconds per call, request bodies up to 1 MB. Redirects may not leave `manifest.domains`.

## What you return

### A title

Returned in lists (`items`) and from `details`. Only `id` and `title` are required. Everything else is optional, and `details` should fill in as much as the site knows.

- `id`: a stable string, up to 300 characters. Comik passes it back to `details`, `episodes` and `streams`.
- `title`, `altTitles` (list of other names, used to find the same show in other sources)
- `cover`, `banner`: https image addresses on an allowed host, or a small `data:image/...` URL.
- `description`
- `year`, `status` (`ongoing`, `airing`, `completed`, `finished`, `hiatus`, `cancelled`)
- `tags` (genres and themes), `studios`, `rating` (0 to 10), `contentRating`
- `trailerUrl` (https, on an allowed host or YouTube)
- `episodeCount`

### An episode

Returned from `episodes`. Required: `id` and `number`.

- `id`, `number` (can be fractional, like `12.5`)
- `season` (a number), `seasonTitle`
- `title`, `description`, `thumbnail`
- `airDate`: an ISO date string or epoch milliseconds
- `duration`: seconds
- `filler`: `true` to mark filler

**Seasons.** Many sites restart numbering at 1 each season. Comik tracks each episode by one running number so nothing collides: season 2 episode 1 follows the last episode of season 1, and the episode is still labelled `S2 E1` in the list. Send `season` on every episode, or none.

### Streams

Returned from `streams(episodeId, info, ctx)`, where `info` is `{ titleId, number, season }`.

```js
return {
  streams: [
    { url: "https://cdn.example.com/ep1/master.m3u8", type: "hls", label: "Auto" },
    { url: "https://cdn.example.com/ep1/720.mp4", type: "mp4", label: "720p" },
  ],
  subtitles: [{ url: "https://cdn.example.com/ep1/en.vtt", lang: "en", label: "English", default: true }],
  skips: [{ kind: "intro", start: 62, end: 151 }],
};
```

- `type` is `hls`, `mp4` or `webm`. If left out, Comik guesses from the file name.
- Every `url` must be https and on an allowed host. A list with nothing playable is an error.
- Several streams appear in the player's **Quality** menu, in the order you give them.
- If the video host needs request headers (for example `Authorization`), set `proxy: true` and `headers: { ... }` on an `hls` stream. Comik then loads the playlist and its segments through its proxy with those headers. Plain `mp4` files are always loaded directly by the player, so they cannot carry custom headers.
- `subtitles` accept `vtt` or `srt` (Comik converts `srt`). `lang` is a short code like `en`.
- `skips` show a **Skip** button while the time is inside the range. `kind` is `intro`, `outro` or `recap`; times are in seconds.

## Testing and debugging

1. Add the connector, then press **Test** on its card. Comik calls `popular(1)` and shows how many titles came back, plus whatever you wrote with `ctx.log`.
2. Open it from **Discover > Anime**, add a title to your library and open an episode. Errors from `streams` appear in the player with a **Try again** button.
3. Common messages:
   - "is not in this connector's domains": add the host to `manifest.domains`.
   - "Connectors may only use https addresses": the site gave an `http://` link.
   - "This episode has no playable stream on the connector's allowed domains": every stream was dropped. Check the hosts.
   - "A single call may make at most 60 requests": fetch fewer pages per call.
   - "does not implement x()": the method is missing.

## Hosting and updating

Put the file anywhere that serves it as plain text over https: a raw file on GitHub, a gist's raw link, or your own server. Paste that address under **Add a connector > From a web address**. Comik downloads the code and stores it on the device. Press **Check for update** on the card to download it again. Bump `manifest.version` each time so people can tell versions apart.

Connector code and its settings stay on the device. They are not part of library sync, so install the connector on each device. Titles you added from it sync as usual and show as "Source unavailable" on a device that does not have it yet.

## Template

Copy this, change the manifest and the address, and fill in the mapping. It runs as is, but the host `api.example.com` does not exist, so it will fail until you point it at a real service.

```js template
// A Comik anime connector. Docs: Settings > Anime connectors > Documentation.
const API = "https://api.example.com";

module.exports = {
  manifest: {
    id: "my-service",
    name: "My Service",
    version: "1.0.0",
    apiVersion: 1,
    description: "Anime from My Service.",
    author: "Your name",
    domains: ["api.example.com", "*.cdn.example.com"],
    languages: ["en"],
    // settings: [{ key: "apiKey", label: "API key", secret: true, required: true }],
  },

  // One title as Comik wants it. Map your service's fields here.
  _title(item) {
    return {
      id: String(item.id),
      title: item.name,
      cover: item.poster,
      description: item.synopsis,
      year: item.year,
      status: item.status,
      tags: item.genres,
      episodeCount: item.episodes,
    };
  },

  async popular(page, ctx) {
    const data = await ctx.http.getJson(`${API}/anime?sort=popular&page=${page}`);
    return { items: data.results.map((item) => this._title(item)), hasNext: !!data.next };
  },

  async latest(page, ctx) {
    const data = await ctx.http.getJson(`${API}/anime?sort=latest&page=${page}`);
    return { items: data.results.map((item) => this._title(item)), hasNext: !!data.next };
  },

  async search(query, page, filters, ctx) {
    const data = await ctx.http.getJson(`${API}/anime?q=${encodeURIComponent(query)}&page=${page}`);
    return { items: data.results.map((item) => this._title(item)), hasNext: !!data.next };
  },

  async details(id, ctx) {
    return this._title(await ctx.http.getJson(`${API}/anime/${encodeURIComponent(id)}`));
  },

  async episodes(id, ctx) {
    const data = await ctx.http.getJson(`${API}/anime/${encodeURIComponent(id)}/episodes`);
    return data.map((e) => ({
      id: String(e.id),
      number: e.number,
      season: e.season,
      title: e.title,
      description: e.summary,
      thumbnail: e.image,
      airDate: e.aired,
      duration: e.runtime_seconds,
    }));
  },

  async streams(episodeId, info, ctx) {
    const data = await ctx.http.getJson(`${API}/episodes/${encodeURIComponent(episodeId)}/play`);
    return {
      streams: [{ url: data.hls, type: "hls", label: "Auto" }],
      subtitles: (data.subtitles || []).map((s) => ({ url: s.url, lang: s.lang, label: s.name })),
      skips: data.intro ? [{ kind: "intro", start: data.intro.start, end: data.intro.end }] : [],
    };
  },
};
```

## Example 1: a JSON API that needs a key

A service that gives partners an API key. The key is typed into the connector's settings, never put in the code.

```js
module.exports = {
  manifest: {
    id: "acme-partner",
    name: "Acme Anime (partner)",
    version: "1.0.0",
    apiVersion: 1,
    domains: ["partner-api.acme.example", "*.acme-cdn.example"],
    settings: [{ key: "apiKey", label: "Partner API key", secret: true, required: true }],
  },

  headers(ctx) {
    if (!ctx.settings.apiKey) throw new Error("Open the connector's settings and enter your partner API key.");
    return { headers: { Authorization: `Bearer ${ctx.settings.apiKey}` } };
  },

  async search(query, page, filters, ctx) {
    const r = await ctx.http.getJson(`https://partner-api.acme.example/v2/shows?query=${encodeURIComponent(query)}&page=${page}`, this.headers(ctx));
    return {
      items: r.data.map((s) => ({ id: s.slug, title: s.title.en || s.title.romaji, cover: s.images.poster, year: s.year })),
      hasNext: r.meta.page < r.meta.pages,
    };
  },

  async details(id, ctx) {
    const s = (await ctx.http.getJson(`https://partner-api.acme.example/v2/shows/${id}`, this.headers(ctx))).data;
    return { id: s.slug, title: s.title.en, altTitles: [s.title.romaji, s.title.native], description: s.about, cover: s.images.poster, banner: s.images.banner, tags: s.tags, studios: s.studios, year: s.year, status: s.airing ? "airing" : "completed", rating: s.score };
  },

  async episodes(id, ctx) {
    const r = await ctx.http.getJson(`https://partner-api.acme.example/v2/shows/${id}/episodes?limit=500`, this.headers(ctx));
    return r.data.map((e) => ({ id: e.id, number: e.number, season: e.season, title: e.title, description: e.about, thumbnail: e.still, airDate: e.aired_at, duration: e.length }));
  },

  async streams(episodeId, info, ctx) {
    const r = (await ctx.http.getJson(`https://partner-api.acme.example/v2/episodes/${episodeId}/playback`, this.headers(ctx))).data;
    return {
      // The CDN wants the same key on every playlist and segment, so route this stream through Comik's proxy.
      streams: [{ url: r.manifest, type: "hls", label: "Auto", proxy: true, headers: { Authorization: `Bearer ${ctx.settings.apiKey}` } }],
      subtitles: r.captions.map((c) => ({ url: c.url, lang: c.language, label: c.label, default: c.default })),
      skips: [r.intro && { kind: "intro", start: r.intro[0], end: r.intro[1] }].filter(Boolean),
    };
  },
};
```

## Example 2: a site you run that only has web pages

When there is no API, read the pages. `ctx.html` gives you a normal DOM.

```js
const SITE = "https://anime.mysite.example";

module.exports = {
  manifest: {
    id: "mysite",
    name: "My Site",
    version: "1.0.0",
    apiVersion: 1,
    domains: ["anime.mysite.example", "media.mysite.example"],
  },

  async search(query, page, filters, ctx) {
    const { text } = await ctx.http.get(`${SITE}/browse?q=${encodeURIComponent(query)}&page=${page}`);
    const doc = ctx.html(text);
    const items = [...doc.querySelectorAll(".card")].map((card) => ({
      id: card.querySelector("a").getAttribute("href").replace("/show/", ""),
      title: card.querySelector(".title").textContent.trim(),
      cover: new URL(card.querySelector("img").getAttribute("src"), SITE).href,
    }));
    return { items, hasNext: !!doc.querySelector("a[rel=next]") };
  },

  async details(id, ctx) {
    const doc = ctx.html((await ctx.http.get(`${SITE}/show/${id}`)).text);
    return {
      id,
      title: doc.querySelector("h1").textContent.trim(),
      description: doc.querySelector(".synopsis")?.textContent.trim(),
      cover: new URL(doc.querySelector(".poster img").getAttribute("src"), SITE).href,
      tags: [...doc.querySelectorAll(".genres a")].map((a) => a.textContent.trim()),
    };
  },

  async episodes(id, ctx) {
    const doc = ctx.html((await ctx.http.get(`${SITE}/show/${id}`)).text);
    return [...doc.querySelectorAll(".episode")].map((row) => ({
      id: row.getAttribute("data-id"),
      number: Number(row.getAttribute("data-number")),
      title: row.querySelector(".ep-title")?.textContent.trim(),
    }));
  },

  async streams(episodeId, info, ctx) {
    // The page embeds the playlist address in a data attribute.
    const doc = ctx.html((await ctx.http.get(`${SITE}/watch/${episodeId}`)).text);
    const url = doc.querySelector("video")?.getAttribute("data-src");
    if (!url) throw new Error("This episode has no video yet.");
    return { streams: [{ url, type: "hls", label: "Auto" }] };
  },
};
```

## Example 3: a working demo

This one needs no account and no site of its own. It lists the Blender Foundation's open movies, which are Creative Commons licensed, with their public test streams. Use it to see the whole flow working, and to check that video plays on your device. **Add a connector > Install the demo** adds it in one tap.

```js demo
const cover = (a, b, label) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><text x="100" y="160" font-family="sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`);

const SHOWS = {
  "blender-open-movies": {
    title: "Blender Open Movies",
    altTitles: ["Blender Foundation shorts"],
    description: "Short films made with Blender and released under Creative Commons licenses. A demo of Comik's anime connector: seasons, episode details, streams and skip buttons.",
    cover: cover("#ff795e", "#8a2be2", "Open Movies"),
    year: 2008,
    status: "completed",
    tags: ["Short film", "Demo", "Open source"],
    studios: ["Blender Foundation"],
    rating: 8.2,
    episodes: [
      { id: "bbb", season: 1, number: 1, title: "Big Buck Bunny", description: "A giant rabbit takes revenge on three bullying rodents.", airDate: "2008-04-10", duration: 596, streams: [{ url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls", label: "Auto (HLS)" }], intro: [0, 12] },
      { id: "sintel", season: 1, number: 2, title: "Sintel (trailer)", description: "A girl searches for the dragon she raised.", airDate: "2010-09-27", duration: 52, streams: [{ url: "https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4", type: "mp4", label: "480p (MP4)" }] },
      { id: "tos", season: 2, number: 1, title: "Tears of Steel", description: "Fighters and scientists try to save the world from robots.", airDate: "2012-09-26", duration: 734, streams: [{ url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8", type: "hls", label: "Auto (HLS)" }] },
    ],
  },
};

const summary = (id) => ({ id, title: SHOWS[id].title, cover: SHOWS[id].cover, year: SHOWS[id].year, status: SHOWS[id].status, tags: SHOWS[id].tags, episodeCount: SHOWS[id].episodes.length });

module.exports = {
  manifest: {
    id: "comik-demo",
    name: "Comik demo",
    version: "1.0.0",
    apiVersion: 1,
    description: "Creative Commons open movies, to try the player. No account needed.",
    author: "Comik",
    domains: ["test-streams.mux.dev", "download.blender.org", "demo.unified-streaming.com"],
    languages: ["en"],
  },
  async popular() { return { items: Object.keys(SHOWS).map(summary), hasNext: false }; },
  async search(query) {
    const q = query.toLowerCase();
    return { items: Object.keys(SHOWS).filter((id) => SHOWS[id].title.toLowerCase().includes(q)).map(summary), hasNext: false };
  },
  async details(id) { return { ...summary(id), ...SHOWS[id], altTitles: SHOWS[id].altTitles }; },
  async episodes(id) {
    return SHOWS[id].episodes.map((e) => ({ id: e.id, number: e.number, season: e.season, seasonTitle: e.season === 1 ? "The early films" : "The later films", title: e.title, description: e.description, airDate: e.airDate, duration: e.duration }));
  },
  async streams(episodeId) {
    const e = Object.values(SHOWS).flatMap((s) => s.episodes).find((x) => x.id === episodeId);
    if (!e) throw new Error("Unknown episode.");
    return {
      streams: e.streams,
      skips: e.intro ? [{ kind: "intro", start: e.intro[0], end: e.intro[1] }] : [],
    };
  },
};
```

## Good practice

- Send everything you know in `details` and `episodes`. Comik shows episode thumbnails, descriptions, durations and seasons when they are there.
- Keep `id` values stable. Reading progress and library entries are tied to them.
- Fail with a clear `throw new Error("...")`. The text is shown to the person.
- Do not store secrets in the code. Use `manifest.settings`.
- Keep `domains` as small as you can. People see the list before they install.
- Pages of 20 to 50 titles are plenty. `hasNext` controls "load more".

## Troubleshooting

- **The connector does not appear in Discover.** Open Settings > Anime connectors and check it is turned on. A connector that fails to load shows its error on its card.
- **Covers are missing.** Image hosts must be in `manifest.domains`, and covers must be https.
- **Video does not play.** Check the stream host is in `domains`. For HLS that needs headers, set `proxy: true`. For a site that allows it, `direct: true` in the manifest can help with CORS.
- **Everything works on desktop but not on the web version.** Comik's hosted website has no proxy, so connectors there need `direct: true` and a site that allows cross-origin requests. The Android, Linux and Windows apps use their own proxy.
