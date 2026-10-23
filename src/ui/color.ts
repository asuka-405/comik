/** Pick a vivid accent from a cover: average the most saturated, mid-brightness pixels of a tiny downscale. */
export async function dominantColor(src: string): Promise<string | undefined> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 28;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 28, 28);
    const { data } = ctx.getImageData(0, 0, 28, 28);
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max === 0 ? 0 : (max - min) / max;
      const light = max / 255;
      if (light < 0.25 || light > 0.95) continue;
      const weight = sat * sat + 0.02;
      r += R * weight; g += G * weight; b += B * weight; w += weight;
    }
    if (!w) return undefined;
    // lift so it reads on both themes
    const mix = (v: number) => Math.round(Math.min(255, (v / w) * 1.1 + 18));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  } catch {
    return undefined;
  }
}
