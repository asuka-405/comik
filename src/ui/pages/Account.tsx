import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowClockwise, CloudCheck, SignOut, UserCircle } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { getFirebaseMode, readFirebaseConfig, signOutSync, useSync } from "@/core/sync/firebase";
import { stopSync, syncNow } from "@/core/sync/engine";
import { toast } from "../common";

export function AccountPage() {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const config = readFirebaseConfig();
  const mode = getFirebaseMode();
  const data = useLiveQuery(async () => {
    const [series, chapters, read, bookmarked, categories, downloads] = await Promise.all([
      db.manga.filter((item) => item.inLibrary).count(),
      db.chapters.count(),
      db.chapters.filter((item) => item.read).count(),
      db.chapters.filter((item) => item.bookmark).count(),
      db.categories.filter((item) => !item.deleted).count(),
      db.downloads.where("state").equals("done").count(),
    ]);
    return { series, chapters, read, bookmarked, categories, downloads };
  }, [], { series: 0, chapters: 0, read: 0, bookmarked: 0, categories: 0, downloads: 0 });

  const disconnect = async () => {
    setBusy(true);
    try {
      stopSync();
      localStorage.removeItem("comik.sync.enabled");
      await signOutSync();
      toast("Signed out. Local data is unchanged.");
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page account-page">
      <div className="topbar">
        <div><div className="kicker">Your account</div><h1>Account and sync</h1></div>
      </div>

      <section className="account-identity">
        <div className="account-avatar"><UserCircle size={34} weight="duotone" /></div>
        <div className="account-identity-text">
          <span className="kicker">{sync.user ? (sync.user.isAnonymous ? "Guest session" : "Google account") : "Not signed in"}</span>
          <h2>{sync.user?.name || sync.user?.email || (config ? "Connect your account" : "Firebase not configured")}</h2>
          {sync.user?.email && sync.user.name && <span className="muted">{sync.user.email}</span>}
          {sync.user && <span className="account-uid mono">UID {sync.user.uid}</span>}
        </div>
        <span className={`account-status ${sync.status}`}><i />{sync.status === "ready" ? "Synced" : sync.status === "connecting" ? "Connecting" : sync.status === "error" ? "Sync error" : "Sync off"}</span>
      </section>

      {!config ? (
        <section className="account-actions"><h2>Connect Firebase</h2><p className="muted">Choose the app server or enter your own Firebase configuration in Settings to sign in and sync.</p><Link className="btn primary" to="/settings">Open settings</Link></section>
      ) : (
        <section className="account-actions">
          <div><span className="kicker">Firebase project</span><h2>{config.projectId}</h2><p className="muted">{mode === "default" ? "App server" : "Your Firebase project"} · {sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}` : "Not synced yet"}</p></div>
          <div className="account-buttons">
            {sync.user?.isAnonymous || !sync.user ? (
              <Link className="btn primary" to="/login"><UserCircle size={18} />Continue with Google</Link>
            ) : <>
              <button className="btn" disabled={busy || sync.syncing} onClick={() => syncNow()}><ArrowClockwise size={17} />{sync.syncing ? "Syncing" : "Sync now"}</button>
              <button className="btn" disabled={busy} onClick={() => void disconnect()}><SignOut size={17} />Sign out</button>
            </>}
          </div>
          {sync.status === "error" && <div className="err" role="alert">{sync.error}</div>}
          {sync.status === "ready" && <div className="account-sync-note"><CloudCheck size={18} /> Changes sync to this Firebase account when online.</div>}
        </section>
      )}

      <div className="account-data-grid">
        <section className="account-data-section">
          <div className="kicker">Private · users/{"{uid}"}</div>
          <h2>Your library data</h2>
          <p className="muted">Counts below are from this device. When sync is active, your account alone can read saved series metadata, categories, and chapter progress. Chapter lists are fetched from sources; page images are not synced.</p>
          <div className="account-counts">
            <DataCount label="Series on shelf" value={data.series} />
            <DataCount label="Chapters tracked locally" value={data.chapters} />
            <DataCount label="Read" value={data.read} />
            <DataCount label="Bookmarked" value={data.bookmarked} />
            <DataCount label="Categories" value={data.categories} />
            <DataCount label="Downloaded chapters" value={data.downloads} local />
          </div>
          <ul className="account-data-list">
            <li>Series metadata, source identifiers, and category assignments</li>
            <li>Read state, bookmarks, last page, and reading timestamps</li>
            <li>Selected theme, library, and reader preferences</li>
          </ul>
        </section>

        <section className="account-data-section">
          <div className="kicker">Shared · this Firebase project</div>
          <h2>Community data</h2>
          <p className="muted">Community content is visible to users of the selected project. Contributions are associated with your Firebase UID.</p>
          <ul className="account-data-list">
            <li>Discussion and recommendation posts, including comic/source references</li>
            <li>Comments, poll options, and individual poll votes</li>
            <li>Your comic ratings</li>
            <li>Optional attachments: Imgur URLs, or images up to 50 KB stored with a post</li>
          </ul>
          <div className="account-local-note">Downloads, page images, imported files, and source page lists stay in this browser. Analytics are sent only when you opt in under Settings.</div>
        </section>
      </div>
    </div>
  );
}

function DataCount({ label, value, local = false }: { label: string; value: number; local?: boolean }) {
  return <div className="account-count"><strong className="mono">{value.toLocaleString()}</strong><span>{label}{local ? " · local" : ""}</span></div>;
}