import { useSettings, type FitMode } from "@/core/settings";
import type { ReaderMode } from "@/core/types";
import { Row, Sheet, Toggle } from "../common";

const MODES: [ReaderMode, string][] = [["auto", "Auto"], ["paged-rtl", "Right to left"], ["paged-ltr", "Left to right"], ["paged-vertical", "Vertical"], ["webtoon", "Webtoon"]];

export function ReaderSettings({ mode, chosen, onMode, onClose }: { mode: string; chosen: ReaderMode; onMode: (m: ReaderMode) => void; onClose: () => void }) {
  const s = useSettings();
  return (
    <Sheet title="Reader" onClose={onClose}>
      <div className="label" style={{ marginBottom: 8 }}>This series reads as {mode.replace("paged-", "").replace("rtl", "right to left").replace("ltr", "left to right")}</div>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        {MODES.map(([v, l]) => <button key={v} className={`chip${chosen === v ? " on" : ""}`} onClick={() => onMode(v)}>{l}</button>)}
      </div>
      <Row title="Fit" hint="How a page fills the screen in paged modes">
        <select className="input" style={{ width: "auto" }} value={s.fit} onChange={(e) => s.set({ fit: e.target.value as FitMode })}>
          <option value="width">Width</option><option value="screen">Screen</option><option value="height">Height</option><option value="original">Original</option>
        </select>
      </Row>
      <Row title="Two pages at once" hint="Wide spreads stay on their own"><Toggle label="Two pages" on={s.doublePages} onChange={(v) => s.set({ doublePages: v })} /></Row>
      <Row title="Crop borders" hint="Trim blank white or black margins"><Toggle label="Crop borders" on={s.cropBorders} onChange={(v) => s.set({ cropBorders: v })} /></Row>
      <Row title="Split tall images" hint="Cut very long strips into screen-sized slices in paged modes"><Toggle label="Split tall" on={s.splitTall} onChange={(v) => s.set({ splitTall: v })} /></Row>
      <Row title="Tap zones">
        <select className="input" style={{ width: "auto" }} value={s.tapZones} onChange={(e) => s.set({ tapZones: e.target.value as typeof s.tapZones })}>
          <option value="standard">Left / right</option><option value="l-shaped">L-shaped</option><option value="edge">Edges</option><option value="off">Off</option>
        </select>
      </Row>
      <Row title="Invert tap zones"><Toggle label="Invert taps" on={s.invertTaps} onChange={(v) => s.set({ invertTaps: v })} /></Row>
      <Row title="Webtoon side padding" hint={`${s.webtoonSidePadding}% each side`}>
        <input type="range" min={0} max={25} value={s.webtoonSidePadding} onChange={(e) => s.set({ webtoonSidePadding: Number(e.target.value) })} />
      </Row>
      <Row title="Webtoon page gap" hint={`${s.webtoonGap}px`}>
        <input type="range" min={0} max={48} step={4} value={s.webtoonGap} onChange={(e) => s.set({ webtoonGap: Number(e.target.value) })} />
      </Row>
      <Row title="Brightness"><input type="range" min={0.3} max={1.2} step={0.05} value={s.brightness} onChange={(e) => s.set({ brightness: Number(e.target.value) })} /></Row>
      <Row title="Warm tint"><input type="range" min={0} max={0.8} step={0.05} value={s.sepia} onChange={(e) => s.set({ sepia: Number(e.target.value) })} /></Row>
      <Row title="Grayscale"><Toggle label="Grayscale" on={s.grayscale} onChange={(v) => s.set({ grayscale: v })} /></Row>
      <Row title="Invert colours"><Toggle label="Invert" on={s.invert} onChange={(v) => s.set({ invert: v })} /></Row>
      <Row title="Page number when controls hide"><Toggle label="Page number" on={s.showPageNumber} onChange={(v) => s.set({ showPageNumber: v })} /></Row>
      <Row title="Keep screen on"><Toggle label="Keep screen on" on={s.keepScreenOn} onChange={(v) => s.set({ keepScreenOn: v })} /></Row>
      <Row title="Preload pages" hint={`${s.preload} ahead`}><input type="range" min={1} max={10} value={s.preload} onChange={(e) => s.set({ preload: Number(e.target.value) })} /></Row>
    </Sheet>
  );
}
