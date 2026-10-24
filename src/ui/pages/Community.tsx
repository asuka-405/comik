import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChatCircleDots, EyeSlash, Fire, Heart, MagnifyingGlass, PencilSimpleLine, ShareNetwork, X } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { db } from "@/core/db";
import { hash53 } from "@/core/hash";
import { trackAnalytics } from "@/core/analytics";
import { getSource } from "@/core/sources/registry";
import { connectPublicCommunity, connectRoomFirebase, linkGooglePublicCommunity, linkGoogleRoom, readCustomFirebaseConfig, readPublicCommunityConfig, useCommunitySession, useRoomSessions } from "@/core/sync/firebase";
import { addComment, comicReference, createPrivateCommunityRoom, joinPrivateCommunityRoom, publishPost, rateComic, roomCommunityTarget, setPostLike, subscribeComments, subscribePollVotes, subscribePostLikes, subscribePosts, subscribeRatings, uploadCommunityImage, votePoll, type CommunityComment, type CommunityKind, type CommunityPost, type CommunityTarget, type PostLikeState, type RatingRecord } from "@/core/community";
import { createCommunityInvite, newCommunityRoom, parseCommunityInvite, readCommunityRooms, saveCommunityRoom, type CommunityRoom } from "@/core/communityRooms";
import { appLink } from "@/core/platform";
import { coverSrc, hueOf, timeAgo, toast } from "../common";

const KINDS: [CommunityKind, string][] = [["discussion", "Discussion"], ["recommendation", "Recommendation"], ["poll", "Poll"]];

export function CommunityPage() {
  const publicSession = useCommunitySession();
  const safeMode = useSettings((state) => state.safeMode);
  const publicEnabled = useSettings((state) => state.publicCommunityEnabled);
  const [searchParams, setSearchParams] = useSearchParams();
  const [rooms, setRooms] = useState(readCommunityRooms);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem("comik.community.active") ?? "public");
  const [showRoomManager, setShowRoomManager] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomBackend, setRoomBackend] = useState<"public" | "personal">(() => (readCustomFirebaseConfig() ? "personal" : "public"));
  const [joinInput, setJoinInput] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | CommunityKind>("all");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null);
  const activeRoom = rooms.find((room) => room.id === selectedId);
  const target = useMemo<CommunityTarget>(() => activeRoom ? roomCommunityTarget(activeRoom) : {
    id: "public",
    config: readPublicCommunityConfig()!,
  }, [activeRoom]);
  const roomSession = useRoomSessions((state) => activeRoom ? state.sessions[activeRoom.id] : undefined);
  const sync = activeRoom ? (roomSession ?? { status: "off" as const, user: null }) : publicSession;

  useEffect(() => {
    const roomId = searchParams.get("room");
    if (!roomId || (roomId !== "public" && !rooms.some((room) => room.id === roomId))) return;
    setSelectedId(roomId);
    localStorage.setItem("comik.community.active", roomId);
  }, [rooms, searchParams]);

  useEffect(() => {
    const encoded = searchParams.get("join");
    if (!encoded) return;
    try {
      const room = parseCommunityInvite(encoded);
      const stored = saveCommunityRoom({ ...room, joined: false });
      setRooms(stored);
      setSelectedId(room.id);
      localStorage.setItem("comik.community.active", room.id);
      const next = new URLSearchParams(searchParams);
      next.delete("join");
      setSearchParams(next, { replace: true });
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [searchParams, setSearchParams]);

  const selectCommunity = (id: string) => {
    setSelectedId(id);
    localStorage.setItem("comik.community.active", id);
    setPosts([]);
    setError("");
    setInviteLink("");
  };

  const createRoom = async () => {
    const config = roomBackend === "public" ? readPublicCommunityConfig() : readCustomFirebaseConfig();
    if (!config) {
      setError("Set up your Firebase project in Settings before creating a room on it.");
      return;
    }
    const name = roomName.trim();
    if (!name) return setError("Enter a name for the community.");
    const room = newCommunityRoom(name, config);
    const roomTarget = roomCommunityTarget(room);
    try {
      await linkGoogleRoom(room.id, config);
      await createPrivateCommunityRoom(room, roomTarget);
      const joinedRoom = { ...room, joined: true };
      setRooms(saveCommunityRoom(joinedRoom));
      setRoomName("");
      selectCommunity(room.id);
      setInviteLink(createCommunityInvite(joinedRoom));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const joinRoom = async (room: CommunityRoom) => {
    const roomTarget = roomCommunityTarget(room);
    try {
      await connectRoomFirebase(room.id, room.config);
      await linkGoogleRoom(room.id, room.config);
      await joinPrivateCommunityRoom(room, roomTarget);
      const joinedRoom = { ...room, joined: true };
      setRooms(saveCommunityRoom(joinedRoom));
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const importInvite = () => {
    try {
      const encoded = joinInput.trim().includes("join=")
        ? new URL(joinInput.trim()).searchParams.get("join")
        : joinInput.trim();
      if (!encoded) throw new Error("Paste a community invite link or code.");
      const room = parseCommunityInvite(encoded);
      setRooms(saveCommunityRoom({ ...room, joined: false }));
      setJoinInput("");
      selectCommunity(room.id);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  useEffect(() => {
    if (activeRoom && !activeRoom.joined) return;
    if (!activeRoom && !publicEnabled) return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void subscribePosts((items) => { setPosts(items); setLoading(false); }, (cause) => { setError(cause.message); setLoading(false); }, target)
      .then((off) => { if (dead) off(); else unsubscribe = off; })
      .catch((cause: Error) => { if (!dead) { setError(cause.message); setLoading(false); } });
    return () => { dead = true; unsubscribe?.(); };
  }, [activeRoom?.id, activeRoom?.joined, publicEnabled, target]);

  useEffect(() => {
    const postId = searchParams.get("post");
    if (!postId || !posts.some((post) => post.id === postId)) return;
    setKindFilter("all");
    setSearch("");
    document.getElementById(`community-post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [posts, searchParams]);

  const visiblePosts = posts.filter((post) => {
    if (safeMode && post.comic && getSource(post.comic.sourceId)?.isNsfw) return false;
    if (kindFilter !== "all" && post.kind !== kindFilter) return false;
    if (author && post.authorId !== author.id) return false;
    if (tag && !hashtagsOf(`${post.title} ${post.body}`).includes(tag)) return false;
    if (!search.trim()) return true;
    const text = `${post.title} ${post.body} ${post.comic?.title ?? ""} ${post.authorName}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  /* What the room is talking about, worked out from the posts already loaded. */
  const buzz = useMemo(() => {
    const shown = posts.filter((post) => !(safeMode && post.comic && getSource(post.comic.sourceId)?.isNsfw));
    const tally = <T,>(keys: (post: CommunityPost) => T[]) => {
      const counts = new Map<T, number>();
      for (const post of shown) for (const key of new Set(keys(post))) counts.set(key, (counts.get(key) ?? 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1]);
    };
    const comics = new Map<string, string>();
    for (const post of shown) if (post.comic) comics.set(post.comic.mangaId, post.comic.title);
    return {
      tags: tally((post) => hashtagsOf(`${post.title} ${post.body}`)).slice(0, 8),
      comics: tally((post) => (post.comic ? [post.comic.mangaId] : [])).slice(0, 5).map(([id, n]) => ({ id, title: comics.get(id)!, n })),
      readers: tally((post) => [`${post.authorId}\u0000${post.authorName}`]).slice(0, 4).map(([key, n]) => ({ id: key.split("\u0000")[0]!, name: key.split("\u0000")[1]!, n })),
    };
  }, [posts, safeMode]);

  const startCommunity = () => {
    const connect = activeRoom ? connectRoomFirebase(activeRoom.id, activeRoom.config) : connectPublicCommunity();
    void connect.catch((cause: Error) => setError(cause.message));
  };

  const signInToCommunity = () => {
    const signIn = activeRoom ? linkGoogleRoom(activeRoom.id, activeRoom.config) : linkGooglePublicCommunity();
    void signIn.then(() => toast("Google account connected")).catch((cause: Error) => toast(cause.message, true));
  };

  return (
    <div className="page community-page">
      <div className="community-layout">
        <main className="community-main">
      <div className="community-titlebar">
        <div><div className="kicker">Comik · readers' corner</div><h1>Community</h1><p>Talk chapters, trade recommendations, and find your next read.</p></div>
        <div className="community-title-actions">
          <select className="input" aria-label="Choose community" value={selectedId} onChange={(event) => selectCommunity(event.target.value)}>
            {publicEnabled && <option value="public">Comik public</option>}
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select>
          <button className="btn" onClick={() => setShowRoomManager((value) => !value)}>{showRoomManager ? "Close communities" : "Manage communities"}</button>
          {sync.status === "off" && <button className="btn" onClick={startCommunity}>Connect</button>}
          {sync.user?.isAnonymous && <button className="btn" onClick={signInToCommunity}>Sign in</button>}
          {sync.user && !sync.user.isAnonymous && <Link className="btn primary" to={`/community/new?room=${encodeURIComponent(selectedId)}`}><PencilSimpleLine size={18} />Write a post</Link>}
        </div>
      </div>
      {showRoomManager && <section className="panel community-room-manager">
        <h2>Private communities</h2>
        <p className="muted">Create invite-only rooms on Comik Firebase, or on your own Firebase project if you want the data to live with you. Each room has its own posts and membership.</p>
        <div className="community-room-create">
          <input className="input" value={roomName} onChange={(event) => setRoomName(event.target.value)} placeholder="Community name" aria-label="Community name" />
          <select className="input" value={roomBackend} onChange={(event) => setRoomBackend(event.target.value as "public" | "personal")} aria-label="Firebase for community">
            <option value="public">Comik Firebase</option><option value="personal" disabled={!readCustomFirebaseConfig()}>My Firebase{readCustomFirebaseConfig() ? "" : " (set up in Settings)"}</option>
          </select>
          <button className="btn primary" disabled={!roomName.trim()} onClick={() => void createRoom()}>Create invite-only room</button>
        </div>
        <div className="community-room-join">
          <input className="input" value={joinInput} onChange={(event) => setJoinInput(event.target.value)} placeholder="Paste invite link" aria-label="Community invite link" />
          <button className="btn" disabled={!joinInput.trim()} onClick={importInvite}>Add invite</button>
        </div>
        {inviteLink && <div className="community-room-invite"><span className="muted">Invite link</span><input className="input mono" value={inviteLink} readOnly aria-label="Invite link" /><button className="btn sm" onClick={() => void navigator.clipboard.writeText(inviteLink).then(() => toast("Invite link copied"))}>Copy</button></div>}
        {rooms.length > 0 && <div className="community-room-list">{rooms.map((room) => <button key={room.id} className="community-room-item" onClick={() => selectCommunity(room.id)}><strong>{room.name}</strong><span>{room.config.projectId} · {room.joined ? "joined" : "invite added"}</span></button>)}</div>}
      </section>}
      {!activeRoom && !publicEnabled ? (
        <section className="panel"><h2>Public community is off</h2><p className="muted">Turn it back on in Settings, or select a private community.</p><Link className="btn" to="/settings/privacy">Community settings</Link></section>
      ) : activeRoom && !activeRoom.joined ? (
        <section className="panel"><h2>Invite-only community</h2><p className="muted" style={{ marginBottom: 12 }}>Join {activeRoom.name} with your Google account. Room posts stay in {activeRoom.config.projectId}.</p><button className="btn primary" onClick={() => void joinRoom(activeRoom)}>Join community</button></section>
      ) : (
        <>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="community-feed-tools">
            <div className="community-feed-filters" role="tablist" aria-label="Filter community posts">
              {([ ["all", "For you"], ["discussion", "Discussions"], ["recommendation", "Picks"], ["poll", "Polls"] ] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={kindFilter === value} className={kindFilter === value ? "active" : ""} onClick={() => setKindFilter(value)}>{label}</button>)}
            </div>
            <label className="community-search"><MagnifyingGlass size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a post" aria-label="Search community posts" /></label>
          </div>
          {(tag || author) && (
            <div className="community-active-filters">
              {tag && <button className="chip on" onClick={() => setTag("")}>#{tag} <X size={12} /></button>}
              {author && <button className="chip on" onClick={() => setAuthor(null)}>Posts by {author.name} <X size={12} /></button>}
            </div>
          )}
          {sync.user && !sync.user.isAnonymous && <QuickCompose name={sync.user.name || sync.user.email || "Reader"} room={selectedId} />}
          <div className="community-feed" aria-live="polite">
            {loading && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading discussions</span></div>}
            {!loading && !posts.length && !error && <section className="community-empty"><span className="community-empty-mark">✳</span><h2>Start the conversation</h2><p>Your reader community is just getting started. Share a favorite, ask a question, or make a poll.</p></section>}
            {!loading && posts.length > 0 && !visiblePosts.length && <section className="community-empty"><h2>No posts match</h2><p>Try another search or post type.</p></section>}
            {visiblePosts.map((post) => <PostView key={post.id} post={post} target={target} onTag={setTag} onAuthor={(id, name) => setAuthor({ id, name })} />)}
          </div>
        </>
      )}
      {sync.status === "error" && <div className="err" role="alert">Community connection failed: {sync.error}</div>}
      {sync.user?.isAnonymous && <p className="hint muted">You are browsing anonymously. Google sign-in is required to contribute.</p>}
        </main>
        <aside className="community-aside">
          <section className="community-aside-intro"><span className="kicker">The reading room</span><h2>Good stories get better shared.</h2><p>Keep it kind. Mark spoilers. Link the source when you recommend a series.</p></section>
          {buzz.tags.length > 0 && <section className="community-aside-section"><h3><Fire size={14} weight="fill" /> Trending tags</h3><div className="tag-cloud">{buzz.tags.map(([name, n]) => <button key={name} className={`chip${tag === name ? " on" : ""}`} onClick={() => setTag(tag === name ? "" : name)}>#{name} <span className="mono muted">{n}</span></button>)}</div></section>}
          {buzz.comics.length > 0 && <section className="community-aside-section"><h3>Being talked about</h3>{buzz.comics.map((comic) => <button key={comic.id} className="aside-link" data-hue={hueOf(comic.id)} onClick={() => setSearch(comic.title)}><span>{comic.title}</span><span>{comic.n}</span></button>)}</section>}
          {buzz.readers.length > 0 && <section className="community-aside-section"><h3>Active readers</h3>{buzz.readers.map((reader) => <button key={reader.id} className="aside-link" onClick={() => setAuthor({ id: reader.id, name: reader.name })}><SocialAvatar name={reader.name} /><span>{reader.name}</span><span>{reader.n}</span></button>)}</section>}
          <section className="community-aside-section"><h3>In this room</h3><div><i className="aside-dot coral" />Discussions<span>{visiblePosts.filter((post) => post.kind === "discussion").length}</span></div><div><i className="aside-dot teal" />Recommendations<span>{visiblePosts.filter((post) => post.kind === "recommendation").length}</span></div><div><i className="aside-dot gold" />Polls<span>{visiblePosts.filter((post) => post.kind === "poll").length}</span></div></section>
          <div className="community-aside-foot">Posts and ratings are shared within the selected Firebase project.</div>
        </aside>
      </div>
    </div>
  );
}

export function CommunityNewPostPage() {
  const [searchParams] = useSearchParams();
  const [rooms, setRooms] = useState(readCommunityRooms);
  // "public" is the shared community, not a saved room, so it must not demand an invite.
  const requested = searchParams.get("room");
  const roomId = requested && requested !== "public" ? requested : null;
  const activeRoom = rooms.find((room) => room.id === roomId);
  const publicSession = useCommunitySession();
  const roomSession = useRoomSessions((state) => activeRoom ? state.sessions[activeRoom.id] : undefined);
  const sync = activeRoom ? (roomSession ?? { status: "off" as const, user: null }) : publicSession;
  const config = readPublicCommunityConfig();
  const navigate = useNavigate();
  const target: CommunityTarget = activeRoom ? roomCommunityTarget(activeRoom) : { id: "public", config: config! };
  const connect = () => {
    const operation = activeRoom ? connectRoomFirebase(activeRoom.id, activeRoom.config) : connectPublicCommunity();
    void operation.catch((cause: Error) => toast(cause.message, true));
  };
  const signIn = () => {
    const operation = activeRoom ? linkGoogleRoom(activeRoom.id, activeRoom.config) : linkGooglePublicCommunity();
    void operation.then(() => toast("Google account connected")).catch((cause: Error) => toast(cause.message, true));
  };
  const joinRoom = async () => {
    if (!activeRoom) return;
    try {
      await connectRoomFirebase(activeRoom.id, activeRoom.config);
      await linkGoogleRoom(activeRoom.id, activeRoom.config);
      await joinPrivateCommunityRoom(activeRoom, roomCommunityTarget(activeRoom));
      setRooms(saveCommunityRoom({ ...activeRoom, joined: true }));
    } catch (cause) {
      toast((cause as Error).message, true);
    }
  };

  return (
    <div className="page community-new-page">
      <Link className="community-back" to="/community"><ArrowLeft size={17} />Back to community</Link>
      <header className="community-new-heading"><div className="kicker">The reading room</div><h1>Start a conversation</h1><p>Share a thought, put a question to readers, or give someone their next favorite series.</p></header>
      {roomId && !activeRoom ? (
        <section className="community-gate"><h2>Community not found</h2><p>This room is not saved on this device. Open its invite link first.</p></section>
      ) : activeRoom && !activeRoom.joined ? (
        <section className="community-gate"><h2>Join {activeRoom.name}</h2><p>Sign in with Google to join this invite-only room.</p><button className="btn primary" onClick={() => void joinRoom()}>Join community</button></section>
      ) : !config && !activeRoom ? (
        <section className="community-gate"><h2>Set up Firebase first</h2><p>Sign in with Comik Firebase, or connect your own, to publish community posts.</p><Link className="btn primary" to="/settings/firebase">Open Firebase settings</Link></section>
      ) : sync.status === "off" ? (
        <section className="community-gate"><h2>Connect to the reading room</h2><p>Posts and replies are shared with people using this Firebase project.</p><button className="btn primary" onClick={connect}>Connect</button></section>
      ) : (
        <>
          {sync.status === "error" && <div className="err" role="alert">{sync.error}</div>}
          <CommunityComposer target={target} user={sync.user} onPublished={() => navigate(activeRoom ? `/community?room=${encodeURIComponent(activeRoom.id)}` : "/community", { replace: true })} />
          {(!sync.user || sync.user.isAnonymous) && <button className="btn primary community-login-prompt" onClick={signIn}>Sign in with Google to publish</button>}
        </>
      )}
    </div>
  );
}

function CommunityComposer({ target, user, onPublished }: { target: CommunityTarget; user: { uid: string; isAnonymous: boolean; name?: string | null; email?: string | null } | null; onPublished: (post: CommunityPost) => void }) {
  const settings = useSettings();
  const library = useLiveQuery(() => db.manga.filter((item) => item.inLibrary).toArray(), [], []);
  const [params] = useSearchParams();
  const [kind, setKind] = useState<CommunityKind>(() => (params.get("comic") ? "recommendation" : "discussion"));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mangaId, setMangaId] = useState(() => params.get("comic") ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
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
      const id = await publishPost(data, target);
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
      <textarea ref={bodyRef} className="input" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={4} placeholder="Write a discussion or recommendation. Use #tags to be found, and hide spoilers with the button below." aria-label="Post text" required />
      <div className="community-compose-hint">
        <button type="button" className="btn sm" onClick={() => wrapSpoiler(bodyRef.current, body, setBody)}><EyeSlash size={15} /> Spoiler</button>
        <span className="muted">Select text, then press Spoiler to blur it until a reader taps it.</span>
      </div>
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

function PostView({ post, target, onTag, onAuthor }: { post: CommunityPost; target: CommunityTarget; onTag: (tag: string) => void; onAuthor: (id: string, name: string) => void }) {
  const user = useCommunitySession((state) => state.user);
  // The comic id is only meaningful on the poster's device, so a cover shows when it is also on this shelf.
  const local = useLiveQuery(() => (post.comic ? db.manga.get(post.comic.mangaId) : undefined), [post.comic?.mangaId]);
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
    void subscribeRatings(comicKey, setRatings, () => {}, target).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [comicKey, post.comic, target]);

  useEffect(() => {
    if (post.kind !== "poll") return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribePollVotes(post.id, setVotes, () => {}, target).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, post.kind, target]);

  useEffect(() => {
    if (!showComments) return;
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeComments(post.id, setComments, () => {}, target).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, showComments, target]);

  const ratingAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length : 0;
  const userVote = user ? votes[user.uid] : undefined;
  useEffect(() => {
    let dead = false;
    let unsubscribe: (() => void) | undefined;
    void subscribePostLikes(post.id, user?.uid ?? "", setLikes, () => {}, target).then((off) => { if (dead) off(); else unsubscribe = off; });
    return () => { dead = true; unsubscribe?.(); };
  }, [post.id, user?.uid, target]);

  const share = async () => {
    const params = new URLSearchParams();
    if (target.roomId) params.set("room", target.roomId);
    params.set("post", post.id);
    const url = appLink(`/community?${params}`);
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

  return (
    <article id={`community-post-${post.id}`} className="community-post">
      <header className="community-post-head"><SocialAvatar name={post.authorName} /><div className="community-post-author"><button className="author-link" onClick={() => onAuthor(post.authorId, post.authorName)} title={`Posts by ${post.authorName}`}>{post.authorName}</button><span>{timeAgo(post.createdAt) || new Date(post.createdAt).toLocaleDateString()}</span></div><span className={`community-kind ${post.kind}`}>{post.kind === "recommendation" ? "reader pick" : post.kind}</span></header>
      <h2>{post.title}</h2>
      <p><RichText text={post.body} onTag={onTag} /></p>
      {post.comic && (
        <div className={`community-reference${local ? " with-cover" : ""}`} data-hue={hueOf(post.comic.mangaId)}>
          {local && <img src={coverSrc(local.sourceId, local.cover)} alt="" loading="lazy" />}
          <div>
            <strong>{post.comic.title}</strong>
            <span>{post.comic.sourceUrl ? post.comic.sourceName : `Local comic · ${post.comic.sourceName}`}</span>
            <div className="community-reference-links">
              {local?.inLibrary && <Link to={`/series/${encodeURIComponent(local.id)}`}>On your shelf</Link>}
              {post.comic.sourceUrl && <a href={post.comic.sourceUrl} target="_blank" rel="noreferrer">Open at {post.comic.sourceName}</a>}
            </div>
          </div>
        </div>
      )}
      {post.imageUrl && <img className="community-image" src={post.imageUrl} alt="Image attached to this post" loading="lazy" />}
      {post.kind === "poll" && <div className="community-poll">{pollOptions.map((option, index) => {
        const count = Object.values(votes).filter((value) => value === index).length;
        return <button key={`${index}-${option}`} className={`poll-option${userVote === index ? " on" : ""}`} disabled={!user || user.isAnonymous || userVote !== undefined} onClick={() => void votePoll(post.id, index, target).then(() => trackAnalytics("community_vote")).catch((cause: Error) => toast(cause.message, true))}>
          <span>{option}</span><span className="mono">{count}</span>
        </button>;
      })}<span className="muted">{Object.keys(votes).length} votes</span></div>}
      {post.comic && <div className="community-rating"><span>Rating {ratingAverage ? `${ratingAverage.toFixed(1)} / 5 · ${ratings.length}` : "No ratings yet"}</span><div className="rating-buttons" aria-label="Rate this comic">{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" aria-label={`Rate ${score} out of 5`} disabled={!user || user.isAnonymous} className={(ratings.find((rating) => rating.uid === user?.uid)?.score ?? 0) >= score ? "on" : ""} onClick={() => void rateComic(post.comic!, score, target).then(() => trackAnalytics("community_rating", { score })).catch((cause: Error) => toast(cause.message, true))}>★</button>)}</div></div>}
      <div className="community-post-actions">
        <button className={`community-action like${likes.liked ? " liked" : ""}`} disabled={!user || user.isAnonymous} aria-pressed={likes.liked} onClick={() => void setPostLike(post.id, likes.liked, target).then(() => trackAnalytics("community_like")).catch((cause: Error) => toast(cause.message, true))}><Heart size={19} weight={likes.liked ? "fill" : "regular"} /><span>{likes.count ? likes.count : "Like"}</span></button>
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
const HASHTAG = /#([\p{L}\p{N}_]{2,30})/gu;

function hashtagsOf(text: string): string[] {
  return [...text.matchAll(HASHTAG)].map((m) => m[1]!.toLowerCase());
}

/** Wrap the selected text of a textarea in ||spoiler|| markers. */
function wrapSpoiler(field: HTMLTextAreaElement | null, body: string, set: (value: string) => void) {
  const start = field?.selectionStart ?? body.length;
  const end = field?.selectionEnd ?? body.length;
  if (start === end) return toast("Select the text to hide first.", true);
  set(`${body.slice(0, start)}||${body.slice(start, end)}||${body.slice(end)}`);
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

/** The "what are you reading" box at the top of the feed, with one-tap shares of recent reads. */
function QuickCompose({ name, room }: { name: string; room: string }) {
  const recent = useLiveQuery(async () => {
    const read = await db.chapters.where("readAt").above(0).reverse().sortBy("readAt");
    const seen: string[] = [];
    for (const c of read) if (!seen.includes(c.mangaId)) seen.push(c.mangaId);
    const rows = await Promise.all(seen.slice(0, 6).map((id) => db.manga.get(id)));
    return rows.filter((m): m is NonNullable<typeof m> => !!m && !(useSettings.getState().safeMode && getSource(m.sourceId)?.isNsfw)).slice(0, 3);
  }, [], []);
  const to = (extra = "") => `/community/new?room=${encodeURIComponent(room)}${extra}`;
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
