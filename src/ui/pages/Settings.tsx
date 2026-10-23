import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db";
import { useSettings, type Theme } from "@/core/settings";
import { proxyBase } from "@/core/http";
import { addCustomSource, allSources, isCustom, onSourcesChange, removeCustomSource } from "@/core/sources/registry";
import { importLocal } from "@/core/sources/local";
import { createBackup, downloadBackup, restoreBackup } from "@/core/backup";
import { storageUsage } from "@/core/downloads";
import { linkGoogle, parseFirebaseConfig, readFirebaseConfig, resetFirebase, saveFirebaseConfig, signOutSync, useSync } from "@/core/sync/firebase";
import { resetPushCursor, startSync, stopSync, syncNow } from "@/core/sync/engine";
import { Row, Toggle, bytes, timeAgo, toast } from "../common";
import type { CustomSourceRow } from "@/core/db";

function Section({ id, title, children, hue = 0 }: { id?: string; title: string; children: ReactNode; hue?: number }) {
  return <section id={id} className="panel" data-hue={hue}><h2>{title}</h2>{children}</section>;
}

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;

const SELECTOR_EXAMPLE = `{
  "popularUrl": "https://example.com/series?page={page}",
  "searchUrl": "https://example.com/search?q={query}&page={page}",
  "card": ".series-card",
  "cardTitle": ".title",
  "detailDescription": ".summary",
  "chapterRow": ".chapter-list li",
  "chapterDate": ".date",
  "pageImage": ".reader img"
}`;

export function SettingsPage() {
  const s = useSettings();
  return (
    <div className="page">
      <div className="topbar"><div><div className="kicker">Settings</div><h1>Make it yours</h1></div></div>
      <div className="two" style={{ alignItems: "start" }}>
        <div className="stack">
          <Section title="Appearance" hue={0}>
            <Row title="Theme">
              <div className="seg">{(["system", "dark", "light"] as Theme[]).map((t) => <button key={t} className={s.theme === t ? "on" : ""} onClick={() => s.set({ theme: t })} style={{ textTransform: "capitalize" }}>{t}</button>)}</div>
            </Row>
            <Row title="3D panel backdrop" hint="Turn off to save battery. Reduced-motion users get a still frame."><Toggle label="3D backdrop" on={s.fx} onChange={(v) => s.set({ fx: v })} /></Row>
            <Row title="Unread badges on covers"><Toggle label="Unread badges" on={s.libraryUnreadBadge} onChange={(v) => s.set({ libraryUnreadBadge: v })} /></Row>
          </Section>
          <Section title="Library updates" hue={2}>
            <Row title="Check for new chapters" hint="Runs when you open the app"><select className="input" style={{ width: "auto" }} value={s.autoUpdateHours} onChange={(e) => s.set({ autoUpdateHours: Number(e.target.value) })}><option value={0}>Never</option><option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Daily</option><option value={168}>Weekly</option></select></Row>
            <Row title="Skip completed series"><Toggle label="Skip completed" on={s.updateSkipCompleted} onChange={(v) => s.set({ updateSkipCompleted: v })} /></Row>
            <Row title="Skip series you have started" hint="Only check ones you have not read yet"><Toggle label="Skip started" on={s.updateSkipStarted} onChange={(v) => s.set({ updateSkipStarted: v })} /></Row>
          </Section>
          <Section title="Reading defaults" hue={4}>
            <Row title="Mode"><select className="input" style={{ width: "auto" }} value={s.readerMode} onChange={(e) => s.set({ readerMode: e.target.value as typeof s.readerMode })}><option value="auto">Auto</option><option value="paged-rtl">Right to left</option><option value="paged-ltr">Left to right</option><option value="paged-vertical">Vertical</option><option value="webtoon">Webtoon</option></select></Row>
            <Row title="Crop borders"><Toggle label="Crop borders" on={s.cropBorders} onChange={(v) => s.set({ cropBorders: v })} /></Row>
            <Row title="Split tall images"><Toggle label="Split tall" on={s.splitTall} onChange={(v) => s.set({ splitTall: v })} /></Row>
            <Row title="Skip chapters already read when going next"><Toggle label="Skip read" on={s.skipReadChapters} onChange={(v) => s.set({ skipReadChapters: v })} /></Row>
            <Row title="Smaller images (MangaDex data saver)"><Toggle label="Data saver" on={s.dataSaver} onChange={(v) => s.set({ dataSaver: v })} /></Row>
            <Row title="Delete download after reading"><Toggle label="Delete after read" on={s.deleteAfterRead} onChange={(v) => s.set({ deleteAfterRead: v })} /></Row>
          </Section>
          <Data />
        </div>
        <div className="stack">
          <SyncSection />
          <SourcesSection />
          <LocalImport />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- sync --------------------------------- */
function SyncSection() {
  const sync = useSync();
  const [cfgText, setCfgText] = useState("");
  const [configured, setConfigured] = useState(() => !!readFirebaseConfig());
  const [enabled, setEnabled] = useState(() => localStorage.getItem("comik.sync.enabled") === "1");
  const [showRules, setShowRules] = useState(false);

  const saveConfig = () => {
    try {
      saveFirebaseConfig(parseFirebaseConfig(cfgText));
      resetFirebase();
      setConfigured(true);
      setCfgText("");
      toast("Firebase config saved");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const turnOn = async () => {
    localStorage.setItem("comik.sync.enabled", "1");
    setEnabled(true);
    await startSync();
  };
  const turnOff = () => {
    localStorage.removeItem("comik.sync.enabled");
    setEnabled(false);
    stopSync();
    useSync.getState().patch({ status: "off" });
  };

  return (
    <Section id="sync" title="Sync (optional)" hue={3}>
      <p className="muted" style={{ marginBottom: 12 }}>Without sync, everything lives in this browser. With sync, your shelf, progress and categories follow an anonymous account across sessions. Link Google to also reach them from other devices.</p>
      {!configured ? (
        <>
          <div className="field"><label>Paste your Firebase web config</label><textarea className="input mono" rows={6} value={cfgText} onChange={(e) => setCfgText(e.target.value)} placeholder={'{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'} /></div>
          <button className="btn primary" disabled={!cfgText.trim()} onClick={saveConfig}>Save config</button>
          <p className="hint muted" style={{ marginTop: 10 }}>In the Firebase console: create a project, add a Web app, enable Authentication with the Anonymous provider and create a Firestore database.</p>
        </>
      ) : (
        <>
          <Row title="Sync this device" hint={enabled ? (sync.user ? `${sync.user.isAnonymous ? "Anonymous account" : sync.user.email ?? "Signed in"}${sync.lastSyncedAt ? `, synced ${timeAgo(sync.lastSyncedAt)}` : ""}` : sync.status === "connecting" ? "Connecting" : "Starting") : "Off, data stays local"}>
            <Toggle label="Sync" on={enabled} onChange={(v) => (v ? void turnOn() : turnOff())} />
          </Row>
          {sync.status === "error" && <div className="err" style={{ margin: "10px 0" }}>{sync.error}</div>}
          {enabled && sync.user && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button className="btn sm" onClick={() => { resetPushCursor(); syncNow(); toast("Uploading everything"); }} disabled={sync.syncing}>{sync.syncing ? "Syncing" : "Sync now"}</button>
              {sync.user.isAnonymous && <button className="btn sm primary" onClick={() => linkGoogle().then(() => toast("Google account linked")).catch((e: Error) => toast(e.message, true))}>Link Google</button>}
              {!sync.user.isAnonymous && <button className="btn sm" onClick={() => void signOutSync().then(turnOff)}>Sign out</button>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn sm ghost" onClick={() => setShowRules(!showRules)}>Firestore rules</button>
            <button className="btn sm ghost danger" onClick={() => { turnOff(); saveFirebaseConfig(null); resetFirebase(); setConfigured(false); }}>Remove config</button>
          </div>
          {showRules && <pre className="input mono" style={{ whiteSpace: "pre-wrap", marginTop: 10, fontSize: 12 }}>{RULES}</pre>}
        </>
      )}
    </Section>
  );
}

/* -------------------------------- sources -------------------------------- */
function SourcesSection() {
  const [, force] = useState(0);
  useEffect(() => { const off = onSourcesChange(() => force((n) => n + 1)); return () => { off(); }; }, []);
  const proxyUrl = useSettings((s) => s.proxyUrl);
  const set = useSettings((s) => s.set);
  const [health, setHealth] = useState("");
  const [kind, setKind] = useState<CustomSourceRow["kind"]>("madara");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [lang, setLang] = useState("en");
  const [cfg, setCfg] = useState("");

  const test = async () => {
    setHealth("Checking");
    try {
      const r = await fetch(`${proxyBase()}/health`);
      setHealth(r.ok ? "Proxy is reachable" : `Proxy answered ${r.status}`);
    } catch {
      setHealth("Cannot reach the proxy");
    }
  };

  const add = async () => {
    try {
      new URL(url);
      let config: Record<string, string> = {};
      if (kind === "selector") config = JSON.parse(cfg) as Record<string, string>;
      if (kind === "selector" && (!config.popularUrl || !config.card || !config.chapterRow || !config.pageImage)) throw new Error("Selector sources need popularUrl, card, chapterRow and pageImage");
      await addCustomSource({ kind, name: name.trim() || new URL(url).host, baseUrl: url, lang, config });
      setName(""); setUrl(""); setCfg("");
      toast("Source added");
    } catch (e) {
      toast((e as Error).message || "Check the URL", true);
    }
  };

  return (
    <Section id="sources" title="Sources and proxy" hue={5}>
      <div className="field"><label>Proxy address (leave empty to use this site)</label>
        <div style={{ display: "flex", gap: 8 }}><input className="input" value={proxyUrl} onChange={(e) => set({ proxyUrl: e.target.value })} placeholder="https://my-proxy.example.com" /><button className="btn" onClick={test}>Test</button></div>
        {health && <span className="hint muted">{health}</span>}
      </div>
      <div className="label" style={{ margin: "16px 0 8px" }}>Your custom sources</div>
      {allSources().filter((s) => isCustom(s.id)).map((s) => (
        <Row key={s.id} title={s.name} hint={s.baseUrl}><button className="btn sm danger" onClick={() => void removeCustomSource(s.id)}>Remove</button></Row>
      ))}
      {!allSources().some((s) => isCustom(s.id)) && <p className="muted" style={{ fontSize: 13 }}>None yet.</p>}
      <div className="label" style={{ margin: "18px 0 8px" }}>Add a source</div>
      <div className="seg" style={{ marginBottom: 12 }}>{(["madara", "themesia", "selector"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "themesia" ? "MangaThemesia" : k === "madara" ? "Madara" : "Selectors"}</button>)}</div>
      <div className="field"><label>Site address</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="field" style={{ flex: 1 }}><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ width: 90 }}><label>Language</label><input className="input" value={lang} onChange={(e) => setLang(e.target.value)} /></div>
      </div>
      {kind === "selector" && <div className="field"><label>CSS selectors and URL templates (JSON)</label><textarea className="input mono" rows={9} value={cfg} onChange={(e) => setCfg(e.target.value)} placeholder={SELECTOR_EXAMPLE} /></div>}
      <button className="btn primary" disabled={!url} onClick={add}>Add source</button>
      <p className="hint muted" style={{ marginTop: 10 }}>Sites behind Cloudflare challenges or logins cannot be read by a plain proxy. Only add sites you are allowed to read.</p>
    </Section>
  );
}

/* ----------------------------- local import ----------------------------- */
function LocalImport() {
  const input = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Import files" hue={6}>
      <p className="muted" style={{ marginBottom: 12 }}>Read CBZ or ZIP archives (one per chapter) or loose images. They stay on this device and never sync.</p>
      <div className="field"><label>Series name</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the first file name" /></div>
      <input ref={input} type="file" multiple accept=".cbz,.zip,image/*" hidden onChange={async (e) => {
        const files = [...(e.target.files ?? [])];
        if (!files.length) return;
        setBusy(true);
        try { await importLocal(files, title); toast(`Imported ${files.length} file${files.length === 1 ? "" : "s"} to your shelf`); setTitle(""); } catch (err) { toast((err as Error).message, true); }
        setBusy(false);
        e.target.value = "";
      }} />
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Importing" : "Choose files"}</button>
    </Section>
  );
}

/* ---------------------------------- data ---------------------------------- */
function Data() {
  const restore = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState({ used: 0, quota: 0 });
  const dls = useLiveQuery(() => db.downloads.where("state").equals("done").count(), [], 0);
  useEffect(() => { void storageUsage().then(setUsage); }, [dls]);
  return (
    <Section title="Your data" hue={1}>
      <Row title="Storage used" hint={usage.quota ? `${bytes(usage.used)} of ${bytes(usage.quota)} available, ${dls} chapters downloaded` : `${dls} chapters downloaded`}>
        <button className="btn sm danger" disabled={!dls} onClick={async () => { await db.pageBlobs.clear(); await db.downloads.clear(); toast("Downloads cleared"); }}>Clear downloads</button>
      </Row>
      <Row title="Backup" hint="Shelf, progress, categories, custom sources and settings as one file">
        <button className="btn sm" onClick={async () => downloadBackup(await createBackup())}>Export</button>
        <button className="btn sm" onClick={() => restore.current?.click()}>Restore</button>
        <input ref={restore} type="file" accept="application/json,.json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { const r = await restoreBackup(f); toast(`Restored ${r.manga} series`); } catch (err) { toast((err as Error).message, true); }
          e.target.value = "";
        }} />
      </Row>
      <Row title="Clear page cache" hint="Forces fresh page lists next time"><button className="btn sm" onClick={async () => { await db.pageCache.clear(); toast("Cache cleared"); }}>Clear</button></Row>
    </Section>
  );
}
