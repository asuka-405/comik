#!/usr/bin/env node
/**
 * Builds the small WebP covers the site's cover wall loads (public/assets/webtoon-covers/thumbs).
 * The full-size covers stay untouched. Needs ffmpeg with libwebp.
 *
 *   node scripts/make-cover-thumbs.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "public", "assets", "webtoon-covers");
const out = path.join(dir, "thumbs");
mkdirSync(out, { recursive: true });

const covers = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
const manifest = [];
for (const { file } of covers) {
  const name = file.replace(/\.[a-z]+$/i, ".webp");
  const result = spawnSync("ffmpeg", [
    "-loglevel", "error", "-y", "-i", path.join(dir, file),
    // 140x210 is a 1.25x copy of the 112x168 wall cell, cropped to the cell's 2:3 shape.
    "-vf", "scale=140:210:force_original_aspect_ratio=increase,crop=140:210",
    "-c:v", "libwebp", "-quality", "45", "-compression_level", "6", path.join(out, name),
  ]);
  if (result.status !== 0) {
    console.error(`Skipped ${file}: ${result.stderr?.toString().trim() || "ffmpeg failed"}`);
    continue;
  }
  manifest.push({ file: name });
}
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(`Wrote ${manifest.length} thumbnails to ${path.relative(process.cwd(), out)}`);
