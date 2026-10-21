/**
 * Resolve Hands.exe for unpackaged (repo build output) and packaged
 * (extraResources/hands/Hands.exe) layouts. Shared by Electron main and the bridge.
 */

import { existsSync } from "node:fs";
import path from "node:path";

export type HandsExeResolveInput = {
  /** Project / asar root that contains package.json (unpackaged) or app files. */
  appRoot?: string;
  /** Electron process.resourcesPath (packaged extraResources). */
  resourcesPath?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

/** Canonical unpackaged relative path from the Lalime repo root. */
export const HANDS_EXE_RELATIVE = path.join(
  "hands",
  "windows",
  "Hands",
  "bin",
  "Release",
  "net8.0-windows",
  "Hands.exe",
);

export function unpackagedHandsExe(appRoot: string): string {
  return path.join(appRoot, HANDS_EXE_RELATIVE);
}

export function packagedHandsExe(resourcesPath: string): string {
  return path.join(resourcesPath, "hands", "Hands.exe");
}

/**
 * Resolve Hands.exe if it exists. Prefer env override, then packaged
 * extraResources, then unpackaged build output.
 */
export function resolveHandsExePath(input: HandsExeResolveInput = {}): string | undefined {
  const env = input.env ?? process.env;
  const fromEnv = (env.LALIME_HANDS_EXE ?? "").trim();
  if (fromEnv) return fromEnv;

  if (input.resourcesPath) {
    const packaged = packagedHandsExe(input.resourcesPath);
    if (existsSync(packaged)) return packaged;
  }

  if (input.appRoot) {
    const unpackaged = unpackagedHandsExe(input.appRoot);
    if (existsSync(unpackaged)) return unpackaged;
  }

  return undefined;
}

export function handsMissingMessage(triedPath?: string): string {
  const where = triedPath ? ` (looked for ${triedPath})` : "";
  return (
    `Computer control (Hands.exe) is not available${where}. ` +
    `On Windows run "npm run build" (builds Hands when .NET 8 is installed), ` +
    `or "pwsh scripts/build-hands-windows.ps1". ` +
    `The installer packages Hands automatically via dist:win.`
  );
}
