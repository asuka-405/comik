import { create } from "zustand";

const KEY = "comik.walkthrough.v1";

const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

interface WalkthroughStore {
  open: boolean;
  show: () => void;
  finish: () => void;
}

/** The first-run walkthrough. Opens once per browser or app install, and again on request from Settings. */
export const useWalkthrough = create<WalkthroughStore>((set) => ({
  open: !seen(),
  show: () => set({ open: true }),
  finish: () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Without storage the walkthrough will show again next visit; harmless.
    }
    set({ open: false });
  },
}));
