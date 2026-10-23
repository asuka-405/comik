/**
 * Page image processing done in the browser, the web counterparts of what Mihon's reader does natively:
 *  - crop borders: trim uniform white/black margins found by scanning a downscaled copy,
 *  - split tall: cut very tall strips into screen-sized slices, preferring blank rows as cut lines,
 *  - wide detection: flag double-page spreads so they are shown alone.
 */

export interface Piece {
  url: string;
  w: number;
  h: number;
  wide: boolean;
  /** Blob URL we created and must revoke. */
  owned: boolean;
}

export interface ProcessOpts { crop: boolean; split: boolean }

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

const SCAN_WIDTH = 360;

function scan(img: HTMLImageElement) {
  const scale = Math.min(1, SCAN_WIDTH / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, scale };
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

/** Returns the rectangle in natural pixels to keep, or null when no worthwhile border exists. */
export function detectBorders(img: HTMLImageElement): { x: number; y: number; w: number; h: number } | null {
  const { data, w, h, scale } = scan(img);
  // background = mean of the four corners
  let bg = 0, n = 0;
  for (const [cx, cy] of [[0, 0], [w - 3, 0], [0, h - 3], [w - 3, h - 3]] as const) {
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { bg += lum(data, ((cy + y) * w + cx + x) * 4); n++; }
  }
  bg /= n;
  if (bg > 22 && bg < 233) return null; // only trim white or black margins, never coloured art
  const tol = 22;
  const rowEmpty = (y: number, x0: number, x1: number) => {
    let off = 0;
    for (let x = x0; x < x1; x++) if (Math.abs(lum(data, (y * w + x) * 4) - bg) > tol) off++;
    return off <= (x1 - x0) * 0.004;
  };
  const colEmpty = (x: number, y0: number, y1: number) => {
    let off = 0;
    for (let y = y0; y < y1; y++) if (Math.abs(lum(data, (y * w + x) * 4) - bg) > tol) off++;
    return off <= (y1 - y0) * 0.004;
  };
  let top = 0, bottom = h - 1, left = 0, right = w - 1;
  while (top < bottom && rowEmpty(top, 0, w)) top++;
  while (bottom > top && rowEmpty(bottom, 0, w)) bottom--;
  while (left < right && colEmpty(left, top, bottom + 1)) left++;
  while (right > left && colEmpty(right, top, bottom + 1)) right--;
  const pad = 2;
  top = Math.max(0, top - pad); left = Math.max(0, left - pad); bottom = Math.min(h - 1, bottom + pad); right = Math.min(w - 1, right + pad);
  const cw = right - left + 1, ch = bottom - top + 1;
  if (cw < w * 0.4 || ch < h * 0.4) return null; // mostly blank page, leave alone
  if (cw > w * 0.97 && ch > h * 0.97) return null; // nothing worth trimming
  return { x: Math.round(left / scale), y: Math.round(top / scale), w: Math.round(cw / scale), h: Math.round(ch / scale) };
}

/** Rows (natural px) near `target` with the least variation, so cuts land in gutters instead of through speech bubbles. */
function quietRow(img: HTMLImageElement, y0: number, target: number, window: number): number {
  const { data, w, h, scale } = scan(img);
  const lo = Math.max(1, Math.floor((target - window) * scale));
  const hi = Math.min(h - 2, Math.ceil((target + window) * scale));
  const rowMin = Math.max(0, Math.floor(y0 * scale));
  let best = Math.round(target * scale), bestScore = Infinity;
  for (let y = Math.max(lo, rowMin + 1); y <= hi; y++) {
    let mean = 0;
    for (let x = 0; x < w; x++) mean += lum(data, (y * w + x) * 4);
    mean /= w;
    let v = 0;
    for (let x = 0; x < w; x++) v += (lum(data, (y * w + x) * 4) - mean) ** 2;
    const score = v / w + Math.abs(y - target * scale) * 0.05;
    if (score < bestScore) { bestScore = score; best = y; }
  }
  return Math.round(best / scale);
}

function slice(img: HTMLImageElement, x: number, y: number, w: number, h: number): Promise<Piece> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve({ url: URL.createObjectURL(b), w, h, wide: w > h * 1.15, owned: true }) : reject(new Error("encode failed"))), "image/jpeg", 0.92),
  );
}

export async function processImage(src: string, opts: ProcessOpts): Promise<Piece[]> {
  const img = await loadImage(src);
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const plain: Piece = { url: src, w: nw, h: nh, wide: nw > nh * 1.15, owned: false };
  const tall = opts.split && nh / nw > 2.2;
  const box = opts.crop ? detectBorders(img) : null;
  if (!box && !tall) return [plain];

  const rect = box ?? { x: 0, y: 0, w: nw, h: nh };
  if (!tall) return [await slice(img, rect.x, rect.y, rect.w, rect.h)];

  const parts = Math.max(2, Math.round(rect.h / (rect.w * 1.5)));
  const cuts = [rect.y];
  for (let i = 1; i < parts; i++) {
    const ideal = rect.y + (rect.h * i) / parts;
    cuts.push(quietRow(img, cuts[cuts.length - 1]! + rect.w * 0.5, ideal, (rect.h / parts) * 0.2));
  }
  cuts.push(rect.y + rect.h);
  const out: Piece[] = [];
  for (let i = 0; i < parts; i++) out.push(await slice(img, rect.x, cuts[i]!, rect.w, cuts[i + 1]! - cuts[i]!));
  return out;
}

/** Whether a set of page sizes looks like a vertical strip (webtoon / manhwa). */
export function looksLikeStrip(sizes: { w: number; h: number }[]): boolean {
  if (!sizes.length) return false;
  const ratios = sizes.map((s) => s.h / s.w).sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)]! > 2.2;
}
