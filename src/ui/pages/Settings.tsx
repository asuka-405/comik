import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { BookOpenText, Books, CaretLeft, CaretRight, CloudArrowUp, Compass, DownloadSimple, Info, Palette, ShieldCheck, type Icon } from "@phosphor-icons/react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/core/db";
import { useSettings, type FitMode, type LibraryDensity, type LibrarySort } from "@/core/settings";
import { proxyBase } from "@/core/http";
import { isNativeShell } from "@/core/platform";
import { addCustomSource, allSources, isCustom, onSourcesChange, removeCustomSource } from "@/core/sources/registry";
import { importLocal } from "@/core/sources/local";
import { createBackup, downloadBackup, restoreBackup } from "@/core/backup";
import { storageUsage } from "@/core/downloads";
import { getFirebaseMode, linkGoogle, parseFirebaseConfig, readCustomFirebaseConfig, readFirebaseConfig, resetFirebase, saveFirebaseConfig, setFirebaseMode, signOutSync, useSync } from "@/core/sync/firebase";
import { resetPushCursor, startSync, stopSync, syncNow } from "@/core/sync/engine";
import { Row, Toggle, bytes, timeAgo, toast } from "../common";
import type { CustomSourceRow } from "@/core/db";
import { refreshAnalyticsConsent } from "@/core/analytics";
import { useWalkthrough } from "@/core/onboarding";
import { TachiyomiImport } from "../components/TachiyomiImport";
import { CustomCssEditor, ThemeStudio } from "../components/ThemeStudio";
import { PRESETS } from "@/core/themes";
import RULES from "../../../firestore.rules?raw";

declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;

function Section({ id, title, children, hue = 0 }: { id?: string; title: string; children: ReactNode; hue?: number }) {
  return <section id={id} className="panel" data-hue={hue}><h2>{title}</h2>{children}</section>;
}

/* ------------------------------ settings shell ------------------------------ */
interface Category { slug: string; title: string; summary: (s: ReturnType<typeof useSettings.getState>) => string; icon: Icon; hue: number }

const CATEGORIES: Category[] = [
  { slug: "appearance", title: "Appearance", icon: Palette, hue: 0, summary: (s) => `${s.theme === "system" ? "System" : PRESETS.find((p) => p.id === s.theme)?.name ?? s.userThemes.find((t) => t.id === s.theme)?.name ?? "Custom"} theme, 3D backdrop ${s.fx ? "on" : "off"}` },
  { slug: "library", title: "Library", icon: Books, hue: 2, summary: (s) => `${s.autoUpdateHours ? `Updates every ${s.autoUpdateHours >= 24 ? `${s.autoUpdateHours / 24} day${s.autoUpdateHours > 24 ? "s" : ""}` : `${s.autoUpdateHours} hours`}` : "Updates off"}, ${s.libraryDensity === "list" ? "list" : `${s.libraryDensity} grid`}` },
  { slug: "reader", title: "Reader", icon: BookOpenText, hue: 4, summary: (s) => `${s.readerMode === "auto" ? "Auto mode" : s.readerMode.replace("paged-", "").replace("rtl", "right to left").replace("ltr", "left to right")}, ${s.fit} fit` },
  { slug: "downloads", title: "Downloads and storage", icon: DownloadSimple, hue: 6, summary: (s) => `${s.downloadConcurrency} at a time, backup and restore` },
  { slug: "proxy", title: "Sources and proxy", icon: Compass, hue: 5, summary: (s) => `${s.disabledSourceIds.length ? `${s.disabledSourceIds.length} disabled` : "All enabled"}, custom sources, file import` },
  { slug: "firebase", title: "Firebase and sync", icon: CloudArrowUp, hue: 3, summary: () => (getFirebaseMode() === "custom" ? "Your own Firebase" : "Comik Firebase") },
  { slug: "privacy", title: "Privacy and community", icon: ShieldCheck, hue: 1, summary: (s) => `Safe mode ${s.safeMode ? "on" : "off"}, analytics ${s.analyticsConsent ? "on" : "off"}` },
  { slug: "about", title: "About", icon: Info, hue: 0, summary: () => `Version ${APP_VERSION}` },
];

function useWide() {
  const query = "(min-width: 900px)";
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setWide(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Android-style settings: a list of categories, each opening its own page. Wide screens show both side by side. */
export function SettingsLayout() {
  const settings = useSettings();
  const { pathname } = useLocation();
  const detail = pathname.replace(/\/+$/, "") !== "/settings";
  return (
    <div className={`page settings-shell${detail ? " has-detail" : ""}`}>
      <nav className="settings-list" aria-label="Settings categories">
        <div className="topbar"><div><div className="kicker">Settings</div><h1>Make it yours</h1></div></div>
        {CATEGORIES.map(({ slug, title, summary, icon: CategoryIcon, hue }) => (
          <NavLink key={slug} to={`/settings/${slug}`} className="settings-item" data-hue={hue}>
            <span className="settings-icon"><CategoryIcon size={22} weight="duotone" /></span>
            <span className="settings-text"><strong>{title}</strong><small>{summary(settings)}</small></span>
            <CaretRight size={16} className="settings-caret" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>
      <div className="settings-detail"><Outlet /></div>
    </div>
  );
}

/** On a wide screen `/settings` has nothing to show beside the list, so open the first category. */
export function SettingsIndex() {
  const wide = useWide();
  return wide ? <Navigate to="/settings/appearance" replace /> : null;
}

function Detail({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <Link to="/settings" className="settings-back" aria-label="Back to settings"><CaretLeft size={20} /></Link>
        <div><h2>{title}</h2>{intro && <p className="muted">{intro}</p>}</div>
      </div>
      <div className="stack">{children}</div>
    </div>
  );
}

export function AppearanceSettings() {
  const s = useSettings();
  return (
    <Detail title="Appearance" intro="Themes, your own colours, and CSS for anything else.">
      <Section title="Theme" hue={0}>
        <ThemeStudio />
      </Section>
      <Section title="Motion" hue={0}>
        <Row title="3D panel backdrop" hint="Turn off to save battery. Reduced-motion users get a still frame."><Toggle label="3D backdrop" on={s.fx} onChange={(v) => s.set({ fx: v })} /></Row>
      </Section>
      <Section title="Custom CSS" hue={2}>
        <Row title="Use custom CSS" hint="Switch off to see the app without it"><Toggle label="Use custom CSS" on={s.customCssOn} onChange={(v) => s.set({ customCssOn: v })} /></Row>
        <CustomCssEditor />
      </Section>
    </Detail>
  );
}

export function LibrarySettings() {
  const s = useSettings();
  return (
    <Detail title="Library" intro="How your shelf looks and when it checks for new chapters.">
      <Section title="Updates" hue={2}>
        <Row title="Check for new chapters" hint="Runs when you open the app"><select className="input" style={{ width: "auto" }} value={s.autoUpdateHours} onChange={(e) => s.set({ autoUpdateHours: Number(e.target.value) })}><option value={0}>Never</option><option value={6}>Every 6 hours</option><option value={12}>Every 12 hours</option><option value={24}>Daily</option><option value={168}>Weekly</option></select></Row>
        <Row title="Skip completed series"><Toggle label="Skip completed" on={s.updateSkipCompleted} onChange={(v) => s.set({ updateSkipCompleted: v })} /></Row>
        <Row title="Skip series you have started" hint="Only check ones you have not read yet"><Toggle label="Skip started" on={s.updateSkipStarted} onChange={(v) => s.set({ updateSkipStarted: v })} /></Row>
      </Section>
      <Section title="Shelf" hue={2}>
        <Row title="Unread badges on covers"><Toggle label="Unread badges" on={s.libraryUnreadBadge} onChange={(v) => s.set({ libraryUnreadBadge: v })} /></Row>
        <Row title="Default sort"><select className="input" style={{ width: "auto" }} value={s.librarySort} onChange={(e) => s.set({ librarySort: e.target.value as LibrarySort })}><option value="lastRead">Last read</option><option value="lastUpdate">Latest update</option><option value="unread">Unread</option><option value="title">Title</option><option value="added">Date added</option></select></Row>
        <Row title="Sort ascending"><Toggle label="Ascending order" on={s.librarySortAsc} onChange={(v) => s.set({ librarySortAsc: v })} /></Row>
        <Row title="Shelf layout"><select className="input" style={{ width: "auto" }} value={s.libraryDensity} onChange={(e) => s.set({ libraryDensity: e.target.value as LibraryDensity })}><option value="cozy">Comfortable grid</option><option value="compact">Compact grid</option><option value="list">List</option></select></Row>
        <Row title="Only show unread"><Toggle label="Unread only" on={s.libraryOnlyUnread} onChange={(v) => s.set({ libraryOnlyUnread: v })} /></Row>
      </Section>
    </Detail>
  );
}

export function ReaderSettingsPage() {
  const s = useSettings();
  return (
    <Detail title="Reader" intro="Defaults for new series. You can still change them per series while reading.">
      <Section title="Layout" hue={4}>
        <Row title="Mode"><select className="input" style={{ width: "auto" }} value={s.readerMode} onChange={(e) => s.set({ readerMode: e.target.value as typeof s.readerMode })}><option value="auto">Auto</option><option value="paged-rtl">Right to left</option><option value="paged-ltr">Left to right</option><option value="paged-vertical">Vertical</option><option value="webtoon">Webtoon</option></select></Row>
        <Row title="Page fit"><select className="input" style={{ width: "auto" }} value={s.fit} onChange={(e) => s.set({ fit: e.target.value as FitMode })}><option value="width">Fit width</option><option value="height">Fit height</option><option value="screen">Fit screen</option><option value="original">Original size</option></select></Row>
        <Row title="Two-page spread"><Toggle label="Two pages" on={s.doublePages} onChange={(v) => s.set({ doublePages: v })} /></Row>
        <Row title="Keep wide pages single"><Toggle label="Smart spreads" on={s.smartSpreads} onChange={(v) => s.set({ smartSpreads: v })} /></Row>
        <Row title="Crop borders"><Toggle label="Crop borders" on={s.cropBorders} onChange={(v) => s.set({ cropBorders: v })} /></Row>
        <Row title="Split tall images"><Toggle label="Split tall" on={s.splitTall} onChange={(v) => s.set({ splitTall: v })} /></Row>
        <Row title="Preload pages" hint={`${s.preload} pages ahead`}><input type="range" min={1} max={10} value={s.preload} onChange={(e) => s.set({ preload: Number(e.target.value) })} /></Row>
      </Section>
      <Section title="Controls" hue={4}>
        <Row title="Tap zones"><select className="input" style={{ width: "auto" }} value={s.tapZones} onChange={(e) => s.set({ tapZones: e.target.value as typeof s.tapZones })}><option value="standard">Left and right</option><option value="l-shaped">L-shaped</option><option value="edge">Screen edges</option><option value="off">Off</option></select></Row>
        <Row title="Invert tap direction"><Toggle label="Invert taps" on={s.invertTaps} onChange={(v) => s.set({ invertTaps: v })} /></Row>
        <Row title="Show page number when controls hide"><Toggle label="Page number" on={s.showPageNumber} onChange={(v) => s.set({ showPageNumber: v })} /></Row>
        <Row title="Keep screen awake"><Toggle label="Keep screen awake" on={s.keepScreenOn} onChange={(v) => s.set({ keepScreenOn: v })} /></Row>
        <Row title="Auto-advance at chapter end"><Toggle label="Auto-next" on={s.autoNextChapter} onChange={(v) => s.set({ autoNextChapter: v })} /></Row>
        <Row title="Skip chapters already read when going next"><Toggle label="Skip read" on={s.skipReadChapters} onChange={(v) => s.set({ skipReadChapters: v })} /></Row>
      </Section>
      <Section title="Image color" hue={4}>
        <Row title="Screen brightness" hint={`${Math.round(s.brightness * 100)}%`}><input type="range" min={0.3} max={1.2} step={0.05} value={s.brightness} onChange={(e) => s.set({ brightness: Number(e.target.value) })} /></Row>
        <Row title="Warm tint" hint={`${Math.round(s.sepia * 100)}%`}><input type="range" min={0} max={0.8} step={0.05} value={s.sepia} onChange={(e) => s.set({ sepia: Number(e.target.value) })} /></Row>
        <Row title="Grayscale"><Toggle label="Grayscale" on={s.grayscale} onChange={(v) => s.set({ grayscale: v })} /></Row>
        <Row title="Invert image colors"><Toggle label="Invert colors" on={s.invert} onChange={(v) => s.set({ invert: v })} /></Row>
      </Section>
    </Detail>
  );
}

export function DownloadsSettings() {
  const s = useSettings();
  return (
    <Detail title="Downloads and storage" intro="Offline chapters, backups and the page cache.">
      <Section title="Downloads" hue={6}>
        <Row title="Concurrent downloads" hint={`${s.downloadConcurrency} at a time`}><input type="range" min={1} max={8} value={s.downloadConcurrency} onChange={(e) => s.set({ downloadConcurrency: Number(e.target.value) })} /></Row>
        <Row title="Download ahead" hint={`${s.autoDownloadAhead} chapters`}><input type="range" min={0} max={10} value={s.autoDownloadAhead} onChange={(e) => s.set({ autoDownloadAhead: Number(e.target.value) })} /></Row>
        <Row title="Delete download after reading"><Toggle label="Delete after read" on={s.deleteAfterRead} onChange={(v) => s.set({ deleteAfterRead: v })} /></Row>
      </Section>
      <Data />
      <TachiyomiImport />
    </Detail>
  );
}

export function ProxySettings() {
  return (
    <Detail title="Sources and proxy" intro="Which sources appear, where requests go, and your own files.">
      <Section title="Enabled sources" hue={5}>
        <p className="muted" style={{ marginBottom: 12 }}>Choose which built-in and custom sources appear in Discover and global search.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" to="/settings/sources">Manage enabled sources</Link>
          <Link className="btn" to="/source-studio">Source Studio</Link>
        </div>
      </Section>
      <SourcesSection />
      <LocalImport />
    </Detail>
  );
}

export function FirebaseSettings() {
  return (
    <Detail title="Firebase and sync" intro="Sign-in, library sync and private rooms. Reading in the browser needs your own project.">
      <SyncSection />
    </Detail>
  );
}

export function PrivacySettings() {
  const s = useSettings();
  return (
    <Detail title="Privacy and community" intro="Content filtering, the public Community and analytics.">
      <Section title="Content" hue={1}>
        <Row title="Safe mode" hint="Hide comics from sources marked as 18+. Enabled by default."><Toggle label="Safe mode" on={s.safeMode} onChange={(v) => s.set({ safeMode: v })} /></Row>
      </Section>
      <Section title="Community and analytics" hue={1}>
        <Row title="Comik public community" hint="Show the shared public discussion room. This does not affect personal library sync."><Toggle label="Comik public community" on={s.publicCommunityEnabled} onChange={(v) => s.set({ publicCommunityEnabled: v })} /></Row>
        <Row title="Anonymous usage analytics" hint="Asked on first run, where it starts switched on. Sends generic screen and feature events only, never comic titles, searches, or post text.">
        <Toggle label="Usage analytics" on={s.analyticsConsent} onChange={(enabled) => {
        s.set({ analyticsConsent: enabled });
        void refreshAnalyticsConsent(enabled);
        }} />
        </Row>
      </Section>
    </Detail>
  );
}

export function AboutSettings() {
  return (
    <Detail title="About" intro="Comik is a local-first reader for web comics.">
      <Section title={`Comik ${APP_VERSION}`} hue={0}>
        <Row title="Release notes and downloads"><a className="btn sm" href="/releases/" target="_blank" rel="noreferrer">Open releases</a></Row>
        <Row title="Firebase setup guide" hint="What each Firebase does and how to bring your own"><Link className="btn sm" to="/setup">Open guide</Link></Row>
        <Row title="Walkthrough" hint="The first-run tour and the Safe mode and analytics choices"><button className="btn sm" onClick={() => useWalkthrough.getState().show()}>Replay</button></Row>
        <Row title="Source code"><a className="btn sm" href="https://github.com/asuka-405/comik" target="_blank" rel="noreferrer">GitHub</a></Row>
      </Section>
    </Detail>
  );
}

/* --------------------------------- sync --------------------------------- */
function SyncSection() {
  const sync = useSync();
  const [cfgText, setCfgText] = useState("");
  const [googleWebClientId, setGoogleWebClientId] = useState(() => readFirebaseConfig()?.googleWebClientId ?? "");
  const [configured, setConfigured] = useState(() => getFirebaseMode() === "default" || !!readCustomFirebaseConfig());
  const [mode, setMode] = useState(getFirebaseMode);
  const [enabled, setEnabled] = useState(() => localStorage.getItem("comik.sync.enabled") === "1");
  const [showRules, setShowRules] = useState(false);
  const [proxyRegion, setProxyRegion] = useState(() => readCustomFirebaseConfig()?.proxyRegion ?? "");

  const saveConfig = () => {
    try {
      if (enabled) stopSync();
      saveFirebaseConfig({ ...parseFirebaseConfig(cfgText), googleWebClientId: googleWebClientId.trim() });
      resetFirebase();
      resetPushCursor();
      setMode("custom");
      setConfigured(true);
      setCfgText("");
      toast("Firebase config saved");
      if (enabled) void startSync();
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
  const switchMode = (next: "default" | "custom") => {
    if (next === mode) return;
    stopSync();
    setFirebaseMode(next);
    resetFirebase();
    resetPushCursor();
    setMode(next);
    const config = readFirebaseConfig();
    setConfigured(!!readCustomFirebaseConfig() || next === "default");
    setGoogleWebClientId(config?.googleWebClientId ?? "");
    setProxyRegion(readCustomFirebaseConfig()?.proxyRegion ?? "");
    useSync.getState().patch({ status: "off", user: null, error: undefined });
    void refreshAnalyticsConsent(useSettings.getState().analyticsConsent);
    if (enabled && (next === "default" || readCustomFirebaseConfig())) void startSync();
  };
  const savePartial = (patch: Partial<NonNullable<ReturnType<typeof readCustomFirebaseConfig>>>, message: string) => {
    const config = readCustomFirebaseConfig();
    if (!config) return;
    saveFirebaseConfig({ ...config, ...patch });
    resetFirebase();
    toast(message);
  };
  const ready = mode === "default" || configured;

  return (
    <Section id="sync" title="Firebase project" hue={3}>
      <div className="seg" style={{ marginBottom: 12 }}>
        <button className={mode === "default" ? "on" : ""} onClick={() => switchMode("default")}>Comik Firebase</button>
        <button className={mode === "custom" ? "on" : ""} onClick={() => switchMode("custom")}>My Firebase</button>
      </div>
      {mode === "default" ? (
        <div className="panel" data-hue="3">
          <h2>Comik's Firebase</h2>
          <p className="muted" style={{ lineHeight: 1.65 }}>Handles sign-in, library sync, the public Community and private rooms, with nothing to set up. Your data is stored in Comik's project, readable only by you. {isNativeShell
            ? "In this app comics are fetched from your own device, so everything works with it."
            : "It never fetches comics. To read in the browser, use your own Firebase, or use the Android, Linux or Windows app."}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {!isNativeShell && <Link className="btn primary" to="/setup">Set up my Firebase</Link>}
            <button className="btn" onClick={() => switchMode("custom")}>Use my own Firebase</button>
          </div>
        </div>
      ) : !configured ? (
        <>
          <div className="field"><label>Paste your Firebase web config</label><textarea className="input mono" rows={6} value={cfgText} onChange={(e) => setCfgText(e.target.value)} placeholder={'{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'} /></div>
          <button className="btn primary" disabled={!cfgText.trim()} onClick={saveConfig}>Save config</button>
          <p className="hint muted" style={{ marginTop: 12, lineHeight: 1.7 }}>Your project handles sign-in, sync and Community{isNativeShell ? "" : ", and, through a function you deploy, reading comics in the browser"}. Everything is stored in your own Firebase and Comik keeps nothing. <Link to="/setup">Step-by-step guide</Link>.</p>
        </>
      ) : null}
      {mode === "custom" && configured && (
        <>
          <div className="field" style={{ marginTop: 4 }}>
            <label htmlFor="google-web-client-id">Google OAuth Web client ID</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input id="google-web-client-id" className="input mono" style={{ flex: "1 1 320px", minWidth: 0 }} value={googleWebClientId} onChange={(event) => setGoogleWebClientId(event.target.value.trim())} placeholder="...apps.googleusercontent.com" autoComplete="off" />
              <button className="btn sm" disabled={!googleWebClientId.trim()} onClick={() => savePartial({ googleWebClientId: googleWebClientId.trim() }, "Google client ID saved")}>Save client ID</button>
            </div>
            <p className="hint muted">Required for Android's native Google account chooser. Use the Web OAuth client from this Firebase project.</p>
          </div>
          {!isNativeShell && <div className="field">
            <label htmlFor="proxy-region">Proxy function region</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input id="proxy-region" className="input mono" style={{ flex: "0 1 220px", minWidth: 0 }} value={proxyRegion} onChange={(event) => setProxyRegion(event.target.value.trim())} placeholder="us-central1" autoComplete="off" />
              <button className="btn sm" onClick={() => savePartial({ proxyRegion: proxyRegion.trim() || undefined }, "Proxy region saved")}>Save region</button>
            </div>
            <p className="hint muted">Where you deployed <span className="mono">comikProxy</span>. The browser sends source requests there. Leave empty for us-central1. <Link to="/setup">Deploy guide</Link>.</p>
          </div>}
        </>
      )}
      {ready && (
        <>
          <Row title="Sync this device" hint={enabled ? (sync.user ? `${sync.user.isAnonymous ? "Guest account" : sync.user.email ?? "Signed in"}${sync.lastSyncedAt ? `, synced ${timeAgo(sync.lastSyncedAt)}` : ""}` : sync.status === "connecting" ? "Connecting" : "Starting") : "Off, data stays on this device"}>
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
            {mode === "custom" && <button className="btn sm ghost" onClick={() => setShowRules(!showRules)}>Firestore rules</button>}
            {mode === "custom" && <button className="btn sm ghost danger" onClick={() => {
              turnOff();
              saveFirebaseConfig(null);
              resetFirebase();
              setMode("default");
              setConfigured(true);
            }}>Forget my Firebase</button>}
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

  const test = async () => {
    if (!proxyBase()) return setHealth("No proxy yet. Connect your own Firebase to read in the browser.");
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
      await addCustomSource({ kind, name: name.trim() || new URL(url).host, baseUrl: url, lang, config: {} });
      setName(""); setUrl("");
      toast("Source added");
    } catch (e) {
      toast((e as Error).message || "Check the URL", true);
    }
  };

  return (
    <Section id="sources" title="Sources and proxy" hue={5}>
      <div className="field"><label>Proxy address (advanced; leave empty to use this device or your Firebase)</label>
        <div style={{ display: "flex", gap: 8 }}><input className="input" value={proxyUrl} onChange={(e) => set({ proxyUrl: e.target.value })} placeholder="https://my-proxy.example.com" /><button className="btn" onClick={test}>Test</button></div>
        {health && <span className="hint muted">{health}</span>}
      </div>
      <div className="label" style={{ margin: "16px 0 8px" }}>Your custom sources</div>
      {allSources().filter((s) => isCustom(s.id)).map((s) => (
        <Row key={s.id} title={s.name} hint={s.baseUrl}><button className="btn sm danger" onClick={() => void removeCustomSource(s.id)}>Remove</button></Row>
      ))}
      {!allSources().some((s) => isCustom(s.id)) && <p className="muted" style={{ fontSize: 13 }}>None yet.</p>}
      <div className="label" style={{ margin: "18px 0 8px" }}>Add a source</div>
      <div className="seg" style={{ marginBottom: 12 }}>{(["madara", "themesia", "selector"] as const).map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "themesia" ? "MangaThemesia" : k === "madara" ? "Madara" : "Source Studio"}</button>)}</div>
      {kind === "selector" ? <div className="source-studio-launch">
        <p className="muted">Map catalog cards, chapter rows, and reader images visually in a dedicated workspace.</p>
        <Link className="btn primary" to="/source-studio"><span>Open Source Studio</span></Link>
      </div> : <>
        <div className="field"><label>Site address</label><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="field" style={{ flex: 1 }}><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field" style={{ width: 90 }}><label>Language</label><input className="input" value={lang} onChange={(e) => setLang(e.target.value)} /></div>
        </div>
        <button className="btn primary" disabled={!url} onClick={add}>Add source</button>
      </>}
      <p className="hint muted" style={{ marginTop: 10 }}>Only connect sites you own or are allowed to access. Sites that require scripts, logins, or access challenges are not supported by this source setup.</p>
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
