/**
 * Colour themes. A theme is a base (dark or light, which picks the built-in defaults and the browser's
 * color-scheme) plus overrides for the CSS variables the whole UI is drawn with. Built-in presets and
 * user themes share one shape, so the editor can start from any preset.
 */

export type ThemeBase = "dark" | "light";

/** The variables a theme may set. Everything else (soft accent, hover, focus ring, borders) is derived from these. */
export const COLOR_KEYS = ["canvas", "surface", "surface-2", "ink", "text", "muted", "accent", "accent-2", "on-accent", "teal", "gold", "blue", "green", "pink"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  canvas: "Background", surface: "Cards", "surface-2": "Raised cards", ink: "Headings", text: "Body text", muted: "Quiet text",
  accent: "Accent", "accent-2": "Accent, second tone", "on-accent": "Text on accent", teal: "Teal", gold: "Gold", blue: "Blue", green: "Green", pink: "Pink",
};

export type ThemeColors = Partial<Record<ColorKey, string>>;

export interface ThemeFonts { id: string; label: string; stack: string }
export const FONTS: ThemeFonts[] = [
  { id: "default", label: "Plus Jakarta Sans", stack: "" },
  { id: "system", label: "System UI", stack: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' },
  { id: "serif", label: "Serif", stack: 'Georgia,"Iowan Old Style","Times New Roman",serif' },
  { id: "rounded", label: "Rounded", stack: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,"Varela Round",system-ui,sans-serif' },
  { id: "mono", label: "Monospace", stack: 'ui-monospace,"Geist Mono Variable",SFMono-Regular,Menlo,Consolas,monospace' },
];

export interface UserTheme {
  id: string;
  name: string;
  base: ThemeBase;
  colors: ThemeColors;
  /** Corner radius in px. 0 is the default square look. */
  radius: number;
  font: string;
}

export interface Preset { id: string; name: string; base: ThemeBase; colors: ThemeColors; radius?: number }

/** Built-ins share the same editable theme shape; dark themes use rounded components by default. */
export const PRESETS: Preset[] = [
  { id: "dark", name: "Moss dark", base: "dark", radius: 8, colors: {} },
  { id: "light", name: "Moss light", base: "light", colors: {} },
  { id: "midnight", name: "Midnight", base: "dark", radius: 8, colors: { canvas: "#0c0f1d", surface: "#141a2e", "surface-2": "#1d2540", ink: "#eef1ff", text: "#c9d0ee", muted: "#8b95bd", accent: "#7c8cff", "accent-2": "#a5b0ff", "on-accent": "#0b0e22", teal: "#4fd1c5", gold: "#f6c453", blue: "#63b3ff", green: "#7ddc8a", pink: "#f58fc1" } },
  { id: "amoled", name: "Pure black", base: "dark", radius: 8, colors: { canvas: "#000000", surface: "#0b0b0d", "surface-2": "#151518", ink: "#ffffff", text: "#d6d6da", muted: "#8a8a92", accent: "#ff5c7a", "accent-2": "#ff8aa0", "on-accent": "#1a0409", teal: "#3fe0c5", gold: "#ffd166", blue: "#5cb8ff", green: "#8ee07a", pink: "#ff8fd0" } },
  { id: "nord", name: "Nord", base: "dark", radius: 8, colors: { canvas: "#2e3440", surface: "#3b4252", "surface-2": "#434c5e", ink: "#eceff4", text: "#d8dee9", muted: "#9aa5b8", accent: "#88c0d0", "accent-2": "#8fbcbb", "on-accent": "#1f2530", teal: "#8fbcbb", gold: "#ebcb8b", blue: "#81a1c1", green: "#a3be8c", pink: "#b48ead" } },
  { id: "dracula", name: "Dracula", base: "dark", radius: 8, colors: { canvas: "#282a36", surface: "#303346", "surface-2": "#3a3d52", ink: "#f8f8f2", text: "#e0e0ea", muted: "#a0a4c0", accent: "#bd93f9", "accent-2": "#d6b8ff", "on-accent": "#1c1530", teal: "#8be9fd", gold: "#f1fa8c", blue: "#8be9fd", green: "#50fa7b", pink: "#ff79c6" } },
  { id: "cyber", name: "Neon city", base: "dark", radius: 10, colors: { canvas: "#0a0714", surface: "#150f26", "surface-2": "#201638", ink: "#fdf6ff", text: "#dccdf2", muted: "#9a86bd", accent: "#ff2e97", "accent-2": "#ff74bd", "on-accent": "#1f0012", teal: "#19f5e0", gold: "#ffe14a", blue: "#4d9bff", green: "#6bff8a", pink: "#ff2e97" } },
  { id: "forest", name: "Deep forest", base: "dark", radius: 8, colors: { canvas: "#0d1a14", surface: "#142a20", "surface-2": "#1c3a2c", ink: "#eaf6ec", text: "#c3dcc9", muted: "#86a893", accent: "#6fd18c", "accent-2": "#9ae6ae", "on-accent": "#06190d", teal: "#4fd1b9", gold: "#e8c85a", blue: "#6ab8ef", green: "#a4d76a", pink: "#e89ab5" } },
  { id: "ocean", name: "Ocean", base: "dark", radius: 8, colors: { canvas: "#0a1822", surface: "#102838", "surface-2": "#173a50", ink: "#e9f5fb", text: "#bfd9e7", muted: "#80a3b8", accent: "#2fb8e6", "accent-2": "#6fd3f2", "on-accent": "#041a24", teal: "#3fe0c5", gold: "#f0c65b", blue: "#5aa9ff", green: "#78d99a", pink: "#f09ac0" } },
  { id: "arcade", name: "Arcade cabinet", base: "dark", radius: 14, colors: { canvas: "#111827", surface: "#1b2638", "surface-2": "#26364b", ink: "#f4f7e9", text: "#d5dfcf", muted: "#9aada2", accent: "#f04f78", "accent-2": "#ff9b4a", "on-accent": "#260914", teal: "#35d4c2", gold: "#f5d547", blue: "#568be8", green: "#8ac85a", pink: "#f04f78" } },
  { id: "carnival", name: "Night carnival", base: "dark", radius: 12, colors: { canvas: "#17121a", surface: "#241a27", "surface-2": "#342638", ink: "#fff3df", text: "#e7d6c0", muted: "#b19b91", accent: "#ed604e", "accent-2": "#f4b942", "on-accent": "#28110d", teal: "#46bba0", gold: "#f4b942", blue: "#5195c5", green: "#8bbd62", pink: "#e78aa3" } },
  { id: "botanical", name: "Botanical after dark", base: "dark", radius: 10, colors: { canvas: "#111a16", surface: "#1b2921", "surface-2": "#283a2d", ink: "#f1f4df", text: "#d4dfc8", muted: "#9cae98", accent: "#dc735c", "accent-2": "#efad70", "on-accent": "#24120d", teal: "#55bfa0", gold: "#dfbd54", blue: "#70aaca", green: "#8fbd68", pink: "#df8c9c" } },
  { id: "rave", name: "Kinetic rave", base: "dark", radius: 16, colors: { canvas: "#10151b", surface: "#1b252c", "surface-2": "#27353b", ink: "#f2f6e9", text: "#cbd8d2", muted: "#8ea6a1", accent: "#ff6b4a", "accent-2": "#ffc247", "on-accent": "#28100a", teal: "#00c9a7", gold: "#ffc247", blue: "#4f9ccd", green: "#9acc57", pink: "#ef6e9c" } },
  { id: "synthwave", name: "Synthwave postcard", base: "dark", radius: 12, colors: { canvas: "#171322", surface: "#251d31", "surface-2": "#352941", ink: "#f8f0e7", text: "#dfd2d0", muted: "#aa98a8", accent: "#ff765e", "accent-2": "#ffbd6b", "on-accent": "#2c100e", teal: "#4ac9b2", gold: "#ffbd6b", blue: "#66a9d4", green: "#96c96c", pink: "#e77fa7" } },
  { id: "sakura", name: "Sakura", base: "light", radius: 10, colors: { canvas: "#fbeef1", surface: "#fffafb", "surface-2": "#f7e1e7", ink: "#3a1f2b", text: "#5b3a47", muted: "#92707e", accent: "#e0527d", "accent-2": "#c43e69", "on-accent": "#fff7f9", teal: "#1f9c8b", gold: "#b27d12", blue: "#3c78b4", green: "#5c9a38", pink: "#c43e69" } },
  { id: "paper", name: "Paper", base: "light", colors: { canvas: "#f1e9d8", surface: "#faf5e8", "surface-2": "#eadfc6", ink: "#2b241a", text: "#4a4132", muted: "#85795f", accent: "#a8472a", "accent-2": "#8c371d", "on-accent": "#fff8ee", teal: "#2a7f6f", gold: "#97690a", blue: "#2d628f", green: "#51792b", pink: "#a14766" } },
  { id: "snow", name: "Snow", base: "light", radius: 6, colors: { canvas: "#eef1f6", surface: "#ffffff", "surface-2": "#e4e9f1", ink: "#12192b", text: "#2f3a52", muted: "#6a7590", accent: "#3b6cf6", "accent-2": "#2c55cf", "on-accent": "#ffffff", teal: "#0f8f82", gold: "#a77508", blue: "#2c6db5", green: "#3f8a2e", pink: "#b9457c" } },
];

export const BUILT_IN_IDS = new Set(PRESETS.map((p) => p.id));
export const MODES = ["system", "dark", "light"] as const;

export type ResolvedTheme = { id: string; base: ThemeBase; colors: ThemeColors; radius: number; font: string };

/** Turn a theme id (a preset, one of the user's themes, or "system") into what to draw. Unknown ids fall back to dark. */
export function resolveTheme(id: string, userThemes: UserTheme[], systemDark: boolean): ResolvedTheme {
  if (id === "system") return { id: systemDark ? "dark" : "light", base: systemDark ? "dark" : "light", colors: {}, radius: 0, font: "default" };
  const user = userThemes.find((t) => t.id === id);
  if (user) return { id, base: user.base, colors: user.colors, radius: user.radius, font: user.font };
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
  return { id: preset.id, base: preset.base, colors: preset.colors, radius: preset.radius ?? 0, font: "default" };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const isHex = (v: string) => HEX.test(v.trim());

/** CSS for the theme's variables. Derived values use color-mix so they follow whatever the accent is. */
export function themeCss(t: ResolvedTheme): string {
  const decl: string[] = [];
  for (const k of COLOR_KEYS) {
    const v = t.colors[k];
    if (v && isHex(v)) decl.push(`--${k}:${v}`);
  }
  const c = t.colors;
  if (c.accent && isHex(c.accent)) {
    decl.push("--accent-soft:color-mix(in srgb,var(--accent) 16%,transparent)", "--accent-hover:color-mix(in srgb,var(--accent) 86%,#000)", "--focus:0 0 0 3px color-mix(in srgb,var(--accent) 34%,transparent)", "--warm:var(--accent)");
  }
  if (c.ink && isHex(c.ink)) decl.push("--line:color-mix(in srgb,var(--ink) 15%,transparent)");
  decl.push(`--radius:${Math.max(0, Math.min(24, t.radius))}px`);
  const font = FONTS.find((f) => f.id === t.font)?.stack;
  if (font) decl.push(`--font:${font}`);
  return `:root[data-theme]{${decl.join(";")}}`;
}

export function newThemeId() {
  return `user-${Math.random().toString(36).slice(2, 9)}`;
}

/** The theme file format used to share a theme: JSON, versioned, validated on the way in. */
export interface ThemeFile { comikTheme: 1; name: string; base: ThemeBase; colors: ThemeColors; radius: number; font: string; css?: string }

export function exportTheme(t: UserTheme, css: string): string {
  const file: ThemeFile = { comikTheme: 1, name: t.name, base: t.base, colors: t.colors, radius: t.radius, font: t.font, ...(css.trim() ? { css } : {}) };
  return JSON.stringify(file, null, 2);
}

export function parseThemeFile(text: string): { theme: UserTheme; css: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("That is not a theme file."); }
  const o = raw as Partial<ThemeFile> | null;
  if (!o || o.comikTheme !== 1 || typeof o.name !== "string") throw new Error("That is not a Comik theme file.");
  const colors: ThemeColors = {};
  for (const k of COLOR_KEYS) {
    const v = o.colors?.[k];
    if (typeof v === "string" && isHex(v)) colors[k] = v.trim();
  }
  return {
    theme: {
      id: newThemeId(),
      name: o.name.trim().slice(0, 40) || "Imported theme",
      base: o.base === "light" ? "light" : "dark",
      colors,
      radius: typeof o.radius === "number" ? Math.max(0, Math.min(24, Math.round(o.radius))) : 0,
      font: FONTS.some((f) => f.id === o.font) ? o.font! : "default",
    },
    css: typeof o.css === "string" ? o.css.slice(0, 60_000) : "",
  };
}

/** What the defaults are for a base, so the editor can show real values before anything is overridden. */
export const BASE_COLORS: Record<ThemeBase, Record<ColorKey, string>> = {
  dark: { canvas: "#111713", surface: "#1a211d", "surface-2": "#242e28", ink: "#f4f6ef", text: "#d5ded5", muted: "#9daaa2", accent: "#ff795e", "accent-2": "#ff9c72", "on-accent": "#24120e", teal: "#51d0b0", gold: "#f0c65b", blue: "#6ab8ef", green: "#a4d76a", pink: "#f092ad" },
  light: { canvas: "#e6ecdf", surface: "#fbfcf5", "surface-2": "#eef2e7", ink: "#1b2922", text: "#34473c", muted: "#687b70", accent: "#df573e", "accent-2": "#c64a34", "on-accent": "#fffaf3", teal: "#078a76", gold: "#a97a10", blue: "#286fa0", green: "#528d2d", pink: "#b74d73" },
};
