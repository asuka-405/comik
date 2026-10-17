import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

const root = path.resolve(import.meta.dirname, "..");
const appDirectory = path.join(root, "release", "win-unpacked");
const archivePath = path.join(root, "release", "Comik-0.1.0-win-x64.zip");
const files = {};

async function collect(directory, relativeDirectory = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolutePath, relativePath);
    } else if (entry.isFile()) {
      files[relativePath] = new Uint8Array(await readFile(absolutePath));
    }
  }
}

await collect(appDirectory);
const archive = zipSync(files, { level: 1 });
await mkdir(path.dirname(archivePath), { recursive: true });
await writeFile(archivePath, archive);
console.log(`Created ${path.relative(root, archivePath)} (${archive.byteLength} bytes)`);
