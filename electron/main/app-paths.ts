/**
 * Resolve Lalime resource paths for both:
 * - unpackaged (`npm run build` + `electron .`) where main is at
 *   <root>/dist-electron/electron/main/
 * - packaged (electron-builder asar) where app.getAppPath() is the asar root
 *   containing dist/, dist-electron/, and package.json
 *
 * Never use a fixed `../../` from __dirname for project-root assets — that
 * resolves to dist-electron/ and breaks Windows standalone launches.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHandsExePath as resolveHandsExePathShared } from "../../hands/src/hands-exe.js";

/** Directory of this compiled (or source) main module. */
export const MAIN_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export type AppPathContext = {
  /** Directory containing electron/main/index.js (or .ts in rare direct runs). */
  mainModuleDir: string;
  /** Electron `app.getAppPath()` — asar or app directory when packaged. */
  appPath?: string;
  /** Electron `app.isPackaged`. */
  isPackaged?: boolean;
  /** Electron `process.resourcesPath` (extraResources). */
  resourcesPath?: string;
};

function looksLikeLalimeRoot(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      main?: string;
    };
    if (pkg.name === "lalime") return true;
    if (pkg.main?.includes("dist-electron/electron/main")) return true;
  } catch {
    // fall through to structural check
  }
  return (
    existsSync(path.join(dir, "dist-electron", "electron", "main")) &&
    (existsSync(path.join(dir, "dist", "index.html")) ||
      existsSync(path.join(dir, "dist")))
  );
}

/**
 * Application root that contains package.json, dist/, and dist-electron/.
 */
export function resolveAppRoot(ctx: AppPathContext): string {
  if (ctx.isPackaged && ctx.appPath) {
    return ctx.appPath;
  }

  let dir = path.resolve(ctx.mainModuleDir);
  for (let i = 0; i < 10; i++) {
    if (looksLikeLalimeRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Compiled layout fallback: dist-electron/electron/main → ../../../
  return path.resolve(ctx.mainModuleDir, "../../..");
}

export function resolveRendererIndexHtml(ctx: AppPathContext): string {
  return path.join(resolveAppRoot(ctx), "dist", "index.html");
}

export function resolveWindowIcon(ctx: AppPathContext): string {
  return path.join(resolveAppRoot(ctx), "build", "icon.png");
}

/** Preload is always a sibling of main under electron/. */
export function resolvePreloadScript(ctx: AppPathContext): string {
  return path.join(ctx.mainModuleDir, "../preload", "index.cjs");
}

/**
 * Hands.exe: packaged extraResources first, then unpackaged build output.
 * Delegates to the shared hands resolver so main and the bridge agree.
 */
export function resolveHandsExePath(ctx: AppPathContext): string | undefined {
  return resolveHandsExePathShared({
    appRoot: resolveAppRoot(ctx),
    resourcesPath: ctx.resourcesPath,
  });
}

/** True when a naive ../../ from main would miss dist/index.html (the Windows bug). */
export function isBrokenRelativeDistPath(mainModuleDir: string): boolean {
  const naive = path.resolve(mainModuleDir, "../../dist/index.html");
  const correct = resolveRendererIndexHtml({ mainModuleDir });
  return naive !== correct;
}
