import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { create } from "zustand";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { imageUrl, readingNeedsOwnFirebase } from "@/core/http";
import { getSource } from "@/core/sources/registry";
import { hash53 } from "@/core/hash";

/* ------------------------------- toasts ------------------------------- */
interface ToastItem { id: number; msg: string; bad?: boolean }
const useToastStore = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let toastId = 0;
export function toast(msg: string, bad = false) {
  const id = ++toastId;
  useToastStore.setState((s) => ({ items: [...s.items, { id, msg, bad }] }));
  setTimeout(() => useToastStore.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), bad ? 6000 : 3200);
}
export function Toasts() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.bad ? " bad" : ""}`}>{t.msg}</div>
      ))}
    </div>
  );
}

/* ------------------------------- helpers ------------------------------- */
/** Stable supporting hue per title, like the Sutrid portfolio tiles. */
export const hueOf = (key: string) => Number.parseInt(hash53(key).slice(0, 3), 36) % 7;

export function coverSrc(sourceId: string, cover?: string): string {
  if (!cover) return "";
  const s = getSource(sourceId);
  return imageUrl(cover, s?.imageReferer ?? s?.baseUrl, s?.directImages);
}

export function timeAgo(ts: number): string {
  if (!ts) return "";
  const d = Date.now() - ts;
  const m = Math.floor(d / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 330 ? "numeric" : undefined });
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export const bytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.round(n / 1e3)} KB`);

/* -------------------------------- cover -------------------------------- */
export interface CoverData { id: string; title: string; cover?: string; sourceId: string }

export function Cover({ m, unread, inLibrary, progress, sub, to }: { m: CoverData; unread?: number; inLibrary?: boolean; progress?: number; sub?: string; to?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const src = coverSrc(m.sourceId, m.cover);
  return (
    <Link to={to ?? `/series/${encodeURIComponent(m.id)}`} className="cover" data-hue={hueOf(m.id)} title={m.title}>
      <div className="art">
        {(!src || broken) && <div className="fallback">{m.title}</div>}
        {src && !broken && <img src={src} alt="" loading="lazy" className={loaded ? "loaded" : ""} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />}
        <div className="tags">{!!unread && unread > 0 && <span className="tag">{unread > 999 ? "999+" : unread}</span>}</div>
        {inLibrary && <span className="inlib">IN SHELF</span>}
        {progress !== undefined && progress > 0 && (
          <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        )}
      </div>
      <div className="name">{m.title}</div>
      {sub && <div className="sub">{sub}</div>}
    </Link>
  );
}

export function CoverSkeletons({ n = 12 }: { n?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i}>
          <div className="skel" style={{ aspectRatio: "2/3" }} />
          <div className="skel" style={{ height: 12, marginTop: 11, width: "80%" }} />
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- sheet --------------------------------- */
export function Sheet({ title, onClose, children, center }: { title?: string; onClose: () => void; children: ReactNode; center?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className={`scrim${center ? " center" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${center ? " center" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: title ? 0 : 8 }}>
          {title && <h2 style={{ flex: 1, marginBottom: 14 }}>{title}</h2>}
          {!title && <span style={{ flex: 1 }} />}
          <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ marginTop: title ? -8 : 0 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="grow">
        <div style={{ fontWeight: 700, color: "var(--ink)" }}>{title}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Back button that floats over the page corner instead of taking a row in the header. */
/** Shown on the web build while the user has no Firebase proxy, because source requests cannot work without one. */
export function ReadingNotice() {
  if (!readingNeedsOwnFirebase()) return null;
  return (
    <div className="panel reading-notice" data-hue="5" role="note">
      <h2>Reading comics in the browser needs your own Firebase</h2>
      <p className="muted">The shared Comik site does not fetch comics, because one address making every reader's requests would be banned by the sources. Your library, sync and Community already work. To read here, connect your own Firebase project, or use the Android, Linux or Windows app, which fetch directly from your device.</p>
      <div className="reading-notice-actions">
        <Link className="btn primary" to="/setup">Set up my Firebase</Link>
        <Link className="btn" to="/settings/firebase">Open Firebase settings</Link>
      </div>
    </div>
  );
}

export function FloatBack({ to }: { to?: string }) {
  const nav = useNavigate();
  return (
    <button className="float-back" aria-label="Back" title="Back" onClick={() => (to ? nav(to) : history.length > 1 ? nav(-1) : nav("/"))}>
      <ArrowLeft size={18} />
    </button>
  );
}
