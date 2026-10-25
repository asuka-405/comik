import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowClockwise, CloudCheck, SignOut, Trash, UserCircle, Warning } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { restoreAccountArchive } from "@/core/backup";
import { getFirebaseMode, readFirebaseConfig, reauthenticate, signOutSync, useSync } from "@/core/sync/firebase";
import { purgeAccount, wipeAccountData, type WipeSummary } from "@/core/sync/accountData";
import { stopSync, syncNow } from "@/core/sync/engine";
import { toast } from "../common";
import { ProfilePreferences } from "../components/ProfilePreferences";
import { useSettings } from "@/core/settings";

export function AccountPage() {
  const sync = useSync();
  const profile = useSettings((state) => state.communityProfile);
  const [busy, setBusy] = useState(false);
  const config = readFirebaseConfig();
  const mode = getFirebaseMode();
  const data = useLiveQuery(async () => {
    const [series, chapters, read, bookmarked, categories, downloads] = await Promise.all([
      db.manga.where("libraryFlag").equals(1).count(),
      db.chapters.count(),
      db.chapters.filter((item) => item.read).count(),
      db.chapters.filter((item) => item.bookmark).count(),
      db.categories.filter((item) => !item.deleted).count(),
      db.downloads.where("state").equals("done").count(),
    ]);
    return { series, chapters, read, bookmarked, categories, downloads };
  }, [], { series: 0, chapters: 0, read: 0, bookmarked: 0, categories: 0, downloads: 0 });
  const archives = useLiveQuery(() => db.accountArchives.orderBy("createdAt").reverse().toArray(), [], []);

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
          <h2>{profile.displayName || profile.username || sync.user?.name || sync.user?.email || (config ? "Connect your account" : "Firebase not configured")}</h2>
          {sync.user?.email && sync.user.name && <span className="muted">{sync.user.email}</span>}
          {sync.user && <span className="account-uid mono">UID {sync.user.uid}</span>}
        </div>
        <span className={`account-status ${sync.status}`}><i />{sync.status === "ready" ? "Synced" : sync.status === "connecting" ? "Connecting" : sync.status === "error" ? "Sync error" : "Sync off"}</span>
      </section>

      {!config ? (
        <section className="account-actions"><h2>Connect Firebase</h2><p className="muted">Use Comik Firebase or enter your own configuration in Settings to sign in and sync.</p><Link className="btn primary" to="/settings/firebase">Open settings</Link></section>
      ) : (
        <section className="account-actions">
          <div><span className="kicker">Firebase project</span><h2>{config.projectId}</h2><p className="muted">{mode === "default" ? "Comik Firebase" : "Your Firebase project"} · {sync.lastSyncedAt ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}` : "Not synced yet"}</p></div>
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

      <ProfilePreferences />

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
          <div className="kicker">Shared · public Community (Comik Firebase)</div>
          <h2>Community data</h2>
          <p className="muted">The public Community lives on the Comik Firebase project and is visible to every Comik user. Private rooms live on the Firebase project of whoever created them. Contributions are associated with your Firebase UID.</p>
          <ul className="account-data-list">
            <li>Discussion and recommendation posts, including comic/source references</li>
            <li>Comments, poll options, and individual poll votes</li>
            <li>Your comic ratings</li>
            <li>Optional attachments: an ImgBB link (you are asked first), or an image shrunk to 50 KB and stored with the post</li>
          </ul>
          <div className="account-local-note">Downloads, page images, imported files, and source page lists stay in this browser. Analytics are sent only when you opt in under Settings.</div>
        </section>
      </div>

      {!!archives?.length && <section className="account-archives">
        <div><div className="kicker">Saved on this device</div><h2>Local data archives</h2><p className="muted">Restore an archive to combine its library and progress with the current data.</p></div>
        <ul>{archives.map((archive) => <li key={archive.id}>
          <span><strong>{new Date(archive.createdAt).toLocaleString()}</strong><small>{archive.backup.manga.length} series · {archive.backup.chapters.length} chapters{archive.previousUid ? ` · previous account ${archive.previousUid.slice(0, 8)}` : ""}</small></span>
          <button className="btn sm" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const result = await restoreAccountArchive(archive.id); toast(`Restored ${result.manga} series and ${result.chapters} chapters`); }
            catch (error) { toast((error as Error).message, true); }
            finally { setBusy(false); }
          }}>Restore</button>
          <button className="icon-btn" disabled={busy} aria-label="Delete local archive" title="Delete archive" onClick={() => void db.accountArchives.delete(archive.id)}><Trash size={16} /></button>
        </li>)}</ul>
      </section>}

      {sync.user && <DangerZone signedInAs={sync.user.email || sync.user.name || "this guest account"} projectId={config?.projectId ?? ""} />}
    </div>
  );
}

type Pending = null | "reset" | "purge";

/** Reset keeps the account and empties it. Purge deletes the account too. Both need the word typed to confirm. */
function DangerZone({ signedInAs, projectId }: { signedInAs: string; projectId: string }) {
  const [pending, setPending] = useState<Pending>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "reset" | "purge"; summary: WipeSummary } | null>(null);
  const word = pending === "purge" ? "delete" : "reset";

  const close = () => { setPending(null); setTyped(""); };
  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const summary = pending === "purge" ? await purgeAccount(reauthenticate) : await wipeAccountData();
      setResult({ kind: pending, summary });
      toast(pending === "purge" ? "Account deleted" : "Account reset");
      close();
    } catch (error) {
      toast((error as Error).message || "That did not finish. Nothing more was changed.", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="account-danger" aria-labelledby="danger-title">
      <div className="kicker">Your data in {projectId || "Firebase"}</div>
      <h2 id="danger-title">Reset or delete this account</h2>
      <p className="muted">Both act on the cloud account ({signedInAs}). Your library on this device is not touched, and sync is switched off so it cannot upload it again by itself.</p>
      <div className="account-danger-grid">
        <article>
          <h3>Reset account</h3>
          <p>Keeps the account and signs you in as before, but deletes everything stored in it: your synced library and settings, your Community posts and ratings, and the likes, votes and comments you left on your own posts.</p>
          <button className="btn" disabled={busy} onClick={() => { setPending("reset"); setTyped(""); }}><ArrowClockwise size={17} />Reset account</button>
        </article>
        <article>
          <h3>Purge account</h3>
          <p>Does everything a reset does, then deletes the account itself from Firebase. This cannot be undone and the account cannot be recovered. You may be asked to sign in again to confirm.</p>
          <button className="btn danger" disabled={busy} onClick={() => { setPending("purge"); setTyped(""); }}><Trash size={17} />Purge account</button>
        </article>
      </div>
      <p className="hint muted">Comments, likes and votes you left on other people's posts cannot be searched for, so they stay. Private rooms keep their own data in the project that hosts them.</p>

      {pending && (
        <div className="account-danger-confirm" role="alertdialog" aria-labelledby="confirm-title">
          <h3 id="confirm-title"><Warning size={19} weight="fill" /> {pending === "purge" ? "Delete this account for good?" : "Erase everything in this account?"}</h3>
          <p>Type <strong className="mono">{word}</strong> to confirm.</p>
          <input className="input mono" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={word} autoComplete="off" aria-label={`Type ${word} to confirm`} autoFocus />
          <div className="account-danger-actions">
            <button className={`btn ${pending === "purge" ? "danger" : "primary"}`} disabled={busy || typed.trim().toLowerCase() !== word} onClick={() => void run()}>{busy ? "Working…" : pending === "purge" ? "Delete account" : "Reset account"}</button>
            <button className="btn" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="account-sync-note"><CloudCheck size={18} /> {result.kind === "purge" ? "The account was deleted." : "The account was reset."} Removed {result.summary.library.toLocaleString()} synced documents, {result.summary.posts} posts and {result.summary.ratings} ratings. Sync is off.</div>
      )}
    </section>
  );
}

function DataCount({ label, value, local = false }: { label: string; value: number; local?: boolean }) {
  return <div className="account-count"><strong className="mono">{value.toLocaleString()}</strong><span>{label}{local ? " · local" : ""}</span></div>;
}