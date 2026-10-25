import { useEffect, useState, type FormEvent } from "react";
import { ChatCircleDots, X } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { addContentComment, contentDiscussionKey, subscribeContentComments, type ContentComment } from "@/core/community";
import { useSettings } from "@/core/settings";
import { connectPublicCommunity, linkGooglePublicCommunity, readPublicCommunityConfig, useCommunitySession } from "@/core/sync/firebase";
import type { ChapterRow, MangaRow } from "@/core/types";
import { toast } from "../common";

export function ContentDiscussion({ manga, chapter, page }: { manga: MangaRow; chapter: ChapterRow; page?: number }) {
  const enabled = useSettings((state) => state.readerCommunityEnabled);
  const session = useCommunitySession();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<ContentComment[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const contentKey = contentDiscussionKey(manga, chapter);
  const signedIn = !!session.user && !session.user.isAnonymous;

  useEffect(() => {
    if (!enabled || !readPublicCommunityConfig() || session.status !== "off") return;
    void connectPublicCommunity().catch((cause: Error) => setError(cause.message));
  }, [enabled, session.status]);

  useEffect(() => {
    if (!open || !enabled) return;
    let dead = false;
    let off: (() => void) | undefined;
    setError("");
    void subscribeContentComments(contentKey, page, (items) => { if (!dead) setComments(items); }, (cause) => { if (!dead) setError(cause.message); })
      .then((close) => { if (dead) close(); else off = close; })
      .catch((cause: Error) => { if (!dead) setError(cause.message); });
    return () => { dead = true; off?.(); };
  }, [open, enabled, contentKey, page]);

  const label = page === undefined ? "Episode discussion" : `Page ${page + 1} discussion`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addContentComment(contentKey, page, body);
      setBody("");
    } catch (cause) {
      toast((cause as Error).message || "Could not post comment", true);
    } finally {
      setBusy(false);
    }
  };

  return <div className="content-discussion">
    <button className={`icon-btn content-discussion-toggle${open ? " on" : ""}`} aria-label={enabled ? label : "Enable reader discussions"} title={enabled ? label : "Reader discussions are off"} aria-expanded={open} onClick={() => setOpen((value) => !value)}><ChatCircleDots size={19} /></button>
    {open && <aside className="content-discussion-panel" role="dialog" aria-label={label}>
      <header><div><strong>{label}</strong><small>{manga.title} · {chapter.name}</small></div><button className="icon-btn" aria-label="Close discussion" onClick={() => setOpen(false)}><X size={17} /></button></header>
      {!enabled && <p className="muted">Reader discussions are off. <Link to="/settings/privacy" onClick={() => setOpen(false)}>Enable them in Settings</Link>.</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {enabled && comments.map((comment) => <article className="content-discussion-comment" key={comment.id}><strong>{comment.authorName}</strong><p>{comment.body}</p></article>)}
      {enabled && !comments.length && !error && <p className="muted">No comments yet.</p>}
      {enabled && (signedIn
        ? <form onSubmit={(event) => void submit(event)}><textarea className="input" value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="Add to the discussion" aria-label="Add a comment" /><button className="btn primary" disabled={busy || !body.trim()}>{busy ? "Posting…" : "Comment"}</button></form>
        : <button className="btn primary" onClick={() => void linkGooglePublicCommunity().catch((cause: Error) => toast(cause.message, true))}>Sign in to comment</button>)}
    </aside>}
  </div>;
}