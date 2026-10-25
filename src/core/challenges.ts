/**
 * Sites that answered with a Cloudflare check. Comik never opens a check window on its own: a request that
 * hits one fails with a ChallengeError, the site is remembered here, and the person runs the check when they choose,
 * from the button next to the error or from Settings > Browser checks.
 */
import { create } from "zustand";

const KEY = "comik.challenged";

export interface ChallengedSite { host: string; url: string; at: number }

export const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");

function read(): ChallengedSite[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as ChallengedSite[];
    return Array.isArray(parsed) ? parsed.filter((site) => site && typeof site.host === "string" && typeof site.url === "string").slice(0, 50) : [];
  } catch { return []; }
}
function write(sites: ChallengedSite[]) {
  try { localStorage.setItem(KEY, JSON.stringify(sites)); } catch { /* private mode: the list lasts until the app closes */ }
}

export const useChallenges = create<{ sites: ChallengedSite[] }>(() => ({ sites: read() }));

/** Remember that a site asked for a check. */
export function noteChallenge(url: string) {
  const host = hostOf(url);
  const origin = new URL(url).origin + "/";
  useChallenges.setState(({ sites }) => {
    const next = [{ host, url: origin, at: Date.now() }, ...sites.filter((site) => site.host !== host)].slice(0, 50);
    write(next);
    return { sites: next };
  });
}

export function clearChallenge(host: string) {
  useChallenges.setState(({ sites }) => {
    const next = sites.filter((site) => site.host !== host.replace(/^www\./, ""));
    write(next);
    return { sites: next };
  });
}
