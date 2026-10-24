import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleLogo, ShieldCheck } from "@phosphor-icons/react";
import { getFirebaseMode, linkGoogle, readFirebaseConfig, useSync } from "@/core/sync/firebase";
import { startSync } from "@/core/sync/engine";

export function LoginPage() {
  const user = useSync((state) => state.user);
  const syncStatus = useSync((state) => state.status);
  const config = readFirebaseConfig();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      await linkGoogle();
      localStorage.setItem("comik.sync.enabled", "1");
      await startSync();
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
        <h1>{user && !user.isAnonymous ? "You’re signed in" : "Sign in to Comik"}</h1>
        {user && !user.isAnonymous ? (
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