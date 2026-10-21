#!/usr/bin/env node
/**
 * Build-time copy helper.
 *
 * Static strings live in src/copy/en.json (committed). This script does not call
 * Anthropic at runtime. If ANTHROPIC_API_KEY is set, a future Deliberate Lite
 * pass could regenerate en.json from source.json — for now it only validates
 * that every source key has a committed English string.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "src/copy/source.json");
const enPath = path.join(root, "src/copy/en.json");

if (!existsSync(sourcePath) || !existsSync(enPath)) {
  console.error("Missing src/copy/source.json or en.json");
  process.exit(1);
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const en = JSON.parse(readFileSync(enPath, "utf8"));
const missing = Object.keys(source).filter((k) => typeof en[k] !== "string" || !en[k].trim());
const extra = Object.keys(en).filter((k) => !(k in source));

if (missing.length) {
  console.error("Missing en.json strings for:", missing.join(", "));
  process.exit(1);
}
if (extra.length) {
  console.warn("en.json has keys not in source.json:", extra.join(", "));
}

console.log(`Copy OK: ${Object.keys(en).length} strings committed.`);
if (process.env.ANTHROPIC_API_KEY) {
  console.log(
    "ANTHROPIC_API_KEY is set in the shell only (never saved). Edit en.json by hand or extend this script for a Deliberate Lite rewrite.",
  );
}
