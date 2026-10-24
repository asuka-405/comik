#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const dist = path.join(root, "dist");
const output = path.join(root, "release", "app-updates", version);
const snapshot = path.join(root, "release", "app-update-snapshots", version);
const baseVersion = process.argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length);
const baseSnapshot = baseVersion ? path.join(root, "release", "app-update-snapshots", baseVersion) : undefined;

if (!/-alpha(?:\.|$)/i.test(version)) throw new Error(`OTA bundles are alpha-only; current version is ${version}`);
if (existsSync(output) || existsSync(snapshot)) throw new Error(`Update bundle or snapshot already exists for ${version}`);
if (baseVersion && !baseSnapshot) throw new Error("--base must name a previous update version");
if (baseSnapshot && !existsSync(baseSnapshot)) throw new Error(`Missing base snapshot ${baseVersion}; build the full update first`);

function collectFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, relative);
    return [relative];
  });
}

const sourcePaths = [
  ...collectFiles(path.join(dist, "assets"), "assets"),
  "web/index.html",
  "releases/index.html",
];
const currentFiles = new Map(sourcePaths.map((relative) => [relative, readFileSync(path.join(dist, relative))]));
const priorManifest = new Map();
if (baseSnapshot) {
  for (const relative of collectFiles(baseSnapshot)) priorManifest.set(relative, readFileSync(path.join(baseSnapshot, relative)));
}
const updateFiles = [...currentFiles.entries()]
  .filter(([relative, content]) => !priorManifest.has(relative) || !priorManifest.get(relative)?.equals(content))
  .map(([relative, content]) => ({ path: relative, content, size: content.length, sha256: createHash("sha256").update(content).digest("hex") }));
if (!updateFiles.some((file) => file.path === "web/index.html")) throw new Error("Every OTA update must include web/index.html");

mkdirSync(output, { recursive: true });
mkdirSync(snapshot, { recursive: true });
for (const [relative, content] of currentFiles) {
  const base = path.join(snapshot, relative);
  mkdirSync(path.dirname(base), { recursive: true });
  writeFileSync(base, content);
}
const archive = zipSync(Object.fromEntries(updateFiles.map((file) => [file.path, file.content])), { level: 9 });
const manifest = {
  schema: 1,
  version,
  archiveSha256: createHash("sha256").update(archive).digest("hex"),
  files: updateFiles.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(path.join(output, "Comik-app-update.json"), manifestBytes);
writeFileSync(path.join(output, "Comik-app-update.zip"), archive);
writeFileSync(path.join(output, "SHA256SUMS.txt"), [
  `${createHash("sha256").update(manifestBytes).digest("hex")}  Comik-app-update.json`,
  `${manifest.archiveSha256}  Comik-app-update.zip`,
].join("\n") + "\n");
console.log(`${version}: ${updateFiles.length} ${baseVersion ? "changed" : "full"} files, ${(archive.length / 1048576).toFixed(1)} MB${baseVersion ? ` (base ${baseVersion})` : ""}`);