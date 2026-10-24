import { Link } from "react-router-dom";
import { ArrowLeft, Check, Minus } from "@phosphor-icons/react";
import "../../landing.css";

const YES = <Check size={16} weight="bold" aria-label="Yes" />;
const NO = <Minus size={16} aria-label="No" />;

const ROWS: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
  ["Sign in (anonymous or Google)", YES, YES, YES],
  ["Library and progress sync", YES, YES, YES],
  ["Public Community", YES, YES, YES],
  ["Private Community rooms", NO, NO, YES],
  ["Read comics in the app", NO, YES, YES],
  ["Where comic requests come from", "Nowhere", "Your device", "Your Firebase project"],
];

const COMMANDS = `git clone https://github.com/asuka-405/comik.git
cd comik
npm install
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,functions --project YOUR_PROJECT_ID`;

/** Explains who uses which Firebase and walks through bringing your own. Mirrors docs/FIREBASE.md. */
export function WebSetup() {
  return (
    <main className="web-setup">
      <header className="web-setup-header">
        <a className="landing-brand" href="/"><span className="landing-mark">C</span><span>comik</span></a>
        <Link className="landing-text-link" to="/"><ArrowLeft size={16} /> Back to Comik</Link>
      </header>
      <section className="web-setup-content">
        <div className="web-setup-intro">
          <span className="landing-kicker">Bring your own Firebase</span>
          <h1>Read comics in the browser with your own Firebase.</h1>
          <p>Comik's Firebase handles sign-in, sync and Community for everyone. Reading comics is different: the website cannot do it for you, so on the web you run a small proxy in your own Firebase project. The Android, Linux and Windows apps need none of this.</p>
        </div>

        <h2 className="guide-h">What each Firebase does</h2>
        <div className="guide-table-wrap">
          <table className="guide-table">
            <thead><tr><th /><th>Comik Firebase<small>web, no setup</small></th><th>Comik Firebase<small>Android, Linux, Windows</small></th><th>Your Firebase<small>any platform</small></th></tr></thead>
            <tbody>{ROWS.map(([label, a, b, c]) => <tr key={label}><th scope="row">{label}</th><td>{a}</td><td>{b}</td><td>{c}</td></tr>)}</tbody>
          </table>
        </div>

        <h2 className="guide-h">Why it works this way</h2>
        <div className="guide-prose">
          <p><strong>Comics are fetched by whoever's address makes the request.</strong> Browsers cannot read most comic sites themselves, so a server has to make the request. If that server were Comik's, every reader's traffic would leave from one address. Sources would see thousands of readers as one scraper, ban it, and reading would break for everyone. In the apps this never happens, because each device fetches from its own connection.</p>
          <p><strong>Sign-in, sync and Community are safe to share.</strong> They store small documents, locked by security rules so you can only reach your own library. Running them centrally is what lets your shelf follow you across devices with no setup.</p>
          <p><strong>Your own project makes the proxy yours.</strong> The proxy is a Cloud Function in your project. Requests leave from your Google Cloud address, only users signed in to your project may call it, and the bill and the limits are yours. A failure or a ban affects only you.</p>
          <p><strong>Cost.</strong> Cloud Functions that contact outside websites need the Blaze (pay as you go) plan. Firebase includes a monthly free allowance, and light personal reading normally stays inside it. Images are most of the traffic. Set a budget alert in Google Cloud so a surprise cannot grow.</p>
          <p><strong>Not a guarantee.</strong> Some sources block traffic from cloud data centers. Those may work in the apps and fail through the proxy.</p>
        </div>

        <h2 className="guide-h">Set it up</h2>
        <ol className="guide-steps">
          <li><h3>Create a project and a web app</h3><p>In the <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">Firebase console</a>, add a project, then choose Add app, Web. Copy the config object it shows. You will paste it into Comik in step 6.</p></li>
          <li><h3>Turn on sign-in</h3><p>Authentication, Sign-in method: enable Anonymous and Google. Under Settings, Authorized domains, add the address you use Comik from (for example your Netlify domain). <code>localhost</code> is already allowed.</p></li>
          <li><h3>Create Firestore</h3><p>Build, Firestore Database, Create database. Production mode is fine, because step 5 publishes the rules.</p></li>
          <li><h3>Switch to the Blaze plan</h3><p>Upgrade the project (Usage and billing). Add a budget alert at an amount you are comfortable with.</p></li>
          <li><h3>Deploy rules and the proxy</h3><p>You need Node.js 22 or newer. Run this once, from your computer, replacing YOUR_PROJECT_ID with your project's ID. Always pass <code>--project</code>: the repository's default project belongs to Comik and you cannot deploy to it.</p><pre className="guide-code">{COMMANDS}</pre><p>The last command builds the proxy, uploads it, and prints a function URL ending in <code>comikProxy</code>. The first deploy asks to enable a few Google Cloud APIs; accept. To limit the proxy to your own Google account, create <code>functions/.env</code> containing <code>ALLOWED_EMAILS=you@gmail.com</code> before deploying.</p></li>
          <li><h3>Paste your config into Comik</h3><p>Open <Link to="/settings/firebase">Settings, Firebase</Link>, choose My Firebase, paste the config from step 1, and save. If you deployed to a region other than us-central1, set it there too. Turn on sync, then press Test on the proxy line to confirm it answers.</p></li>
          <li><h3>Android only: Google sign-in on your project</h3><p>Add an Android app to your project with package name <code>in.archdev.comik</code> and the signing fingerprints printed on the Comik release page. Then paste your project's Web client ID (Authentication, Google, Web SDK configuration) into the Google OAuth Web client ID field in Settings.</p></li>
        </ol>

        <div className="web-setup-actions">
          <Link className="landing-button primary" to="/settings/firebase">Open Firebase settings</Link>
          <Link className="landing-button secondary" to="/community">Visit Community</Link>
        </div>
      </section>
    </main>
  );
}
