import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChatCircleDots, Heart, MagnifyingGlass, PencilSimpleLine, ShareNetwork } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { db } from "@/core/db";
import { hash53 } from "@/core/hash";
import { trackAnalytics } from "@/core/analytics";
import { getSource } from "@/core/sources/registry";
import { defaultFirebaseAvailable, linkGoogle, readFirebaseConfig, useSync } from "@/core/sync/firebase";
import { startSync } from "@/core/sync/engine";
import { addComment, comicReference, publishPost, rateComic, setPostLike, subscribeComments, subscribePollVotes, subscribePostLikes, subscribePosts, subscribeRatings, uploadCommunityImage, votePoll, type CommunityComment, type CommunityKind, type CommunityPost, type PostLikeState, type RatingRecord } from "@/core/community";
import { timeAgo, toast } from "../common";

const KINDS: [CommunityKind, string][] = [["discussion", "Discussion"], ["recommendation", "Recommendation"], ["poll", "Poll"]];

export function CommunityPage() {
  const sync = useSync();
  const config = readFirebaseConfig();
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | CommunityKind>("all");
  const [search, setSearch] = useState("");

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

  useEffect(() => {
    const postId = searchParams.get("post");
    if (!postId || !posts.some((post) => post.id === postId)) return;
    setKindFilter("all");
    setSearch("");
    document.getElementById(`community-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [posts, searchParams]);

  const visiblePosts = posts.filter((post) => {
    if (kindFilter !== "all" && post.kind !== kindFilter) return false;
    if (!search.trim()) return true;
    const text = `${post.title} ${post.body} ${post.comic?.title ?? ""} ${post.authorName}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  const startCommunity = () => {
    localStorage.setItem("comik.sync.enabled", "1");
    void startSync();
  };

  return (
    <div className="page community-page">
      <div className="community-layout">
        <main className="community-main">
      <div className="community-titlebar">
        <div><div className="kicker">Comik · readers' corner</div><h1>Community</h1><p>Talk chapters, trade recommendations, and find your next read.</p></div>
        <div className="community-title-actions">
          <Link className="btn primary" to="/community/new"><PencilSimpleLine size={18} />Write a post</Link>
          {sync.user?.isAnonymous && <button className="btn" onClick={() => void linkGoogle().then(() => toast("Google account connected")).catch((cause: Error) => toast(cause.message, true))}>Sign in</button>}
        </div>
      </div>
      {!config ? (
        <section className="panel"><h2>Firebase is not configured</h2><p className="muted">Choose the app server or connect your Firebase project in Settings to use the community.</p><a className="btn" href="#/settings">Open Firebase settings</a></section>
      ) : sync.status === "off" ? (
        <section className="panel"><h2>Connect to the selected server</h2><p className="muted" style={{ marginBottom: 12 }}>Community posts and ratings are shared within this Firebase project. Sign in with Google to post, comment, vote, or rate.</p><button className="btn primary" onClick={startCommunity}>Connect</button></section>
      ) : (
        <>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="community-feed-tools">
            <div className="community-feed-filters" role="tablist" aria-label="Filter community posts">
              {([ ["all", "For you"], ["discussion", "Discussions"], ["recommendation", "Picks"], ["poll", "Polls"] ] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kindFilter === value} className={kindFilter === value ? "active" : ""} onClick={() => setKindFilter(value)}>{label}</button>)}
            </div>
            <label className="community-search"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a post" aria-label="Search community posts" /></label>
          </div>
          <div className="community-feed" aria-live="polite">
            {loading && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading discussions</span></div>}
            {!loading && !posts.length && !error && <section className="community-empty"><span className="community-empty-mark">✳</span><h2>Start the conversation</h2><p>Your reader community is just getting started. Share a favorite, ask a question, or make a poll.</p></section>}
            {!loading && posts.length > 0 && !visiblePosts.length && <section className="community-empty"><h2>No posts match</h2><p>Try another search or post type.</p></section>}
            {visiblePosts.map((post) => <PostView key={post.id} post={post} />)}
          </div>
        </>
      )}
      {config && sync.status === "error" && <div className="err" role="alert">Firebase connection failed: {sync.error}</div>}
      {config && sync.status === "ready" && sync.user?.isAnonymous && <p className="hint muted">You are browsing anonymously. Google sign-in is required to contribute.</p>}
      {config && !defaultFirebaseAvailable() && <p className="hint muted">Using the selected Firebase project. Community data is private to this project.</p>}
        </main>
        <aside className="community-aside">
          <section className="community-aside-intro"><span className="kicker">The reading room</span><h2>Good stories get better shared.</h2><p>Keep it kind. Mark spoilers. Link the source when you recommend a series.</p></section>
          <section className="community-aside-section"><h3>In this room</h3><div><i className="aside-dot coral" />Discussions<span>{posts.filter((post) => post.kind === "discussion").length}</span></div><div><i className="aside-dot teal" />Recommendations<span>{posts.filter((post) => post.kind === "recommendation").length}</span></div><div><i className="aside-dot gold" />Polls<span>{posts.filter((post) => post.kind === "poll").length}</span></div></section>
          <div className="community-aside-foot">Posts and ratings are shared within the selected Firebase project.</div>
        </aside>
      </div>
    </div>
  );
}

export function CommunityNewPostPage() {
  const sync = useSync();
  const config = readFirebaseConfig();
  const navigate = useNavigate();
  const connect = () => {
    localStorage.setItem("comik.sync.enabled", "1");
    void startSync();
  };

  return (
    <div className="page community-new-page">
      <Link className="community-back" to="/community"><ArrowLeft size={17} />Back to community</Link>
      <header className="community-new-heading"><div className="kicker">The reading room</div><h1>Start a conversation</h1><p>Share a thought, put a question to readers, or give someone their next favorite series.</p></header>
      {!config ? (
        <section className="community-gate"><h2>Set up Firebase first</h2><p>Connect the app server or your own Firebase project to publish community posts.</p><Link className="btn primary" to="/settings">Open Firebase settings</Link></section>
      ) : sync.status === "off" ? (
        <section className="community-gate"><h2>Connect to the reading room</h2><p>Posts and replies are shared with people using this Firebase project.</p><button className="btn primary" onClick={connect}>Connect</button></section>
      ) : (
        <>
          {sync.status === "error" && <div className="err" role="alert">{sync.error}</div>}
          <CommunityComposer onPublished={() => navigate("/community", { replace: true })} />
          {(!sync.user || sync.user.isAnonymous) && <Link className="community-login-prompt" to="/login">Sign in with Google to publish</Link>}
        </>
      )}
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
      <div className="community-compose-head"><SocialAvatar name={user?.name || user?.email || "Reader"} /><div><strong>{signedIn ? `Posting as ${user?.name || user?.email}` : "Join the conversation"}</strong><span>{signedIn ? "Share a thought with the room" : "Sign in with Google to post, reply, and vote"}</span></div></div>
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
  const [likes, setLikes] = useState<PostLikeState>({ count: 0, liked: false });
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
  useEffect(() => {
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribePostLikes(post.id, user?.uid ?? "", setLikes, () => {}).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, user?.uid]);

  const share = async () => {
    const url = `${location.origin}${location.pathname}#/community?post=${encodeURIComponent(post.id)}`;
    try {
      if (navigator.share) await navigator.share({ title: post.title, url });
      else { await navigator.clipboard.writeText(url); toast("Post link copied"); }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") toast("Could not share this post", true);
    }
  };
  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    try { await addComment(post.id, comment); setComment(""); void trackAnalytics("community_comment"); } catch (cause) { toast((cause as Error).message, true); }
    setBusy(false);
  };

  return (
    <article id={`community-post-${post.id}`} className="community-post">
      <header className="community-post-head"><SocialAvatar name={post.authorName} /><div className="community-post-author"><strong>{post.authorName}</strong><span>{timeAgo(post.createdAt) || new Date(post.createdAt).toLocaleDateString()}</span></div><span className={`community-kind ${post.kind}`}>{post.kind === "recommendation" ? "reader pick" : post.kind}</span></header>
      <h2>{post.title}</h2>
      <p>{post.body}</p>
      {post.comic && (post.comic.sourceUrl ? <a className="community-reference" href={post.comic.sourceUrl} target="_blank" rel="noreferrer"><strong>{post.comic.title}</strong><span>Open at {post.comic.sourceName}</span></a> : <div className="community-reference"><strong>{post.comic.title}</strong><span>Local comic · {post.comic.sourceName}</span></div>)}
      {post.imageUrl && <img className="community-image" src={post.imageUrl} alt="Image attached to this post" loading="lazy" />}
      {post.kind === "poll" && <div className="community-poll">{pollOptions.map((option, index) => {
        const count = Object.values(votes).filter((value) => value === index).length;
        return <button key={`${index}-${option}`} className={`poll-option${userVote === index ? " on" : ""}`} disabled={!user || user.isAnonymous || userVote !== undefined} onClick={() => void votePoll(post.id, index).then(() => trackAnalytics("community_vote")).catch((cause: Error) => toast(cause.message, true))}>
          <span>{option}</span><span className="mono">{count}</span>
        </button>;
      })}<span className="muted">{Object.keys(votes).length} votes</span></div>}
      {post.comic && <div className="community-rating"><span>Rating {ratingAverage ? `${ratingAverage.toFixed(1)} / 5 · ${ratings.length}` : "No ratings yet"}</span><div className="rating-buttons" aria-label="Rate this comic">{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" aria-label={`Rate ${score} out of 5`} disabled={!user || user.isAnonymous} className={(ratings.find((rating) => rating.uid === user?.uid)?.score ?? 0) >= score ? "on" : ""} onClick={() => void rateComic(post.comic!, score).then(() => trackAnalytics("community_rating", { score })).catch((cause: Error) => toast(cause.message, true))}>★</button>)}</div></div>}
      <div className="community-post-actions">
        <button className={`community-action like${likes.liked ? " liked" : ""}`} disabled={!user || user.isAnonymous} aria-pressed={likes.liked} onClick={() => void setPostLike(post.id, likes.liked).then(() => trackAnalytics("community_like")).catch((cause: Error) => toast(cause.message, true))}><Heart size={19} weight={likes.liked ? "fill" : "regular"} /><span>{likes.count ? likes.count : "Like"}</span></button>
        <button className={`community-action${showComments ? " selected" : ""}`} onClick={() => setShowComments((value) => !value)}><ChatCircleDots size={19} /><span>{showComments ? "Hide replies" : "Reply"}</span></button>
        <button className="community-action" onClick={() => void share()}><ShareNetwork size={18} /><span>Share</span></button>
      </div>
      {showComments && <div className="community-comments">
        {comments.map((item) => <div key={item.id} className="community-comment"><strong>{item.authorName}</strong><span>{item.body}</span></div>)}
        <form onSubmit={(event) => void submitComment(event)}><input className="input" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder="Add a comment" aria-label="Add a comment" /><button className="btn" disabled={busy || !user || user.isAnonymous}>Reply</button></form>
      </div>}
    </article>
  );
}

function SocialAvatar({ name }: { name: string }) {
  const colors = ["coral", "teal", "gold", "leaf", "sky"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return <span className={`social-avatar ${color}`} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "R"}</span>;
}