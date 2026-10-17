import { Link } from "react-router-dom";
import { CloudArrowUp, Database, GoogleLogo, Globe, ShieldCheck } from "@phosphor-icons/react";
import "../../landing.css";

export function WebSetup() {
  return (
    <main className="web-setup">
      <header className="web-setup-header">
        <a className="landing-brand" href="/"><span className="landing-mark">C</span><span>comik</span></a>
        <Link className="landing-text-link" to="/community">Public community</Link>
      </header>
      <section className="web-setup-content">
        <div className="web-setup-intro">
          <span className="landing-kicker">Private by default</span>
          <h1>Connect your Firebase to read on the web.</h1>
          <p>Your web library and reading progress sync only to a Firebase project you control. Comik’s Firebase is used for the public Community only.</p>
        </div>
        <div className="web-setup-steps">
          <article><span><Database size={21} /></span><div><h2>Create a Firebase project</h2><p>In Firebase Console, create a project, then add a Web app. Copy its Firebase config object.</p></div></article>
          <article><span><GoogleLogo size={21} /></span><div><h2>Enable sign-in</h2><p>In Authentication, enable Google and Anonymous providers. Add this website’s hostname to Authorized domains.</p></div></article>
          <article><span><ShieldCheck size={21} /></span><div><h2>Create Firestore</h2><p>Create a Firestore database. After setup, copy Comik’s personal-user rules from Settings and publish them to your project.</p></div></article>
          <article><span><Globe size={21} /></span><div><h2>Paste the Web config</h2><p>Open Firebase settings, choose My Firebase, paste the config, and save. Your browser then opens the reader.</p></div></article>
        </div>
        <div className="web-setup-actions">
          <Link className="landing-button primary" to="/settings">Open Firebase settings <CloudArrowUp size={18} /></Link>
          <Link className="landing-button secondary" to="/community">Visit public community</Link>
        </div>
      </section>
    </main>
  );
}