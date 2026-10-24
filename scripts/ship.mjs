#!/usr/bin/env node
/**
 * Build everything, commit, push and publish a release with one command.
 *
 *   npm run ship                        ship the version already in package.json
 *   npm run ship -- 0.4.2-alpha         bump to that version first (package files, locks, Android versionName and versionCode)
 *   npm run ship -- -m "Add anime"      commit message (default: "Release <version>")
 *   npm run ship -- --dry-run           print the plan and change nothing
 *
 * Flags: --skip-checks (no typecheck/tests)  --skip-build (reuse the last builds)  --no-push  --no-release
 *
 * Steps: preflight, typecheck + tests, web build, Linux AppImage, Windows zip,
 * Android APK, commit, push to master (which deploys the website), GitHub release, verify the download links.
 * Needs git, gh (logged in), npm and the JDK/Gradle/Android SDK described in HANDOVER.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (...names) => {
  const index = args.findIndex((arg) => names.includes(arg));
  return index >= 0 ? args[index + 1] : undefined;
};
const messageIndex = args.findIndex((arg) => arg === "-m" || arg === "--message");
const requested = args.find((arg, index) => /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(arg) && (messageIndex < 0 || index !== messageIndex + 1));
const dryRun = flag("--dry-run");

const read = (file) => readFileSync(path.join(root, file), "utf8");
const write = (file, text) => writeFileSync(path.join(root, file), text);
const currentVersion = () => JSON.parse(read("package.json")).version;

// ---- environment: pick up the toolchain from ~/.local/opt/comik when the shell has not set it up
const home = os.homedir();
const tools = path.join(home, ".local", "opt", "comik");
const env = { ...process.env };
const jdk = env.JAVA_HOME || path.join(tools, "jdk17");
const gradleBin = path.join(tools, "gradle-8.9", "bin");
if (existsSync(jdk)) env.JAVA_HOME = jdk;
if (!env.ANDROID_HOME && existsSync(path.join(home, "Android", "Sdk"))) env.ANDROID_HOME = path.join(home, "Android", "Sdk");
env.PATH = [existsSync(gradleBin) ? gradleBin : "", env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin") : "", env.PATH].filter(Boolean).join(path.delimiter);

function run(command, commandArgs, { capture = false, allowFail = false } = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", encoding: "utf8", shell: process.platform === "win32" });
  const ok = result.status === 0;
  if (!ok && !allowFail) throw new Error(`${command} ${commandArgs.join(" ")} failed (exit ${result.status})`);
  // With capture: the trimmed output, or null when the command failed. Without: whether it succeeded.
  return capture ? (ok ? (result.stdout ?? "").trim() : null) : ok;
}

const steps = [];
const step = (title, action) => steps.push({ title, action });

// ---- version bump
function bump(version) {
  const setTop = (file) => {
    const json = JSON.parse(read(file));
    json.version = version;
    if (json.packages?.[""]) json.packages[""].version = version;
    write(file, JSON.stringify(json, null, 2) + "\n");
  };
  for (const file of ["package.json", "desktop/package.json", "package-lock.json", "desktop/package-lock.json"]) if (existsSync(path.join(root, file))) setTop(file);
  const gradlePath = "android/app/build.gradle";
  let gradle = read(gradlePath);
  gradle = gradle.replace(/versionCode (\d+)/, (_, code) => `versionCode ${Number(code) + 1}`).replace(/versionName "[^"]*"/, `versionName "${version}"`);
  write(gradlePath, gradle);
}

const version = requested ?? currentVersion();
const tag = `v${version}`;
const message = option("-m", "--message") ?? `Release ${version}`;

// ---- preflight (read-only)
function preflight() {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  if (branch !== "master") throw new Error(`Ship from master (you are on ${branch}).`);
  if (!flag("--no-release")) {
    if (run("gh", ["auth", "status"], { capture: true, allowFail: true }) === null) throw new Error("gh is not logged in. Run: gh auth login");
    if (run("gh", ["release", "view", tag, "--json", "tagName"], { capture: true, allowFail: true }) !== null) throw new Error(`Release ${tag} already exists. Pass a new version.`);
  }
  const changelog = read("CHANGELOG.md");
  if (!new RegExp(`^## ${version.replaceAll(".", "\\.")}\\s*$`, "m").test(changelog)) throw new Error(`CHANGELOG.md has no "## ${version}" section. Write the release notes first.`);
}

step("Preflight", preflight);
if (requested && requested !== currentVersion()) step(`Bump version to ${version}`, () => bump(version));
if (!flag("--skip-checks")) {
  step("Typecheck", () => run("npm", ["run", "typecheck"]));
  step("Tests", () => run("npx", ["vitest", "run"]));
}
if (!flag("--skip-build")) {
  step("Web build", () => run("npm", ["run", "build:native"]));
  step("Linux AppImage", () => run("npm", ["run", "desktop:linux"]));
  step("Windows zip", () => run("npm", ["run", "desktop:windows:portable"]));
  step("Android APK", () => run("gradle", ["-p", "android", "assembleDebug", "--offline"]));
}
if (!flag("--no-push")) {
  step("Commit", () => {
    run("git", ["add", "-A"]);
    if (run("git", ["diff", "--cached", "--quiet"], { allowFail: true })) console.log("Nothing to commit.");
    else run("git", ["commit", "-m", message]);
  });
  step("Push to master", () => run("git", ["push", "origin", "master"]));
}
if (!flag("--no-release")) {
  step("Publish GitHub release", () => run("node", ["scripts/release.mjs", "--publish"]));
  step("Verify downloads", () => {
    const missing = [];
    for (const name of ["Comik-android.apk", "Comik-linux-x64.AppImage", "Comik-windows-x64.zip"]) {
      const code = run("curl", ["-sIL", "-o", "/dev/null", "-w", "%{http_code}", `https://github.com/asuka-405/comik/releases/latest/download/${name}`], { capture: true });
      console.log(`${name}: ${code}`);
      if (code !== "200") missing.push(name);
    }
    if (missing.length) throw new Error(`Download links not ready: ${missing.join(", ")}`);
  });
}

// ---- run
console.log(`${dryRun ? "[dry run] " : ""}Shipping ${version}${requested ? " (bump)" : ""}\n${steps.map((s, i) => `  ${i + 1}. ${s.title}`).join("\n")}\n`);
if (dryRun) process.exit(0);

const started = Date.now();
let failed = false;
try {
  for (const [index, { title, action }] of steps.entries()) {
    console.log(`\n==> ${index + 1}/${steps.length} ${title}`);
    await action();
  }
} catch (error) {
  failed = true;
  console.error(`\nShip stopped: ${error.message}`);
} finally {
  // The Gradle daemon keeps gigabytes of memory after a build.
  run("gradle", ["--stop"], { capture: true, allowFail: true });
}
if (failed) process.exit(1);
console.log(`\nShipped ${tag} in ${Math.round((Date.now() - started) / 60000)} min. The website redeploys from master; check https://comik.archdev.in/releases/`);
