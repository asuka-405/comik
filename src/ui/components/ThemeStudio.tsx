import { useRef, useState } from "react";
import { Check, Copy, DownloadSimple, Export, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { useSettings } from "@/core/settings";
import { BASE_COLORS, COLOR_KEYS, COLOR_LABELS, FONTS, PRESETS, exportTheme, isHex, newThemeId, parseThemeFile, resolveTheme, type ColorKey, type ResolvedTheme, type UserTheme } from "@/core/themes";
import { ConfirmDialog, toast } from "../common";

const EXAMPLE_CSS = `/* Variables go on body, which beats the theme's own values. */
body { --accent: #ff4d94; }

/* Any element can be restyled. Round every card: */
.panel, .cover .art, .list-row { border-radius: 14px; }

/* Hide the 3D backdrop and soften the page: */
.bg { display: none; }
`;

const full = (hex: string) => (/^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex);

function swatchOf(t: ResolvedTheme) {
  const c = { ...BASE_COLORS[t.base], ...t.colors };
  return c;
}

export function ThemeStudio() {
  const s = useSettings();
  const [drop, setDrop] = useState<UserTheme | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = s.userThemes.find((t) => t.id === s.theme);
  const systemDark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

  const choose = (id: string) => s.set({ theme: id });
  const update = (patch: Partial<UserTheme>) => active && s.set({ userThemes: s.userThemes.map((t) => (t.id === active.id ? { ...t, ...patch } : t)) });
  const setColor = (key: ColorKey, value: string) => {
    if (!active) return;
    const colors = { ...active.colors };
    if (value) colors[key] = value; else delete colors[key];
    update({ colors });
  };

  /** A new theme starts as a copy of whatever is showing now, so editing never starts from a blank page. */
  const create = (from?: UserTheme) => {
    const base = resolveTheme(s.theme, s.userThemes, systemDark);
    const theme: UserTheme = from
      ? { ...from, id: newThemeId(), name: `${from.name} copy`.slice(0, 40) }
      : { id: newThemeId(), name: "My theme", base: base.base, colors: { ...base.colors }, radius: base.radius, font: base.font };
    s.set({ userThemes: [...s.userThemes, theme], theme: theme.id });
  };

  const share = async () => {
    if (!active) return;
    const text = exportTheme(active, s.customCss);
    try {
      await navigator.clipboard.writeText(text);
      toast("Theme copied. Paste it anywhere to share it.");
    } catch {
      const blob = new Blob([text], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${active.name.replace(/[^\w-]+/g, "-")}.comik-theme.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const importText = (text: string) => {
    try {
      const { theme, css } = parseThemeFile(text);
      s.set({ userThemes: [...s.userThemes, theme], theme: theme.id, ...(css ? { customCss: css, customCssOn: true } : {}) });
      toast(css ? `Added “${theme.name}” and its custom CSS` : `Added “${theme.name}”`);
    } catch (cause) {
      toast((cause as Error).message, true);
    }
  };

  const importFromClipboard = async () => {
    try { importText(await navigator.clipboard.readText()); } catch { toast("Could not read the clipboard. Use Import file instead.", true); }
  };

  const card = (id: string, name: string, t: ResolvedTheme, extra?: string) => {
    const c = swatchOf(t);
    return (
      <button key={id} className={`theme-card${s.theme === id ? " on" : ""}`} onClick={() => choose(id)} aria-pressed={s.theme === id}>
        <span className="theme-swatch" style={{ background: c.canvas, borderColor: c.surface }}>
          <i style={{ background: c.surface }} />
          <i style={{ background: c["surface-2"] }} />
          <i style={{ background: c.accent }} />
          <i style={{ background: c.teal }} />
        </span>
        <span className="theme-name">{name}{s.theme === id && <Check size={13} weight="bold" />}</span>
        {extra && <span className="muted theme-sub">{extra}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="theme-grid" role="group" aria-label="Themes">
        <button className={`theme-card${s.theme === "system" ? " on" : ""}`} onClick={() => choose("system")} aria-pressed={s.theme === "system"}>
          <span className="theme-swatch split" style={{ background: `linear-gradient(105deg,${BASE_COLORS.dark.canvas} 50%,${BASE_COLORS.light.canvas} 50%)` }}><i style={{ background: BASE_COLORS.dark.accent }} /><i style={{ background: BASE_COLORS.light.accent }} /></span>
          <span className="theme-name">System{s.theme === "system" && <Check size={13} weight="bold" />}</span>
          <span className="muted theme-sub">Follows your device</span>
        </button>
        {PRESETS.map((p) => card(p.id, p.name, resolveTheme(p.id, [], true), p.base === "dark" ? "Dark" : "Light"))}
        {s.userThemes.map((t) => card(t.id, t.name, resolveTheme(t.id, s.userThemes, true), "Yours"))}
      </div>

      <div className="theme-actions">
        <button className="btn" onClick={() => create()}><Plus size={15} /> New theme</button>
        <button className="btn" onClick={() => void importFromClipboard()}><DownloadSimple size={15} /> Paste theme</button>
        <button className="btn" onClick={() => fileRef.current?.click()}><UploadSimple size={15} /> Import file</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void f.text().then(importText);
        }} />
      </div>

      {active && (
        <div className="theme-editor">
          <div className="theme-editor-head">
            <input className="input" value={active.name} maxLength={40} onChange={(e) => update({ name: e.target.value })} aria-label="Theme name" />
            <button className="icon-btn" onClick={() => create(active)} aria-label="Duplicate theme" title="Duplicate"><Copy size={16} /></button>
            <button className="icon-btn" onClick={() => void share()} aria-label="Copy theme to share" title="Copy to share"><Export size={16} /></button>
            <button className="icon-btn" onClick={() => setDrop(active)} aria-label="Delete theme" title="Delete"><Trash size={16} /></button>
          </div>
          <div className="theme-editor-row">
            <span>Based on</span>
            <div className="seg">{(["dark", "light"] as const).map((b) => <button key={b} className={active.base === b ? "on" : ""} onClick={() => update({ base: b })} style={{ textTransform: "capitalize" }}>{b}</button>)}</div>
          </div>
          <div className="theme-colors">
            {COLOR_KEYS.map((key) => {
              const value = active.colors[key] ?? "";
              const shown = value || BASE_COLORS[active.base][key];
              return (
                <div key={key} className="theme-color">
                  <input type="color" value={full(shown)} onChange={(e) => setColor(key, e.target.value)} aria-label={COLOR_LABELS[key]} />
                  <div className="theme-color-text">
                    <span>{COLOR_LABELS[key]}</span>
                    <input className="input mono" value={value} placeholder={shown} spellCheck={false} aria-label={`${COLOR_LABELS[key]} hex`}
                      onChange={(e) => { const v = e.target.value.trim(); if (v === "" || isHex(v)) setColor(key, v); else update({}); }}
                      onBlur={(e) => { if (e.target.value && !isHex(e.target.value)) e.target.value = value; }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="theme-editor-row">
            <span>Corner roundness <span className="mono muted">{active.radius}px</span></span>
            <input type="range" min={0} max={24} step={1} value={active.radius} onChange={(e) => update({ radius: Number(e.target.value) })} aria-label="Corner roundness" />
          </div>
          <div className="theme-editor-row">
            <span>Font</span>
            <select className="input" style={{ width: "auto" }} value={active.font} onChange={(e) => update({ font: e.target.value })} aria-label="Font">
              {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <p className="hint muted">Leave a colour empty to use the {active.base} default. Changes apply as you make them.</p>
        </div>
      )}

      {drop && <ConfirmDialog title={`Delete “${drop.name}”?`} body="The theme is removed from this device and from any device that syncs your settings." action="Delete theme" danger onClose={() => setDrop(null)} onConfirm={() => {
        s.set({ userThemes: s.userThemes.filter((t) => t.id !== drop.id), theme: s.theme === drop.id ? "system" : s.theme });
        setDrop(null);
      }} />}
    </>
  );
}

export function CustomCssEditor() {
  const s = useSettings();
  return (
    <div className="css-editor">
      <textarea className="input mono css-area" value={s.customCss} spellCheck={false} rows={12} maxLength={60000} placeholder={EXAMPLE_CSS} aria-label="Custom CSS" onChange={(e) => s.set({ customCss: e.target.value })} />
      <div className="theme-actions">
        <button className="btn" onClick={() => s.set({ customCss: EXAMPLE_CSS })} disabled={!!s.customCss.trim()}>Insert example</button>
        <button className="btn" onClick={() => s.set({ customCss: "" })} disabled={!s.customCss}>Clear</button>
      </div>
      <p className="hint muted">
        Applies on top of the theme, live, on this device and any device that syncs settings. Every element has a class you can target; open the developer tools to look them up.
        CSS cannot run code, but it can load images and fonts from the web, so only paste CSS from people you trust.
        If a change leaves the app unusable, turn the switch off or clear the box.
      </p>
    </div>
  );
}
