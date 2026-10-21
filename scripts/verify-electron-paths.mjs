/**
 * Smoke-check that unpackaged Electron can resolve and load dist/index.html.
 * Exits 0 on success; prints the resolved path and fails if Missing …/dist-electron/dist.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distHtml = path.join(root, "dist", "index.html");
const mainJs = path.join(root, "dist-electron", "electron", "main", "index.js");

if (!existsSync(distHtml) || !existsSync(mainJs)) {
  console.error("Run npm run build first");
  process.exit(1);
}

const { resolveRendererIndexHtml, resolvePreloadScript, resolveWindowIcon, isBrokenRelativeDistPath } =
  await import(pathToFileURL(path.join(root, "dist-electron/electron/main/app-paths.js")).href);

const mainDir = path.dirname(mainJs);
const ctx = { mainModuleDir: mainDir, isPackaged: false };
const resolvedHtml = resolveRendererIndexHtml(ctx);
const preload = resolvePreloadScript(ctx);
const icon = resolveWindowIcon(ctx);

console.log("resolved dist:", resolvedHtml);
console.log("resolved preload:", preload);
console.log("resolved icon:", icon);

if (!existsSync(resolvedHtml)) {
  console.error("FAIL: resolved dist/index.html missing");
  process.exit(1);
}
if (resolvedHtml.includes(`${path.sep}dist-electron${path.sep}dist${path.sep}`)) {
  console.error("FAIL: still resolving under dist-electron/dist");
  process.exit(1);
}
if (!isBrokenRelativeDistPath(mainDir)) {
  console.error("FAIL: expected naive ../../ to be wrong for this layout");
  process.exit(1);
}
if (!existsSync(preload)) {
  console.error("FAIL: preload missing at", preload);
  process.exit(1);
}

// Headless Electron: load file briefly, fail on Missing path error
const electronBin = path.join(root, "node_modules", "electron", "cli.js");
const child = spawn(
  process.execPath,
  [electronBin, "."],
  {
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      // Do not set LALIME_DEV — must load dist file
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let out = "";
const onData = (buf) => {
  out += buf.toString();
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

const timer = setTimeout(() => {
  child.kill("SIGTERM");
}, 8000);

const code = await new Promise((resolve) => {
  child.on("exit", (c) => resolve(c ?? 0));
});
clearTimeout(timer);

if (/Missing .*dist-electron[/\\]dist[/\\]index\.html/i.test(out)) {
  console.error("FAIL: Electron reported Missing dist-electron/dist/index.html");
  console.error(out.slice(-2000));
  process.exit(1);
}
if (/Error: Missing /i.test(out) && /index\.html/i.test(out)) {
  console.error("FAIL: Electron reported Missing index.html");
  console.error(out.slice(-2000));
  process.exit(1);
}

console.log("electron exit:", code);
console.log("verify-electron-paths: ok");
process.exit(0);
