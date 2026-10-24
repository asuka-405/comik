/**
 * Images for community posts. There are two ways to attach one:
 *  - upload it to ImgBB and link it, which keeps the post small, or
 *  - shrink it to fit inside the post document itself (the security rules cap that at about 50 KB).
 * The reader chooses before anything leaves their device.
 */

/** Largest image that fits in a post. As a base64 data URL it stays under the 70,000 characters the rules allow. */
export const INLINE_LIMIT = 48 * 1024;

/**
 * Comik's ImgBB key, so readers never need an account. ImgBB keys only allow uploading and are meant to ship
 * inside client apps. VITE_IMGBB_KEY replaces it at build time.
 */
const IMGBB_KEY = (import.meta.env?.VITE_IMGBB_KEY as string | undefined)?.trim() || "8fd11e0baa409dfd9854772e56d465fa";
const UPLOAD_LIMIT = 32 * 1024 * 1024;

/** Upload to ImgBB and return the public https link. */
export async function uploadToImgbb(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > UPLOAD_LIMIT) throw new Error("Uploaded images must be 32 MB or smaller.");
  const body = new FormData();
  body.set("image", file);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_KEY)}`, { method: "POST", body });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; data?: { url?: string }; error?: { message?: string } };
  const link = result.data?.url;
  if (!response.ok || !result.success || !link) throw new Error(`Image upload failed${result.error?.message ? `: ${result.error.message}` : "."}`);
  return link.replace(/^http:/, "https:");
}

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the image.")));
  reader.onerror = () => reject(new Error("Could not read the image."));
  reader.readAsDataURL(blob);
});

/** The image as a data URL of at most INLINE_LIMIT bytes: kept as is when small enough, otherwise scaled down and re-encoded as JPEG. */
export async function shrinkToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size <= INLINE_LIMIT) return readAsDataUrl(file);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image could not be opened."); });
  let scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 10; round++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize images.");
    ctx.fillStyle = "#fff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46, 0.36]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= INLINE_LIMIT) { bitmap.close?.(); return readAsDataUrl(blob); }
    }
    scale *= 0.75;
  }
  bitmap.close?.();
  throw new Error("Could not shrink this image enough. Try a smaller one.");
}
