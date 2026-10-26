import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Copy prompt files beside the compiled writer that reads them at runtime. */
export function copyRuntimeAssets() {
  const destination = path.join(root, "dist-electron", "writer", "prompts");
  mkdirSync(destination, { recursive: true });
  cpSync(path.join(root, "writer", "prompts"), destination, { recursive: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  copyRuntimeAssets();
}
