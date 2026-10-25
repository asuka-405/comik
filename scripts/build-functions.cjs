const path = require("node:path");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");

build({
  entryPoints: [path.join(root, "functions/src/index.ts")],
  outfile: path.join(root, "functions/index.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["firebase-functions", "firebase-functions/*", "firebase-admin", "firebase-admin/*"],
  logLevel: "info",
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});