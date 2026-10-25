import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, EyeSlash } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { trackAnalytics } from "@/core/analytics";
import { getSource } from "@/core/sources/registry";
import { comicReference, communityTarget, publishPost, PUBLIC_ID, type CommunityKind } from "@/core/community";
import { INLINE_LIMIT, shrinkToDataUrl, uploadToImgbb } from "@/core/communityImage";
import { mediaOf, type MediaKind } from "@/core/types";
import { Sheet, toast } from "../common";
import { MEDIA, MEDIA_KINDS } from "../media";
import { wrapSpoiler } from "./Feed";
import { PUBLIC_COMMUNITY, SocialAvatar, useCommunity, useCommunityUser, useDirectory } from "./shared";

const KINDS: [CommunityKind, string][] = [["discussion", "Discussion"], ["recommendation", "Recommendation"], ["poll", "Poll"]];

export function CommunityNewPostPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const who = useCommunityUser();
  const { communities, joined } = useDirectory(who.user?.uid);
  const chosen = params.get("c") ?? params.get("room") ?? localStorage.getItem("comik.community.active") ?? PUBLIC_ID;
  const live = useCommunity(chosen, who.user?.uid);
  const builtIn = chosen === PUBLIC_ID;
  const member = builtIn ? who.signedIn : !!live.member;
  const mine = useMemo(() => (communities ?? []).filter((c) => joined.has(c.id) || c.ownerId === who.user?.uid), [communities, joined, who.user?.uid]);
  const choose = (id: string) => {
    localStorage.setItem("comik.community.active", id);
    const next = new URLSearchParams(params);
    next.set("c", id);
    next.delete("room");
    setParams(next, { replace: true });
  };

  return (
    <div className="page community-new-page">
      <Link className="community-back" to={builtIn ? "/community/public" : `/community/${chosen}`}><ArrowLeft size={17} />Back to community</Link>
      <header className="community-new-heading"><div className="kicker">The reading room</div><h1>Start a conversation</h1><p>Share a thought, put a question to readers, or give someone their next favorite series.</p></header>
      {!who.configured ? (
        <section className="community-gate"><h2>Set up Firebase first</h2><p>This build has no Firebase project for community posts.</p><Link className="btn primary" to="/settings/firebase">Open Firebase settings</Link></section>
      ) : !who.enabled ? (
        <section className="community-gate"><h2>Communities are off</h2><p>Turn the public community on in Settings to post.</p><Link className="btn" to="/settings/privacy">Community settings</Link></section>
      ) : (
        <>
          {who.error && <div className="err" role="alert">{who.error}</div>}
          <label className="community-target"><span className="label">Post in</span>
            <select className="input" value={chosen} onChange={(e) => choose(e.target.value)} aria-label="Community to post in">
              <option value={PUBLIC_ID}>{PUBLIC_COMMUNITY.name}</option>
              {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {!builtIn && !mine.some((c) => c.id === chosen) && live.community && <option value={chosen}>{live.community.name}</option>}
            </select>
          </label>
          {!who.signedIn ? (
            <section className="community-gate"><h2>Sign in to post</h2><p>Posts are tied to a Google account so replies and edits stay yours.</p><button className="btn primary" onClick={who.signIn}>Sign in with Google</button></section>
          ) : !builtIn && live.community === undefined ? (
            <div className="chapter-loading"><span className="reader-spinner" /><span>Opening community</span></div>
          ) : !builtIn && !member ? (
            <section className="community-gate"><h2>Join {live.community?.name ?? "this community"} first</h2><p>Only members can post. Open the community to join it.</p><Link className="btn primary" to={`/community/${chosen}`}>Open community</Link></section>
          ) : (
            <CommunityComposer communityId={chosen} name={who.name} onPublished={() => nav(builtIn ? "/community/public" : `/community/${chosen}`, { replace: true })} />
          )}
        </>
      )}
    </div>
  );
}

function CommunityComposer({ communityId, name, onPublished }: { communityId: string; name: string; onPublished: () => void }) {
  // Vault titles are never offered, so a post cannot give them away.
  const library = useLiveQuery(() => db.manga.filter((item) => item.inLibrary && !item.vault).toArray(), [], []);
  const [params] = useSearchParams();
  const [kind, setKind] = useState<CommunityKind>(() => (params.get("comic") ? "recommendation" : "discussion"));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mangaId, setMangaId] = useState(() => params.get("comic") ?? "");
  const [options, setOptions] = useState("");
  const [image, setImage] = useState<Attachment | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedManga = library?.find((item) => item.id === mangaId);
  const [refKind, setRefKind] = useState<MediaKind>("comic");
  // A title chosen elsewhere (Share on its page) opens in its own section.
  useEffect(() => { if (selectedManga) setRefKind(mediaOf(selectedManga)); }, [selectedManga?.id]);
  const refOptions = (library ?? []).filter((item) => mediaOf(item) === refKind).sort((a, b) => a.title.localeCompare(b.title));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
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
      let imageUrl = image?.mode === "inline" ? image.dataUrl : undefined;
      if (image?.mode === "upload") {
        try {
          imageUrl = await uploadToImgbb(image.file);
        } catch (cause) {
          // The host is unreachable or refused it. Keep the image in the post instead of losing it.
          imageUrl = await shrinkToDataUrl(image.file);
          toast(`${(cause as Error).message} The image was shrunk and kept in the post instead.`, true);
        }
      }
      await publishPost({
        kind,
        title: title.trim().slice(0, 160),
        body: body.trim().slice(0, 5000),
        ...(comic ? { comic } : {}),
        ...(kind === "poll" ? { pollOptions } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      }, communityTarget(communityId));
      void trackAnalytics("community_post", { kind });
      toast("Post published");
      onPublished();
    } catch (cause) {
      toast((cause as Error).message, true);
      setBusy(false);
    }
  };

  return (
    <form className="community-compose" onSubmit={(event) => void submit(event)}>
      <div className="community-compose-head"><SocialAvatar name={name} /><div><strong>Posting as {name}</strong><span>Share a thought with the community</span></div></div>
      <div className="seg" role="tablist" aria-label="Post type">
        {KINDS.map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={kind === value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>{label}</button>)}
      </div>
      <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={kind === "poll" ? "Poll question" : "Give your post a title"} aria-label="Post title" required />
      <textarea ref={bodyRef} className="input" value={body} onChange={(event) => setBody(event.target.value)} maxLength={5000} rows={5} placeholder="Write a discussion or recommendation. Use #tags to be found, and hide spoilers with the button below." aria-label="Post text" required />
      <div className="community-compose-hint">
        <button type="button" className="btn sm" onClick={() => wrapSpoiler(bodyRef.current, body, setBody)}><EyeSlash size={15} /> Spoiler</button>
        <span className="muted">Select text, then press Spoiler to blur it until a reader taps it.</span>
      </div>
      {kind === "poll" && <textarea className="input" value={options} onChange={(event) => setOptions(event.target.value)} maxLength={500} rows={3} placeholder="One poll option per line" aria-label="Poll options" required />}
      <div className="community-compose-tools">
        <div className="community-ref">
          <div className="seg" role="tablist" aria-label="Type of title to reference">
            {MEDIA_KINDS.map((value) => <button type="button" key={value} role="tab" aria-selected={refKind === value} className={refKind === value ? "on" : ""} onClick={() => { setRefKind(value); if (selectedManga && mediaOf(selectedManga) !== value) setMangaId(""); }}>{MEDIA[value].plural}</button>)}
          </div>
          <select className="input" value={selectedManga && mediaOf(selectedManga) === refKind ? mangaId : ""} onChange={(event) => setMangaId(event.target.value)} aria-label={`Reference a ${MEDIA[refKind].one} (optional)`}>
            <option value="">{refOptions.length ? `Reference a ${MEDIA[refKind].one} (optional)` : `No ${MEDIA[refKind].plural.toLowerCase()} on your shelf`}</option>
            {refOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { setPicked(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        {image ? (
          <span className="attach-chip"><span>{image.name} · {image.mode === "upload" ? "ImgBB" : `${(image.size / 1024).toFixed(0)} KB`}</span><button type="button" aria-label="Remove image" onClick={() => setImage(null)}>×</button></span>
        ) : <button className="btn attach" type="button" onClick={() => fileRef.current?.click()}>Attach image</button>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Publishing" : "Post"}</button>
      </div>
      {picked && <ImageChoice file={picked} onClose={() => setPicked(null)} onDone={(attachment) => { setImage(attachment); setPicked(null); }} />}
    </form>
  );
}

type Attachment = { name: string; size: number } & ({ mode: "upload"; file: File } | { mode: "inline"; dataUrl: string });

/** Ask where the image goes before it leaves the device: ImgBB, or shrunk into the post itself. */
function ImageChoice({ file, onClose, onDone }: { file: File; onClose: () => void; onDone: (attachment: Attachment) => void }) {
  const [step, setStep] = useState<"upload" | "resize">("upload");
  const [busy, setBusy] = useState(false);
  const small = file.size <= INLINE_LIMIT;
  const keep = async () => {
    setBusy(true);
    try {
      const dataUrl = await shrinkToDataUrl(file);
      onDone({ mode: "inline", name: file.name, size: Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75), dataUrl });
    } catch (cause) {
      toast((cause as Error).message, true);
      setBusy(false);
    }
  };
  return (
    <Sheet title={step === "upload" ? "Upload this image?" : small ? "Attach this image" : "Shrink this image?"} onClose={onClose} center>
      {step === "upload" ? (
        <>
          <p className="muted" style={{ marginBottom: 16 }}>When you post, <strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} KB) is uploaded to ImgBB, a third-party image host, and the post links to it. ImgBB's terms apply and anyone with the link can see the image. Nothing is uploaded until you press Post.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setStep("resize")}>No, keep it in the post</button>
            <button type="button" className="btn primary" onClick={() => onDone({ mode: "upload", name: file.name, size: file.size, file })}>Upload to ImgBB</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 16 }}>{small ? "This image is small enough to be stored inside your post as it is. It stays on Comik's servers only." : `Without uploading, the image has to fit in ${INLINE_LIMIT / 1024} KB. Comik will make it smaller (lower resolution, saved as JPEG) and store it inside your post.`}</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void keep()}>{busy ? "Working" : small ? "Attach" : "Shrink and attach"}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
