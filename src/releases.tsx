import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, ArrowSquareOut, AndroidLogo, Check, Copy, DownloadSimple, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import "./styles.css";
import "./landing.css";
import "./releases.css";
import { downloadsFor, fallbackUrl, fetchReleases, formatBytes, PLATFORMS, REPO_URL, type Platform, type Release } from "./core/releases";
import { parseMarkdown, type Inline } from "./core/markdown";

const ICONS: Record<Platform, React.ReactNode> = {
  android: <AndroidLogo size={26} />,
  linux: <LinuxLogo size={26} />,
  windows: <WindowsLogo size={26} />,
};

const FEATURES: { title: string; body: string }[] = [
  { title: "100 English sources", body: "Webtoon, Webtoon Canvas and about 97 community sites in one searchable catalogue. Pick the ones you want and switch the rest off." },
  { title: "A library that remembers", body: "Progress, read marks and resume points per chapter. Duplicate uploads of the same chapter are folded together so counts stay honest." },
  { title: "Readers for every format", body: "Right to left, left to right, vertical paging and continuous webtoon scrolling. Fit modes, tall-strip splitting and per-image filters." },
  { title: "Downloads and updates", body: "Save chapters for offline reading and check the whole library for new chapters in one pass." },
  { title: "Local first, sync if you want", body: "Everything stays on your device by default. Turn on sync with anonymous sign-in, or link Google, using a Firebase project you control." },
  { title: "Backups", body: "Export your library and progress to a file and restore it on any device." },
  { title: "Community", body: "Share what you are reading, rate comics, vote in polls and open private rooms with an invite link." },
  { title: "Safe mode on by default", body: "Adult-marked sources are hidden from Discover, search, your shelf and community posts until you turn it off." },
  { title: "Source Studio", body: "Build a source for a site you are allowed to read with CSS selectors, preview it live, and save it into your catalogue." },
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
        if (block.type === "list") return <ul key={i}>{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</ul>;
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
  const latest = stable[0] ?? releases?.[0];
  const older = (releases ?? []).filter((r) => r !== latest);
  const loading = !releases && !error;

  return (
    <div className="landing releases">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#notes">Release notes</a>
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
            {latest && <>Latest: <strong>{latest.name}</strong> · {formatDate(latest.publishedAt)}{latest.prerelease && " · pre-release"}</>}
            {releases && !latest && "The first release is on its way. The web reader is live in the meantime."}
            {error && "Could not reach GitHub, so these links go to the newest published files."}
          </p>
          <Downloads release={latest} offline={!!error} />
          {error && <p className="rel-error">{error}</p>}
          <p className="landing-release-note">Files are hosted on <a href={`${REPO_URL}/releases`}>GitHub Releases</a>. Prefer no install? <a href="/web/">Open the web reader</a>.</p>
        </section>

        <section className="rel-section" id="features">
          <div className="landing-section-heading">
            <h2>What you get.</h2>
            <p>The same reader on the web, Android, Linux and Windows.</p>
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

        <section className="rel-section" id="history">
          <div className="landing-section-heading">
            <h2>Every release.</h2>
            <p>Older builds stay available if a newer one does not suit you.</p>
          </div>
          <div className="rel-history">
            {releases && !releases.length && <p className="rel-empty">Nothing published yet.</p>}
            {latest && !older.length && releases && <p className="rel-empty">{latest.name} is the only release so far.</p>}
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
