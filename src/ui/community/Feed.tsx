import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChatCircleDots, Heart, MagnifyingGlass, PushPin, ShareNetwork, Trash, X } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { db } from "@/core/db";
import { hash53 } from "@/core/hash";
import { trackAnalytics } from "@/core/analytics";
import { getSource } from "@/core/sources/registry";
import { appLink } from "@/core/platform";
import { addComment, deleteComment, deletePost, isStaff, pinPost, rateComic, setPostLike, subscribeComments, subscribePollVotes, subscribePostLikes, subscribePosts, subscribeRatings, votePoll, type CommunityComment, type CommunityPost, type CommunityTarget, type PostLikeState, type RatingRecord, type Role } from "@/core/community";
import { ConfirmDialog, coverSrc, hueOf, timeAgo, toast } from "../common";
import { SocialAvatar } from "./shared";

const HASHTAG = /#([\p{L}\p{N}_]{2,30})/gu;

export function hashtagsOf(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((m) => m[1]!.toLowerCase());
}

/**
 * Wrap the selected text of a textarea in ||spoiler|| markers. With nothing selected, drop in a
 * placeholder and select it so typing replaces it. Selection and focus are put back afterwards.
 */
export function wrapSpoiler(field: HTMLTextAreaElement | null, body: string, set: (value: string) => void) {
  const start = field?.selectionStart ?? body.length;
  const end = field?.selectionEnd ?? body.length;
  const inner = start === end ? "spoiler" : body.slice(start, end);
  set(`${body.slice(0, start)}||${inner}||${body.slice(end)}`);
  requestAnimationFrame(() => {
    field?.focus();
    field?.setSelectionRange(start + 2, start + 2 + inner.length);
  });
}

/** Post text with #tags that filter the feed and ||spoilers|| hidden until tapped. Plain React text, never HTML. */
function RichText({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  const parts = text.split(/(\|\|[^|]+?\|\||#[\p{L}\p{N}_]{2,30})/gu);
  return <>{parts.map((part, i) => {
    if (part.startsWith("||") && part.endsWith("||") && part.length > 4) return <Spoiler key={i} text={part.slice(2, -2)} />;
    if (part.startsWith("#") && part.length > 2) return <button key={i} className="hashtag" onClick={() => onTag(part.slice(1).toLowerCase())}>{part}</button>;
    return part;
  })}</>;
}

function Spoiler({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  return <span className={`spoiler${shown ? " shown" : ""}`} role="button" tabIndex={0} aria-label={shown ? "Spoiler" : "Hidden spoiler, press to reveal"} onClick={() => setShown(true)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShown(true)}>{text}</span>;
}

interface Viewer { uid: string; signedIn: boolean; role?: Role; name: string }

/** The "what are you reading" box at the top of the feed, with one-tap shares of recent reads. */
function QuickCompose({ name, communityId, canPost }: { name: string; communityId: string; canPost: boolean }) {
  const recent = useLiveQuery(async () => {
    const read = await db.chapters.where("readAt").above(0).reverse().sortBy("readAt");
    const seen: string[] = [];
    for (const c of read) if (!seen.includes(c.mangaId)) seen.push(c.mangaId);
    const rows = await Promise.all(seen.slice(0, 6).map((id) => db.manga.get(id)));
    return rows.filter((m): m is NonNullable<typeof m> => !!m && !m.vault && !(useSettings.getState().safeMode && getSource(m.sourceId)?.isNsfw)).slice(0, 3);
  }, [], []);
  if (!canPost) return null;
  const to = (extra = "") => `/community/new?c=${encodeURIComponent(communityId)}${extra}`;
  return (
    <section className="community-quick">
      <div className="community-quick-row">
        <SocialAvatar name={name} />
        <Link className="community-quick-input" to={to()}>What are you reading, {name.split(" ")[0]}?</Link>
      </div>
      {!!recent?.length && (
        <div className="community-quick-shares">
          <span className="muted">Share a read</span>
          {recent.map((m) => <Link key={m.id} className="chip" data-hue={hueOf(m.id)} to={to(`&comic=${encodeURIComponent(m.id)}`)}>{m.title}</Link>)}
        </div>
      )}
    </section>
  );
}

export function CommunityFeed({ target, viewer, canPost, canPin }: { target: CommunityTarget; viewer: Viewer; canPost: boolean; canPin: boolean }) {
  const safeMode = useSettings((state) => state.safeMode);
  const [searchParams] = useSearchParams();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | CommunityPost["kind"]>("all");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    setLoading(true);
    setError("");
    void subscribePosts((items) => { setPosts(items); setLoading(false); }, (cause) => { setError(cause.message); setLoading(false); }, target)
      .then((close) => { if (dead) close(); else off = close; })
      .catch((cause: Error) => { if (!dead) { setError(cause.message); setLoading(false); } });
    return () => { dead = true; off?.(); };
  }, [target.id]);

  useEffect(() => {
    const postId = searchParams.get("post");
    if (!postId || !posts.some((post) => post.id === postId)) return;
    setKindFilter("all");
    setSearch("");
    document.getElementById(`community-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [posts, searchParams]);

  const hidden = (post: CommunityPost) => safeMode && !!post.comic && !!getSource(post.comic.sourceId)?.isNsfw;
  const visible = useMemo(() => posts
    .filter((post) => {
      if (hidden(post)) return false;
      if (kindFilter !== "all" && post.kind !== kindFilter) return false;
      if (author && post.authorId !== author.id) return false;
      if (tag && !hashtagsOf(`${post.title} ${post.body}`).includes(tag)) return false;
      if (!search.trim()) return true;
      return `${post.title} ${post.body} ${post.comic?.title ?? ""} ${post.authorName}`.toLowerCase().includes(search.trim().toLowerCase());
    })
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)), [posts, kindFilter, author, tag, search, safeMode]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts) if (!hidden(post)) for (const name of new Set(hashtagsOf(`${post.title} ${post.body}`))) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [posts, safeMode]);

  return (
    <>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="community-feed-tools">
        <div className="community-feed-filters" role="tablist" aria-label="Filter community posts">
          {([["all", "All"], ["discussion", "Discussions"], ["recommendation", "Picks"], ["poll", "Polls"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kindFilter === value} className={kindFilter === value ? "active" : ""} onClick={() => setKindFilter(value)}>{label}</button>)}
        </div>
        <label className="community-search"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a post" aria-label="Search community posts" /></label>
      </div>
      {(tag || author || tags.length > 0) && (
        <div className="community-active-filters">
          {tag && <button className="chip on" onClick={() => setTag("")}>#{tag} <X size={12} /></button>}
          {author && <button className="chip on" onClick={() => setAuthor(null)}>Posts by {author.name} <X size={12} /></button>}
          {!tag && tags.map(([name, n]) => <button key={name} className="chip" onClick={() => setTag(name)}>#{name} <span className="mono muted">{n}</span></button>)}
        </div>
      )}
      <QuickCompose name={viewer.name} communityId={target.id} canPost={canPost} />
      <div className="community-feed" aria-live="polite">
        {loading && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading discussions</span></div>}
        {!loading && !posts.length && !error && <section className="community-empty"><span className="community-empty-mark">✳</span><h2>Start the conversation</h2><p>Nothing here yet. Share a favorite, ask a question, or make a poll.</p></section>}
        {!loading && posts.length > 0 && !visible.length && <section className="community-empty"><h2>No posts match</h2><p>Try another search or post type.</p></section>}
        {visible.map((post) => <PostView key={post.id} post={post} target={target} viewer={viewer} canPin={canPin} onTag={setTag} onAuthor={(id, name) => setAuthor({ id, name })} />)}
      </div>
    </>
  );
}

function PostView({ post, target, viewer, canPin, onTag, onAuthor }: { post: CommunityPost; target: CommunityTarget; viewer: Viewer; canPin: boolean; onTag: (tag: string) => void; onAuthor: (id: string, name: string) => void }) {
  // The comic id is only meaningful on the poster's device, so a cover shows when it is also on this shelf.
  const local = useLiveQuery(() => (post.comic ? db.manga.get(post.comic.mangaId) : undefined), [post.comic?.mangaId]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [ratings, setRatings] = useState<RatingRecord[]>([]);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [likes, setLikes] = useState<PostLikeState>({ count: 0, liked: false });
  const [comment, setComment] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const comicKey = post.comic ? hash53(post.comic.mangaId) : "";
  const pollOptions = post.pollOptions ?? [];
  const mine = post.authorId === viewer.uid;
  const staff = isStaff(viewer.role);
  const canRemove = mine || (!!target.communityId && staff);
  const nothing = () => {};

  useEffect(() => {
    if (!post.comic) return;
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeRatings(comicKey, setRatings, nothing, target).then((close) => { if (dead) close(); else off = close; }).catch(nothing);
    return () => { dead = true; off?.(); };
  }, [comicKey, post.comic, target.id]);

  useEffect(() => {
    if (post.kind !== "poll") return;
    let dead = false;
    let off: (() => void) | undefined;
    void subscribePollVotes(post.id, setVotes, nothing, target).then((close) => { if (dead) close(); else off = close; }).catch(nothing);
    return () => { dead = true; off?.(); };
  }, [post.id, post.kind, target.id]);

  useEffect(() => {
    if (!showComments) return;
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeComments(post.id, setComments, nothing, target).then((close) => { if (dead) close(); else off = close; }).catch(nothing);
    return () => { dead = true; off?.(); };
  }, [post.id, showComments, target.id]);

  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void subscribePostLikes(post.id, viewer.uid, setLikes, nothing, target).then((close) => { if (dead) close(); else off = close; }).catch(nothing);
    return () => { dead = true; off?.(); };
  }, [post.id, viewer.uid, target.id]);

  const ratingAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length : 0;
  const userVote = viewer.uid ? votes[viewer.uid] : undefined;
  const interact = viewer.signedIn && (!target.communityId || !!viewer.role);

  const share = async () => {
    const url = appLink(target.communityId ? `/community/${target.communityId}?post=${post.id}` : `/community/public?post=${post.id}`);
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
    try { await addComment(post.id, comment, target); setComment(""); void trackAnalytics("community_comment"); } catch (cause) { toast((cause as Error).message, true); }
    setBusy(false);
  };
  const remove = async () => {
    setConfirmDelete(false);
    try { await deletePost(post.id, target); toast("Post deleted"); } catch (cause) { toast((cause as Error).message, true); }
  };

  return (
    <article id={`community-post-${post.id}`} className={`community-post${post.pinned ? " pinned" : ""}`}>
      <header className="community-post-head"><SocialAvatar name={post.authorName} /><div className="community-post-author"><button className="author-link" onClick={() => onAuthor(post.authorId, post.authorName)} title={`Posts by ${post.authorName}`}>{post.authorName}</button><span>{timeAgo(post.createdAt) || new Date(post.createdAt).toLocaleDateString()}</span></div>
        {post.pinned && <span className="cm-pinned"><PushPin size={12} weight="fill" /> Pinned</span>}
        <span className={`community-kind ${post.kind}`}>{post.kind === "recommendation" ? "reader pick" : post.kind}</span></header>
      <h2>{post.title}</h2>
      <p><RichText text={post.body} onTag={onTag} /></p>
      {post.comic && (
        <div className={`community-reference${local ? " with-cover" : ""}`} data-hue={hueOf(post.comic.mangaId)}>
          {local && <img src={coverSrc(local.sourceId, local.cover)} alt="" loading="lazy" />}
          <div>
            <strong>{post.comic.title}</strong>
            <span>{post.comic.sourceUrl ? `${post.comic.sourceName} · ${mediaLabel(post.comic.mediaKind)}` : `Local ${mediaLabel(post.comic.mediaKind).toLowerCase()} · ${post.comic.sourceName}`}</span>
            <div className="community-reference-links">
              {local?.inLibrary && <Link to={`/series/${encodeURIComponent(local.id)}`}>In your library</Link>}
              {post.comic.sourceUrl && <a href={post.comic.sourceUrl} target="_blank" rel="noreferrer">Open at {post.comic.sourceName}</a>}
            </div>
          </div>
        </div>
      )}
      {post.imageUrl && <img className="community-image" src={post.imageUrl} alt="Image attached to this post" loading="lazy" />}
      {post.kind === "poll" && <div className="community-poll">{pollOptions.map((option, index) => {
        const count = Object.values(votes).filter((value) => value === index).length;
        return <button key={`${index}-${option}`} className={`poll-option${userVote === index ? " on" : ""}`} disabled={!interact || userVote !== undefined} onClick={() => void votePoll(post.id, index, target).then(() => trackAnalytics("community_vote")).catch((cause: Error) => toast(cause.message, true))}>
          <span>{option}</span><span className="mono">{count}</span>
        </button>;
      })}<span className="muted">{Object.keys(votes).length} votes</span></div>}
      {post.comic && <div className="community-rating"><span>{mediaLabel(post.comic.mediaKind)} rating {ratingAverage ? `${ratingAverage.toFixed(1)} / 5 · ${ratings.length}` : "not rated yet"}</span><div className="rating-buttons" aria-label={`Rate this ${mediaLabel(post.comic.mediaKind).toLowerCase()}`}>{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" aria-label={`Rate ${score} out of 5`} disabled={!interact} className={(ratings.find((rating) => rating.uid === viewer.uid)?.score ?? 0) >= score ? "on" : ""} onClick={() => void rateComic(post.comic!, score, target).then(() => trackAnalytics("community_rating", { score })).catch((cause: Error) => toast(cause.message, true))}>★</button>)}</div></div>}
      <div className="community-post-actions">
        <button className={`community-action like${likes.liked ? " liked" : ""}`} disabled={!interact} aria-pressed={likes.liked} onClick={() => void setPostLike(post.id, likes.liked, target).then(() => trackAnalytics("community_like")).catch((cause: Error) => toast(cause.message, true))}><Heart size={19} weight={likes.liked ? "fill" : "regular"} /><span>{likes.count ? likes.count : "Like"}</span></button>
        <button className={`community-action${showComments ? " selected" : ""}`} onClick={() => setShowComments((value) => !value)}><ChatCircleDots size={19} /><span>{showComments ? "Hide replies" : "Reply"}</span></button>
        <button className="community-action" onClick={() => void share()}><ShareNetwork size={18} /><span>Share</span></button>
        {canPin && <button className="community-action" onClick={() => void pinPost(post.id, !post.pinned, target).catch((cause: Error) => toast(cause.message, true))}><PushPin size={18} weight={post.pinned ? "fill" : "regular"} /><span>{post.pinned ? "Unpin" : "Pin"}</span></button>}
        {canRemove && <button className="community-action danger" onClick={() => setConfirmDelete(true)} aria-label="Delete post"><Trash size={18} /><span>Delete</span></button>}
      </div>
      {showComments && <div className="community-comments">
        {comments.map((item) => (
          <div key={item.id} className="community-comment">
            <strong>{item.authorName}</strong><span>{item.body}</span>
            {(item.authorId === viewer.uid || (!!target.communityId && staff)) && <button className="cm-x" aria-label="Delete reply" onClick={() => void deleteComment(post.id, item.id, target).catch((cause: Error) => toast(cause.message, true))}><X size={13} /></button>}
          </div>
        ))}
        <form onSubmit={(event) => void submitComment(event)}><input className="input" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={2000} placeholder={interact ? "Add a comment" : "Join and sign in to reply"} aria-label="Add a comment" /><button className="btn" disabled={busy || !interact}>Reply</button></form>
      </div>}
      {confirmDelete && <ConfirmDialog title="Delete this post?" body="The post and its replies, likes and votes are removed for everyone. This cannot be undone." action="Delete post" danger onConfirm={() => void remove()} onClose={() => setConfirmDelete(false)} />}
    </article>
  );
}

const mediaLabel = (kind?: "comic" | "novel" | "anime") => kind === "anime" ? "Anime" : kind === "novel" ? "Web novel" : "Comic";
