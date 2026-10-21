/**
 * Full app build: TypeScript + Vite + Electron compile, then Hands.exe on Windows.
 */
import { cpSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["tsc", "-p", "tsconfig.node.json"]);
run("npx", ["vite", "build"]);
run("npx", ["tsc", "-p", "tsconfig.electron.json"]);

// Writer prompts are read at runtime next to the compiled stages.js.
const promptsSrc = path.join(root, "writer", "prompts");
const promptsDest = path.join(root, "dist-electron", "writer", "prompts");
mkdirSync(promptsDest, { recursive: true });
cpSync(promptsSrc, promptsDest, { recursive: true });

run("node", [path.join("scripts", "build-hands.mjs")]);
