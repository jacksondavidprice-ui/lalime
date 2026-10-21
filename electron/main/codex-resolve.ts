/**
 * Resolve the Codex CLI binary for live agent turns.
 * Prefer LALIME_CODEX_BIN, then PATH, then common install locations on Windows/macOS/Linux.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type CodexResolveEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function resolveCodexCommand(
  env: CodexResolveEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const fromEnv = (env.LALIME_CODEX_BIN ?? "").trim();
  if (fromEnv) return fromEnv;

  const which = lookUpOnPath("codex", env, platform);
  if (which) return which;

  for (const candidate of candidatePaths(platform, env)) {
    if (existsSync(candidate)) return candidate;
  }

  return "codex";
}

export function isCodexAvailable(
  env: CodexResolveEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const cmd = resolveCodexCommand(env, platform);
  if (path.isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\")) {
    return existsSync(cmd);
  }
  return Boolean(lookUpOnPath(cmd, env, platform));
}

function lookUpOnPath(
  bin: string,
  env: CodexResolveEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const pathEnv = env.PATH ?? env.Path ?? "";
  if (!pathEnv) return undefined;
  try {
    const result =
      platform === "win32"
        ? spawnSync("where.exe", [bin], {
            env: env as NodeJS.ProcessEnv,
            encoding: "utf8",
            windowsHide: true,
          })
        : spawnSync("which", [bin], {
            env: env as NodeJS.ProcessEnv,
            encoding: "utf8",
          });
    if (result.status === 0) {
      const line = (result.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && existsSync(line)) return line;
    }
  } catch {
    // fall through to manual PATH walk
  }

  const sep = platform === "win32" ? ";" : ":";
  const exts =
    platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + (ext || ""));
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

function candidatePaths(
  platform: NodeJS.Platform,
  env: CodexResolveEnv,
): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  const list: string[] = [
    path.join(home, ".local", "bin", "codex"),
    path.join(home, ".cargo", "bin", "codex"),
  ];
  if (platform === "win32") {
    const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const localApp = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    list.push(
      path.join(appData, "npm", "codex.cmd"),
      path.join(appData, "npm", "codex.exe"),
      path.join(localApp, "npm", "codex.cmd"),
      path.join(home, "AppData", "Roaming", "npm", "codex.cmd"),
    );
  }
  if (platform === "darwin") {
    list.push("/opt/homebrew/bin/codex", "/usr/local/bin/codex");
  }
  return list;
}

export function codexMissingMessage(command: string): string {
  return (
    `Could not start Codex (${command}). Install the Codex CLI once, then sign in:\n` +
    `  npm i -g @openai/codex\n` +
    `  codex login\n` +
    `Or set LALIME_CODEX_BIN to the full path of the codex binary. ` +
    `You can also paste your own OpenAI API key below.`
  );
}
