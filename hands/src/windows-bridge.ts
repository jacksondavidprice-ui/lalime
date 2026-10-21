/**
 * Bridge to Hands.exe on Windows (stdio JSON lines).
 * Reports unavailable when the binary is missing (UI shows a clear message).
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HandsClient, HandsResult, WindowElement } from "./types.js";
import {
  handsMissingMessage,
  packagedHandsExe,
  resolveHandsExePath,
  unpackagedHandsExe,
} from "./hands-exe.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

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
  private nextId = 1;
  private pending = new Map<string, { resolve: (v: BridgeResponse) => void }>();
  private stopped = false;
  private journal: Array<{ id: string; summary: string; undone: boolean }> = [];

  isAvailable(): boolean {
    return existsSync(resolveExe());
  }

  exePath(): string | undefined {
    return resolveExe();
  }

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc;
    const exe = resolveExe();
    if (!existsSync(exe)) {
      throw new Error(handsMissingMessage(exe));
    }
    this.proc = spawn(exe, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      try {
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
    this.proc.on("exit", () => {
      this.proc = null;
    });
    return this.proc;
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<BridgeResponse> {
    if (this.stopped) return Promise.resolve({ ok: false, output: "Stopped by user." });
    if (!this.isAvailable()) {
      return Promise.resolve({ ok: false, output: handsMissingMessage(this.exePath()) });
    }
    const id = String(this.nextId++);
    const proc = this.ensureProc();
    proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve({ ok: false, output: "Hands.exe timed out" });
        }
      }, 30_000);
    });
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
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

  async runPowerShell(command: string, summary: string) {
    const r = await this.call("powershell.run", { command, summary });
    if (r.journalId) {
      this.journal.push({ id: r.journalId, summary, undone: false });
    }
    return r;
  }

  async moveToRecycleBin(paths: string[], summary: string) {
    const r = await this.call("files.recycle", { paths, summary });
    if (r.journalId) this.journal.push({ id: r.journalId, summary, undone: false });
    return r;
  }

  async openSettings(uri: string) {
    return this.call("settings.open", { uri });
  }

  async screenshot() {
    return this.call("screen.capture", {});
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

  async undo(journalId: string) {
    const r = await this.call("journal.undo", { journalId });
    const entry = this.journal.find((j) => j.id === journalId);
    if (entry && r.ok) entry.undone = true;
    return r;
  }
}
