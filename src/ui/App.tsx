import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { BookBookmark, ChatCircleText, Clock, Compass, GearSix, MagnifyingGlass, UserCircle } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { useSettings } from "@/core/settings";
import { trackAnalytics } from "@/core/analytics";
import { loadCustomSources } from "@/core/sources/registry";
import { maybeAutoUpdate } from "@/core/updater";
import { readFirebaseConfig } from "@/core/sync/firebase";
import { startSync } from "@/core/sync/engine";
import { Backdrop } from "./Backdrop";
import { Toasts } from "./common";
import { Palette } from "./Palette";
import { Shelf } from "./pages/Shelf";
import { Browse } from "./pages/Browse";
import { SourceView } from "./pages/SourceView";
import { Series } from "./pages/Series";
import { Timeline } from "./pages/Timeline";
import { AboutSettings, AppearanceSettings, DownloadsSettings, FirebaseSettings, LibrarySettings, PrivacySettings, ProxySettings, ReaderSettingsPage, SettingsIndex, SettingsLayout } from "./pages/Settings";
import { SourceSettingsPage } from "./pages/SourceSettings";
import { CommunityNewPostPage, CommunityPage } from "./pages/Community";
import { AccountPage } from "./pages/Account";
import { LoginPage } from "./pages/Login";
import { SourceStudioPage } from "./components/SourceStudio";
import { Reader } from "./reader/Reader";
import { WebSetup } from "./pages/WebSetup";
import { proxyToken } from "@/core/http";
import { Onboarding } from "./Onboarding";

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#e6ecdf" : "#111713");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

export function App() {
  useTheme();
  const [palette, setPalette] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const reading = loc.pathname.startsWith("/read/");
  const analyticsConsent = useSettings((s) => s.analyticsConsent);

  useEffect(() => {
    void loadCustomSources();
    void maybeAutoUpdate();
    if (readFirebaseConfig() && localStorage.getItem("comik.sync.enabled") === "1") void startSync();
  }, []);

  // With a Firebase proxy, source requests carry a sign-in token. Keep one ready so image URLs can use it.
  useEffect(() => {
    const tick = () => void proxyToken().catch(() => {});
    tick();
    const timer = setInterval(tick, 10 * 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const screen = loc.pathname.split("/").filter(Boolean)[0] ?? "shelf";
    void trackAnalytics("comik_screen_view", { screen });
  }, [loc.pathname, analyticsConsent]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  const newCount = useLiveQuery(async () => {
    const since = Number(localStorage.getItem("comik.timeline.seen") ?? 0);
    return db.chapters.where("fetchedAt").above(Math.max(since, 1)).filter((c) => !c.read).count();
  }, [loc.pathname], 0);

  if (loc.pathname === "/setup") return <WebSetup />;

  if (reading) {
    return (
      <>
        <Routes><Route path="/read/:chapterId" element={<Reader />} /></Routes>
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Backdrop />
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="logo" aria-hidden="true"><BookBookmark size={24} weight="fill" /></div>
          <NavLink to="/" end className="nav-btn" aria-label="Shelf"><BookBookmark size={24} /><span className="tip">Shelf</span></NavLink>
          <NavLink to="/browse" className="nav-btn" aria-label="Discover"><Compass size={24} /><span className="tip">Discover</span></NavLink>
          <NavLink to="/timeline" className="nav-btn" aria-label="Timeline"><Clock size={24} />{!!newCount && <span className="dot">{newCount > 99 ? "99+" : newCount}</span>}<span className="tip">Timeline</span></NavLink>
          <NavLink to="/community" className="nav-btn" aria-label="Community"><ChatCircleText size={24} /><span className="tip">Community</span></NavLink>
          <NavLink to="/account" className="nav-btn" aria-label="Account"><UserCircle size={24} /><span className="tip">Account and sync</span></NavLink>
          <div className="grow" />
          <NavLink to="/settings" className="nav-btn" aria-label="Settings"><GearSix size={24} /><span className="tip">Settings</span></NavLink>
        </nav>
        <main>
          <form className="shell-searchbar" role="search" onSubmit={(event) => {
            event.preventDefault();
            const query = (event.currentTarget.elements.namedItem("global-search") as HTMLInputElement).value.trim();
            if (query) nav(`/browse?q=${encodeURIComponent(query)}`);
          }}>
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input name="global-search" type="search" placeholder="Search your shelf and every source" aria-label="Search your shelf and every source" />
            <button type="button" className="shell-search-shortcut" onClick={() => setPalette(true)}>Ctrl K</button>
          </form>
          <Routes>
            <Route path="/" element={<Shelf onSearch={() => setPalette(true)} />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/browse/:sourceId" element={<SourceView />} />
            <Route path="/series/:id" element={<Series />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/community/new" element={<CommunityNewPostPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<SettingsIndex />} />
              <Route path="appearance" element={<AppearanceSettings />} />
              <Route path="library" element={<LibrarySettings />} />
              <Route path="reader" element={<ReaderSettingsPage />} />
              <Route path="downloads" element={<DownloadsSettings />} />
              <Route path="proxy" element={<ProxySettings />} />
              <Route path="firebase" element={<FirebaseSettings />} />
              <Route path="privacy" element={<PrivacySettings />} />
              <Route path="about" element={<AboutSettings />} />
            </Route>
            <Route path="/settings/sources" element={<SourceSettingsPage />} />
            <Route path="/source-studio" element={<SourceStudioPage />} />
            <Route path="*" element={<div className="page"><div className="empty"><h2>Lost page</h2><button className="btn primary" onClick={() => nav("/")}>Back to shelf</button></div></div>} />
          </Routes>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
      <Onboarding />
      <Toasts />
    </>
  );
}
