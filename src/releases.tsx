import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, ArrowSquareOut, AndroidLogo, Check, Copy, DownloadSimple, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import "./styles.css";
import "./landing.css";
import "./releases.css";
import { classifyAsset, downloadsFor, fallbackUrl, fetchReleases, formatBytes, PLATFORMS, REPO_URL, type Platform, type Release } from "./core/releases";
import { parseMarkdown, type Inline } from "./core/markdown";

const ICONS: Record<Platform, React.ReactNode> = {
  android: <AndroidLogo size={26} />,
  linux: <LinuxLogo size={26} />,
  windows: <WindowsLogo size={26} />,
};

const FEATURES: { title: string; body: string }[] = [
  { title: "Comic reader", body: "Right to left, left to right, vertical paging and continuous webtoon scrolling, with fit modes, tall-strip splitting and per-image filters. About 100 English sources, including Webtoon and community sites, in one searchable catalogue." },
  { title: "Web novel reader", body: "Follow web novels from FreeWebNovel, ReadNovelFull, NovelFull, WuxiaBox, Royal Road and Project Gutenberg, or import your own EPUB and text files. Chapters, progress and updates work like they do for comics." },
  { title: "Anime player", body: "HLS and MP4 playback with a quality menu, VTT and SRT subtitles, skip intro and outro, resume and automatic next episode. Episodes show thumbnails, descriptions, durations and seasons. Discover lists anime from AniList." },
  { title: "Anime connectors", body: "Connect a service you have permission to use with a small JavaScript file. It runs in a locked sandbox, reaches only the https hosts it declares and is checked before Comik uses what it returns. Comik ships none for third-party sites." },
  { title: "Connector debugger", body: "Syntax errors are marked as you type, with the line, column and a suggested fix. A step-by-step run shows what each call returned, every request and what Comik kept. Includes a JSON formatter, connector icons and built-in documentation." },
  { title: "Source Studio", body: "Build a comic source for a site you are allowed to read with CSS selectors, preview it live and save it into your catalogue. Madara and MangaThemesia templates get you started." },
  { title: "Community", body: "Share what you are reading and watching, rate titles, vote in polls and reference a comic, novel or anime in a post. Join communities with channels and announcements, with owners, admins and moderators, or open a private room with an invite link." },
  { title: "Vault", body: "Move titles out of sight. They stay off your shelf, history and community suggestions until you open the Vault, which you can lock with a PIN. Safe mode also hides adult-marked sources by default." },
  { title: "One shelf, one library", body: "Comics, novels and anime share progress, read marks and resume points, with shelf tabs, sort, filter and multi-select. History and updates have a tab for each kind." },
  { title: "Downloads and updates", body: "Save chapters for offline reading and check the whole library for new chapters or episodes in one pass. App updates download as a plain file you choose to install." },
  { title: "Sign in and sync, built in", body: "Everything stays on your device until you turn on sync. Comik's Firebase handles guest or Google sign-in, sync and the public Community with no setup. Bring your own Firebase and everything is stored in your project, with nothing kept by Comik." },
  { title: "Your Firebase reads for you on the web", body: "The apps fetch from your device. In the browser, a small proxy in your own Firebase project does it, so no shared address gets banned by the sources." },
  { title: "Backups and Tachiyomi import", body: "Export your library and progress to a file and restore it on any device, or import a Tachiyomi or Mihon backup to bring your whole shelf and read progress across." },
  { title: "Command palette", body: "Press Ctrl K to jump to a series, a page or a setting without touching the mouse." },
];

const INSTALL: Record<Platform, string[]> = {
  android: ["Download the APK on your phone.", "Open it and allow installs from your browser or file manager when Android asks.", "This build is signed with a debug key, so Play Protect may ask you to confirm."],
  linux: ["Download the AppImage.", "Make it executable: chmod +x Comik-linux-x64.AppImage", "Run it. No install step is needed."],
  windows: ["Download the zip and extract it anywhere.", "Open Comik.exe inside the extracted folder.", "The build is unsigned, so SmartScreen may show a warning. Choose More info, then Run anyway."],
};

function renderInline(parts: Inline[]) {
  return parts.map((part, i) => {
    if (part.type === "bold") return <strong key={i}>{part.text}</strong>;
    if (part.type === "code") return <code key={i}>{part.text}</code>;
    if (part.type === "link") return <a key={i} href={part.href} target="_blank" rel="noreferrer">{part.text}</a>;
    return part.text;
  });
}

function Notes({ body }: { body: string }) {
  const blocks = parseMarkdown(body);
  if (!blocks.length) return <p className="rel-empty">No notes were written for this release.</p>;
  return (
    <div className="rel-notes">
      {blocks.map((block, i) => {
        if (block.type === "heading") return block.level === 2 ? <h3 key={i}>{renderInline(block.inline)}</h3> : <h4 key={i}>{renderInline(block.inline)}</h4>;
        if (block.type === "code") return <pre key={i}><code>{block.text}</code></pre>;
        if (block.type === "list") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</ul>;
        if (block.type === "table") return null;
        return <p key={i}>{renderInline(block.inline)}</p>;
      })}
    </div>
  );
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function Checksum({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="rel-hash"
      title="Copy SHA-256"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} SHA-256 {value.slice(0, 10)}…
    </button>
  );
}

function Downloads({ release, offline }: { release?: Release; offline: boolean }) {
  const rows = downloadsFor(release);
  return (
    <div className="rel-downloads">
      {rows.map(({ info, asset }) => {
        // Without the API, GitHub's `latest/download` redirect still reaches the file.
        const href = asset?.url ?? (offline ? fallbackUrl(info) : undefined);
        return (
          <div key={info.platform} className={`rel-download${href ? "" : " missing"}`}>
            <div className="rel-download-head">{ICONS[info.platform]}<span><strong>{info.title}</strong><small>{info.detail}</small></span></div>
            {href ? (
              <a className="landing-button primary" href={href}><DownloadSimple size={18} weight="bold" /> Download{asset ? ` · ${formatBytes(asset.size)}` : ""}</a>
            ) : (
              <span className="rel-soon">{release ? "Not in this release" : "Not published yet"}</span>
            )}
            <div className="rel-download-meta">
              {asset?.sha256 && <Checksum value={asset.sha256} />}
              {asset && <small>{asset.downloads.toLocaleString()} downloads</small>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReleasesPage() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchReleases(controller.signal).then(setReleases).catch((cause: Error) => {
      if (cause.name !== "AbortError") setError(cause.message);
    });
    return () => controller.abort();
  }, []);

  const stable = releases?.filter((r) => !r.prerelease) ?? [];
  const alpha = releases?.filter((r) => r.prerelease) ?? [];
  const latest = stable[0];
  const latestAlpha = alpha[0];
  const latestAlphaInstall = alpha.find((release) => PLATFORMS.every((platform) => release.assets.some((asset) => classifyAsset(asset.name) === platform.platform)));
  const older = stable.filter((r) => r !== latest);
  const olderAlpha = alpha.filter((r) => r !== latestAlpha);
  const loading = !releases && !error;

  return (
    <div className="landing releases">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#notes">Release notes</a>
          <a href="#alpha">Alpha</a>
          <a href="#history">History</a>
          <a className="landing-nav-cta" href="/web/">Open reader <ArrowRight size={16} /></a>
        </nav>
      </header>

      <main>
        <section className="rel-hero">
          <span className="landing-kicker">Releases</span>
          <h1>Get Comik on<br /><em>every screen.</em></h1>
          <p className="rel-lede">
            {loading && "Checking the latest release…"}
            {latest && <>Latest main release: <strong>{latest.name}</strong> · {formatDate(latest.publishedAt)}</>}
            {releases && !latest && "No main release is published yet. The web reader is live in the meantime."}
            {error && "Could not reach GitHub, so these links go to the newest published files."}
          </p>
          <Downloads release={latest} offline={!!error} />
          {error && <p className="rel-error">{error}</p>}
          <p className="landing-release-note">Files are hosted on <a href={`${REPO_URL}/releases`}>GitHub Releases</a>. Prefer no install? <a href="/web/">Open the web reader</a>.</p>
        </section>

        <section className="rel-section" id="features">
          <div className="landing-section-heading">
            <h2>What you get.</h2>
            <p>Comics, web novels and anime on the web, Android, Linux and Windows.</p>
          </div>
          <ul className="rel-features">
            {FEATURES.map((feature) => (
              <li key={feature.title}><h3>{feature.title}</h3><p>{feature.body}</p></li>
            ))}
          </ul>
        </section>

        <section className="rel-section alt" id="notes">
          <div className="landing-section-heading">
            <h2>{latest ? `What changed in ${latest.name}.` : "Release notes."}</h2>
            <p>{latest ? "Written for each release and published with the files." : "Notes appear here with each release."}</p>
          </div>
          <div className="rel-notes-wrap">
            {loading && <p className="rel-empty">Loading notes…</p>}
            {latest && <Notes body={latest.body} />}
            {latest && <a className="landing-text-link" href={latest.url} target="_blank" rel="noreferrer">View on GitHub <ArrowSquareOut size={16} /></a>}
          </div>
          <div className="rel-install">
            <h3>Installing</h3>
            <div className="rel-install-grid">
              {PLATFORMS.map((info) => (
                <article key={info.platform}>
                  <h4>{ICONS[info.platform]} {info.title}</h4>
                  <ol>{INSTALL[info.platform].map((step) => <li key={step}>{step}</li>)}</ol>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="rel-section alpha-stream" id="alpha">
          <div className="landing-section-heading">
            <h2>Alpha stream.</h2>
            <p>Early builds for testing. Alpha releases stay separate from the main Comik release stream.</p>
          </div>
          {loading && <p className="rel-empty">Loading alpha releases…</p>}
          {!loading && !latestAlpha && <p className="rel-empty">No alpha build is published yet.</p>}
          {latestAlpha && <>
            <div className="alpha-current-head">
              <div><span className="landing-kicker">Latest alpha</span><h3>{latestAlpha.name}</h3><p>{formatDate(latestAlpha.publishedAt)}</p></div>
              <a className="landing-text-link" href={latestAlpha.url} target="_blank" rel="noreferrer">GitHub release <ArrowSquareOut size={16} /></a>
            </div>
            {latestAlphaInstall && latestAlphaInstall !== latestAlpha && <div className="alpha-base-install"><h3>Install base · {latestAlphaInstall.name}</h3><p>Install this alpha build first. Later alpha releases can arrive through Internal app updates.</p><Downloads release={latestAlphaInstall} offline={!!error} /></div>}
            {latestAlphaInstall === latestAlpha && <Downloads release={latestAlpha} offline={!!error} />}
            <div className="alpha-notes"><Notes body={latestAlpha.body} /></div>
            {!!olderAlpha.length && <div className="rel-history alpha-history">
              {olderAlpha.map((release) => (
                <article key={release.tag} className="rel-row">
                  <button aria-expanded={open === release.tag} onClick={() => setOpen(open === release.tag ? null : release.tag)}><strong>{release.name}</strong><em>alpha</em><span>{formatDate(release.publishedAt)}</span></button>
                  {open === release.tag && <div className="rel-row-body"><Notes body={release.body} /><ul className="rel-files">{release.assets.map((asset) => <li key={asset.name}><a href={asset.url}><DownloadSimple size={15} /> {asset.name}</a><small>{formatBytes(asset.size)}</small></li>)}</ul></div>}
                </article>
              ))}
            </div>}
          </>}
        </section>

        <section className="rel-section" id="history">
          <div className="landing-section-heading">
            <h2>Main releases.</h2>
            <p>Older builds stay available if a newer one does not suit you.</p>
          </div>
          <div className="rel-history">
            {releases && !stable.length && <p className="rel-empty">No main releases published yet.</p>}
            {latest && !older.length && releases && <p className="rel-empty">{latest.name} is the only main release so far.</p>}
            {older.map((release) => (
              <article key={release.tag} className="rel-row">
                <button aria-expanded={open === release.tag} onClick={() => setOpen(open === release.tag ? null : release.tag)}>
                  <strong>{release.name}</strong>
                  {release.prerelease && <em>pre-release</em>}
                  <span>{formatDate(release.publishedAt)}</span>
                </button>
                {open === release.tag && (
                  <div className="rel-row-body">
                    <Notes body={release.body} />
                    <ul className="rel-files">
                      {release.assets.map((asset) => (
                        <li key={asset.name}><a href={asset.url}><DownloadSimple size={15} /> {asset.name}</a><small>{formatBytes(asset.size)}</small></li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <span>Made for the next chapter.</span>
        <a href={REPO_URL}>GitHub <ArrowRight size={15} /></a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><ReleasesPage /></StrictMode>);
