import { create } from "zustand";
import type { FirebaseOptions } from "firebase/app";

/**
 * Optional Firebase backend. Nothing here loads until a config exists, so the app stays a
 * pure local-first PWA for people who never turn sync on.
 *
 * Config sources, in priority order:
 *  1. Pasted by the user in Settings (localStorage), so a hosted build can stay generic.
 *  2. VITE_FIREBASE_CONFIG (JSON string) baked in at build time.
 */

const LS_KEY = "comik.firebase.config";

export type SyncStatus = "off" | "connecting" | "ready" | "error";

export interface SyncUser {
  uid: string;
  isAnonymous: boolean;
  email?: string | null;
  name?: string | null;
}

interface SyncStore {
  status: SyncStatus;
  user: SyncUser | null;
  error?: string;
  syncing: boolean;
  lastSyncedAt: number;
  patch: (p: Partial<SyncStore>) => void;
}

export const useSync = create<SyncStore>((set) => ({
  status: "off",
  user: null,
  syncing: false,
  lastSyncedAt: Number(localStorage.getItem("comik.sync.last") ?? 0),
  patch: (p) => set(p),
}));

export function readFirebaseConfig(): FirebaseOptions | null {
  try {
    const raw = localStorage.getItem(LS_KEY) ?? (import.meta.env.VITE_FIREBASE_CONFIG as string | undefined);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as FirebaseOptions;
    return cfg.apiKey && cfg.projectId ? cfg : null;
  } catch {
    return null;
  }
}

/** Accepts strict JSON or the JS object literal Firebase's console shows (`const firebaseConfig = {...}`). */
export function parseFirebaseConfig(input: string): FirebaseOptions {
  const body = input.slice(input.indexOf("{"), input.lastIndexOf("}") + 1);
  let cfg: unknown;
  try {
    cfg = JSON.parse(body);
  } catch {
    const quoted = body.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, "}");
    cfg = JSON.parse(quoted);
  }
  const c = cfg as FirebaseOptions;
  if (!c.apiKey || !c.projectId || !c.appId) throw new Error("Config needs apiKey, projectId and appId");
  return c;
}

export function saveFirebaseConfig(cfg: FirebaseOptions | null) {
  if (cfg) localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(LS_KEY);
}

export const syncAvailable = () => readFirebaseConfig() !== null;

type FirebaseBits = {
  auth: import("firebase/auth").Auth;
  fs: import("firebase/firestore").Firestore;
  authMod: typeof import("firebase/auth");
  fsMod: typeof import("firebase/firestore");
};

let bits: Promise<FirebaseBits> | null = null;

export function loadFirebase(): Promise<FirebaseBits> {
  if (bits) return bits;
  const cfg = readFirebaseConfig();
  if (!cfg) return Promise.reject(new Error("Firebase is not configured"));
  bits = (async () => {
    const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
    const app = getApps()[0] ?? initializeApp(cfg);
    const auth = authMod.getAuth(app);
    // Firestore's own offline cache doubles as a write queue when the network drops.
    const fs = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) });
    return { auth, fs, authMod, fsMod };
  })();
  bits.catch(() => (bits = null));
  return bits;
}

export function resetFirebase() {
  bits = null;
}

const toUser = (u: import("firebase/auth").User | null): SyncUser | null => (u ? { uid: u.uid, isAnonymous: u.isAnonymous, email: u.email, name: u.displayName } : null);

/** Resolve current user, creating an anonymous account on first use. */
export async function ensureSignedIn(): Promise<SyncUser> {
  const { auth, authMod } = await loadFirebase();
  await auth.authStateReady();
  if (!auth.currentUser) await authMod.signInAnonymously(auth);
  const user = toUser(auth.currentUser)!;
  useSync.getState().patch({ user });
  return user;
}

export async function watchAuth(cb: (u: SyncUser | null) => void): Promise<() => void> {
  const { auth, authMod } = await loadFirebase();
  return authMod.onAuthStateChanged(auth, (u) => {
    const user = toUser(u);
    useSync.getState().patch({ user });
    cb(user);
  });
}

/** Upgrade the anonymous account to Google without losing its data. Falls back to plain sign-in if that Google account already exists. */
export async function linkGoogle(): Promise<void> {
  const { auth, authMod } = await loadFirebase();
  const provider = new authMod.GoogleAuthProvider();
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) await authMod.linkWithPopup(current, provider);
    else await authMod.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
      await authMod.signInWithPopup(auth, provider);
    } else throw e;
  }
  useSync.getState().patch({ user: toUser(auth.currentUser) });
}

export async function signOutSync(): Promise<void> {
  const { auth, authMod } = await loadFirebase();
  await authMod.signOut(auth);
  useSync.getState().patch({ user: null, status: "off" });
}
