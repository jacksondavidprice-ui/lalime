/**
 * Bridge to Hands.exe on Windows (stdio JSON lines).
 * Reports unavailable when the binary is missing (UI shows a clear message).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HandsClient, HandsResult, WindowElement } from "./types.js";
import { ALLOWED_MUTATION_ROOTS } from "../../guardian/src/never-list.js";
import {
  handsMissingMessage,
  packagedHandsExe,
  resolveHandsExePath,
  unpackagedHandsExe,
} from "./hands-exe.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// Use OS known folders so redirected user folders retain their actual scope.
const RECYCLE_ROOTS = ["documents", "downloads", "desktop", "pictures", "videos", "music"] as const;

type RecycleRoot = { lexical: string; canonical: string };

function isStrictChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isAllowedRecyclePath(file: string, roots: RecycleRoot[]): boolean {
  if (file.split(/[\\/]/).includes("..")) return false;
  try {
    const lexical = path.resolve(file);
    const canonical = realpathSync.native(file);
    return roots.some((root) => isStrictChild(root.lexical, lexical) && isStrictChild(root.canonical, canonical));
  } catch {
    return false;
  }
}

function recyclePathIdentity(file: string): { entry: string; target: string } {
  const entry = path.join(realpathSync.native(path.dirname(file)), path.basename(file));
  const target = realpathSync.native(file);
  return process.platform === "win32"
    ? { entry: entry.toLowerCase(), target: target.toLowerCase() }
    : { entry, target };
}

function describePaths(paths: string[]): string {
  return paths.slice(0, 5).join("; ") + (paths.length > 5 ? `; and ${paths.length - 5} more item(s)` : "");
}
interface BridgeResponse extends HandsResult {
  windows?: Array<{ title: string; pid?: number }>;
  elements?: WindowElement[];
}

/**
 * Find repo/app root from compiled hands module
 * (<root>/dist-electron/hands/src) or source (<root>/hands/src).
 */
function resolveHandsProjectRoot(): string {
  let dir = path.resolve(MODULE_DIR);
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, "package.json");
    const handsDir = path.join(dir, "hands");
    if (existsSync(pkgPath) && existsSync(handsDir)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "lalime" || existsSync(path.join(handsDir, "windows"))) {
          return dir;
        }
      } catch {
        if (existsSync(path.join(handsDir, "windows"))) return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(MODULE_DIR, "../../..");
}

function resolveExe(): string {
  const appRoot = resolveHandsProjectRoot();
  const electronResources = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  const resourcesPath =
    process.env.LALIME_RESOURCES_PATH?.trim() || electronResources;
  const found = resolveHandsExePath({
    appRoot,
    resourcesPath: resourcesPath || undefined,
  });
  if (found) return found;

  // Preferred display path when missing (unpackaged layout).
  if (resourcesPath) {
    const packaged = packagedHandsExe(resourcesPath);
    if (process.env.LALIME_PACKAGED === "1") return packaged;
  }
  return unpackagedHandsExe(appRoot);
}

export class WindowsHandsBridge implements HandsClient {
  readonly backend = "windows" as const;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stoppingProcesses = new Set<ChildProcessWithoutNullStreams>();
  private nextId = 1;
  private pending = new Map<string, { resolve: (v: BridgeResponse) => void }>();
  private stopped = false;
  private recycleGeneration = 0;
  private journal: Array<{ id: string; summary: string; undone: boolean }> = [];

  isAvailable(): boolean {
    return existsSync(resolveExe());
  }

  exePath(): string | undefined {
    return resolveExe();
  }

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.stoppingProcesses.size) throw new Error("The previous Hands process is still stopping.");
    if (this.proc) return this.proc;
    const exe = resolveExe();
    if (!existsSync(exe)) {
      throw new Error(handsMissingMessage(exe));
    }
    const proc = spawn(exe, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.proc = proc;
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        if (this.proc !== proc) return;
        const msg = JSON.parse(line) as BridgeResponse & { id: string };
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          p.resolve({
            ok: msg.ok,
            output: msg.output ?? "",
            journalId: msg.journalId,
            imageDataUrl: msg.imageDataUrl,
            windows: msg.windows,
            elements: msg.elements,
          });
        }
      } catch {
        // ignore
      }
    });
    const ended = (): void => {
      this.stoppingProcesses.delete(proc);
      if (this.proc !== proc) return;
      this.proc = null;
      rl.close();
      this.settlePending("Hands stopped before returning a result. Completed changes may remain.");
    };
    const failed = (): void => {
      if (this.proc !== proc) return;
      // An IPC failure does not mean the native action has stopped.
      this.proc = null;
      rl.close();
      this.settlePending("Hands stopped before returning a result. Completed changes may remain.");
      this.terminateProcess(proc);
    };
    proc.on("exit", ended);
    proc.on("close", ended);
    proc.on("error", failed);
    proc.stdin.on("error", failed);
    // Drain diagnostic output so it cannot block the native worker.
    proc.stderr.resume();
    return proc;
  }

  private terminateProcess(proc: ChildProcessWithoutNullStreams): void {
    this.stoppingProcesses.add(proc);
    // Native stdin EOF also cancels its active action and its elevated worker.
    proc.stdin.destroy();
    try {
      if (proc.kill()) this.stoppingProcesses.delete(proc);
    } catch {
      // Keep the process tracked until exit/close confirms termination.
    }
  }

  private settlePending(output: string): void {
    for (const request of this.pending.values()) request.resolve({ ok: false, output });
    this.pending.clear();
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<BridgeResponse> {
    if (this.stopped) return Promise.resolve({ ok: false, output: "Stopped by user." });
    if (!this.isAvailable()) {
      return Promise.resolve({ ok: false, output: handsMissingMessage(this.exePath()) });
    }
    const id = String(this.nextId++);
    return new Promise((resolve) => {
      try {
        const proc = this.ensureProc();
        this.pending.set(id, { resolve });
        proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch {
        this.pending.delete(id);
        resolve({ ok: false, output: "Hands could not start the action." });
      }
    });
  }

  stop(): void {
    this.stopped = true;
    this.recycleGeneration++;
    const proc = this.proc;
    this.proc = null;
    this.settlePending("Stopped by user.");
    if (proc) this.terminateProcess(proc);
  }

  resume(): void {
    this.stopped = false;
  }

  listJournal() {
    return [...this.journal];
  }

  async precheckPowerShell(command: string) {
    const r = await this.call("powershell.astCheck", { command });
    return { blocked: !r.ok, reason: r.ok ? undefined : r.output };
  }

  async runPowerShell(command: string, summary: string, options?: { admin?: boolean }) {
    const r = await this.call("powershell.run", { command, summary, admin: options?.admin === true });
    if (r.journalId) {
      this.journal.push({ id: r.journalId, summary, undone: false });
    }
    return r;
  }

  async moveToRecycleBin(paths: string[], _summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    if (!Array.isArray(paths) || paths.length === 0) {
      return { ok: false, output: "Use existing absolute file or folder paths without wildcards. No items were moved." };
    }
    const invalidPaths = paths.filter((file) => typeof file !== "string" || !path.isAbsolute(file) || /[*?\0]/.test(file) || !existsSync(file));
    if (invalidPaths.length) {
      return { ok: false, output: `Use existing absolute file or folder paths without wildcards. Refused paths: ${describePaths(invalidPaths)}. No items were moved.` };
    }
    const generation = this.recycleGeneration;
    let completed = 0;
    let currentFile = paths[0];
    try {
      // Electron aborts on Windows if an item cannot be recycled. Do not fall back to deletion.
      const { app, shell } = await import("electron");
      const roots: RecycleRoot[] = [];
      for (const name of RECYCLE_ROOTS) {
        if (!ALLOWED_MUTATION_ROOTS.includes(name)) continue;
        try {
          const lexical = path.resolve(app.getPath(name));
          roots.push({ lexical, canonical: realpathSync.native(lexical) });
        } catch {
          // Unavailable folders do not grant access.
        }
      }
      const refusedPaths = paths.filter((file) => !isAllowedRecyclePath(file, roots));
      if (refusedPaths.length) {
        return { ok: false, output: `Recycle only items inside Documents, Downloads, Desktop, Pictures, Videos, or Music. Folder roots and paths outside these folders are not allowed. Refused paths: ${describePaths(refusedPaths)}. No items were moved.` };
      }
      const uniquePaths = new Map<string, { file: string; target: string }>();
      for (const file of paths) {
        currentFile = file;
        // Trash the directory entry, not the target of a final symbolic link.
        const identity = recyclePathIdentity(file);
        if (!uniquePaths.has(identity.entry)) uniquePaths.set(identity.entry, { file, target: identity.target });
      }
      for (const [entry, selected] of uniquePaths) {
        const file = selected.file;
        currentFile = file;
        if (this.stopped || generation !== this.recycleGeneration) {
            const remaining = [...uniquePaths.values()].slice(completed).map((item) => item.file);
            return { ok: false, completedItems: completed, output: `Stopped after ${completed} completed item(s). Not processed: ${describePaths(remaining)}. Restore completed items manually from the Recycle Bin.` };
        }
        // Recheck after each asynchronous operation. The shell API has no atomic path guard.
        if (!isAllowedRecyclePath(file, roots)) {
            return { ok: false, completedItems: completed, output: `Recycle stopped after ${completed} completed item(s). The next path is missing or outside the allowed folders: ${file}. Restore completed items manually from the Recycle Bin.` };
        }
        const current = recyclePathIdentity(file);
        if (current.entry !== entry || current.target !== selected.target) {
          return { ok: false, completedItems: completed, output: `Recycle stopped after ${completed} completed item(s). The next path changed since validation: ${file}. Restore completed items manually from the Recycle Bin.` };
        }
        await shell.trashItem(file);
        completed++;
      }
        return { ok: true, completedItems: completed, output: `Moved ${completed} item(s) to the Recycle Bin. Restore them manually from the Recycle Bin. Automatic undo is not available.` };
    } catch {
        return { ok: false, completedItems: completed, output: `Recycle stopped after ${completed} completed item(s). Windows could not recycle the current item (${currentFile}); it may be partly moved. No permanent-deletion fallback was used. Check the Recycle Bin to restore items manually.` };
    }
  }

  async openSettings(uri: string) {
    if (!/^ms-settings:[a-z0-9-]*$/i.test(uri) || /[\r\n]/.test(uri)) return { ok: false, output: "Invalid Windows Settings URI." };
    return this.call("settings.open", { uri });
  }

  async screenshot(): Promise<HandsResult> {
    const result = await this.call("screen.capture", {});
    if (result.output === "Stopped by user.") return result;
    if (result.ok && result.imageDataUrl) return result;
    const reason = result.ok
      ? "Hands returned no image."
      : result.output.trim().slice(0, 1_000) || "Windows did not provide a reason.";
    return {
      ok: false,
      output: `Windows screen capture failed: ${reason} No screenshot was returned. Try lalime_list_ui or a read-only check instead.`,
    };
  }

  async listWindows() {
    const r = await this.call("uia.listWindows", {});
    return { ok: r.ok, windows: (r.windows as Array<{ title: string; pid?: number }>) ?? [] };
  }

  async listUiElements(windowTitle?: string) {
    const r = await this.call("uia.list", { windowTitle });
    return { ok: r.ok, elements: (r.elements as WindowElement[]) ?? [] };
  }

  async clickElement(name: string, windowTitle?: string) {
    return this.call("uia.click", { name, windowTitle });
  }

  async typeText(text: string, windowTitle?: string) {
    return this.call("uia.type", { text, windowTitle });
  }

  async setElementValue(name: string, value: string, windowTitle?: string) {
    return this.call("uia.setValue", { name, value, windowTitle });
  }

  async undo(journalId: string) {
    const r = await this.call("journal.undo", { journalId });
    const entry = this.journal.find((j) => j.id === journalId);
    if (entry && r.ok) entry.undone = true;
    return r;
  }
}
