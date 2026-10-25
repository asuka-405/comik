import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Eye, LockKey, LockKeyOpen, Plus, Trash, X } from "@phosphor-icons/react";
import { db } from "@/core/db";
import { hash53 } from "@/core/hash";
import { removeFromLibrary, setVault } from "@/core/repo";
import { useSettings } from "@/core/settings";
import { getSource } from "@/core/sources/registry";
import { statsOf } from "@/core/progress";
import { mediaOf, type MediaKind } from "@/core/types";
import { ConfirmDialog, Cover, Empty, Sheet, timeAgo, toast } from "../common";
import { MEDIA, MEDIA_KINDS } from "../media";

const OPEN_KEY = "comik.vault.open";
const pinHash = (pin: string) => hash53(`comik-vault:${pin}`);
const isOpen = () => { try { return sessionStorage.getItem(OPEN_KEY) === "1"; } catch { return false; } };
const setOpenFlag = (open: boolean) => { try { open ? sessionStorage.setItem(OPEN_KEY, "1") : sessionStorage.removeItem(OPEN_KEY); } catch { /* private window */ } };

/**
 * Titles kept apart from the shelf: they are left out of the shelf, the timeline, the update badge and
 * community suggestions. An optional PIN hides the page itself. It keeps casual eyes out; it is not encryption.
 */
export function Vault() {
  const pin = useSettings((s) => s.vaultPin);
  const set = useSettings((s) => s.set);
  const safeMode = useSettings((s) => s.safeMode);
  const [unlocked, setUnlocked] = useState(isOpen);
  const [kind, setKind] = useState<MediaKind>("comic");
  const [dialog, setDialog] = useState<null | "pin" | "removePin" | "remove">(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const entries = useLiveQuery(async () => {
    const manga = await db.manga.where("libraryFlag").equals(1).filter((m) => !!m.vault).toArray();
    const ids = new Set(manga.map((m) => m.id));
    const chapters = (await db.chapters.toArray()).filter((c) => ids.has(c.mangaId));
    return manga.map((m) => ({ m, s: statsOf(chapters.filter((c) => c.mangaId === m.id)) }));
  }, [], undefined);

  const shown = useMemo(
    () => (entries ?? []).filter(({ m }) => mediaOf(m) === kind && (!safeMode || !getSource(m.sourceId)?.isNsfw)).sort((a, b) => b.m.addedAt - a.m.addedAt),
    [entries, kind, safeMode],
  );
  const counts = (value: MediaKind) => (entries ?? []).filter(({ m }) => mediaOf(m) === value).length;
  const ids = [...picked];
  const stop = () => { setSelecting(false); setPicked(new Set()); };

  if (pin && !unlocked) return <PinGate pin={pin} onUnlock={() => { setOpenFlag(true); setUnlocked(true); }} />;

  return (
    <div className="page vault-page">
      <div className="topbar">
        <div><div className="kicker">Private</div><h1>Vault</h1></div>
        <div className="vault-actions">
          <button className={`btn${selecting ? " primary" : ""}`} disabled={!shown.length} onClick={() => (selecting ? stop() : setSelecting(true))}><Check size={16} />{selecting ? "Done" : "Select"}</button>
          {pin
            ? <><button className="btn" onClick={() => { setOpenFlag(false); setUnlocked(false); }}><LockKey size={16} /> Lock now</button><button className="btn" onClick={() => setDialog("removePin")}>Remove PIN</button></>
            : <button className="btn" onClick={() => setDialog("pin")}><LockKeyOpen size={16} /> Set a PIN</button>}
        </div>
      </div>
      <p className="muted vault-note">Titles here are left out of your shelf, timeline, update badge and community suggestions. They still update and keep their progress, and they sync with your library.{!pin && " Set a PIN to hide this page too."}</p>

      <div className="seg vault-tabs" role="tablist" aria-label="Vault sections">
        {MEDIA_KINDS.map((value) => <button key={value} role="tab" aria-selected={kind === value} className={kind === value ? "on" : ""} onClick={() => { setKind(value); stop(); }}>{MEDIA[value].plural} <span className="mono muted">{counts(value)}</span></button>)}
      </div>

      {entries && !shown.length && <Empty title={`No ${MEDIA[kind].plural.toLowerCase()} in the Vault`} body="Open any title and choose Move to Vault, or select titles on a shelf and press Vault." />}
      <div className="grid">
        {shown.map(({ m, s }) => (
          <Cover key={m.id} m={m} unread={s.unread} progress={s.progress} sub={s.lastReadAt ? timeAgo(s.lastReadAt) : undefined}
            select={selecting ? { selecting, selected: picked.has(m.id), onPick: () => setPicked((cur) => { const next = new Set(cur); if (!next.delete(m.id)) next.add(m.id); return next; }) } : undefined}
            onHold={() => { setSelecting(true); setPicked(new Set([m.id])); }} />
        ))}
      </div>

      {selecting && (
        <div className="selbar shelf-selbar" role="toolbar" aria-label="Selected titles">
          <span className="selbar-count mono">{picked.size} selected</span>
          <button className="btn sm" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((e) => e.m.id)))}>{picked.size === shown.length && shown.length > 0 ? "None" : "All"}</button>
          <button className="btn sm" disabled={!picked.size} onClick={() => void setVault(ids, false).then(() => { toast(`Moved ${picked.size} back to the shelf`); stop(); })}><Eye size={15} /> Take out</button>
          <button className="btn sm danger" disabled={!picked.size} onClick={() => setDialog("remove")}><Trash size={15} /> Remove</button>
          <button className="icon-btn" onClick={stop} aria-label="Done selecting"><X size={17} /></button>
        </div>
      )}

      {dialog === "pin" && <PinSetup onClose={() => setDialog(null)} onSet={(value) => { set({ vaultPin: pinHash(value) }); setOpenFlag(true); setDialog(null); toast("PIN set"); }} />}
      {dialog === "removePin" && <ConfirmDialog title="Remove the PIN?" body="Anyone using this device can open the Vault page." action="Remove PIN" danger onClose={() => setDialog(null)} onConfirm={() => { set({ vaultPin: "" }); setDialog(null); toast("PIN removed"); }} />}
      {dialog === "remove" && <ConfirmDialog title={`Remove ${picked.size} from your library?`} body="Progress and downloads are kept. You can add them back from their page." action="Remove" danger onClose={() => setDialog(null)} onConfirm={() => void removeFromLibrary(ids).then(() => { toast(`Removed ${picked.size}`); setDialog(null); stop(); })} />}
    </div>
  );
}

function PinGate({ pin, onUnlock }: { pin: string; onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);
  return (
    <div className="page vault-page">
      <form className="vault-gate" onSubmit={(event) => { event.preventDefault(); if (pinHash(value) === pin) onUnlock(); else { setWrong(true); setValue(""); } }}>
        <LockKey size={34} />
        <h1>Vault</h1>
        <p className="muted">Enter your PIN to open it.</p>
        <input className="input" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={12} value={value} onChange={(e) => { setValue(e.target.value); setWrong(false); }} aria-label="Vault PIN" />
        {wrong && <span className="err" role="alert">That PIN is not right.</span>}
        <button className="btn primary" disabled={!value}>Unlock</button>
      </form>
    </div>
  );
}

function PinSetup({ onSet, onClose }: { onSet: (pin: string) => void; onClose: () => void }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const ok = first.length >= 4 && first === second;
  return (
    <Sheet title="Set a Vault PIN" onClose={onClose} center>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSet(first); }}>
        <p className="muted" style={{ marginBottom: 12 }}>4 to 12 digits. It hides the Vault page on this device. It is not encryption. If you forget it, the only way back is clearing Comik's data on this device, which removes the local library too (a synced library returns after you sign in).</p>
        <div className="field"><label className="label" htmlFor="pin1">PIN</label><input id="pin1" className="input" type="password" inputMode="numeric" autoFocus maxLength={12} value={first} onChange={(e) => setFirst(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="field"><label className="label" htmlFor="pin2">Repeat PIN</label><input id="pin2" className="input" type="password" inputMode="numeric" maxLength={12} value={second} onChange={(e) => setSecond(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="dialog-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok}><Plus size={15} /> Set PIN</button></div>
      </form>
    </Sheet>
  );
}
