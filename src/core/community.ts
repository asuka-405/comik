import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, setDoc, where, limit, type Unsubscribe } from "firebase/firestore";
import { hash53 } from "./hash";
import { loadFirebaseForConfig, readPublicCommunityConfig, useCommunitySession, useRoomSessions } from "./sync/firebase";
import type { ComikFirebaseOptions } from "./sync/firebase";
import type { CommunityRoom } from "./communityRooms";
import type { MangaRow } from "./types";

export type CommunityKind = "discussion" | "recommendation" | "poll";

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
}

export interface CommunityComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface RatingRecord {
  uid: string;
  score: number;
}

export interface PostLikeState {
  count: number;
  liked: boolean;
}

export interface CommunityTarget {
  id: string;
  config: ComikFirebaseOptions;
  roomId?: string;
}

export function publicCommunityTarget(): CommunityTarget {
  const config = readPublicCommunityConfig();
  if (!config) throw new Error("Public Community is not configured.");
  return { id: "public", config };
}

export function roomCommunityTarget(room: CommunityRoom): CommunityTarget {
  return { id: room.id, config: room.config, roomId: room.id };
}

function getRoomFirebase(target: CommunityTarget) {
  const appName = target.id === "public"
    ? `comik-community-public-${target.config.projectId}`
    : `comik-room-${target.id}-${target.config.projectId}`;
  return loadFirebaseForConfig(target.config, appName);
}

function requireUser(target: CommunityTarget) {
  const user = target.id === "public"
    ? useCommunitySession.getState().user
    : useRoomSessions.getState().sessions[target.id]?.user;
  if (!user || user.isAnonymous) throw new Error("Sign in with Google to participate.");
  return user;
}

function postCollection(fs: import("firebase/firestore").Firestore, target: CommunityTarget) {
  return target.roomId ? collection(fs, "rooms", target.roomId, "posts") : collection(fs, "communityPosts");
}

function postDoc(fs: import("firebase/firestore").Firestore, target: CommunityTarget, postId: string, ...nested: string[]) {
  return target.roomId
    ? doc(fs, "rooms", target.roomId, "posts", postId, ...nested)
    : doc(fs, "communityPosts", postId, ...nested);
}

function childCollection(fs: import("firebase/firestore").Firestore, target: CommunityTarget, postId: string, name: "comments" | "likes" | "votes") {
  return target.roomId
    ? collection(fs, "rooms", target.roomId, "posts", postId, name)
    : collection(fs, "communityPosts", postId, name);
}

function ratingsCollection(fs: import("firebase/firestore").Firestore, target: CommunityTarget) {
  return target.roomId ? collection(fs, "rooms", target.roomId, "ratings") : collection(fs, "communityRatings");
}

export async function subscribePosts(onPosts: (posts: CommunityPost[]) => void, onError: (error: Error) => void, target = publicCommunityTarget()): Promise<Unsubscribe> {
  const { fs } = await getRoomFirebase(target);
  return onSnapshot(query(postCollection(fs, target), orderBy("createdAt", "desc"), limit(60)),
    (snapshot) => onPosts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CommunityPost)), onError);
}

export async function publishPost(input: Omit<CommunityPost, "id" | "authorId" | "authorName" | "createdAt">, target = publicCommunityTarget()): Promise<string> {
  const user = requireUser(target);
  const { fs } = await getRoomFirebase(target);
  const created = await addDoc(postCollection(fs, target), {
    ...input,
    authorId: user.uid,
    authorName: user.name?.trim().slice(0, 60) || "Reader",
    createdAt: Date.now(),
  });
  return created.id;
}

export async function subscribeComments(postId: string, onComments: (comments: CommunityComment[]) => void, onError: (error: Error) => void, target = publicCommunityTarget()): Promise<Unsubscribe> {
  const { fs } = await getRoomFirebase(target);
  const comments = childCollection(fs, target, postId, "comments");
  return onSnapshot(query(comments, orderBy("createdAt", "asc"), limit(100)),
    (snapshot) => onComments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CommunityComment)), onError);
}

export async function addComment(postId: string, body: string, target = publicCommunityTarget()): Promise<void> {
  const user = requireUser(target);
  const { fs } = await getRoomFirebase(target);
  await addDoc(childCollection(fs, target, postId, "comments"), {
    authorId: user.uid,
    authorName: user.name?.trim().slice(0, 60) || "Reader",
    body: body.trim().slice(0, 2000),
    createdAt: Date.now(),
  });
}

export async function subscribePostLikes(postId: string, uid: string, onLikes: (state: PostLikeState) => void, onError: (error: Error) => void, target = publicCommunityTarget()): Promise<Unsubscribe> {
  const { fs } = await getRoomFirebase(target);
  return onSnapshot(childCollection(fs, target, postId, "likes"), (snapshot) => {
    onLikes({ count: snapshot.size, liked: !!uid && snapshot.docs.some((item) => item.id === uid) });
  }, onError);
}

export async function setPostLike(postId: string, liked: boolean, target = publicCommunityTarget()): Promise<void> {
  const user = requireUser(target);
  const { fs } = await getRoomFirebase(target);
  const reference = postDoc(fs, target, postId, "likes", user.uid);
  if (liked) await deleteDoc(reference);
  else await setDoc(reference, { uid: user.uid, createdAt: Date.now() });
}

export async function subscribePollVotes(postId: string, onVotes: (votes: Record<string, number>) => void, onError: (error: Error) => void, target = publicCommunityTarget()): Promise<Unsubscribe> {
  const { fs } = await getRoomFirebase(target);
  return onSnapshot(childCollection(fs, target, postId, "votes"), (snapshot) => {
    onVotes(Object.fromEntries(snapshot.docs.map((item) => [item.id, Number(item.data().optionIndex)])));
  }, onError);
}

export async function votePoll(postId: string, optionIndex: number, target = publicCommunityTarget()): Promise<void> {
  const user = requireUser(target);
  const { fs } = await getRoomFirebase(target);
  await setDoc(postDoc(fs, target, postId, "votes", user.uid), { uid: user.uid, optionIndex, updatedAt: Date.now() });
}

export async function subscribeRatings(comicKey: string, onRatings: (ratings: RatingRecord[]) => void, onError: (error: Error) => void, target = publicCommunityTarget()): Promise<Unsubscribe> {
  const { fs } = await getRoomFirebase(target);
  return onSnapshot(query(ratingsCollection(fs, target), where("comicKey", "==", comicKey), limit(500)),
    (snapshot) => onRatings(snapshot.docs.map((item) => ({ uid: String(item.data().uid), score: Number(item.data().score) }))), onError);
}

export async function rateComic(comic: CommunityComic, score: number, target = publicCommunityTarget()): Promise<void> {
  const user = requireUser(target);
  const { fs } = await getRoomFirebase(target);
  const comicKey = hash53(comic.mangaId);
  const ratingRef = target.roomId
    ? doc(fs, "rooms", target.roomId, "ratings", `${comicKey}_${user.uid}`)
    : doc(fs, "communityRatings", `${comicKey}_${user.uid}`);
  await setDoc(ratingRef, {
    comicKey,
    comicTitle: comic.title.slice(0, 160),
    sourceId: comic.sourceId.slice(0, 120),
    uid: user.uid,
    score: Math.max(1, Math.min(5, Math.round(score))),
    updatedAt: Date.now(),
  });
}

export async function createPrivateCommunityRoom(room: CommunityRoom, target: CommunityTarget): Promise<void> {
  const user = requireUser(target);
  if (!target.roomId || target.roomId !== room.id) throw new Error("Invalid room target.");
  const { fs } = await getRoomFirebase(target);
  const now = Date.now();
  await setDoc(doc(fs, "rooms", room.id), { id: room.id, name: room.name, ownerId: user.uid, visibility: "invite", createdAt: now });
  await setDoc(doc(fs, "rooms", room.id, "members", user.uid), { uid: user.uid, role: "owner", joinedAt: now });
}

export async function joinPrivateCommunityRoom(room: CommunityRoom, target: CommunityTarget): Promise<void> {
  const user = requireUser(target);
  if (!target.roomId || target.roomId !== room.id) throw new Error("Invalid room target.");
  const { fs } = await getRoomFirebase(target);
  const roomDoc = await getDoc(doc(fs, "rooms", room.id));
  if (!roomDoc.exists()) throw new Error("This private room was not found.");
  await setDoc(doc(fs, "rooms", room.id, "members", user.uid), {
    uid: user.uid,
    role: "member",
    inviteCode: room.id,
    joinedAt: Date.now(),
  });
}

export function comicReference(manga: MangaRow, sourceName: string, sourceUrl: string): CommunityComic {
  return { mangaId: manga.id, title: manga.title.slice(0, 160), sourceId: manga.sourceId, sourceName: sourceName.slice(0, 100), sourceUrl };
}

export async function uploadCommunityImage(file: File, imgurClientId: string): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (imgurClientId.trim()) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Imgur uploads must be 10 MB or smaller.");
    const body = new FormData();
    body.set("image", file);
    const response = await fetch("https://api.imgur.com/3/image", {
      method: "POST",
      headers: { Authorization: `Client-ID ${imgurClientId.trim()}` },
      body,
    });
    const result = await response.json() as { success?: boolean; data?: { link?: string; error?: string } };
    if (!response.ok || !result.success || !result.data?.link) throw new Error(result.data?.error ?? "Imgur upload failed.");
    return result.data.link;
  }
  if (file.size > 50 * 1024) throw new Error("Without Imgur, images must be 50 KB or smaller.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image."));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}