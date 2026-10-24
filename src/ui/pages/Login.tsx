import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogo, ShieldCheck } from "@phosphor-icons/react";
import { ensureSignedIn, getFirebaseMode, linkGoogle, readFirebaseConfig, useSync } from "@/core/sync/firebase";
import { startSync, stopSync, type AccountSyncChoice } from "@/core/sync/engine";

type HandoffChoice = AccountSyncChoice | "none";

const HANDOFF_CHOICES: { value: HandoffChoice; title: string; detail: string }[] = [
  { value: "park-local", title: "Put local data aside and show cloud data", detail: "Save this device's library as a restorable local archive, then use this account's cloud library." },
  { value: "combine", title: "Combine local and cloud data", detail: "Keep both libraries, categories, and chapter progress, resolving conflicts by latest change." },
  { value: "none", title: "Keep local data and don't sync", detail: "Sign in for Community, but leave personal library sync off." },
  { value: "cloud", title: "Replace local data with cloud data", detail: "Use this account's library and settings on this device." },
  { value: "local", title: "Replace cloud data with local data", detail: "Upload this device's library and settings to this account, replacing its current sync data." },
];

export function LoginPage() {
  const user = useSync((state) => state.user);
  const syncStatus = useSync((state) => state.status);
  const config = readFirebaseConfig();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [previousUid, setPreviousUid] = useState<string | null>(() => localStorage.getItem("comik.sync.previousUid"));
  const [choice, setChoice] = useState<HandoffChoice>("combine");

  useEffect(() => {
    if (user?.uid && localStorage.getItem("comik.sync.pendingUid") === user.uid) setHandoff(true);
  }, [user?.uid]);

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      stopSync();
      const previous = await ensureSignedIn();
      const previousAccountUid = localStorage.getItem("comik.sync.previousUid") || previous.uid;
      await linkGoogle();
      const next = useSync.getState().user;
      if (next && previous.uid !== next.uid) {
        setPreviousUid(previousAccountUid);
        localStorage.setItem("comik.sync.previousUid", previousAccountUid);
        localStorage.setItem("comik.sync.pendingUid", next.uid);
        setHandoff(true);
        return;
      }
      localStorage.setItem("comik.sync.enabled", "1");
      await startSync("combine", previousAccountUid);
      localStorage.removeItem("comik.sync.previousUid");
      navigate("/account", { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishHandoff = async () => {
    setBusy(true);
    setError("");
    try {
      if (choice === "none") {
        stopSync();
        localStorage.removeItem("comik.sync.enabled");
        useSync.getState().patch({ status: "off", syncing: false });
      } else {
        localStorage.setItem("comik.sync.enabled", "1");
        await startSync(choice, previousUid);
      }
      localStorage.removeItem("comik.sync.pendingUid");
      localStorage.removeItem("comik.sync.previousUid");
      navigate("/account", { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-mark"><ShieldCheck size={25} weight="duotone" /></div>
        <div className="kicker">Comik account</div>
        <h1>{handoff ? "Choose what to do with your data" : user && !user.isAnonymous ? "You’re signed in" : "Sign in to Comik"}</h1>
        {handoff ? (
          <>
            <p className="muted">This is a different account. Choose how its cloud library and this device's library should be handled before sync starts.</p>
            <fieldset className="login-handoff-choices">
              {HANDOFF_CHOICES.map((item) => <label key={item.value}>
                <input type="radio" name="handoff-choice" value={item.value} checked={choice === item.value} onChange={() => setChoice(item.value)} />
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              </label>)}
            </fieldset>
            <p className="muted login-community-note">Community posts and ratings remain shared and attached to their original account; they are not copied between account identities.</p>
            <button className="btn primary login-submit" disabled={busy} onClick={() => void finishHandoff()}>{busy ? "Working…" : "Continue"}</button>
            {error && <div className="err" role="alert">{error}</div>}
          </>
        ) : user && !user.isAnonymous ? (
          <>
            <p className="login-user">{user.name || user.email}</p>
            {user.email && user.name && <p className="muted">{user.email}</p>}
            <Link className="btn primary login-submit" to="/account">Open account and sync</Link>
          </>
        ) : config ? (
          <>
            <p className="muted">Use Google to sync your library and participate in the community.</p>
            <button className="btn primary login-submit" disabled={busy} onClick={() => void signIn()}>
              <GoogleLogo size={19} weight="bold" />
              {busy ? "Connecting" : user?.isAnonymous ? "Continue with Google" : "Sign in with Google"}
            </button>
            {error && <div className="err" role="alert">{error}</div>}
            {syncStatus === "error" && !error && <div className="err" role="alert">{useSync.getState().error}</div>}
            <p className="login-project">{getFirebaseMode() === "default" ? "Comik Firebase" : "Your Firebase project"} · {config.projectId}</p>
          </>
        ) : (
          <>
            <p className="muted">Connect the app server or enter your own Firebase project before signing in.</p>
            <Link className="btn primary login-submit" to="/settings/firebase">Open Firebase settings</Link>
          </>
        )}
        <Link className="login-back" to="/">Back to shelf</Link>
      </section>
    </main>
  );
}