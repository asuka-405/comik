import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSettings } from "@/core/settings";
import { db } from "@/core/db";
import { hash53 } from "@/core/hash";
import { trackAnalytics } from "@/core/analytics";
import { getSource } from "@/core/sources/registry";
import { defaultFirebaseAvailable, linkGoogle, readFirebaseConfig, useSync } from "@/core/sync/firebase";
import { startSync } from "@/core/sync/engine";
import { addComment, comicReference, publishPost, rateComic, subscribeComments, subscribePollVotes, subscribePosts, subscribeRatings, uploadCommunityImage, votePoll, type CommunityComment, type CommunityKind, type CommunityPost, type RatingRecord } from "@/core/community";
import { toast } from "../common";

const KINDS: [CommunityKind, string][] = [["discussion", "Discussion"], ["recommendation", "Recommendation"], ["poll", "Poll"]];

export function CommunityPage() {
  const sync = useSync();
  const config = readFirebaseConfig();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!config || sync.status === "off") return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void subscribePosts((items) => { setPosts(items); setLoading(false); }, (cause) => { setError(cause.message); setLoading(false); })
      .then((off) => { if (dead) off(); else unsubscribe = off; })
      .catch((cause: Error) => { if (!dead) { setError(cause.message); setLoading(false); } });
    return () => { dead = true; unsubscribe?.(); };
  }, [config?.projectId, sync.status]);

  const startCommunity = () => {
    localStorage.setItem("comik.sync.enabled", "1");
    void startSync();
  };

  return (
    <div className="page community-page">
      <div className="topbar">
        <div><div className="kicker">Comik community</div><h1>Read together</h1></div>
        <div className="spacer" />
        {sync.user?.isAnonymous && <button className="btn primary" onClick={() => void linkGoogle().then(() => toast("Google account connected")).catch((cause: Error) => toast(cause.message, true))}>Sign in with Google</button>}
      </div>
      {!config ? (
        <section className="panel"><h2>Firebase is not configured</h2><p className="muted">Choose the app server or connect your Firebase project in Settings to use the community.</p><a className="btn" href="#/settings">Open Firebase settings</a></section>
      ) : sync.status === "off" ? (
        <section className="panel"><h2>Connect to the selected server</h2><p className="muted" style={{ marginBottom: 12 }}>Community posts and ratings are shared within this Firebase project. Sign in with Google to post, comment, vote, or rate.</p><button className="btn primary" onClick={startCommunity}>Connect</button></section>
      ) : (
        <>
          {error && <div className="err" role="alert">{error}</div>}
          <CommunityComposer onPublished={(post) => setPosts((items) => [post, ...items])} />
          <div className="community-feed" aria-live="polite">
            {loading && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading discussions</span></div>}
            {!loading && !posts.length && !error && <section className="empty"><h2>Nothing here yet</h2><p>Start a discussion, recommend a series, or ask the community a question.</p></section>}
            {posts.map((post) => <PostView key={post.id} post={post} />)}
          </div>
        </>
      )}
      {config && sync.status === "error" && <div className="err" role="alert">Firebase connection failed: {sync.error}</div>}
      {config && sync.status === "ready" && sync.user?.isAnonymous && <p className="hint muted">You are browsing anonymously. Google sign-in is required to contribute.</p>}
      {config && !defaultFirebaseAvailable() && <p className="hint muted">Using the selected Firebase project. Community data is private to this project.</p>}
    </div>
  );
}

function CommunityComposer({ onPublished }: { onPublished: (post: CommunityPost) => void }) {
  const user = useSync((state) => state.user);
  const settings = useSettings();
  const library = useLiveQuery(() => db.manga.filter((item) => item.inLibrary).toArray(), [], []);
  const [kind, setKind] = useState<CommunityKind>("discussion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mangaId, setMangaId] = useState("");
  const [options, setOptions] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedManga = library?.find((item) => item.id === mangaId);
  const signedIn = !!user && !user.isAnonymous;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!signedIn) return toast("Sign in with Google to post.", true);
    const pollOptions = options.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 8);
    if (kind === "poll" && pollOptions.length < 2) return toast("A poll needs at least two options.", true);
    setBusy(true);
    try {
      const source = selectedManga ? getSource(selectedManga.sourceId) : undefined;
      let sourceUrl = "";
      if (selectedManga && source) {
        try {
          const url = new URL(selectedManga.url, source.baseUrl);
          if (url.protocol === "https:" || url.protocol === "http:") sourceUrl = url.toString();
        } catch { /* Local imports have no external source URL. */ }
      }
      const comic = selectedManga && source ? comicReference(selectedManga, source.name, sourceUrl) : undefined;
      const imageUrl = image ? await uploadCommunityImage(image, settings.imgurClientId) : undefined;
      const data = {
        kind,
        title: title.trim().slice(0, 160),
        body: body.trim().slice(0, 5000),
        ...(comic ? { comic } : {}),
        ...(kind === "poll" ? { pollOptions } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      };
      const id = await publishPost(data);
      onPublished({ ...data, id, authorId: user!.uid, authorName: user!.name || "Reader", createdAt: Date.now() });
      void trackAnalytics("community_post", { kind });
      setTitle(""); setBody(""); setMangaId(""); setOptions(""); setImage(null);
      if (fileRef.current) fileRef.current.value = "";
      toast("Post published");
    } catch (cause) {
      toast((cause as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="community-compose" onSubmit={(event) => void submit(event)}>
      <div className="seg" role="tablist" aria-label="Post type">
        {KINDS.map(([value, label]) => <button type="button" key={value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>{label}</button>)}
      </div>
      <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={kind === "poll" ? "Poll question" : "Give your post a title"} aria-label="Post title" required />
      <textarea className="input" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={4} placeholder="Write a discussion or recommendation" aria-label="Post text" required />
      {kind === "poll" && <textarea className="input" value={options} onChange={(event) => setOptions(event.target.value)} maxLength={500} rows={3} placeholder="One poll option per line" aria-label="Poll options" required />}
      <div className="community-compose-tools">
        <select className="input" value={mangaId} onChange={(event) => setMangaId(event.target.value)} aria-label="Reference a comic">
          <option value="">Reference a comic (optional)</option>
          {library?.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
        <button className="btn" type="button" onClick={() => fileRef.current?.click()}>{image ? `${image.name} · ${(image.size / 1024).toFixed(1)} KB` : "Attach image"}</button>
        <button className="btn primary" type="submit" disabled={busy || !signedIn}>{busy ? "Publishing" : "Post"}</button>
      </div>
      {!signedIn && <span className="hint muted">Connect Firebase and sign in with Google to contribute.</span>}
    </form>
  );
}

function PostView({ post }: { post: CommunityPost }) {
  const user = useSync((state) => state.user);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [comment, setComment] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const comicKey = post.comic ? hash53(post.comic.mangaId) : "";
  const pollOptions = post.pollOptions ?? [];

  useEffect(() => {
    if (!post.comic) return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeRatings(comicKey, setRatings, () => {}).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [comicKey, post.comic]);

  useEffect(() => {
    if (post.kind !== "poll") return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribePollVotes(post.id, setVotes, () => {}).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, post.kind]);

  useEffect(() => {
    if (!showComments) return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeComments(post.id, setComments, () => {}).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, showComments]);

  const ratingAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length : 0;
  const userVote = user ? votes[user.uid] : undefined;
  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try { await addComment(post.id, comment); setComment(""); void trackAnalytics("community_comment"); } catch (cause) { toast((cause as Error).message, true); }
    setBusy(false);
  };

  return (
    <article className="community-post">
      <header><span className="tag">{post.kind}</span><time className="muted">{new Date(post.createdAt).toLocaleString()}</time></header>
      <h2>{post.title}</h2>
      <p>{post.body}</p>
      <div className="muted community-author">{post.authorName}</div>
      {post.comic && (post.comic.sourceUrl ? <a className="community-reference" href={post.comic.sourceUrl} target="_blank" rel="noreferrer"><strong>{post.comic.title}</strong><span>Open at {post.comic.sourceName}</span></a> : <div className="community-reference"><strong>{post.comic.title}</strong><span>Local comic · {post.comic.sourceName}</span></div>)}
      {post.imageUrl && <img className="community-image" src={post.imageUrl} alt="Image attached to this post" loading="lazy" />}
      {post.kind === "poll" && <div className="community-poll">{pollOptions.map((option, index) => {
        const count = Object.values(votes).filter((value) => value === index).length;
        return <button key={`${index}-${option}`} className={`poll-option${userVote === index ? " on" : ""}`} disabled={!user || user.isAnonymous || userVote !== undefined} onClick={() => void votePoll(post.id, index).then(() => trackAnalytics("community_vote")).catch((cause: Error) => toast(cause.message, true))}>
          <span>{option}</span><span className="mono">{count}</span>
        </button>;
      })}<span className="muted">{Object.keys(votes).length} votes</span></div>}
      {post.comic && <div className="community-rating"><span>Rating {ratingAverage ? `${ratingAverage.toFixed(1)} / 5 · ${ratings.length}` : "No ratings yet"}</span><div className="rating-buttons" aria-label="Rate this comic">{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" aria-label={`Rate ${score} out of 5`} disabled={!user || user.isAnonymous} className={(ratings.find((rating) => rating.uid === user?.uid)?.score ?? 0) >= score ? "on" : ""} onClick={() => void rateComic(post.comic!, score).then(() => trackAnalytics("community_rating", { score })).catch((cause: Error) => toast(cause.message, true))}>★</button>)}</div></div>}
      <button className="btn sm" onClick={() => setShowComments((value) => !value)}>{showComments ? "Hide comments" : "Comments"}</button>
      {showComments && <div className="community-comments">
        {comments.map((item) => <div key={item.id} className="community-comment"><strong>{item.authorName}</strong><span>{item.body}</span></div>)}
        <form onSubmit={(event) => void submitComment(event)}><input className="input" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder="Add a comment" aria-label="Add a comment" /><button className="btn" disabled={busy || !user || user.isAnonymous}>Reply</button></form>
      </div>}
    </article>
  );
}