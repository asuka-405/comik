#!/usr/bin/env node
/**
 * Stages the built app files under stable names and prepares a GitHub release.
 *
 *   node scripts/release.mjs            stage files and print what would be published
 *   node scripts/release.mjs --publish  also create the GitHub release with the gh CLI
 *
 * Stable names mean `releases/latest/download/<name>` keeps working across versions.
 * Notes come from the matching section of CHANGELOG.md.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;
const prerelease = /-(alpha|beta|rc)\b/i.test(version);
// "0.1.0-alpha" reads better as "0.1 alpha" in a title.
const title = `Comik ${version.replace(/\.0(?=-)/, "").replace("-", " ")}`;
const stage = path.join(root, "release", "upload", version);

const PLATFORM_FILES = [
  ["android/app/build/outputs/apk/debug/app-debug.apk", "Comik-android.apk"],
  [`release/Comik-${version}.AppImage`, "Comik-linux-x64.AppImage"],
  [`release/Comik-${version}-win-x64.zip`, "Comik-windows-x64.zip"],
];
const filesToPublish = PLATFORM_FILES;

function notesFor(version) {
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const start = changelog.search(new RegExp(`^## ${version.replaceAll(".", "\\.")}\\s*$`, "m"));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  const rest = changelog.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

mkdirSync(stage, { recursive: true });

const sums = [];
for (const [from, name] of filesToPublish) {
  const source = path.join(root, from);
  if (!existsSync(source)) throw new Error(`Missing ${from}. Build it first (see HANDOVER.md).`);
  copyFileSync(source, path.join(stage, name));
  const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
  sums.push(`${hash}  ${name}`);
  console.log(`${name}  ${(statSync(source).size / 1048576).toFixed(1)} MB  sha256 ${hash.slice(0, 12)}…`);
}
writeFileSync(path.join(stage, "SHA256SUMS.txt"), sums.join("\n") + "\n");

const notes = notesFor(version);
const notesFile = path.join(stage, "NOTES.md");
writeFileSync(notesFile, notes + "\n");
console.log(`\nTag ${tag}, notes ${notes.split("\n").length} lines, staged in release/upload/${version}/`);

if (process.argv.includes("--publish")) {
  const files = [...filesToPublish.map(([, name]) => path.join(stage, name)), path.join(stage, "SHA256SUMS.txt")];
  const result = spawnSync("gh", ["release", "create", tag, ...files, ...(prerelease ? ["--prerelease"] : []), "--title", title, "--notes-file", notesFile], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
console.log("Dry run only. Add --publish to create the GitHub release.");
