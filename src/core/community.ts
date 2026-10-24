import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch, type Firestore, type Unsubscribe } from "firebase/firestore";
import { hash53 } from "./hash";
import { loadPublicCommunityFirebase, readPublicCommunityConfig, useCommunitySession } from "./sync/firebase";
import type { MangaRow } from "./types";

/**
 * Communities live in the Comik Firebase project. "public" is the original shared feed that every
 * reader can use; every other id is a community document with its own members, roles, channels and feed.
 * The security rules in firestore.rules are what actually enforce who may do what, the checks here only
 * give people a readable message first.
 */
export const PUBLIC_ID = "public";

export type CommunityKind = "discussion" | "recommendation" | "poll";
export type Role = "owner" | "admin" | "mod" | "member";
export type Visibility = "public" | "private";
export type ChannelKind = "chat" | "announcements";

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", mod: "Moderator", member: "Member" };
const RANK: Record<Role, number> = { owner: 3, admin: 2, mod: 1, member: 0 };
export const atLeast = (role: Role | undefined, needed: Role) => !!role && RANK[role] >= RANK[needed];
export const isStaff = (role: Role | undefined) => atLeast(role, "mod");
export const isAdmin = (role: Role | undefined) => atLeast(role, "admin");
export const byRole = (a: Role, b: Role) => RANK[b] - RANK[a];

export interface Community {
  id: string;
  name: string;
  description: string;
  rules: string;
  visibility: Visibility;
  accent: string;
  ownerId: string;
  ownerName: string;
  createdAt: number;
  memberCount: number;
}

export interface Member { uid: string; name: string; role: Role; joinedAt: number }
export interface Ban { uid: string; name: string; by: string; createdAt: number }
export interface Channel { id: string; name: string; description: string; kind: ChannelKind; createdAt: number; createdBy: string }
export interface Membership { id: string; role: Role; joinedAt: number }

export interface CommunityComic {
  mangaId: string;
  title: string;
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
}

export interface CommunityPost {
  id: string;
  kind: CommunityKind;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: number;
  comic?: CommunityComic;
  pollOptions?: string[];
  imageUrl?: string;
  pinned?: boolean;
}

export interface CommunityComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface RatingRecord { uid: string; score: number }
export interface PostLikeState { count: number; liked: boolean }

/** Where a post lives: the shared feed ("public") or one community. */
export interface CommunityTarget { id: string; communityId?: string }

export const communityTarget = (id: string): CommunityTarget => (id === PUBLIC_ID ? { id: PUBLIC_ID } : { id, communityId: id });

export const ACCENTS = ["#ff795e", "#34c4b0", "#e8b04a", "#5b9cf5", "#b07cf0", "#6fc46a", "#f06fa8", "#8a94a6"];

/* ------------------------------------------------------------------ plumbing */

async function bits() {
  if (!readPublicCommunityConfig()) throw new Error("Community is not configured in this build.");
  return loadPublicCommunityFirebase();
}

export function requireUser() {
  const user = useCommunitySession.getState().user;
  if (!user || user.isAnonymous) throw new Error("Sign in with Google to take part.");
  return user;
}

const displayName = (user: { name?: string | null; email?: string | null }) => (user.name || user.email?.split("@")[0] || "Reader").trim().slice(0, 60);
const codeOf = (error: unknown) => (error as { code?: string })?.code;

/** Firestore says only "permission-denied". Say what that is likely to mean here. */
function friendly(error: unknown): Error {
  if (codeOf(error) !== "permission-denied") return error instanceof Error ? error : new Error(String(error));
  return new Error("Not allowed. You may lack the role for this, or Comik's Firebase security rules are not published yet. Signing out and in again also fixes a stale login.");
}

/** A freshly linked Google account can keep an "anonymous" token until it is renewed, which the rules reject. */
export async function refreshCommunityToken(): Promise<void> {
  const { auth } = await bits();
  await auth.currentUser?.getIdToken(true);
}

/** Run a write; if Firestore refuses it, renew the login token once and try again before giving up. */
async function write<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (first) {
    if (codeOf(first) !== "permission-denied") throw friendly(first);
    try {
      await refreshCommunityToken();
      return await operation();
    } catch (second) {
      throw friendly(second);
    }
  }
}

const cDoc = (fs: Firestore, cid: string, ...rest: string[]) => doc(fs, "communities", cid, ...rest);
const cCol = (fs: Firestore, cid: string, ...rest: string[]) => collection(fs, "communities", cid, ...rest);

function postCollection(fs: Firestore, target: CommunityTarget) {
  return target.communityId ? cCol(fs, target.communityId, "posts") : collection(fs, "communityPosts");
}
function postDoc(fs: Firestore, target: CommunityTarget, postId: string, ...nested: string[]) {
  return target.communityId ? cDoc(fs, target.communityId, "posts", postId, ...nested) : doc(fs, "communityPosts", postId, ...nested);
}
function childCollection(fs: Firestore, target: CommunityTarget, postId: string, name: "comments" | "likes" | "votes") {
  return target.communityId ? cCol(fs, target.communityId, "posts", postId, name) : collection(fs, "communityPosts", postId, name);
}
function ratingsCollection(fs: Firestore, target: CommunityTarget) {
  return target.communityId ? cCol(fs, target.communityId, "ratings") : collection(fs, "communityRatings");
}

/** Delete every document in a collection, a batch at a time. */
async function wipe(fs: Firestore, source: ReturnType<typeof collection>): Promise<void> {
  for (;;) {
    const snapshot = await getDocs(query(source, limit(400)));
    if (snapshot.empty) return;
    const batch = writeBatch(fs);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

const withId = <T,>(item: { id: string; data: () => unknown }) => ({ id: item.id, ...(item.data() as object) }) as T;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => (byte % 36).toString(36)).join("");
}

/* ------------------------------------------------------------ the directory */

export async function subscribeCommunities(onList: (list: Community[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(collection(fs, "communities"), orderBy("memberCount", "desc"), limit(200)),
    (snapshot) => onList(snapshot.docs.map((item) => withId<Community>(item))), (error) => onError(friendly(error)));
}

export async function subscribeCommunity(id: string, onCommunity: (community: Community | null) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(cDoc(fs, id), (snapshot) => onCommunity(snapshot.exists() ? withId<Community>(snapshot) : null), (error) => onError(friendly(error)));
}

/** The communities this reader has joined, mirrored under their own user document so they follow them across devices. */
export async function subscribeMemberships(uid: string, onList: (list: Membership[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(collection(fs, "users", uid, "memberships"),
    (snapshot) => onList(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as object) }) as Membership)), (error) => onError(friendly(error)));
}

export async function forgetMembership(uid: string, cid: string): Promise<void> {
  const { fs } = await bits();
  await deleteDoc(doc(fs, "users", uid, "memberships", cid)).catch(() => {});
}

/* ----------------------------------------------------------------- members */

export async function subscribeMember(cid: string, uid: string, onMember: (member: Member | null) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(cDoc(fs, cid, "members", uid), (snapshot) => onMember(snapshot.exists() ? (snapshot.data() as Member) : null), (error) => onError(friendly(error)));
}

export async function subscribeMembers(cid: string, onList: (list: Member[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(cCol(fs, cid, "members"), limit(500)),
    (snapshot) => onList(snapshot.docs.map((item) => item.data() as Member).sort((a, b) => byRole(a.role, b.role) || a.name.localeCompare(b.name))), (error) => onError(friendly(error)));
}

export async function subscribeBans(cid: string, onList: (list: Ban[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(cCol(fs, cid, "bans"), (snapshot) => onList(snapshot.docs.map((item) => item.data() as Ban)), (error) => onError(friendly(error)));
}

/* ------------------------------------------------------- create, join, leave */

export interface CommunityDraft { name: string; description: string; rules?: string; visibility: Visibility; accent: string }

export async function createCommunity(draft: CommunityDraft): Promise<string> {
  const user = requireUser();
  const { fs } = await bits();
  const id = doc(collection(fs, "communities")).id;
  const now = Date.now();
  const name = displayName(user);
  await write(async () => {
    const first = writeBatch(fs);
    first.set(cDoc(fs, id), {
      id, name: draft.name.trim().slice(0, 60), description: draft.description.trim().slice(0, 500), rules: (draft.rules ?? "").trim().slice(0, 1500),
      visibility: draft.visibility, accent: draft.accent, ownerId: user.uid, ownerName: name, createdAt: now, memberCount: 1,
    });
    first.set(cDoc(fs, id, "members", user.uid), { uid: user.uid, name, role: "owner", joinedAt: now });
    first.set(doc(fs, "users", user.uid, "memberships", id), { role: "owner", joinedAt: now });
    await first.commit();
  });
  // The owner now exists, so the rules let the default channels and the invite code through.
  await write(async () => {
    const second = writeBatch(fs);
    second.set(cDoc(fs, id, "private", "invite"), { code: randomCode() });
    const announcements = doc(cCol(fs, id, "channels"));
    second.set(announcements, { id: announcements.id, name: "announcements", description: "News from the people who run this community", kind: "announcements", createdAt: now, createdBy: user.uid });
    const general = doc(cCol(fs, id, "channels"));
    second.set(general, { id: general.id, name: "general", description: "Talk about anything", kind: "chat", createdAt: now + 1, createdBy: user.uid });
    await second.commit();
  });
  return id;
}

export async function joinCommunity(community: Community, inviteCode?: string): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  if (community.visibility === "private" && !inviteCode?.trim()) throw new Error("This community is private. Enter its invite code to join.");
  const now = Date.now();
  try {
    await write(async () => {
      const batch = writeBatch(fs);
      batch.set(cDoc(fs, community.id, "members", user.uid), {
        uid: user.uid, name: displayName(user), role: "member", joinedAt: now,
        ...(community.visibility === "private" ? { inviteCode: inviteCode!.trim() } : {}),
      });
      batch.update(cDoc(fs, community.id), { memberCount: increment(1) });
      batch.set(doc(fs, "users", user.uid, "memberships", community.id), { role: "member", joinedAt: now });
      await batch.commit();
    });
  } catch (cause) {
    if (community.visibility === "private") throw new Error("Could not join. Check the invite code, or you may have been removed from this community.");
    throw cause;
  }
}

export async function leaveCommunity(cid: string): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  await write(async () => {
    const batch = writeBatch(fs);
    batch.delete(cDoc(fs, cid, "members", user.uid));
    batch.update(cDoc(fs, cid), { memberCount: increment(-1) });
    batch.delete(doc(fs, "users", user.uid, "memberships", cid));
    await batch.commit();
  });
}

/** Remove a community and everything in it. Posts and channels go first, because the rules look at the owner's member record. */
export async function deleteCommunity(cid: string, onStep?: (label: string) => void): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  await write(async () => {
    onStep?.("Removing posts");
    for (const post of (await getDocs(cCol(fs, cid, "posts"))).docs) {
      for (const child of ["comments", "likes", "votes"]) await wipe(fs, cCol(fs, cid, "posts", post.id, child));
      await deleteDoc(post.ref);
    }
    onStep?.("Removing channels");
    for (const channel of (await getDocs(cCol(fs, cid, "channels"))).docs) {
      await wipe(fs, cCol(fs, cid, "channels", channel.id, "messages"));
      await deleteDoc(channel.ref);
    }
    onStep?.("Removing people");
    await wipe(fs, cCol(fs, cid, "ratings"));
    await wipe(fs, cCol(fs, cid, "bans"));
    await deleteDoc(cDoc(fs, cid, "private", "invite")).catch(() => {});
    await wipe(fs, cCol(fs, cid, "members"));
    await deleteDoc(cDoc(fs, cid));
    await deleteDoc(doc(fs, "users", user.uid, "memberships", cid)).catch(() => {});
  });
}

/* ---------------------------------------------------------------- settings */

export async function updateCommunity(cid: string, patch: Partial<Pick<Community, "name" | "description" | "rules" | "accent" | "visibility">>): Promise<void> {
  requireUser();
  const { fs } = await bits();
  const clean = { ...patch };
  if (clean.name !== undefined) clean.name = clean.name.trim().slice(0, 60);
  if (clean.description !== undefined) clean.description = clean.description.trim().slice(0, 500);
  if (clean.rules !== undefined) clean.rules = clean.rules.trim().slice(0, 1500);
  await write(() => updateDoc(cDoc(fs, cid), clean));
}

export async function readInvite(cid: string): Promise<string> {
  const { fs } = await bits();
  const snapshot = await write(() => getDoc(cDoc(fs, cid, "private", "invite")));
  return snapshot.exists() ? String(snapshot.data().code) : "";
}

export async function regenerateInvite(cid: string): Promise<string> {
  requireUser();
  const { fs } = await bits();
  const code = randomCode();
  await write(() => setDoc(cDoc(fs, cid, "private", "invite"), { code }));
  return code;
}

export async function setMemberRole(cid: string, uid: string, role: Role): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(() => updateDoc(cDoc(fs, cid, "members", uid), { role }));
}

/** Give the community to another member. The previous owner stays on as an admin. */
export async function transferOwnership(cid: string, to: Member): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  await write(async () => {
    const batch = writeBatch(fs);
    batch.update(cDoc(fs, cid), { ownerId: to.uid, ownerName: to.name });
    batch.update(cDoc(fs, cid, "members", to.uid), { role: "owner" });
    batch.update(cDoc(fs, cid, "members", user.uid), { role: "admin" });
    await batch.commit();
  });
}

export async function removeMember(cid: string, member: Member, ban: boolean): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  await write(async () => {
    const batch = writeBatch(fs);
    batch.delete(cDoc(fs, cid, "members", member.uid));
    batch.update(cDoc(fs, cid), { memberCount: increment(-1) });
    if (ban) batch.set(cDoc(fs, cid, "bans", member.uid), { uid: member.uid, name: member.name, by: user.uid, createdAt: Date.now() });
    await batch.commit();
  });
}

export async function unban(cid: string, uid: string): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(() => deleteDoc(cDoc(fs, cid, "bans", uid)));
}

/* ---------------------------------------------------------------- channels */

export async function subscribeChannels(cid: string, onList: (list: Channel[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(cCol(fs, cid, "channels"), orderBy("createdAt", "asc")),
    (snapshot) => onList(snapshot.docs.map((item) => withId<Channel>(item))), (error) => onError(friendly(error)));
}

export async function saveChannel(cid: string, input: { id?: string; name: string; description: string; kind: ChannelKind }): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  const reference = input.id ? cDoc(fs, cid, "channels", input.id) : doc(cCol(fs, cid, "channels"));
  const name = input.name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!name) throw new Error("Give the channel a name.");
  const existing = input.id ? await getDoc(reference) : null;
  await write(() => setDoc(reference, {
    id: reference.id, name, description: input.description.trim().slice(0, 200), kind: input.kind,
    createdAt: existing?.exists() ? existing.data().createdAt : Date.now(), createdBy: existing?.exists() ? existing.data().createdBy : user.uid,
  }));
}

export async function deleteChannel(cid: string, chid: string): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(async () => {
    await wipe(fs, cCol(fs, cid, "channels", chid, "messages"));
    await deleteDoc(cDoc(fs, cid, "channels", chid));
  });
}

export async function subscribeMessages(cid: string, chid: string, onList: (list: CommunityComment[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(cCol(fs, cid, "channels", chid, "messages"), orderBy("createdAt", "desc"), limit(150)),
    (snapshot) => onList(snapshot.docs.map((item) => withId<CommunityComment>(item)).reverse()), (error) => onError(friendly(error)));
}

export async function sendMessage(cid: string, chid: string, body: string): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  const text = body.trim().slice(0, 2000);
  if (!text) return;
  await write(() => addDoc(cCol(fs, cid, "channels", chid, "messages"), { authorId: user.uid, authorName: displayName(user), body: text, createdAt: Date.now() }));
}

export async function deleteMessage(cid: string, chid: string, messageId: string): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(() => deleteDoc(cDoc(fs, cid, "channels", chid, "messages", messageId)));
}

/* ------------------------------------------------------------------- posts */

export async function subscribePosts(onPosts: (posts: CommunityPost[]) => void, onError: (error: Error) => void, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(postCollection(fs, target), orderBy("createdAt", "desc"), limit(60)),
    (snapshot) => onPosts(snapshot.docs.map((item) => withId<CommunityPost>(item))), (error) => onError(friendly(error)));
}

export async function publishPost(input: Omit<CommunityPost, "id" | "authorId" | "authorName" | "createdAt" | "pinned">, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<string> {
  const user = requireUser();
  const { fs } = await bits();
  const created = await write(() => addDoc(postCollection(fs, target), { ...input, authorId: user.uid, authorName: displayName(user), createdAt: Date.now() }));
  return created.id;
}

/** The author, or staff in a community, may remove a post. Its replies, likes and votes go with it. */
export async function deletePost(postId: string, target: CommunityTarget): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(async () => {
    for (const child of ["comments", "likes", "votes"] as const) await wipe(fs, childCollection(fs, target, postId, child)).catch(() => {});
    await deleteDoc(postDoc(fs, target, postId));
  });
}

export async function pinPost(postId: string, pinned: boolean, target: CommunityTarget): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(() => updateDoc(postDoc(fs, target, postId), { pinned }));
}

export async function subscribeComments(postId: string, onComments: (comments: CommunityComment[]) => void, onError: (error: Error) => void, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(childCollection(fs, target, postId, "comments"), orderBy("createdAt", "asc"), limit(100)),
    (snapshot) => onComments(snapshot.docs.map((item) => withId<CommunityComment>(item))), (error) => onError(friendly(error)));
}

export async function addComment(postId: string, body: string, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  const text = body.trim().slice(0, 2000);
  if (!text) return;
  await write(() => addDoc(childCollection(fs, target, postId, "comments"), { authorId: user.uid, authorName: displayName(user), body: text, createdAt: Date.now() }));
}

export async function deleteComment(postId: string, commentId: string, target: CommunityTarget): Promise<void> {
  requireUser();
  const { fs } = await bits();
  await write(() => deleteDoc(doc(childCollection(fs, target, postId, "comments"), commentId)));
}

export async function subscribePostLikes(postId: string, uid: string, onLikes: (state: PostLikeState) => void, onError: (error: Error) => void, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(childCollection(fs, target, postId, "likes"), (snapshot) => {
    onLikes({ count: snapshot.size, liked: !!uid && snapshot.docs.some((item) => item.id === uid) });
  }, (error) => onError(friendly(error)));
}

export async function setPostLike(postId: string, liked: boolean, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  const reference = postDoc(fs, target, postId, "likes", user.uid);
  await write(() => (liked ? deleteDoc(reference) : setDoc(reference, { uid: user.uid, createdAt: Date.now() })));
}

export async function subscribePollVotes(postId: string, onVotes: (votes: Record<string, number>) => void, onError: (error: Error) => void, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(childCollection(fs, target, postId, "votes"), (snapshot) => {
    onVotes(Object.fromEntries(snapshot.docs.map((item) => [item.id, Number(item.data().optionIndex)])));
  }, (error) => onError(friendly(error)));
}

export async function votePoll(postId: string, optionIndex: number, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  await write(() => setDoc(postDoc(fs, target, postId, "votes", user.uid), { uid: user.uid, optionIndex, updatedAt: Date.now() }));
}

export async function subscribeRatings(comicKey: string, onRatings: (ratings: RatingRecord[]) => void, onError: (error: Error) => void, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<Unsubscribe> {
  const { fs } = await bits();
  return onSnapshot(query(ratingsCollection(fs, target), where("comicKey", "==", comicKey), limit(500)),
    (snapshot) => onRatings(snapshot.docs.map((item) => ({ uid: String(item.data().uid), score: Number(item.data().score) }))), (error) => onError(friendly(error)));
}

export async function rateComic(comic: CommunityComic, score: number, target: CommunityTarget = communityTarget(PUBLIC_ID)): Promise<void> {
  const user = requireUser();
  const { fs } = await bits();
  const comicKey = hash53(comic.mangaId);
  await write(() => setDoc(doc(ratingsCollection(fs, target), `${comicKey}_${user.uid}`), {
    comicKey,
    comicTitle: comic.title.slice(0, 160),
    sourceId: comic.sourceId.slice(0, 120),
    uid: user.uid,
    score: Math.max(1, Math.min(5, Math.round(score))),
    updatedAt: Date.now(),
  }));
}

export function comicReference(manga: MangaRow, sourceName: string, sourceUrl: string): CommunityComic {
  return { mangaId: manga.id, title: manga.title.slice(0, 160), sourceId: manga.sourceId, sourceName: sourceName.slice(0, 100), sourceUrl };
}
