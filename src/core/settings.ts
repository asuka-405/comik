import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReaderMode } from "./types";
import type { UserTheme } from "./themes";
import { DEFAULT_COMMUNITY_PROFILE, DEFAULT_TASTE_PREFERENCES, type CommunityProfile, type TastePreferences } from "./preferences";

/** "system", a built-in preset id, or the id of one of the user's own themes. */
export type Theme = string;
export type FitMode = "width" | "height" | "screen" | "original";
/**
 * Sources that failed the health check (scripts/check-sources.ts) when they were last tested: dead hosts, empty
 * searches, chapters with no pages. They start disabled; turning one back on in Settings is respected.
 * Sources that only fail behind Cloudflare in the Node proxy are not listed, since the apps pass that check.
 */
export const DEFAULT_DISABLED_SOURCE_IDS = [
  "mihon-8904806262353429205", // Anisa Scans: HTTP 502
  "mihon-2571489285618757730", // Coffee Manga (Unoriginal): chapters have no pages
  "mihon-3694940277826033657", // Gourmet Scans: chapters have no pages
  "cutiecomics-en", // Cutie Comics: search finds nothing
  "mihon-58992897252080929", // KokoMangas: search finds nothing
  "mihon-3544957587727489204", // Manhuanext: search finds nothing
  "mihon-6293890187960663957", // TopManhua.fan: search finds nothing
  "mihon-6540843430852844328", // WuxiaWorld: search finds nothing
];
/** Bump when the list above changes so existing installs get the new entries once. */
const SOURCE_DEFAULTS_VERSION = 1;

export type LibrarySort = "title" | "unread" | "lastRead" | "added" | "lastUpdate";
export type LibraryDensity = "cozy" | "compact" | "list";
export type LibraryGridColumns = "auto" | 2 | 3 | 4 | 5 | 6;

export interface Settings {
  theme: Theme;
  /** Themes the user made or imported. */
  userThemes: UserTheme[];
  /** Stylesheet applied on top of everything, for changes the colour editor cannot make. */
  customCss: string;
  customCssOn: boolean;
  /** three.js backdrop + hero scenes. */
  fx: boolean;
  /** Hide content from sources marked as adult. */
  safeMode: boolean;
  /** Show the shared Comik public community. */
  publicCommunityEnabled: boolean;
  readerCommunityEnabled: boolean;
  communityProfile: CommunityProfile;
  tastePreferences: TastePreferences;
  /** Where the proxy lives. Empty = same origin (/api). */
  proxyUrl: string;
  /** Source IDs disabled on this device. */
  disabledSourceIds: string[];
  /** Which version of DEFAULT_DISABLED_SOURCE_IDS has been applied to this device. */
  sourceDefaultsVersion: number;
  /** Firebase Analytics is explicitly opt-in. */
  analyticsConsent: boolean;

  /** Hash of the Vault PIN, or empty for no lock. Stays on this device. */
  vaultPin: string;

  // library
  librarySort: LibrarySort;
  librarySortAsc: boolean;
  libraryDensity: LibraryDensity;
  libraryGridColumns: LibraryGridColumns;
  globalSearchGridColumns: LibraryGridColumns;
  globalSearchTolerance: number;
  libraryUnreadBadge: boolean;
  libraryOnlyUnread: boolean;
  autoUpdateHours: number; // 0 = off
  updateSkipCompleted: boolean;
  updateSkipStarted: boolean;

  // reader
  readerMode: ReaderMode;
  fit: FitMode;
  webtoonGap: number;
  webtoonSidePadding: number; // percent per side
  doublePages: boolean;
  smartSpreads: boolean; // detect wide pages and show them alone
  cropBorders: boolean;
  splitTall: boolean; // split very tall images in paged modes
  preload: number;
  tapZones: "standard" | "l-shaped" | "edge" | "off";
  invertTaps: boolean;
  showPageNumber: boolean;
  keepScreenOn: boolean;
  brightness: number; // 0.3..1.2
  grayscale: boolean;
  invert: boolean;
  /** Web novel reader: text size in px, line spacing multiplier, and serif or sans body text. */
  novelFontSize: number;
  novelLineHeight: number;
  novelFont: "serif" | "sans";
  sepia: number; // 0..1
  autoNextChapter: boolean;
  skipReadChapters: boolean;

  // downloads
  downloadConcurrency: number;
  autoDownloadAhead: number;
  deleteAfterRead: boolean;

  set: (patch: Partial<Settings>) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: "system",
      userThemes: [],
      customCss: "",
      customCssOn: true,
      fx: true,
      safeMode: true,
      publicCommunityEnabled: true,
      readerCommunityEnabled: false,
      communityProfile: DEFAULT_COMMUNITY_PROFILE,
      tastePreferences: DEFAULT_TASTE_PREFERENCES,
      proxyUrl: "",
      disabledSourceIds: [...DEFAULT_DISABLED_SOURCE_IDS],
      sourceDefaultsVersion: SOURCE_DEFAULTS_VERSION,
      analyticsConsent: false,

      librarySort: "lastRead",
      librarySortAsc: false,
      vaultPin: "",
      libraryDensity: "cozy",
      libraryGridColumns: "auto",
      globalSearchGridColumns: "auto",
      globalSearchTolerance: 0.75,
      libraryUnreadBadge: true,
      libraryOnlyUnread: false,
      autoUpdateHours: 12,
      updateSkipCompleted: true,
      updateSkipStarted: false,

      readerMode: "auto",
      fit: "width",
      webtoonGap: 0,
      webtoonSidePadding: 0,
      doublePages: false,
      smartSpreads: true,
      cropBorders: false,
      splitTall: true,
      preload: 4,
      tapZones: "standard",
      invertTaps: false,
      showPageNumber: true,
      keepScreenOn: true,
      brightness: 1,
      grayscale: false,
      invert: false,
      novelFontSize: 18,
      novelLineHeight: 1.85,
      novelFont: "serif",
      sepia: 0,
      autoNextChapter: true,
      skipReadChapters: false,

      downloadConcurrency: 3,
      autoDownloadAhead: 0,
      deleteAfterRead: false,

      set: (patch) => set(patch),
    }),
    {
      name: "comik.settings.v1",
      // Saved settings from before the defaults existed get them added once, never again, so a source the user re-enables stays on.
      merge: (saved, current) => {
        const merged = { ...current, ...(saved as Partial<Settings>) };
        if ((merged.sourceDefaultsVersion ?? 0) < SOURCE_DEFAULTS_VERSION) {
          merged.disabledSourceIds = [...new Set([...(merged.disabledSourceIds ?? []), ...DEFAULT_DISABLED_SOURCE_IDS])];
          merged.sourceDefaultsVersion = SOURCE_DEFAULTS_VERSION;
        }
        return merged;
      },
      partialize: (s) => {
        const { set: _set, ...rest } = s;
        return rest;
      },
    },
  ),
);

export const getSettings = () => useSettings.getState();
