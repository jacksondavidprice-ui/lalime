import { spawn } from "node:child_process";
import net from "node:net";
import { createRequire } from "node:module";
import { buildPreload } from "./build-preload.mjs";
import { copyRuntimeAssets } from "./copy-runtime-assets.mjs";

const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript/bin/tsc");
await new Promise((resolve, reject) => {
  const compile = spawn(process.execPath, [tscPath, "-p", "tsconfig.electron.json"], { stdio: "inherit" });
  compile.on("error", reject);
  compile.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Electron compile failed (${code})`)));
});
copyRuntimeAssets();
const preloadWatcher = await buildPreload({ watch: true });
const typescript = spawn(process.execPath, [tscPath, "-p", "tsconfig.electron.json", "--watch"], { stdio: "inherit" });

function waitForPort(port, host = "127.0.0.1", timeoutMs = 90000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve(undefined);
      });
      sock.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

const vite = spawn(
  "npx",
  ["vite", "--port", "43123", "--strictPort", "--host", "127.0.0.1"],
  { stdio: "inherit", shell: true },
);

try {
  await waitForPort(43123);
} catch (err) {
  vite.kill();
  typescript.kill();
  await preloadWatcher.close();
  console.error(err);
  process.exit(1);
}

const electron = spawn("npx", ["electron", "."], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    LALIME_DEV: "1",
    LALIME_DEV_URL: process.env.LALIME_DEV_URL ?? "http://127.0.0.1:43123",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill();
  electron.kill();
  typescript.kill();
  await preloadWatcher.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

electron.on("exit", shutdown);
