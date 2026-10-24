import { loadFirebase, useSync, deleteSignedInAccount } from "./firebase";
import { resetPushCursor, stopSync } from "./engine";

/**
 * Wipe or delete the signed-in Firebase account's cloud data.
 *
 * Covers everything stored under the account that Comik can find:
 *  - the synced library and settings (`users/<uid>`),
 *  - the account's Community posts, and on those posts the likes, votes and comments it left itself,
 *  - the account's ratings.
 * Comments, likes and votes left on other people's posts are not found by any query the rules allow,
 * so they stay. Nothing on this device is touched.
 */
export interface WipeSummary {
  library: number;
  posts: number;
  ratings: number;
}

const BATCH = 400;

async function deleteAll(refs: import("firebase/firestore").DocumentReference[]): Promise<number> {
  const { fs, fsMod } = await loadFirebase();
  for (let start = 0; start < refs.length; start += BATCH) {
    const batch = fsMod.writeBatch(fs);
    for (const ref of refs.slice(start, start + BATCH)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

export async function wipeAccountData(): Promise<WipeSummary> {
  const { fs, fsMod } = await loadFirebase();
  const uid = useSync.getState().user?.uid;
  if (!uid) throw new Error("You are not signed in.");
  // Stop sync first, or it would upload the library again while it is being removed.
  stopSync();
  localStorage.removeItem("comik.sync.enabled");

  const refs = async (path: string) => (await fsMod.getDocs(fsMod.collection(fs, path))).docs.map((d) => d.ref);
  const library = await deleteAll([...(await refs(`users/${uid}/series`)), ...(await refs(`users/${uid}/meta`))]);

  let posts = 0;
  const owned = await fsMod.getDocs(fsMod.query(fsMod.collection(fs, "communityPosts"), fsMod.where("authorId", "==", uid)));
  for (const post of owned.docs) {
    // Remove what this account left on its own post first; what others left cannot be deleted by it.
    const mine = [
      fsMod.doc(fs, `communityPosts/${post.id}/likes/${uid}`),
      fsMod.doc(fs, `communityPosts/${post.id}/votes/${uid}`),
      ...(await fsMod.getDocs(fsMod.query(fsMod.collection(fs, `communityPosts/${post.id}/comments`), fsMod.where("authorId", "==", uid)))).docs.map((d) => d.ref),
    ];
    for (const ref of mine) await fsMod.deleteDoc(ref).catch(() => {});
    await fsMod.deleteDoc(post.ref);
    posts++;
  }

  const rated = await fsMod.getDocs(fsMod.query(fsMod.collection(fs, "communityRatings"), fsMod.where("uid", "==", uid)));
  const ratings = await deleteAll(rated.docs.map((d) => d.ref));

  resetPushCursor();
  localStorage.removeItem("comik.sync.last");
  useSync.getState().patch({ lastSyncedAt: 0, status: "off", error: undefined });
  return { library, posts, ratings };
}

/** Delete the data, then the account itself. */
export async function purgeAccount(reauth: () => Promise<void>): Promise<WipeSummary> {
  const summary = await wipeAccountData();
  try {
    await deleteSignedInAccount();
  } catch (error) {
    // Firebase wants a fresh sign-in before deleting an account that has been open a while.
    if ((error as { code?: string }).code !== "auth/requires-recent-login") throw error;
    await reauth();
    await deleteSignedInAccount();
  }
  return summary;
}
