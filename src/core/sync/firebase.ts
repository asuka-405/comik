import { create } from "zustand";
import type { FirebaseOptions } from "firebase/app";

interface NativeGoogleAuthBridge {
  requestGoogleIdToken(requestId: string, serverClientId: string): void;
}

interface NativeGoogleAuthResult {
  requestId: string;
  idToken?: string;
  code?: string;
  error?: string;
}

const DEFAULT_GOOGLE_WEB_CLIENT_ID = "202200394347-1h9j9ulu3ifcuncf8g3jm3hlivgo8mok.apps.googleusercontent.com";

declare global {
  interface Window {
    ComikAndroidAuth?: NativeGoogleAuthBridge;
    __comikAndroidGoogleResult?: (result: string) => void;
  }
}

const nativeGoogleRequests = new Map<string, {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
let nativeGoogleRequestId = 0;

if (typeof window !== "undefined") {
  window.__comikAndroidGoogleResult = (serialized) => {
    let result: NativeGoogleAuthResult;
    try {
      result = JSON.parse(serialized) as NativeGoogleAuthResult;
    } catch {
      return;
    }
    const pending = nativeGoogleRequests.get(result.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    nativeGoogleRequests.delete(result.requestId);
    if (result.idToken) {
      pending.resolve(result.idToken);
    } else {
      pending.reject(Object.assign(new Error(result.error || "Google sign-in failed"), { code: result.code }));
    }
  };
}

function getNativeGoogleIdToken(serverClientId: string): Promise<string> {
  const bridge = window.ComikAndroidAuth;
  if (!bridge) return Promise.reject(new Error("Native Google sign-in is unavailable"));
  if (!serverClientId) return Promise.reject(new Error("Set the Google OAuth Web client ID in Firebase settings to use Android sign-in."));
  const requestId = String(++nativeGoogleRequestId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      nativeGoogleRequests.delete(requestId);
      reject(new Error("Google sign-in timed out. Try again."));
    }, 120_000);
    nativeGoogleRequests.set(requestId, { resolve, reject, timeout });
    try {
      bridge.requestGoogleIdToken(requestId, serverClientId);
    } catch (error) {
      clearTimeout(timeout);
      nativeGoogleRequests.delete(requestId);
      reject(error instanceof Error ? error : new Error("Could not open Google sign-in"));
    }
  });
}

/**
 * Optional Firebase backend. Nothing here loads until a config exists, so the app stays a
 * pure local-first PWA for people who never turn sync on.
 *
 * Config sources, in priority order:
 *  1. Pasted by the user in Settings (localStorage), so a hosted build can stay generic.
 *  2. VITE_FIREBASE_CONFIG (JSON string) baked in at build time.
 */

const LS_KEY = "comik.firebase.config";
const MODE_KEY = "comik.firebase.mode";
const ENV_CONFIG = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined;
const BUILT_IN_CONFIG: ComikFirebaseOptions = {
  apiKey: "AIzaSyC-Td_4ePDAi_y3rjNYV3e2Wh-QzoLzXH8",
  authDomain: "comik-7157c.firebaseapp.com",
  projectId: "comik-7157c",
  storageBucket: "comik-7157c.firebasestorage.app",
  messagingSenderId: "202200394347",
  appId: "1:202200394347:web:060ac88d29594d1afe9f2e",
  measurementId: "G-CK0GZMT50R",
  googleWebClientId: DEFAULT_GOOGLE_WEB_CLIENT_ID,
};

export type FirebaseMode = "default" | "custom";

export type SyncStatus = "off" | "connecting" | "ready" | "error";

export interface SyncUser {
  uid: string;
  isAnonymous: boolean;
  email?: string | null;
  name?: string | null;
}

export interface ComikFirebaseOptions extends FirebaseOptions {
  googleWebClientId?: string;
  /** Region of the comikProxy Cloud Function in this project. Defaults to us-central1. */
  proxyRegion?: string;
}

interface SyncStore {
  status: SyncStatus;
  user: SyncUser | null;
  error?: string;
  syncing: boolean;
  lastSyncedAt: number;
  patch: (p: Partial<SyncStore>) => void;
}

const firebaseBits = new Map<string, Promise<FirebaseBits>>();

export const useSync = create<SyncStore>((set) => ({
  status: "off",
  user: null,
  syncing: false,
  lastSyncedAt: Number(localStorage.getItem("comik.sync.last") ?? 0),
  patch: (p) => set(p),
}));

interface CommunitySessionState {
  status: SyncStatus;
  user: SyncUser | null;
  error?: string;
}

interface CommunitySessionStore extends CommunitySessionState {
  patch: (p: Partial<CommunitySessionStore>) => void;
}

export const useCommunitySession = create<CommunitySessionStore>((set) => ({
  status: "off",
  user: null,
  patch: (p) => set(p),
}));

interface RoomSessionStore {
  sessions: Record<string, CommunitySessionState>;
  patch: (roomId: string, p: Partial<CommunitySessionState>) => void;
}

export const useRoomSessions = create<RoomSessionStore>((set) => ({
  sessions: {},
  patch: (roomId, patch) => set((state) => ({
    sessions: { ...state.sessions, [roomId]: { ...(state.sessions[roomId] ?? { status: "off", user: null }), ...patch } },
  })),
}));

function parseConfig(raw: string | undefined): ComikFirebaseOptions | null {
  try {
    if (!raw) return null;
    const cfg = JSON.parse(raw) as ComikFirebaseOptions;
    return cfg.apiKey && cfg.projectId && cfg.appId ? cfg : null;
  } catch {
    return null;
  }
}

export function getFirebaseMode(): FirebaseMode {
  const selected = localStorage.getItem(MODE_KEY);
  if (selected === "default" || selected === "custom") return selected;
  return localStorage.getItem(LS_KEY) ? "custom" : "default";
}

export function setFirebaseMode(mode: FirebaseMode) {
  localStorage.setItem(MODE_KEY, mode);
  firebaseBits.clear();
}

export const defaultFirebaseAvailable = () => !!readPublicCommunityConfig();

/** The user's own project, or null while they use the Comik project. */
export function readCustomFirebaseConfig(): ComikFirebaseOptions | null {
  return getFirebaseMode() === "custom" ? parseConfig(localStorage.getItem(LS_KEY) ?? undefined) : null;
}

/**
 * The project that handles sign-in and library sync: the user's own when they have set one up,
 * otherwise the Comik project. Comic fetching never uses the Comik project, see proxyBase().
 */
export function readFirebaseConfig(): ComikFirebaseOptions | null {
  return readCustomFirebaseConfig() ?? readPublicCommunityConfig();
}

export function readPublicCommunityConfig(): ComikFirebaseOptions | null {
  return parseConfig(ENV_CONFIG) ?? BUILT_IN_CONFIG;
}

/** Accepts strict JSON or the JS object literal Firebase's console shows (`const firebaseConfig = {...}`). */
export function parseFirebaseConfig(input: string): ComikFirebaseOptions {
  const body = input.slice(input.indexOf("{"), input.lastIndexOf("}") + 1);
  let cfg: unknown;
  try {
    cfg = JSON.parse(body);
  } catch {
    const quoted = body.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, "}");
    cfg = JSON.parse(quoted);
  }
  const c = cfg as ComikFirebaseOptions;
  if (!c.apiKey || !c.projectId || !c.appId) throw new Error("Config needs apiKey, projectId and appId");
  return c;
}

export function saveFirebaseConfig(cfg: ComikFirebaseOptions | null) {
  if (cfg) {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    localStorage.setItem(MODE_KEY, "custom");
  } else {
    localStorage.removeItem(LS_KEY);
    localStorage.setItem(MODE_KEY, "default");
  }
  firebaseBits.clear();
}

export const syncAvailable = () => readFirebaseConfig() !== null;

/** URL of the comic proxy Cloud Function in the user's own project, or null without one. */
export function ownProxyUrl(): string | null {
  const config = readCustomFirebaseConfig();
  if (!config?.projectId) return null;
  return `https://${config.proxyRegion || "us-central1"}-${config.projectId}.cloudfunctions.net/comikProxy`;
}

/** A fresh ID token for the proxy function. Firebase caches it and renews it shortly before expiry. */
export async function getProxyIdToken(): Promise<string> {
  await ensureSignedIn();
  const { auth } = await loadFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to use your Firebase proxy.");
  return user.getIdToken();
}

type FirebaseBits = {
  auth: import("firebase/auth").Auth;
  fs: import("firebase/firestore").Firestore;
  authMod: typeof import("firebase/auth");
  fsMod: typeof import("firebase/firestore");
  appName: string;
};

export function loadFirebaseForConfig(cfg: ComikFirebaseOptions | null, appName: string): Promise<FirebaseBits> {
  if (!cfg) return Promise.reject(new Error("Firebase is not configured"));
  const cached = firebaseBits.get(appName);
  if (cached) return cached;
  const pending = (async () => {
    const [{ initializeApp, getApps }, authMod, fsMod] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
    const app = getApps().find((candidate) => candidate.name === appName) ?? initializeApp(cfg, appName);
    const auth = authMod.getAuth(app);
    // Firestore's own offline cache doubles as a write queue when the network drops.
    const fs = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) });
    return { auth, fs, authMod, fsMod, appName };
  })();
  firebaseBits.set(appName, pending);
  pending.catch(() => firebaseBits.delete(appName));
  return pending;
}

export function loadFirebase(): Promise<FirebaseBits> {
  const own = readCustomFirebaseConfig();
  // On the Comik project, sync and Community share one app so they share one signed-in user.
  if (!own) return loadPublicCommunityFirebase();
  return loadFirebaseForConfig(own, `comik-personal-${own.projectId}`);
}

export function loadPublicCommunityFirebase(): Promise<FirebaseBits> {
  const config = readPublicCommunityConfig();
  return loadFirebaseForConfig(config, `comik-community-public-${config?.projectId ?? "unconfigured"}`);
}

export function resetFirebase() {
  firebaseBits.clear();
}

/** On the Comik project one auth session serves both sync and Community, so keep both stores current. */
function publishUser(user: SyncUser | null, extra: Partial<SyncStore> = {}) {
  useSync.getState().patch({ user, ...extra });
  if (!readCustomFirebaseConfig()) {
    useCommunitySession.getState().patch({ user, status: user ? "ready" : "off", error: undefined });
  }
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

export async function connectPublicCommunity(): Promise<SyncUser> {
  useCommunitySession.getState().patch({ status: "connecting", error: undefined });
  try {
    const { auth, authMod } = await loadPublicCommunityFirebase();
    await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    const user = toUser(auth.currentUser)!;
    useCommunitySession.getState().patch({ status: "ready", user });
    return user;
  } catch (error) {
    useCommunitySession.getState().patch({ status: "error", error: (error as Error).message });
    throw error;
  }
}

export async function linkGooglePublicCommunity(): Promise<void> {
  const config = readPublicCommunityConfig();
  if (!config) throw new Error("Public community Firebase is not configured.");
  const { auth, authMod } = await loadPublicCommunityFirebase();
  const idToken = typeof window !== "undefined" && window.ComikAndroidAuth
    ? await getNativeGoogleIdToken(config.googleWebClientId ?? DEFAULT_GOOGLE_WEB_CLIENT_ID)
    : undefined;
  const provider = new authMod.GoogleAuthProvider();
  const current = auth.currentUser;
  try {
    if (idToken) {
      const credential = authMod.GoogleAuthProvider.credential(idToken);
      if (current?.isAnonymous) await authMod.linkWithCredential(current, credential);
      else await authMod.signInWithCredential(auth, credential);
    } else if (current?.isAnonymous) {
      await authMod.linkWithPopup(current, provider);
    } else {
      await authMod.signInWithPopup(auth, provider);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/credential-already-in-use" && code !== "auth/email-already-in-use") throw error;
    if (idToken) await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(idToken));
    else await authMod.signInWithPopup(auth, provider);
  }
  useCommunitySession.getState().patch({ status: "ready", user: toUser(auth.currentUser), error: undefined });
}

export async function signOutPublicCommunity(): Promise<void> {
  const { auth, authMod } = await loadPublicCommunityFirebase();
  await authMod.signOut(auth);
  useCommunitySession.getState().patch({ status: "off", user: null, error: undefined });
}

function roomAppName(roomId: string, config: ComikFirebaseOptions) {
  return `comik-room-${roomId}-${config.projectId}`;
}

export async function connectRoomFirebase(roomId: string, config: ComikFirebaseOptions): Promise<SyncUser> {
  useRoomSessions.getState().patch(roomId, { status: "connecting", error: undefined });
  try {
    const { auth, authMod } = await loadFirebaseForConfig(config, roomAppName(roomId, config));
    await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    const user = toUser(auth.currentUser)!;
    useRoomSessions.getState().patch(roomId, { status: "ready", user });
    return user;
  } catch (error) {
    useRoomSessions.getState().patch(roomId, { status: "error", error: (error as Error).message });
    throw error;
  }
}

export async function linkGoogleRoom(roomId: string, config: ComikFirebaseOptions): Promise<void> {
  const { auth, authMod } = await loadFirebaseForConfig(config, roomAppName(roomId, config));
  const serverClientId = config.googleWebClientId
    ?? (config.projectId === "comik-7157c" ? DEFAULT_GOOGLE_WEB_CLIENT_ID : "");
  let credential: import("firebase/auth").OAuthCredential;
  if (typeof window !== "undefined" && window.ComikAndroidAuth) {
    credential = authMod.GoogleAuthProvider.credential(await getNativeGoogleIdToken(serverClientId));
  } else {
    const provider = new authMod.GoogleAuthProvider();
    const result = await authMod.signInWithPopup(auth, provider);
    useRoomSessions.getState().patch(roomId, { status: "ready", user: toUser(result.user) });
    return;
  }
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) await authMod.linkWithCredential(current, credential);
    else await authMod.signInWithCredential(auth, credential);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/credential-already-in-use" && code !== "auth/email-already-in-use") throw error;
    await authMod.signInWithCredential(auth, credential);
  }
  useRoomSessions.getState().patch(roomId, { status: "ready", user: toUser(auth.currentUser), error: undefined });
}

/** Upgrade the anonymous account to Google without losing its data. Falls back to plain sign-in if that Google account already exists. */
export async function linkGoogle(): Promise<void> {
  const { auth, authMod } = await loadFirebase();
  if (typeof window !== "undefined" && window.ComikAndroidAuth) {
    const config = readFirebaseConfig();
    const serverClientId = config?.googleWebClientId
      ?? (config?.projectId === "comik-7157c" ? DEFAULT_GOOGLE_WEB_CLIENT_ID : "");
    const idToken = await getNativeGoogleIdToken(serverClientId);
    const credential = authMod.GoogleAuthProvider.credential(idToken);
    const current = auth.currentUser;
    try {
      if (current?.isAnonymous) await authMod.linkWithCredential(current, credential);
      else await authMod.signInWithCredential(auth, credential);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") {
        await authMod.signInWithCredential(auth, credential);
      } else throw error;
    }
    publishUser(toUser(auth.currentUser));
    return;
  }

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
  publishUser(toUser(auth.currentUser));
}

export async function signOutSync(): Promise<void> {
  const { auth, authMod } = await loadFirebase();
  await authMod.signOut(auth);
  publishUser(null, { status: "off" });
}
