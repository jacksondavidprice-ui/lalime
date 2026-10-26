/** Build one CommonJS preload for Electron's restricted sandbox loader. */
import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPreload({ watch = false, outDir = path.join(root, "dist-electron/electron/preload") } = {}) {
  const result = await build({
    configFile: false,
    root,
    logLevel: "warn",
    clearScreen: false,
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      sourcemap: true,
      lib: {
        entry: path.join(root, "electron/preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.cjs",
      },
      rollupOptions: { external: ["electron"] },
      watch: watch ? {} : null,
    },
  });
  if (watch) {
    await new Promise((resolve, reject) => {
      const onEvent = (event) => {
        if (event.code === "END") {
          result.off("event", onEvent);
          resolve();
        } else if (event.code === "ERROR") {
          result.off("event", onEvent);
          void result.close();
          reject(event.error);
        }
      };
      result.on("event", onEvent);
    });
    return result;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const watcher = await buildPreload({ watch: process.argv.includes("--watch") });
  if (watcher) {
    const close = async () => { await watcher.close(); process.exit(0); };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
  }
}
