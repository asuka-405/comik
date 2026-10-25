import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, AndroidLogo, BookOpen, BookOpenText, LinuxLogo, PlayCircle, WindowsLogo } from "@phosphor-icons/react";
import { PanelField } from "./ui/PanelField";
import "./styles.css";
import "./landing.css";

function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <nav aria-label="Main navigation">
          <a href="#reading">Read and watch</a>
          <a href="#community">Community</a>
          <a href="#sources">Your sources</a>
          <a href="#privacy">Your data</a>
          <a href="#downloads">Downloads</a>
          <a className="landing-nav-keep" href="/docs/">Docs</a>
          <a className="landing-nav-keep" href="/releases/">Releases</a>
          <a className="landing-nav-cta" href="/web/">Open reader <ArrowRight size={16} /></a>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-kicker">Comics, web novels and anime</span>
            <h1>Read it.<br />Watch it.<br /><em>Your rules.</em></h1>
            <p>One shelf for the comics you read, the web novels you follow and the anime you watch. Use it on the web or install Comik on your device.</p>
            <div className="landing-actions">
              <a className="landing-button primary" href="/releases/">Get Comik <ArrowRight size={18} /></a>
              <a className="landing-button secondary" href="/web/">Open the web reader</a>
            </div>
          </div>
          <div className="landing-art" aria-label="Original animated comic-cover panels">
            <PanelField mode="hero" className="landing-art-canvas" />
          </div>
          <div className="landing-scrollline" aria-hidden="true"><span /></div>
        </section>

        <section className="landing-reading" id="reading">
          <div className="landing-section-heading">
            <h2>Three ways to read and watch. One shelf.</h2>
            <p>Comics, web novels and anime sit side by side, each with its own reader, and share the same library, progress and sync.</p>
          </div>
          <div className="landing-media">
            <article>
              <BookOpen size={30} weight="duotone" />
              <h3>Comic reader</h3>
              <p>Manga, manhwa and webtoons in the layout you like: right to left, left to right, vertical paging or continuous scrolling.</p>
              <ul>
                <li>About 100 English sources in one searchable catalogue</li>
                <li>Downloads for offline reading and one-pass library updates</li>
                <li>Resume points per chapter, and Tachiyomi or Mihon import</li>
              </ul>
            </article>
            <article>
              <BookOpenText size={30} weight="duotone" />
              <h3>Web novel reader</h3>
              <p>A text reader for long chapters. Follow series from web novel sites, read them in the app and keep your place on every device.</p>
              <ul>
                <li>FreeWebNovel, ReadNovelFull, NovelFull, WuxiaBox, Royal Road and Project Gutenberg</li>
                <li>Import your own EPUB and text files</li>
                <li>Chapter lists, progress and updates like any other title</li>
              </ul>
            </article>
            <article>
              <PlayCircle size={30} weight="duotone" />
              <h3>Anime player</h3>
              <p>A full player with a quality menu, subtitles, skip intro and outro, resume, and automatic next episode. Episodes come with art, descriptions and seasons.</p>
              <ul>
                <li>HLS and MP4, with VTT and SRT subtitles</li>
                <li>Discover lists anime from AniList</li>
                <li>Add the services you may use through connectors</li>
              </ul>
            </article>
          </div>
          <p className="landing-media-note">Comik ships no connector for third-party anime sites. Connect only sites whose operators allow it.</p>
        </section>

        <section className="landing-split" id="community">
          <div className="landing-split-copy">
            <span className="landing-kicker">Together and private</span>
            <h2>Community, and a Vault for the rest.</h2>
          </div>
          <div className="landing-split-cols">
            <div>
              <h3>Community</h3>
              <p>Share what you are reading and watching, rate titles, vote in polls and reference a comic, novel or anime in a post. Join a community with channels and announcements, or start your own with owners, admins and moderators and an invite link.</p>
            </div>
            <div>
              <h3>Vault</h3>
              <p>Move any title out of sight. Vault titles stay off your shelf, your history and community suggestions until you open the Vault, which you can lock with a PIN. Safe mode also keeps adult-marked sources hidden by default.</p>
            </div>
          </div>
        </section>

        <section className="landing-sources" id="sources">
          <div className="landing-section-heading">
            <span className="landing-kicker">Make it yours</span>
            <h2>Bring your own sources.</h2>
            <p>The catalogue is a start. Add the sites you are allowed to use, and Comik does the rest.</p>
          </div>
          <div className="landing-sources-grid">
            <article>
              <h3>Source Studio for comics</h3>
              <p>Build a source from CSS selectors, preview the results live, then save it into your catalogue. Start from a Madara or MangaThemesia template, or point it at your own site.</p>
            </article>
            <article>
              <h3>Connectors for anime</h3>
              <p>A connector is one small JavaScript file that tells Comik how to read a service: titles, seasons, episodes, video and subtitles. It runs in a locked sandbox and can only contact the https hosts it declares, which you see before you install it.</p>
            </article>
            <article>
              <h3>A debugger that points at the problem</h3>
              <p>Syntax errors are marked as you type. A step-by-step run shows what each call returned, every request and what Comik kept, with the line, column and a suggested fix. There is a JSON formatter, connector icons and documentation built in.</p>
            </article>
          </div>
          <p className="landing-release-note">Read the <a href="/docs/#connectors">connector reference</a>, or see how to <a href="/docs/#customize">restyle the whole app with themes and CSS</a>.</p>
        </section>

        <section className="landing-privacy" id="privacy">
          <div>
            <span className="landing-kicker">Your library, your choice</span>
            <h2>Local first.<br />Sync when you choose.</h2>
          </div>
          <div className="landing-privacy-copy">
            <p>Your library, comics, novels and anime alike, stays on your device by default. Sign in to sync it through Comik’s Firebase with nothing to set up, or bring your own Firebase. The Android, Linux and Windows apps read comics straight from your device. On the web, reading uses a proxy in your own Firebase, so no shared address gets banned by the sources.</p>
            <a className="landing-text-link" href="/web/setup">How the web setup works <ArrowRight size={17} /></a>
            <a className="landing-text-link" href="/docs/#data">See what is public and the database schema <ArrowRight size={17} /></a>
          </div>
        </section>

        <section className="landing-downloads" id="downloads">
          <div className="landing-section-heading">
            <h2>Read on your terms.</h2>
            <p>Choose the build that fits your device.</p>
          </div>
          <div className="download-list">
            <a href="/releases/" className="download-row">
              <AndroidLogo size={25} /><span><strong>Android</strong><small>APK for Android 6 and newer</small></span><ArrowRight size={19} />
            </a>
            <a href="/releases/" className="download-row">
              <LinuxLogo size={25} /><span><strong>Linux</strong><small>AppImage for x64</small></span><ArrowRight size={19} />
            </a>
            <a href="/releases/" className="download-row">
              <WindowsLogo size={25} /><span><strong>Windows</strong><small>Portable x64 app</small></span><ArrowRight size={19} />
            </a>
          </div>
          <p className="landing-release-note">See <a href="/releases/">features, release notes and every version</a>, or browse the source on <a href="https://github.com/asuka-405/comik">GitHub</a>.</p>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <span>Made for the next chapter.</span>
        <a href="/docs/">Docs</a>
        <a href="https://github.com/asuka-405/comik">GitHub <ArrowRight size={15} /></a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><LandingPage /></StrictMode>);