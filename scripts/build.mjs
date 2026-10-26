/**
 * Full app build: TypeScript + Vite + Electron compile, then Hands.exe on Windows.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyRuntimeAssets } from "./copy-runtime-assets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["tsc", "-p", "tsconfig.node.json"]);
run("npx", ["vite", "build"]);
run("npx", ["tsc", "-p", "tsconfig.electron.json"]);
run("node", [path.join("scripts", "build-preload.mjs")]);

copyRuntimeAssets();

run("node", [path.join("scripts", "build-hands.mjs")]);
