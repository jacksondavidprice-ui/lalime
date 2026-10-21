/**
 * Mock Hands sidecar for Linux CI and demo mode.
 * Implements the same HandsClient contract as Node / Windows backends.
 */

import type { HandsClient, HandsResult, WindowElement } from "../src/types.js";

export interface HandsJournalEntry {
  id: string;
  summary: string;
  undo: () => Promise<void>;
  undone: boolean;
}

function detectPlatform(): string {
  if (typeof process !== "undefined" && process.platform) {
    return process.platform;
  }
  return "browser";
}

export class MockHands implements HandsClient {
  readonly backend = "mock" as const;
  readonly platform = detectPlatform();
  private journal: HandsJournalEntry[] = [];
  private stopped = false;

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
    if (lower.includes("encodedcommand") || (lower.includes("iex") && lower.includes("download"))) {
      return { blocked: true, reason: "Obfuscated PowerShell blocked by Hands pre-check." };
    }
    return { blocked: false };
  }

  async runPowerShell(command: string, summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    const id = `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.journal.push({
      id,
      summary,
      undone: false,
      undo: async () => {
        const entry = this.journal.find((j) => j.id === id);
        if (entry) entry.undone = true;
      },
    });
    return {
      ok: true,
      output: `[mock] Ran PowerShell: ${command.slice(0, 160)}`,
      journalId: id,
      undoToken: id,
    };
  }

  async moveToRecycleBin(paths: string[], summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    const id = `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const copied = [...paths];
    this.journal.push({
      id,
      summary,
      undone: false,
      undo: async () => {
        const entry = this.journal.find((j) => j.id === id);
        if (entry) {
          entry.undone = true;
          entry.summary = `Restored ${copied.length} item(s) from Recycle Bin`;
        }
      },
    });
    return {
      ok: true,
      output: `[mock] Moved ${paths.length} path(s) to Recycle Bin`,
      journalId: id,
      undoToken: id,
    };
  }

  async openSettings(uri: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    return { ok: true, output: `[mock] Opened ${uri}` };
  }

  async screenshot(): Promise<HandsResult> {
    return {
      ok: true,
      output: "[mock] screenshot captured",
      imageDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    };
  }

  async listWindows() {
    return { ok: true, windows: [{ title: "Settings" }, { title: "File Explorer" }] };
  }

  async listUiElements(_windowTitle?: string): Promise<{ ok: boolean; elements: WindowElement[] }> {
    return {
      ok: true,
      elements: [
        { name: "Night light", controlType: "ToggleButton" },
        { name: "Make text bigger", controlType: "Button" },
      ],
    };
  }

  async clickElement(name: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    return { ok: true, output: `[mock] Clicked "${name}"` };
  }

  async typeText(text: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    return { ok: true, output: `[mock] Typed ${JSON.stringify(text)}` };
  }

  async undo(journalId: string): Promise<HandsResult> {
    const entry = this.journal.find((j) => j.id === journalId);
    if (!entry) return { ok: false, output: "Nothing to undo." };
    if (entry.undone) return { ok: false, output: "Already undone." };
    await entry.undo();
    return { ok: true, output: `Undid: ${entry.summary}` };
  }
}

export function createHandsClient(): MockHands {
  return new MockHands();
}
