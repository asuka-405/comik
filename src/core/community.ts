import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, where, limit, type Unsubscribe } from "firebase/firestore";
import { hash53 } from "./hash";
import { loadFirebase, useSync } from "./sync/firebase";
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

function requireUser() {
  const user = useSync.getState().user;
  if (!user || user.isAnonymous) throw new Error("Sign in with Google to participate.");
  return user;
}

export async function subscribePosts(onPosts: (posts: CommunityPost[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await loadFirebase();
  return onSnapshot(query(collection(fs, "communityPosts"), orderBy("createdAt", "desc"), limit(60)),
    (snapshot) => onPosts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CommunityPost)), onError);
}

export async function publishPost(input: Omit<CommunityPost, "id" | "authorId" | "authorName" | "createdAt">): Promise<string> {
  const user = requireUser();
  const { fs } = await loadFirebase();
  const created = await addDoc(collection(fs, "communityPosts"), {
    ...input,
    authorId: user.uid,
    authorName: user.name?.trim().slice(0, 60) || "Reader",
    createdAt: Date.now(),
  });
  return created.id;
}

export async function subscribeComments(postId: string, onComments: (comments: CommunityComment[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await loadFirebase();
  const comments = collection(fs, "communityPosts", postId, "comments");
  return onSnapshot(query(comments, orderBy("createdAt", "asc"), limit(100)),
    (snapshot) => onComments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CommunityComment)), onError);
}

export async function addComment(postId: string, body: string): Promise<void> {
  const user = requireUser();
  const { fs } = await loadFirebase();
  await addDoc(collection(fs, "communityPosts", postId, "comments"), {
    authorId: user.uid,
    authorName: user.name?.trim().slice(0, 60) || "Reader",
    body: body.trim().slice(0, 2000),
    createdAt: Date.now(),
  });
}

export async function subscribePostLikes(postId: string, uid: string, onLikes: (state: PostLikeState) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await loadFirebase();
  return onSnapshot(collection(fs, "communityPosts", postId, "likes"), (snapshot) => {
    onLikes({ count: snapshot.size, liked: !!uid && snapshot.docs.some((item) => item.id === uid) });
  }, onError);
}

export async function setPostLike(postId: string, liked: boolean): Promise<void> {
  const user = requireUser();
  const { fs } = await loadFirebase();
  const reference = doc(fs, "communityPosts", postId, "likes", user.uid);
  if (liked) await deleteDoc(reference);
  else await setDoc(reference, { uid: user.uid, createdAt: Date.now() });
}

export async function subscribePollVotes(postId: string, onVotes: (votes: Record<string, number>) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await loadFirebase();
  return onSnapshot(collection(fs, "communityPosts", postId, "votes"), (snapshot) => {
    onVotes(Object.fromEntries(snapshot.docs.map((item) => [item.id, Number(item.data().optionIndex)])));
  }, onError);
}

export async function votePoll(postId: string, optionIndex: number): Promise<void> {
  const user = requireUser();
  const { fs } = await loadFirebase();
  await setDoc(doc(fs, "communityPosts", postId, "votes", user.uid), { uid: user.uid, optionIndex, updatedAt: Date.now() });
}

export async function subscribeRatings(comicKey: string, onRatings: (ratings: RatingRecord[]) => void, onError: (error: Error) => void): Promise<Unsubscribe> {
  const { fs } = await loadFirebase();
  return onSnapshot(query(collection(fs, "communityRatings"), where("comicKey", "==", comicKey), limit(500)),
    (snapshot) => onRatings(snapshot.docs.map((item) => ({ uid: String(item.data().uid), score: Number(item.data().score) }))), onError);
}

export async function rateComic(comic: CommunityComic, score: number): Promise<void> {
  const user = requireUser();
  const { fs } = await loadFirebase();
  const comicKey = hash53(comic.mangaId);
  await setDoc(doc(fs, "communityRatings", `${comicKey}_${user.uid}`), {
    comicKey,
    comicTitle: comic.title.slice(0, 160),
    sourceId: comic.sourceId.slice(0, 120),
    uid: user.uid,
    score: Math.max(1, Math.min(5, Math.round(score))),
    updatedAt: Date.now(),
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