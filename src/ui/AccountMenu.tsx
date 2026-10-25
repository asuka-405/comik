import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { GearSix, LockKey, UserCircle } from "@phosphor-icons/react";
import { useSync } from "@/core/sync/firebase";

/** Account button at the end of the top bar. Opens a small menu with the account page and app settings. */
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const user = useSync((state) => state.user);
  const { pathname } = useLocation();
  const initial = user && !user.isAnonymous ? (user.name || user.email || "?").trim()[0]?.toUpperCase() : undefined;

  // Leaving the page closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    addEventListener("pointerdown", onPointer);
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("pointerdown", onPointer);
      removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={box}>
      <button
        type="button"
        className={`account-menu-button${open ? " open" : ""}`}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {initial ? <span className="account-initial">{initial}</span> : <UserCircle size={26} weight={open ? "fill" : "regular"} />}
      </button>
      {open && (
        <div className="account-menu-list" role="menu">
          <Link role="menuitem" to="/account"><UserCircle size={19} /><span><strong>My account</strong><small>{user ? (user.isAnonymous ? "Guest session" : user.email ?? "Signed in") : "Sign in and sync"}</small></span></Link>
          <Link role="menuitem" to="/vault"><LockKey size={19} /><span><strong>Vault</strong><small>Titles kept apart from your shelf</small></span></Link>
          <Link role="menuitem" to="/settings"><GearSix size={19} /><span><strong>App settings</strong><small>Appearance, reader, Firebase</small></span></Link>
        </div>
      )}
    </div>
  );
}
