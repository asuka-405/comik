import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Hash, Megaphone, PaperPlaneRight, Trash } from "@phosphor-icons/react";
import { deleteMessage, isStaff, PUBLIC_ID, sendMessage, subscribeChannels, subscribeMessages, type Channel, type CommunityComment } from "@/core/community";
import { dayLabel, toast } from "../common";
import { CommunityAvatar, SocialAvatar, useCommunity, useCommunityUser } from "./shared";

const GROUP_MS = 5 * 60 * 1000;
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** One chat room or announcement channel of a community, live. */
export function ChannelPage() {
  const { cid = "", chid = "" } = useParams();
  const nav = useNavigate();
  const who = useCommunityUser();
  const live = useCommunity(cid, who.user?.uid);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<CommunityComment[]>();
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const channel = channels.find((c) => c.id === chid);
  const role = live.member?.role;
  const canRead = !!live.community && (live.community.visibility === "public" || !!live.member);
  const announcement = channel?.kind === "announcements";
  const canWrite = who.signedIn && !!live.member && (!announcement || isStaff(role));

  useEffect(() => {
    if (!canRead) return;
    let dead = false;
    let off: (() => void) | undefined;
    void subscribeChannels(cid, (list) => { if (!dead) setChannels(list); }, (cause) => { if (!dead) setError(cause.message); }).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cid, canRead]);

  useEffect(() => {
    if (!canRead) return;
    let dead = false;
    let off: (() => void) | undefined;
    setMessages(undefined);
    stick.current = true;
    void subscribeMessages(cid, chid, (list) => { if (!dead) setMessages(list); }, (cause) => { if (!dead) setError(cause.message); }).then((close) => { if (dead) close(); else off = close; }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [cid, chid, canRead]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (cid === PUBLIC_ID) return <Navigate to={`/community/${PUBLIC_ID}`} replace />;

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try { await sendMessage(cid, chid, text); setText(""); stick.current = true; } catch (cause) { toast((cause as Error).message, true); }
    setSending(false);
  };

  const rows = messages ?? [];
  return (
    <div className="page cm-page cm-chat-page" style={{ ["--cm" as string]: live.community?.accent }}>
      <Link className="community-back" to={`/community/${cid}?tab=channels`}><ArrowLeft size={17} />{live.community?.name ?? "Community"}</Link>
      <div className="cm-chat">
        <nav className="cm-chat-side" aria-label="Channels">
          {live.community && <div className="cm-chat-side-head"><CommunityAvatar community={live.community} size={28} /><strong>{live.community.name}</strong></div>}
          {channels.map((c) => <Link key={c.id} to={`/community/${cid}/chat/${c.id}`} className={c.id === chid ? "on" : ""}>{c.kind === "announcements" ? <Megaphone size={15} /> : <Hash size={15} />}<span>{c.name}</span></Link>)}
        </nav>
        <section className="cm-chat-main">
          <header className="cm-chat-head">
            {channels.length > 1 && <select className="input cm-chat-switch" aria-label="Switch channel" value={chid} onChange={(e) => nav(`/community/${cid}/chat/${e.target.value}`)}>{channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            <div className="cm-chat-title">{announcement ? <Megaphone size={18} /> : <Hash size={18} />}<strong>{channel?.name ?? "channel"}</strong></div>
            {channel?.description && <span className="cm-chat-desc">{channel.description}</span>}
          </header>
          {error && <div className="err" role="alert">{error}</div>}
          {live.community && !canRead && <div className="community-empty"><h2>Members only</h2><p>Join this community to read its channels.</p><Link className="btn" to={`/community/${cid}`}>Open community</Link></div>}
          {canRead && (
            <div className="cm-chat-log" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} aria-live="polite">
              {messages === undefined && <div className="chapter-loading"><span className="reader-spinner" /><span>Loading messages</span></div>}
              {messages !== undefined && !rows.length && <p className="muted cm-chat-empty">{announcement ? "No announcements yet." : "No messages yet. Say hello."}</p>}
              {rows.map((m, i) => {
                const prev = rows[i - 1];
                const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                const joined = !newDay && prev!.authorId === m.authorId && m.createdAt - prev!.createdAt < GROUP_MS;
                return (
                  <div key={m.id}>
                    {newDay && <div className="cm-day"><span>{dayLabel(m.createdAt)}</span></div>}
                    <div className={`cm-msg${joined ? " joined" : ""}`}>
                      {joined ? <span className="cm-msg-time">{clock(m.createdAt)}</span> : <SocialAvatar name={m.authorName} />}
                      <div className="cm-msg-body">
                        {!joined && <div className="cm-msg-meta"><strong>{m.authorName}</strong><span>{clock(m.createdAt)}</span></div>}
                        <p>{m.body}</p>
                      </div>
                      {(m.authorId === who.user?.uid || isStaff(role)) && <button className="cm-x" aria-label="Delete message" onClick={() => void deleteMessage(cid, chid, m.id).catch((cause: Error) => toast(cause.message, true))}><Trash size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {canRead && (
            <form className="cm-chat-form" onSubmit={(e) => void send(e)}>
              <textarea className="input" rows={1} maxLength={2000} value={text} disabled={!canWrite} aria-label="Message"
                placeholder={!who.signedIn ? "Sign in with Google to chat" : !live.member ? "Join the community to chat" : announcement && !isStaff(role) ? "Only moderators and admins can post announcements" : `Message #${channel?.name ?? "channel"}`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <button className="btn primary" disabled={!canWrite || sending || !text.trim()} aria-label="Send message"><PaperPlaneRight size={18} weight="fill" /></button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
