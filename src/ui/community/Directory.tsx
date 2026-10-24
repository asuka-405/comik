import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { MagnifyingGlass, Plus, UsersThree } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { ACCENTS, createCommunity, PUBLIC_ID, type Community, type Role, type Visibility } from "@/core/community";
import { Sheet, toast } from "../common";
import { CommunityAvatar, PUBLIC_COMMUNITY, RoleBadge, VisibilityBadge, useCommunityUser, useDirectory } from "./shared";

type Filter = "all" | "mine" | "public" | "private";

export function CommunityDirectory() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const who = useCommunityUser();
  const { communities, joined, memberships, error } = useDirectory(who.user?.uid);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  // Links shared before communities had their own pages: /community?room=<id>&post=<id>
  const legacyRoom = params.get("room");
  const shown = useMemo(() => {
    const text = search.trim().toLowerCase();
    return (communities ?? []).filter((c) => {
      const mine = joined.has(c.id) || c.ownerId === who.user?.uid;
      if (filter === "mine" && !mine) return false;
      if ((filter === "public" || filter === "private") && c.visibility !== filter) return false;
      return !text || `${c.name} ${c.description}`.toLowerCase().includes(text);
    });
  }, [communities, joined, filter, search, who.user?.uid]);

  if (legacyRoom) return <Navigate to={`/community/${encodeURIComponent(legacyRoom)}${params.get("post") ? `?post=${encodeURIComponent(params.get("post")!)}` : ""}`} replace />;

  const roleOf = (id: string) => memberships.find((m) => m.id === id)?.role;
  const showPublic = who.enabled && (filter === "all" || filter === "public" || filter === "mine") && (!search.trim() || PUBLIC_COMMUNITY.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="page cm-page">
      <div className="community-titlebar">
        <div><div className="kicker">Comik · readers' corner</div><h1>Communities</h1><p>Find a place to talk chapters, or start your own with channels, roles and announcements.</p></div>
        <div className="community-title-actions">
          <button className="btn" onClick={() => setJoining(true)}>Join with a link</button>
          <button className="btn primary" onClick={() => (who.signedIn ? setCreating(true) : toast("Sign in with Google to create a community.", true))}><Plus size={18} />Create community</button>
        </div>
      </div>

      {!who.configured && <section className="community-gate"><h2>Community is not set up</h2><p>This build has no Firebase project to host communities.</p><Link className="btn" to="/settings/firebase">Open Firebase settings</Link></section>}
      {who.configured && !who.enabled && <section className="community-gate"><h2>Communities are off</h2><p>Turn the public community back on in Settings to browse and join.</p><Link className="btn" to="/settings/privacy">Community settings</Link></section>}
      {who.error && <div className="err" role="alert">Community connection failed: {who.error}</div>}
      {who.user?.isAnonymous && <div className="cm-banner"><span>You are browsing. Sign in with Google to join, post and chat.</span><button className="btn sm primary" onClick={who.signIn}>Sign in with Google</button></div>}

      {who.configured && who.enabled && (
        <>
          <div className="cm-toolbar">
            <label className="community-search"><MagnifyingGlass size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search communities" aria-label="Search communities" /></label>
            <div className="chips" role="tablist" aria-label="Filter communities">
              {([["all", "All"], ["mine", "Joined"], ["public", "Public"], ["private", "Private"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={filter === value} className={`chip${filter === value ? " on" : ""}`} onClick={() => setFilter(value)}>{label}</button>)}
            </div>
          </div>
          {error && <div className="err" role="alert">{error}</div>}
          <div className="cm-grid">
            {showPublic && <CommunityCard community={PUBLIC_COMMUNITY} note="Open to everyone" />}
            {shown.map((c) => <CommunityCard key={c.id} community={c} role={joined.has(c.id) || c.ownerId === who.user?.uid ? roleOf(c.id) ?? (c.ownerId === who.user?.uid ? "owner" : "member") : undefined} />)}
          </div>
          {communities === undefined && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading communities</span></div>}
          {communities !== undefined && !shown.length && !showPublic && (
            <section className="community-empty"><UsersThree size={32} /><h2>{filter === "mine" ? "You have not joined any community" : "No communities match"}</h2><p>{filter === "mine" ? "Browse the list and join one, or create your own." : "Try another search, or start a new community yourself."}</p></section>
          )}
        </>
      )}

      {creating && <CreateSheet onClose={() => setCreating(false)} onCreated={(id) => nav(`/community/${id}`)} />}
      {joining && <JoinSheet onClose={() => setJoining(false)} />}
    </div>
  );
}

function CommunityCard({ community, role, note }: { community: Community; role?: Role; note?: string }) {
  return (
    <Link to={`/community/${community.id}`} className="cm-card" style={{ ["--cm" as string]: community.accent }}>
      <div className="cm-card-head">
        <CommunityAvatar community={community} />
        <div className="cm-card-title"><strong>{community.name}</strong><VisibilityBadge visibility={community.visibility} /></div>
      </div>
      <p>{community.description || "No description yet."}</p>
      <div className="cm-card-foot">
        <span><UsersThree size={14} /> {community.id === PUBLIC_ID ? (note ?? "") : `${community.memberCount.toLocaleString()} member${community.memberCount === 1 ? "" : "s"}`}</span>
        {role ? <RoleBadge role={role} /> : community.visibility === "private" ? <span className="muted">Invite code needed</span> : <span className="cm-join">Open</span>}
      </div>
    </Link>
  );
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const publicAllowed = useSettings((s) => s.publicCommunityEnabled);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>(publicAllowed ? "public" : "private");
  const [accent, setAccent] = useState(ACCENTS[0]!);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return toast("Give the community a name.", true);
    setBusy(true);
    try {
      const id = await createCommunity({ name, description, visibility, accent });
      toast("Community created");
      onCreated(id);
    } catch (cause) {
      toast((cause as Error).message, true);
      setBusy(false);
    }
  };
  return (
    <Sheet title="Create a community" onClose={onClose}>
      <form className="cm-form" onSubmit={(e) => void submit(e)}>
        <div className="field"><label className="label" htmlFor="cm-name">Name</label><input id="cm-name" className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Slice of life readers" /></div>
        <div className="field"><label className="label" htmlFor="cm-desc">What is it about?</label><textarea id="cm-desc" className="input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A few lines so people know what to expect" /></div>
        <div className="field">
          <span className="label">Who can join</span>
          <div className="cm-choice">
            <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}><strong>Public</strong><span>Listed for everyone. Anyone can read and join.</span></button>
            <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}><strong>Private</strong><span>Listed, but posts are hidden. Joining needs your invite code.</span></button>
          </div>
        </div>
        <div className="field"><span className="label">Colour</span><div className="cm-swatches">{ACCENTS.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={accent === c} className={accent === c ? "on" : ""} style={{ background: c }} onClick={() => setAccent(c)} />)}</div></div>
        <p className="muted cm-note">You become the owner. You can add admins and moderators, create channels and change all of this later in the community's settings.</p>
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || name.trim().length < 2}>{busy ? "Creating" : "Create community"}</button></div>
      </form>
    </Sheet>
  );
}

/** Invite links look like /community/<id>?code=<code>. Accept the whole link, or just its tail. */
function JoinSheet({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [value, setValue] = useState("");
  const go = (event: React.FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    const match = text.match(/community\/([^/?#\s]+)(?:[^#\s]*?[?&]code=([^&#\s]+))?/);
    if (!match) return toast("Paste the invite link you were sent.", true);
    nav(`/community/${match[1]}${match[2] ? `?code=${match[2]}` : ""}`);
    onClose();
  };
  return (
    <Sheet title="Join with a link" onClose={onClose} center>
      <form className="cm-form" onSubmit={go}>
        <div className="field"><label className="label" htmlFor="cm-link">Invite link</label><input id="cm-link" className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/community/abc123?code=…" /></div>
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!value.trim()}>Open</button></div>
      </form>
    </Sheet>
  );
}
