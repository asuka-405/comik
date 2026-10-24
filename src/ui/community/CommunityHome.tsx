import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Gear, Hash, Megaphone, PencilSimpleLine, UsersThree } from "@phosphor-icons/react";
import { forgetMembership, isAdmin, joinCommunity, PUBLIC_ID, subscribeChannels, subscribeMembers, subscribeMessages, communityTarget, isStaff, type Channel, type CommunityComment, type Member } from "@/core/community";
import { timeAgo, toast } from "../common";
import { CommunityFeed } from "./Feed";
import { CommunityAvatar, PUBLIC_COMMUNITY, RoleBadge, SocialAvatar, VisibilityBadge, useCommunity, useCommunityUser } from "./shared";

type Tab = "feed" | "channels" | "members";

export function CommunityHome() {
  const { cid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const who = useCommunityUser();
  const live = useCommunity(cid, who.user?.uid);
  const builtIn = cid === PUBLIC_ID;
  const community = builtIn ? PUBLIC_COMMUNITY : live.community;
  const member = builtIn ? (who.signedIn ? { uid: who.user!.uid, name: who.name, role: "member" as const, joinedAt: 0 } : null) : live.member;
  const role = member?.role;
  const tab = (params.get("tab") as Tab | null) ?? "feed";
  const [channels, setChannels] = useState<Channel[]>([]);
  const target = communityTarget(cid);

  // A person who was removed keeps a stale entry in their own list; tidy it up.
  useEffect(() => {
    if (!builtIn && who.user && live.member === null && live.community) void forgetMembership(who.user.uid, cid);
  }, [builtIn, who.user?.uid, live.member, live.community, cid]);

  const canRead = builtIn || !!member || community?.visibility === "public";
  useEffect(() => {
    if (builtIn || !community || !canRead) return;
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeChannels(cid, (list) => { if (!dead) setChannels(list); }, () => {}).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [builtIn, cid, community?.id, canRead]);

  if (!who.configured || !who.enabled) {
    return <div className="page cm-page"><BackLink /><section className="community-gate"><h2>Communities are off</h2><p>Turn the public community on in Settings to use communities.</p><Link className="btn" to="/settings/privacy">Community settings</Link></section></div>;
  }
  if (community === undefined || (!builtIn && live.member === undefined && !live.error && !who.error)) {
    return <div className="page cm-page"><BackLink />{live.error || who.error ? <div className="err" role="alert">{live.error || who.error}</div> : <div className="chapter-loading"><span className="reader-spinner" /><span>Opening community</span></div>}</div>;
  }
  if (community === null) {
    return <div className="page cm-page"><BackLink /><section className="community-gate"><h2>Community not found</h2><p>It may have been deleted by its owner, or the link is wrong.</p><Link className="btn" to="/community">Browse communities</Link></section></div>;
  }

  const setTab = (next: Tab) => { const p = new URLSearchParams(params); if (next === "feed") p.delete("tab"); else p.set("tab", next); setParams(p, { replace: true }); };
  const announcements = channels.find((c) => c.kind === "announcements");
  const viewer = { uid: who.user?.uid ?? "", signedIn: who.signedIn, role, name: who.name };

  return (
    <div className="page cm-page" style={{ ["--cm" as string]: community.accent }}>
      <BackLink />
      <header className="cm-hero">
        <CommunityAvatar community={community} size={64} />
        <div className="cm-hero-text">
          <div className="cm-hero-badges"><VisibilityBadge visibility={community.visibility} />{role && !builtIn && <RoleBadge role={role} />}</div>
          <h1>{community.name}</h1>
          {community.description && <p>{community.description}</p>}
          {!builtIn && <span className="cm-meta"><UsersThree size={14} /> {community.memberCount.toLocaleString()} member{community.memberCount === 1 ? "" : "s"} · started by {community.ownerName}</span>}
        </div>
        <div className="cm-hero-actions">
          {member && <Link className="btn primary" to={`/community/new?c=${encodeURIComponent(cid)}`}><PencilSimpleLine size={18} />Write a post</Link>}
          {member && !builtIn && <Link className="btn" to={`/community/${cid}/settings`}><Gear size={18} />{isAdmin(role) ? "Settings" : "About"}</Link>}
        </div>
      </header>

      {who.user?.isAnonymous && <div className="cm-banner"><span>Sign in with Google to join, post and chat.</span><button className="btn sm primary" onClick={who.signIn}>Sign in with Google</button></div>}

      {!member && !builtIn && <JoinPanel communityId={cid} priv={community.visibility === "private"} memberCount={community.memberCount} signedIn={who.signedIn} signIn={who.signIn} presetCode={params.get("code") ?? ""} community={community} />}

      {canRead && (
        <>
          {announcements && <AnnouncementStrip cid={cid} channel={announcements} />}
          {!builtIn && (
            <div className="cm-tabs" role="tablist">
              {([["feed", "Feed"], ["channels", `Channels${channels.length ? ` · ${channels.length}` : ""}`], ["members", `Members · ${community.memberCount}`]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "on" : ""} onClick={() => setTab(value)}>{label}</button>)}
            </div>
          )}
          {(builtIn || tab === "feed") && <CommunityFeed target={target} viewer={viewer} canPost={!!member} canPin={!builtIn && isStaff(role)} />}
          {!builtIn && tab === "channels" && <ChannelList cid={cid} channels={channels} admin={isAdmin(role)} />}
          {!builtIn && tab === "members" && <MemberList cid={cid} />}
        </>
      )}
      {!canRead && <section className="community-empty"><h2>Posts are private</h2><p>Join this community to read its feed and channels.</p></section>}
    </div>
  );
}

const BackLink = () => <Link className="community-back" to="/community"><ArrowLeft size={17} />All communities</Link>;

function JoinPanel({ communityId, priv, memberCount, signedIn, signIn, presetCode, community }: { communityId: string; priv: boolean; memberCount: number; signedIn: boolean; signIn: () => void; presetCode: string; community: Parameters<typeof joinCommunity>[0] }) {
  const [code, setCode] = useState(presetCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const join = async () => {
    setBusy(true);
    setError("");
    try { await joinCommunity(community, code); toast("Joined"); } catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  };
  return (
    <section className="cm-join-panel">
      <div>
        <h2>{priv ? "This community is invite-only" : "Join this community"}</h2>
        <p className="muted">{priv ? "Enter the invite code from the people who run it. Members can read the feed, chat in channels and post." : `Join ${memberCount.toLocaleString()} reader${memberCount === 1 ? "" : "s"} to post, reply, vote and chat in its channels.`}</p>
      </div>
      {signedIn ? (
        <form className="cm-join-form" key={communityId} onSubmit={(e) => { e.preventDefault(); void join(); }}>
          {priv && <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" aria-label="Invite code" autoComplete="off" />}
          <button className="btn primary" disabled={busy || (priv && !code.trim())}>{busy ? "Joining" : "Join community"}</button>
        </form>
      ) : <button className="btn primary" onClick={signIn}>Sign in with Google to join</button>}
      {error && <div className="err" role="alert">{error}</div>}
    </section>
  );
}

/** The newest few announcements, pinned above the feed. */
function AnnouncementStrip({ cid, channel }: { cid: string; channel: Channel }) {
  const [items, setItems] = useState<CommunityComment[]>([]);
  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeMessages(cid, channel.id, (list) => { if (!dead) setItems(list.slice(-2).reverse()); }, () => {}).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cid, channel.id]);
  if (!items.length) return null;
  return (
    <section className="cm-announce" aria-label="Announcements">
      <div className="cm-announce-head"><Megaphone size={16} weight="fill" /><strong>Announcements</strong><Link to={`/community/${cid}/chat/${channel.id}`}>See all</Link></div>
      {items.map((item) => <div key={item.id} className="cm-announce-item"><p>{item.body}</p><span>{item.authorName} · {timeAgo(item.createdAt)}</span></div>)}
    </section>
  );
}

function ChannelList({ cid, channels, admin }: { cid: string; channels: Channel[]; admin: boolean }) {
  const nav = useNavigate();
  return (
    <section className="cm-list" aria-label="Channels">
      {!channels.length && <p className="muted cm-note">No channels yet.{admin ? " Create one in the community settings." : ""}</p>}
      {channels.map((c) => (
        <button key={c.id} className="cm-row" onClick={() => nav(`/community/${cid}/chat/${c.id}`)}>
          <span className="cm-row-icon">{c.kind === "announcements" ? <Megaphone size={18} /> : <Hash size={18} />}</span>
          <span className="cm-row-text"><strong>{c.name}</strong><span>{c.description || (c.kind === "announcements" ? "Announcements from the team" : "Chat room")}</span></span>
          {c.kind === "announcements" && <span className="cm-tag">Announcements</span>}
        </button>
      ))}
      {admin && <Link className="btn cm-manage" to={`/community/${cid}/settings?s=channels`}>Manage channels</Link>}
    </section>
  );
}

function MemberList({ cid }: { cid: string }) {
  const [members, setMembers] = useState<Member[]>();
  const [search, setSearch] = useState("");
  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeMembers(cid, (list) => { if (!dead) setMembers(list); }, () => { if (!dead) setMembers([]); }).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cid]);
  const shown = (members ?? []).filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <section className="cm-list" aria-label="Members">
      <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a member" aria-label="Find a member" />
      {members === undefined && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading members</span></div>}
      {shown.map((m) => <div key={m.uid} className="cm-row static"><SocialAvatar name={m.name} /><span className="cm-row-text"><strong>{m.name}</strong><span>Joined {new Date(m.joinedAt).toLocaleDateString()}</span></span><RoleBadge role={m.role} /></div>)}
    </section>
  );
}
