import { useEffect, useRef } from "react";
import { useSettings } from "@/core/settings";
import { PanelField } from "./PanelField";

/** Drifting grid, cursor-following bright grid (same device as the Sutrid site), plus the 3D panel stream. */
export function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const fx = useSettings((s) => s.fx);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const on = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--px", `${e.clientX}px`);
        el.style.setProperty("--py", `${e.clientY}px`);
      });
    };
    addEventListener("pointermove", on, { passive: true });
    return () => {
      removeEventListener("pointermove", on);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="bg" ref={ref} aria-hidden="true">
      <div className="bg-grid" />
      {fx && <PanelField mode="bg" />}
      <div className="bg-glow" />
      <div className="bg-vignette" />
    </div>
  );
}
