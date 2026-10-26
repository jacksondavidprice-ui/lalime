import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const promptNames = ["lalime-audience.md", "writing-rules.txt", "direct-prose.md", "explain.md"];
const expected = promptNames.map((name) => readFileSync(path.join("writer/prompts", name), "utf8").trim()).join("\n\n");
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("lalime-assets-")) throw new Error("Invalid scratch root");
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lalime-assets-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "dist-electron/writer"), { recursive: true });
  cpSync("writer/prompts", path.join(root, "writer/prompts"), { recursive: true });
  for (const name of readdirSync("scripts").filter((name) => name.endsWith(".mjs"))) {
    copyFileSync(path.join("scripts", name), path.join(root, "scripts", name));
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  // TypeScript compilation is isolated here; renderer and preload bundles are unrelated.
  const compiled = ts.transpileModule(readFileSync("writer/stages.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "writer/stages.ts",
  }).outputText;
  writeFileSync(path.join(root, "dist-electron/writer/stages.js"), compiled);
  writeFileSync(path.join(root, "scripts/build-preload.mjs"), "export async function buildPreload() { return { close: async () => {} }; }\n");
  return root;
}

function run(root: string, args: string[]) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

const readCompiledPrompt = "import { buildWriterSystemPrompt } from './dist-electron/writer/stages.js'; console.log(JSON.stringify(buildWriterSystemPrompt()));";

describe("writer runtime prompt assets", () => {
  it("loads unchanged prompts after the JS-only build runtime steps", () => {
    const root = fixture();
    const command = JSON.parse(readFileSync("package.json", "utf8")).scripts["build:js"] as string;
    // tsc is represented by the real transpilation above; Vite output is not required here.
    for (const step of command.split("&&").map((step) => step.trim())) {
      if (!step.startsWith("node scripts/")) continue;
      const result = run(root, step.slice("node ".length).split(/\s+/));
      expect(result.status, result.stderr).toBe(0);
    }
    const result = run(root, ["--input-type=module", "-e", readCompiledPrompt]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toBe(expected);
  });

  it("loads unchanged prompts before development starts Electron", () => {
    const root = fixture();
    const probe = pathToFileURL(path.join(root, "dist-electron/writer/stages.js")).href;
    const childSource = `import { EventEmitter } from 'node:events';
export function spawn(command, args) {
  const child = new EventEmitter(); child.kill = () => {};
  if (args.includes('electron')) queueMicrotask(async () => {
    try { const stages = await import(${JSON.stringify(probe)}); console.log(JSON.stringify(stages.buildWriterSystemPrompt())); process.exit(0); }
    catch (error) { console.error(error.message); process.exit(1); }
  });
  else if (!args.includes('--watch')) queueMicrotask(() => child.emit('exit', 0));
  return child;
}`;
    const netSource = `import { EventEmitter } from 'node:events';
export default { connect(_options, ready) { const socket = new EventEmitter(); socket.end = () => {}; queueMicrotask(ready); return socket; } };`;
    const moduleSource = "export function createRequire() { return { resolve: () => '/fixture/tsc' }; }";
    const replacements = Object.fromEntries(Object.entries({
      "node:child_process": childSource, "node:net": netSource, "node:module": moduleSource,
    }).map(([name, source]) => [name, `data:text/javascript,${encodeURIComponent(source)}`]));
    // Only process launch, compilation, networking, and preload watch are stubbed.
    // The actual dev entrypoint and filesystem asset copy execute without changes.
    writeFileSync(path.join(root, "loader.mjs"), `const replacements = ${JSON.stringify(replacements)};
export function resolve(specifier, context, nextResolve) {
  return replacements[specifier] ? { url: replacements[specifier], shortCircuit: true } : nextResolve(specifier, context);
}`);
    const result = run(root, ["--loader", pathToFileURL(path.join(root, "loader.mjs")).href, "scripts/dev.mjs"]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toBe(expected);
  });
});
