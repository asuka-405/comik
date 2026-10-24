import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReaderMode } from "./types";
import type { UserTheme } from "./themes";

/** "system", a built-in preset id, or the id of one of the user's own themes. */
export type Theme = string;
export type FitMode = "width" | "height" | "screen" | "original";
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
  /** Where the proxy lives. Empty = same origin (/api). */
  proxyUrl: string;
  /** Source IDs disabled on this device. */
  disabledSourceIds: string[];
  /** Firebase Analytics is explicitly opt-in. */
  analyticsConsent: boolean;

  // library
  librarySort: LibrarySort;
  librarySortAsc: boolean;
  libraryDensity: LibraryDensity;
  libraryGridColumns: LibraryGridColumns;
  globalSearchGridColumns: LibraryGridColumns;
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
      proxyUrl: "",
      disabledSourceIds: [],
      analyticsConsent: false,

      librarySort: "lastRead",
      librarySortAsc: false,
      libraryDensity: "cozy",
      libraryGridColumns: "auto",
      globalSearchGridColumns: "auto",
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
      partialize: (s) => {
        const { set: _set, ...rest } = s;
        return rest;
      },
    },
  ),
);

export const getSettings = () => useSettings.getState();
