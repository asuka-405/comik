import { useState } from "react";
import { ShieldWarning } from "@phosphor-icons/react";
import { verifySite } from "@/core/http";
import { isNativeShell } from "@/core/platform";
import { useChallenges } from "@/core/challenges";
import { toast } from "./common";

/** A button that runs one site's Cloudflare check, when the person presses it and not before. */
export function CheckButton({ url, onDone, label = "Run browser check" }: { url: string; onDone?: () => void; label?: string }) {
  const [working, setWorking] = useState(false);
  if (!isNativeShell) return null;
  return (
    <button
      className="btn sm primary"
      disabled={working}
      onClick={() => {
        setWorking(true);
        verifySite(url)
          .then(() => { toast("Check passed"); onDone?.(); })
          .catch((cause: Error) => toast(cause.message, true))
          .finally(() => setWorking(false));
      }}
    >
      <ShieldWarning size={14} /> {working ? "Checking…" : label}
    </button>
  );
}

/**
 * Shown under an error message. When the message is about a site that is waiting for a Cloudflare check,
 * it offers the button that runs that check by hand. It renders nothing otherwise.
 */
export function ChallengeFix({ message, onDone }: { message: string; onDone?: () => void }) {
  const sites = useChallenges((state) => state.sites);
  const site = isNativeShell ? sites.find((entry) => message.includes(entry.host)) : undefined;
  if (!site) return null;
  return <CheckButton url={site.url} onDone={onDone} label={`Check ${site.host}`} />;
}
