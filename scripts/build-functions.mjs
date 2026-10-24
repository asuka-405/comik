#!/usr/bin/env node
/**
 * Bundles the comic proxy (server/app.ts plus the Cloud Function wrapper) into functions/index.js.
 * firebase.json runs this before every `firebase deploy --only functions`.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

// The Firebase CLI loads functions/index.js locally to discover the function, so its packages must be installed.
if (!existsSync(path.join(root, "functions", "node_modules"))) {
  const install = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--prefix", "functions", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (install.status !== 0) process.exit(install.status ?? 1);
}

await build({
  entryPoints: [path.join(root, "functions/src/index.ts")],
  outfile: path.join(root, "functions/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Installed by Firebase from functions/package.json at deploy time.
  external: ["firebase-functions", "firebase-functions/*", "firebase-admin", "firebase-admin/*"],
  logLevel: "info",
});
