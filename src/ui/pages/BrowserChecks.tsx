import { useMemo, useState } from "react";
import { ShieldWarning, X } from "@phosphor-icons/react";
import { allSources } from "@/core/sources/registry";
import { clearChallenge, hostOf, useChallenges } from "@/core/challenges";
import { isNativeShell } from "@/core/platform";
import { CheckButton } from "../ChallengeFix";
import { timeAgo } from "../common";
import { Detail } from "./Settings";

/** Settings > Browser checks: where Cloudflare checks are run, one at a time, when the person chooses. */
export function BrowserChecks() {
  const waiting = useChallenges((state) => state.sites);
  const [filter, setFilter] = useState("");
  const [address, setAddress] = useState("");
  const sources = useMemo(() => allSources().filter((source) => source.id !== "local" && !source.isConnector && /^https:\/\//.test(source.baseUrl)), []);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (q ? sources.filter((source) => source.name.toLowerCase().includes(q) || source.baseUrl.toLowerCase().includes(q)) : sources).slice(0, 40);
  }, [sources, filter]);
  let typed: string | null = null;
  try { const url = new URL(/^https?:\/\//i.test(address.trim()) ? address.trim() : `https://${address.trim()}`); if (address.trim() && url.hostname.includes(".")) typed = `${url.origin}/`; } catch { typed = null; }

  return (
    <Detail title="Browser checks" intro="Some sites ask for a Cloudflare check before they answer. Comik never opens one on its own. Run the ones you want here, or from the button next to an error.">
      {!isNativeShell && (
        <section className="panel" data-hue="2">
          <h2>Not available in the browser</h2>
          <p className="muted">Cloudflare checks need a real browser window, which the website cannot open. The Android, Linux and Windows apps can, and this menu runs the checks there.</p>
        </section>
      )}
      <section className="panel" data-hue="5">
        <h2>Waiting for a check</h2>
        {!waiting.length && <p className="muted">No site is waiting. A site appears here when it answers with a check.</p>}
        {waiting.length > 0 && (
          <ul className="verify-list">
            {waiting.map((site) => (
              <li className="verify-row" key={site.host}>
                <span className="verify-name" title={`Last seen ${timeAgo(site.at)}`}>{site.host}</span>
                <span className="row-inline">
                  <CheckButton url={site.url} label="Run check" />
                  <button className="icon-btn" onClick={() => clearChallenge(site.host)} aria-label={`Dismiss ${site.host}`} title="Dismiss"><X size={15} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {isNativeShell && (
        <section className="panel" data-hue="3">
          <h2>Check a site now</h2>
          <p className="muted" style={{ marginBottom: 10 }}>Pick a source, or enter an address. The check window opens only after you press the button, and it passes on its own when the site allows it.</p>
          <div className="stack" style={{ gap: 10 }}>
            <div className="verify-address">
              <input className="input" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="example.com" aria-label="Site address" />
              {typed ? <CheckButton url={typed} label={`Check ${hostOf(typed)}`} /> : <button className="btn sm" disabled><ShieldWarning size={14} /> Run browser check</button>}
            </div>
            <input className="input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Filter ${sources.length} sources`} aria-label="Filter sources" />
            <ul className="verify-list">
              {shown.map((source) => (
                <li className="verify-row" key={source.id}>
                  <span className="verify-name">{source.name}</span>
                  <CheckButton url={`${source.baseUrl.replace(/\/+$/, "")}/`} label="Run check" />
                </li>
              ))}
            </ul>
            {sources.length > shown.length && <p className="muted" style={{ fontSize: 12.5 }}>Showing {shown.length} of {sources.length}. Type to narrow the list.</p>}
          </div>
        </section>
      )}
    </Detail>
  );
}
