import { useEffect, useMemo, useState } from "react";
import { Globe, Lock } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { connectPublicCommunity, linkGooglePublicCommunity, readPublicCommunityConfig, useCommunitySession } from "@/core/sync/firebase";
import { PUBLIC_ID, ROLE_LABEL, subscribeCommunities, subscribeCommunity, subscribeMember, subscribeMemberships, type Community, type Member, type Membership, type Role } from "@/core/community";
import { toast } from "../common";

/** The shared feed every reader can use. It has no owner or roles, so it is described here instead of stored. */
export const PUBLIC_COMMUNITY: Community = {
  id: PUBLIC_ID,
  name: "Comik public",
  description: "The open reading room. Anyone with a Google sign-in can post, reply and vote.",
  rules: "Keep it kind. Mark spoilers. Link the source when you recommend a series.",
  visibility: "public",
  accent: "#ff795e",
  ownerId: "",
  ownerName: "Comik",
  createdAt: 0,
  memberCount: 0,
};

export function SocialAvatar({ name }: { name: string }) {
  const colors = ["coral", "teal", "gold", "leaf", "sky"];
  const color = colors[name.charCodeAt(0) % colors.length];
  return <span className={`social-avatar ${color}`} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "R"}</span>;
}

export function CommunityAvatar({ community, size = 44 }: { community: Pick<Community, "name" | "accent">; size?: number }) {
  return <span className="cm-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42, background: community.accent }}>{community.name.trim().slice(0, 1).toUpperCase() || "C"}</span>;
}

export const RoleBadge = ({ role }: { role: Role }) => <span className={`cm-role ${role}`}>{ROLE_LABEL[role]}</span>;

export const VisibilityBadge = ({ visibility }: { visibility: Community["visibility"] }) => (
  <span className="cm-vis">{visibility === "private" ? <Lock size={12} weight="bold" /> : <Globe size={12} weight="bold" />}{visibility === "private" ? "Private" : "Public"}</span>
);

/** Connects to the community project as soon as a community page opens, and reports who is signed in. */
export function useCommunityUser() {
  const session = useCommunitySession();
  const enabled = useSettings((state) => state.publicCommunityEnabled);
  useEffect(() => {
    if (!enabled || !readPublicCommunityConfig() || session.status !== "off") return;
    void connectPublicCommunity().catch(() => {});
  }, [enabled, session.status]);
  const user = session.user;
  return {
    enabled,
    configured: !!readPublicCommunityConfig(),
    user,
    signedIn: !!user && !user.isAnonymous,
    connecting: session.status === "off" || session.status === "connecting",
    error: session.status === "error" ? session.error : undefined,
    name: user?.name || user?.email?.split("@")[0] || "Reader",
    signIn: () => void linkGooglePublicCommunity().then(() => toast("Google account connected")).catch((cause: Error) => toast(cause.message, true)),
  };
}

/** One community plus this reader's membership in it. `undefined` means still loading, `null` means it does not exist. */
export function useCommunity(id: string, uid: string | undefined) {
  const [state, setState] = useState<{ community: Community | null | undefined; member: Member | null | undefined; error: string }>({ community: undefined, member: undefined, error: "" });
  useEffect(() => {
    if (id === PUBLIC_ID) return;
    let dead = false;
    const offs: (() => void)[] = [];
    setState({ community: undefined, member: uid ? undefined : null, error: "" });
    const fail = (cause: Error) => { if (!dead) setState((current) => ({ ...current, error: cause.message })); };
    const keep = (open: Promise<() => void>) => open.then((off) => { if (dead) off(); else offs.push(off); }).catch(fail);
    void keep(subscribeCommunity(id, (community) => { if (!dead) setState((current) => ({ ...current, community })); }, fail));
    if (uid) void keep(subscribeMember(id, uid, (member) => { if (!dead) setState((current) => ({ ...current, member })); }, fail));
    return () => { dead = true; offs.forEach((off) => off()); };
  }, [id, uid]);
  return state;
}

/** Every community in the directory, and which of them this reader has joined. */
export function useDirectory(uid: string | undefined) {
  const [communities, setCommunities] = useState<Community[]>();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeCommunities((list) => { if (!dead) setCommunities(list); }, (cause) => { if (!dead) setError(cause.message); })
      .then((close) => { if (dead) close(); else off = close; })
      .catch((cause: Error) => { if (!dead) setError(cause.message); });
    return () => { dead = true; off?.(); };
  }, []);
  useEffect(() => {
    if (!uid) { setMemberships([]); return; }
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeMemberships(uid, (list) => { if (!dead) setMemberships(list); }, () => {})
      .then((close) => { if (dead) close(); else off = close; })
      .catch(() => {});
    return () => { dead = true; off?.(); };
  }, [uid]);
  const joined = useMemo(() => new Set(memberships.map((item) => item.id)), [memberships]);
  return { communities, memberships, joined, error };
}
