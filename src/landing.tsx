import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, AndroidLogo, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import { PanelField } from "./ui/PanelField";
import "./styles.css";
import "./landing.css";

function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <nav aria-label="Main navigation">
          <a href="#reading">Reading</a>
          <a href="#privacy">Your data</a>
          <a href="#downloads">Downloads</a>
          <a href="/releases/">Releases</a>
          <a className="landing-nav-cta" href="/web/">Open reader <ArrowRight size={16} /></a>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-kicker">A home for your comics</span>
            <h1>Your comics.<br />Your shelf.<br /><em>Your rules.</em></h1>
            <p>Bring your favorite sources together. Read on the web or install Comik on your device.</p>
            <div className="landing-actions">
              <a className="landing-button primary" href="/web/">Open the web reader <ArrowRight size={18} /></a>
              <a className="landing-button secondary" href="#downloads">Get Comik</a>
            </div>
          </div>
          <div className="landing-art" aria-label="Original animated comic-cover panels">
            <PanelField mode="hero" className="landing-art-canvas" />
          </div>
          <div className="landing-scrollline" aria-hidden="true"><span /></div>
        </section>

        <section className="landing-reading" id="reading">
          <div className="landing-section-heading">
            <h2>One shelf for every source.</h2>
            <p>Browse comic catalogs, follow series, and keep your place across chapters.</p>
          </div>
          <div className="landing-reading-layout">
            <div className="landing-reading-art"><PanelField mode="hero" className="landing-reading-canvas" /></div>
            <div className="landing-reading-copy">
              <h3>Find it. Follow it. Pick up where you left off.</h3>
              <p>Comik keeps your library, reading progress, and downloads together. Webtoon and manga sources stay searchable in one place.</p>
              <a className="landing-text-link" href="/web/">Explore the reader <ArrowRight size={17} /></a>
            </div>
          </div>
        </section>

        <section className="landing-privacy" id="privacy">
          <div>
            <span className="landing-kicker">Your library, your choice</span>
            <h2>Local first.<br />Sync when you choose.</h2>
          </div>
          <div className="landing-privacy-copy">
            <p>Reading data stays on your device by default. For web sync, connect a Firebase project you own. Comik’s shared Firebase is used for the public reader community, not your web library.</p>
            <a className="landing-text-link" href="/web/settings">Set up web sync <ArrowRight size={17} /></a>
          </div>
        </section>

        <section className="landing-downloads" id="downloads">
          <div className="landing-section-heading">
            <h2>Read on your terms.</h2>
            <p>Choose the build that fits your device.</p>
          </div>
          <div className="download-list">
            <a href="https://github.com/asuka-405/comik/releases/latest/download/Comik-android.apk" className="download-row">
              <AndroidLogo size={25} /><span><strong>Android</strong><small>APK for Android 6 and newer</small></span><ArrowRight size={19} />
            </a>
            <a href="https://github.com/asuka-405/comik/releases/latest/download/Comik-linux-x64.AppImage" className="download-row">
              <LinuxLogo size={25} /><span><strong>Linux</strong><small>AppImage for x64</small></span><ArrowRight size={19} />
            </a>
            <a href="https://github.com/asuka-405/comik/releases/latest/download/Comik-windows-x64.zip" className="download-row">
              <WindowsLogo size={25} /><span><strong>Windows</strong><small>Portable x64 app</small></span><ArrowRight size={19} />
            </a>
          </div>
          <p className="landing-release-note">See <a href="/releases/">features, release notes and every version</a>, or browse the source on <a href="https://github.com/asuka-405/comik">GitHub</a>.</p>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="/" aria-label="Comik home"><span className="landing-mark">C</span><span>comik</span></a>
        <span>Made for the next chapter.</span>
        <a href="https://github.com/asuka-405/comik">GitHub <ArrowRight size={15} /></a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><LandingPage /></StrictMode>);