import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Hash, Megaphone, Trash } from "@phosphor-icons/react";
import { appLink } from "@/core/platform";
import { ACCENTS, deleteChannel, deleteCommunity, isAdmin, isStaff, leaveCommunity, PUBLIC_ID, readInvite, regenerateInvite, removeMember, ROLE_LABEL, saveChannel, setMemberRole, subscribeBans, subscribeChannels, subscribeMembers, transferOwnership, unban, updateCommunity, type Ban, type Channel, type ChannelKind, type Community, type Member, type Role } from "@/core/community";
import { ConfirmDialog, toast } from "../common";
import { CommunityAvatar, RoleBadge, SocialAvatar, VisibilityBadge, useCommunity, useCommunityUser } from "./shared";

type Section = "about" | "general" | "channels" | "members" | "invite" | "danger";

/** The settings page of one community. What shows depends on the viewer's role. */
export function CommunitySettings() {
  const { cid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const who = useCommunityUser();
  const { community, member, error } = useCommunity(cid, who.user?.uid);
  const role = member?.role;

  if (cid === PUBLIC_ID) return <Navigate to={`/community/${PUBLIC_ID}`} replace />;
  if (error) return <div className="page cm-page"><Back cid={cid} /><div className="err" role="alert">{error}</div></div>;
  if (community === undefined || member === undefined) return <div className="page cm-page"><Back cid={cid} /><div className="chapter-loading"><span className="reader-spinner" /><span>Opening settings</span></div></div>;
  if (community === null) return <div className="page cm-page"><Back cid={cid} /><section className="community-gate"><h2>Community not found</h2><Link className="btn" to="/community">Browse communities</Link></section></div>;
  if (!member) return <Navigate to={`/community/${cid}`} replace />;

  const sections: [Section, string][] = [
    ["about", "About"],
    ...(isAdmin(role) ? [["general", "General"], ["channels", "Channels"]] as [Section, string][] : []),
    ["members", "Members"],
    ...(isAdmin(role) ? [["invite", community.visibility === "private" ? "Invite" : "Share"]] as [Section, string][] : []),
    ["danger", role === "owner" ? "Danger zone" : "Leave"],
  ];
  const wanted = (params.get("s") as Section | null) ?? "about";
  const current = sections.some(([id]) => id === wanted) ? wanted : "about";

  return (
    <div className="page cm-page" style={{ ["--cm" as string]: community.accent }}>
      <Back cid={cid} />
      <header className="cm-settings-head">
        <CommunityAvatar community={community} size={52} />
        <div><h1>{community.name} settings</h1><div className="cm-hero-badges"><VisibilityBadge visibility={community.visibility} /><RoleBadge role={member.role} /></div></div>
      </header>
      <div className="cm-settings">
        <nav className="cm-settings-nav" aria-label="Settings sections">
          {sections.map(([id, label]) => <button key={id} aria-current={current === id} className={current === id ? "on" : ""} onClick={() => setParams({ s: id }, { replace: true })}>{label}</button>)}
        </nav>
        <div className="cm-settings-body">
          {current === "about" && <About community={community} />}
          {current === "general" && <General community={community} role={role!} />}
          {current === "channels" && <Channels cid={cid} />}
          {current === "members" && <Members cid={cid} me={member} />}
          {current === "invite" && <Invite community={community} />}
          {current === "danger" && <Danger community={community} me={member} />}
        </div>
      </div>
    </div>
  );
}

const Back = ({ cid }: { cid: string }) => <Link className="community-back" to={`/community/${cid}`}><ArrowLeft size={17} />Back to community</Link>;

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="cm-card-box"><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}{children}</section>;
}

function About({ community }: { community: Community }) {
  return (
    <Card title="About this community">
      <p>{community.description || "No description yet."}</p>
      <dl className="cm-facts">
        <div><dt>Started by</dt><dd>{community.ownerName}</dd></div>
        <div><dt>Created</dt><dd>{new Date(community.createdAt).toLocaleDateString()}</dd></div>
        <div><dt>Members</dt><dd>{community.memberCount.toLocaleString()}</dd></div>
        <div><dt>Who can join</dt><dd>{community.visibility === "private" ? "Invite code required" : "Anyone"}</dd></div>
      </dl>
      <h3>Community rules</h3>
      <p className="cm-rules">{community.rules || "The people who run this community have not written any rules yet."}</p>
      <h3>What each role can do</h3>
      <ul className="cm-perms">
        <li><RoleBadge role="owner" /> Everything, including handing the community over or deleting it.</li>
        <li><RoleBadge role="admin" /> Edit settings, manage channels and invites, and manage moderators and members.</li>
        <li><RoleBadge role="mod" /> Delete posts, replies and messages, pin posts, post announcements, and remove members.</li>
        <li><RoleBadge role="member" /> Post, reply, vote and chat. Delete their own content.</li>
      </ul>
    </Card>
  );
}

function General({ community, role }: { community: Community; role: Role }) {
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description);
  const [rules, setRules] = useState(community.rules);
  const [accent, setAccent] = useState(community.accent);
  const [visibility, setVisibility] = useState(community.visibility);
  const [busy, setBusy] = useState(false);
  const dirty = name !== community.name || description !== community.description || rules !== community.rules || accent !== community.accent || visibility !== community.visibility;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) return toast("The name needs at least two characters.", true);
    setBusy(true);
    try {
      await updateCommunity(community.id, { name, description, rules, accent, ...(role === "owner" && visibility !== community.visibility ? { visibility } : {}) });
      toast("Settings saved");
    } catch (cause) { toast((cause as Error).message, true); }
    setBusy(false);
  };
  return (
    <Card title="General" hint="How the community looks in the directory and on its page.">
      <form className="cm-form" onSubmit={(e) => void save(e)}>
        <div className="field"><label className="label" htmlFor="s-name">Name</label><input id="s-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="s-desc">Description</label><textarea id="s-desc" className="input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="s-rules">Rules</label><textarea id="s-rules" className="input" rows={5} maxLength={1500} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="One rule per line" /></div>
        <div className="field"><span className="label">Colour</span><div className="cm-swatches">{ACCENTS.map((c) => <button type="button" key={c} aria-label={`Colour ${c}`} aria-pressed={accent === c} className={accent === c ? "on" : ""} style={{ background: c }} onClick={() => setAccent(c)} />)}</div></div>
        <div className="field">
          <span className="label">Who can join</span>
          <div className="cm-choice">
            <button type="button" disabled={role !== "owner"} className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}><strong>Public</strong><span>Anyone can read the feed and join.</span></button>
            <button type="button" disabled={role !== "owner"} className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}><strong>Private</strong><span>The feed is for members. Joining needs the invite code.</span></button>
          </div>
          {role !== "owner" && <p className="muted cm-note">Only the owner can change this.</p>}
        </div>
        <div className="dialog-actions"><button className="btn primary" disabled={busy || !dirty}>{busy ? "Saving" : "Save changes"}</button></div>
      </form>
    </Card>
  );
}

function Channels({ cid }: { cid: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [editing, setEditing] = useState<Partial<Channel> | null>(null);
  const [removing, setRemoving] = useState<Channel | null>(null);
  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeChannels(cid, (list) => { if (!dead) setChannels(list); }, () => {}).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cid]);
  return (
    <Card title="Channels" hint="Chat rooms for the community. Announcement channels are written by moderators and admins and read by everyone.">
      <div className="cm-list">
        {channels.map((c) => (
          <div key={c.id} className="cm-row static">
            <span className="cm-row-icon">{c.kind === "announcements" ? <Megaphone size={18} /> : <Hash size={18} />}</span>
            <span className="cm-row-text"><strong>{c.name}</strong><span>{c.description || (c.kind === "announcements" ? "Announcements" : "Chat room")}</span></span>
            <button className="btn sm" onClick={() => setEditing(c)}>Edit</button>
            <button className="btn sm danger" aria-label={`Delete ${c.name}`} onClick={() => setRemoving(c)}><Trash size={15} /></button>
          </div>
        ))}
        {!channels.length && <p className="muted cm-note">No channels yet.</p>}
      </div>
      <button className="btn primary" onClick={() => setEditing({ kind: "chat", name: "", description: "" })}>Add a channel</button>
      {editing && <ChannelEditor cid={cid} channel={editing} onClose={() => setEditing(null)} />}
      {removing && <ConfirmDialog title={`Delete #${removing.name}?`} body="Every message in this channel is deleted for everyone. This cannot be undone." action="Delete channel" danger onClose={() => setRemoving(null)} onConfirm={() => { const c = removing; setRemoving(null); void deleteChannel(cid, c.id).then(() => toast("Channel deleted")).catch((cause: Error) => toast(cause.message, true)); }} />}
    </Card>
  );
}

function ChannelEditor({ cid, channel, onClose }: { cid: string; channel: Partial<Channel>; onClose: () => void }) {
  const [name, setName] = useState(channel.name ?? "");
  const [description, setDescription] = useState(channel.description ?? "");
  const [kind, setKind] = useState<ChannelKind>(channel.kind ?? "chat");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await saveChannel(cid, { id: channel.id, name, description, kind }); toast("Channel saved"); onClose(); } catch (cause) { toast((cause as Error).message, true); setBusy(false); }
  };
  return (
    <div className="cm-editor">
      <form className="cm-form" onSubmit={(e) => void submit(e)}>
        <h3>{channel.id ? "Edit channel" : "New channel"}</h3>
        <div className="field"><label className="label" htmlFor="ch-name">Name</label><input id="ch-name" className="input" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="spoilers" /></div>
        <div className="field"><label className="label" htmlFor="ch-desc">Topic</label><input id="ch-desc" className="input" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs here" /></div>
        <div className="field"><span className="label">Type</span>
          <div className="cm-choice">
            <button type="button" className={kind === "chat" ? "on" : ""} onClick={() => setKind("chat")}><strong>Chat</strong><span>Every member can write.</span></button>
            <button type="button" className={kind === "announcements" ? "on" : ""} onClick={() => setKind("announcements")}><strong>Announcements</strong><span>Only moderators and admins write.</span></button>
          </div>
        </div>
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()}>{busy ? "Saving" : "Save channel"}</button></div>
      </form>
    </div>
  );
}

function Members({ cid, me }: { cid: string; me: Member }) {
  const [members, setMembers] = useState<Member[]>();
  const [bans, setBans] = useState<Ban[]>([]);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<{ kind: "remove" | "ban" | "owner"; member: Member } | null>(null);
  useEffect(() => {
    let dead = false;
    const offs: (() => void)[] = [];
    const keep = (open: Promise<() => void>) => open.then((off) => { if (dead) off(); else offs.push(off); }).catch(() => {});
    void keep(subscribeMembers(cid, (list) => { if (!dead) setMembers(list); }, () => { if (!dead) setMembers([]); }));
    if (isStaff(me.role)) void keep(subscribeBans(cid, (list) => { if (!dead) setBans(list); }, () => {}));
    return () => { dead = true; offs.forEach((off) => off()); };
  }, [cid, me.role]);

  /** Which roles this viewer may give to this person, empty when they may not change them. */
  const assignable = (target: Member): Role[] => {
    if (target.uid === me.uid || target.role === "owner") return [];
    if (me.role === "owner") return ["admin", "mod", "member"];
    if (me.role === "admin" && (target.role === "member" || target.role === "mod")) return ["mod", "member"];
    return [];
  };
  const removable = (target: Member) => target.uid !== me.uid && target.role !== "owner" && (me.role === "owner" || (me.role === "admin" && (target.role === "member" || target.role === "mod")) || (me.role === "mod" && target.role === "member"));
  const shown = (members ?? []).filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()));
  const run = (task: Promise<unknown>, done: string) => task.then(() => toast(done)).catch((cause: Error) => toast(cause.message, true));

  return (
    <Card title="Members and roles" hint={me.role === "mod" ? "Moderators can remove and ban members." : "Change roles, remove people, or ban them from rejoining."}>
      <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a member" aria-label="Find a member" />
      {members === undefined && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading members</span></div>}
      <div className="cm-list">
        {shown.map((m) => {
          const roles = assignable(m);
          return (
            <div key={m.uid} className="cm-row static cm-member">
              <SocialAvatar name={m.name} />
              <span className="cm-row-text"><strong>{m.name}{m.uid === me.uid ? " (you)" : ""}</strong><span>Joined {new Date(m.joinedAt).toLocaleDateString()}</span></span>
              {roles.length ? (
                <select className="input cm-role-select" aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => void run(setMemberRole(cid, m.uid, e.target.value as Role), "Role updated")}>
                  {[m.role, ...roles.filter((r) => r !== m.role)].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              ) : <RoleBadge role={m.role} />}
              <div className="cm-member-actions">
                {me.role === "owner" && m.uid !== me.uid && <button className="btn sm" onClick={() => setAction({ kind: "owner", member: m })}>Make owner</button>}
                {removable(m) && <button className="btn sm" onClick={() => setAction({ kind: "remove", member: m })}>Remove</button>}
                {removable(m) && <button className="btn sm danger" onClick={() => setAction({ kind: "ban", member: m })}>Ban</button>}
              </div>
            </div>
          );
        })}
      </div>
      {isStaff(me.role) && bans.length > 0 && (
        <>
          <h3>Banned</h3>
          <div className="cm-list">{bans.map((b) => <div key={b.uid} className="cm-row static"><span className="cm-row-text"><strong>{b.name}</strong><span>Banned {new Date(b.createdAt).toLocaleDateString()}</span></span><button className="btn sm" onClick={() => void run(unban(cid, b.uid), "Ban lifted")}>Unban</button></div>)}</div>
        </>
      )}
      {action && (
        <ConfirmDialog
          title={action.kind === "owner" ? `Make ${action.member.name} the owner?` : action.kind === "ban" ? `Ban ${action.member.name}?` : `Remove ${action.member.name}?`}
          body={action.kind === "owner" ? "They get full control, including deleting the community. You stay on as an admin. Only they can undo this." : action.kind === "ban" ? "They are removed and cannot rejoin, even with the invite code, until you unban them." : "They are removed from the community. They can rejoin later."}
          action={action.kind === "owner" ? "Transfer ownership" : action.kind === "ban" ? "Ban" : "Remove"} danger={action.kind !== "remove"}
          onClose={() => setAction(null)}
          onConfirm={() => { const a = action; setAction(null); void run(a.kind === "owner" ? transferOwnership(cid, a.member) : removeMember(cid, a.member, a.kind === "ban"), a.kind === "owner" ? "Ownership transferred" : a.kind === "ban" ? "Member banned" : "Member removed"); }}
        />
      )}
    </Card>
  );
}

function Invite({ community }: { community: Community }) {
  const priv = community.visibility === "private";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void readInvite(community.id).then(setCode).catch(() => setCode("")); }, [community.id]);
  const link = appLink(`/community/${community.id}${priv && code ? `?code=${code}` : ""}`);
  const copy = (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast(done)).catch(() => toast("Could not copy", true));
  const renew = async () => {
    setBusy(true);
    try { setCode(await regenerateInvite(community.id)); toast("New invite code created. Old links stop working."); } catch (cause) { toast((cause as Error).message, true); }
    setBusy(false);
  };
  return (
    <Card title={priv ? "Invite people" : "Share this community"} hint={priv ? "Anyone with this link or code can join. Create a new code to cut off links you already shared." : "Anyone can join a public community. Share the link to bring people in."}>
      <div className="field"><label className="label" htmlFor="inv-link">Link</label><div className="cm-copy"><input id="inv-link" className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><button className="btn" onClick={() => copy(link, "Link copied")}>Copy</button></div></div>
      {priv && (
        <div className="field"><label className="label" htmlFor="inv-code">Invite code</label><div className="cm-copy"><input id="inv-code" className="input mono" readOnly value={code || "…"} onFocus={(e) => e.currentTarget.select()} /><button className="btn" disabled={!code} onClick={() => copy(code, "Code copied")}>Copy</button></div></div>
      )}
      {priv && <button className="btn" disabled={busy} onClick={() => void renew()}>{busy ? "Creating" : "Create a new code"}</button>}
    </Card>
  );
}

function Danger({ community, me }: { community: Community; me: Member }) {
  const nav = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState("");
  const owner = me.role === "owner";
  const leave = async () => {
    setLeaving(false);
    try { await leaveCommunity(community.id); toast(`You left ${community.name}`); nav("/community"); } catch (cause) { toast((cause as Error).message, true); }
  };
  const destroy = async () => {
    setStep("Starting");
    try { await deleteCommunity(community.id, setStep); toast("Community deleted"); nav("/community", { replace: true }); } catch (cause) { toast((cause as Error).message, true); setStep(""); }
  };
  return (
    <Card title={owner ? "Danger zone" : "Leave this community"}>
      {!owner && <div className="cm-danger"><div><strong>Leave {community.name}</strong><p className="muted">You stop seeing it in your list. {community.visibility === "private" ? "To come back you need the invite code again." : "You can rejoin any time."}</p></div><button className="btn danger" onClick={() => setLeaving(true)}>Leave</button></div>}
      {owner && (
        <>
          <div className="cm-danger"><div><strong>Leave</strong><p className="muted">Owners cannot leave. Make another member the owner first from Members, then you can leave as an admin.</p></div><button className="btn" onClick={() => nav(`/community/${community.id}/settings?s=members`)}>Choose a new owner</button></div>
          <div className="cm-danger"><div><strong>Delete this community</strong><p className="muted">Removes the feed, every channel and message, and all memberships for everyone. This cannot be undone.</p></div><button className="btn danger" onClick={() => { setTyped(""); setDeleting(true); }}>Delete</button></div>
        </>
      )}
      {leaving && <ConfirmDialog title={`Leave ${community.name}?`} body="You can rejoin later if the community allows it." action="Leave" danger onClose={() => setLeaving(false)} onConfirm={() => void leave()} />}
      {deleting && (
        <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && !step && setDeleting(false)}>
          <div className="sheet center" role="dialog" aria-modal="true" aria-label="Delete community">
            <h2>Delete {community.name}?</h2>
            <p className="muted" style={{ marginBottom: 12 }}>Everything in it is deleted for every member. Type the community name to confirm.</p>
            <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={community.name} aria-label="Type the community name" disabled={!!step} />
            {step && <p className="muted cm-note"><span className="reader-spinner" style={{ width: 14, height: 14, display: "inline-block", verticalAlign: "middle", marginRight: 8 }} />{step}</p>}
            <div className="dialog-actions"><button className="btn" disabled={!!step} onClick={() => setDeleting(false)}>Cancel</button><button className="btn danger" disabled={!!step || typed.trim() !== community.name} onClick={() => void destroy()}>Delete forever</button></div>
          </div>
        </div>
      )}
    </Card>
  );
}
