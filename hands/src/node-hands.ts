/**
 * Node Hands — usable on Linux/macOS for limited local ops + journal.
 * Not a substitute for Windows UIA; screenshots/clicks are simulated.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename, writeFile, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { HandsClient, HandsResult, WindowElement } from "./types.js";

const execFileAsync = promisify(execFile);

interface JournalEntry {
  id: string;
  summary: string;
  undone: boolean;
  restore?: () => Promise<void>;
}

function id(): string {
  return `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 1x1 lime PNG as data URL — placeholder when no display capture exists. */
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export class NodeHands implements HandsClient {
  readonly backend = "node" as const;
  private journal: JournalEntry[] = [];
  private stopped = false;
  private scratch: string;

  constructor(scratchRoot?: string) {
    this.scratch = scratchRoot ?? path.join(os.tmpdir(), "lalime-hands");
  }

  isAvailable(): boolean {
    return true;
  }

  stop(): void {
    this.stopped = true;
  }

  resume(): void {
    this.stopped = false;
  }

  listJournal() {
    return this.journal.map(({ id, summary, undone }) => ({ id, summary, undone }));
  }

  async precheckPowerShell(command: string): Promise<{ blocked: boolean; reason?: string }> {
    const lower = command.toLowerCase();
    if (
      lower.includes("-encodedcommand") ||
      /iex\b/.test(lower) && lower.includes("download") ||
      lower.includes("frombase64string")
    ) {
      return {
        blocked: true,
        reason: "PowerShell looks encoded or download-and-run. Lalime will not execute it.",
      };
    }
    return { blocked: false };
  }

  async runPowerShell(command: string, summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    const pre = await this.precheckPowerShell(command);
    if (pre.blocked) return { ok: false, output: pre.reason ?? "Blocked" };

    // On non-Windows, record intent only — do not shell out to real PowerShell.
    if (process.platform !== "win32") {
      const jid = id();
      this.journal.push({ id: jid, summary, undone: false });
      return {
        ok: true,
        output: `[node-hands] Recorded PowerShell (not executed on ${process.platform}): ${command.slice(0, 200)}`,
        journalId: jid,
        undoToken: jid,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { timeout: 60_000, windowsHide: true, maxBuffer: 2_000_000 },
      );
      const jid = id();
      this.journal.push({ id: jid, summary, undone: false });
      return {
        ok: true,
        output: (stdout || stderr || "OK").toString().slice(0, 8000),
        journalId: jid,
        undoToken: jid,
      };
    } catch (err) {
      return {
        ok: false,
        output: err instanceof Error ? err.message : "PowerShell failed",
      };
    }
  }

  async moveToRecycleBin(paths: string[], summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    await mkdir(this.scratch, { recursive: true });
    const quarantine = path.join(this.scratch, "quarantine", id());
    await mkdir(quarantine, { recursive: true });
    const moved: Array<{ from: string; to: string }> = [];

    for (const p of paths) {
      try {
        const base = path.basename(p);
        const dest = path.join(quarantine, base);
        await rename(p, dest).catch(async () => {
          await copyFile(p, dest);
        });
        moved.push({ from: p, to: dest });
      } catch {
        // Skip missing paths in demo/sandbox.
      }
    }

    const jid = id();
    this.journal.push({
      id: jid,
      summary,
      undone: false,
      restore: async () => {
        for (const m of moved) {
          await rename(m.to, m.from).catch(() => undefined);
        }
      },
    });
    return {
      ok: true,
      output: `Moved ${moved.length} item(s) to quarantine (Recycle-Bin style).`,
      journalId: jid,
      undoToken: jid,
    };
  }

  async openSettings(uri: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    if (process.platform === "win32") {
      try {
        await execFileAsync("cmd.exe", ["/c", "start", "", uri], { windowsHide: true });
        return { ok: true, output: `Opened ${uri}` };
      } catch (err) {
        return { ok: false, output: err instanceof Error ? err.message : "Failed to open settings" };
      }
    }
    return { ok: true, output: `[node-hands] Would open ${uri} on Windows` };
  }

  async screenshot(): Promise<HandsResult> {
    // Write a tiny placeholder so tools that expect a file still work.
    await mkdir(this.scratch, { recursive: true });
    const file = path.join(this.scratch, `shot_${Date.now()}.txt`);
    await writeFile(file, "screenshot placeholder — real capture on Windows Hands.exe\n");
    return {
      ok: true,
      output: `Screenshot saved (placeholder on ${process.platform}): ${file}`,
      imageDataUrl: PLACEHOLDER_PNG,
    };
  }

  async listWindows() {
    return {
      ok: true,
      windows: [{ title: `(node-hands) No UIA on ${process.platform}` }],
    };
  }

  async listUiElements(_windowTitle?: string): Promise<{ ok: boolean; elements: WindowElement[] }> {
    return {
      ok: true,
      elements: [
        { name: "Night light", controlType: "Button" },
        { name: "Text size", controlType: "Slider" },
      ],
    };
  }

  async clickElement(name: string, windowTitle?: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    return {
      ok: true,
      output: `[node-hands] Would click "${name}"${windowTitle ? ` in ${windowTitle}` : ""}`,
    };
  }

  async typeText(text: string, windowTitle?: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    return {
      ok: true,
      output: `[node-hands] Would type ${JSON.stringify(text)}${windowTitle ? ` in ${windowTitle}` : ""}`,
    };
  }

  async undo(journalId: string): Promise<HandsResult> {
    const entry = this.journal.find((j) => j.id === journalId);
    if (!entry) return { ok: false, output: "Nothing to undo." };
    if (entry.undone) return { ok: false, output: "Already undone." };
    await entry.restore?.();
    entry.undone = true;
    return { ok: true, output: `Undid: ${entry.summary}` };
  }
}

export async function readScratchNote(file: string): Promise<string> {
  return readFile(file, "utf8");
}
