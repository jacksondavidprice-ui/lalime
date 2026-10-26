/**
 * Node Hands — usable on Linux/macOS for limited local ops + journal.
 * Not a substitute for Windows UIA; screenshots/clicks are simulated.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rename, writeFile, readFile, lstat, link, unlink, readdir, rmdir, readlink, symlink, realpath, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { HandsClient, HandsResult, WindowElement } from "./types.js";

const execFileAsync = promisify(execFile);

interface JournalEntry {
  id: string;
  summary: string;
  undone: boolean;
  restore?: () => Promise<Pick<HandsResult, "ok" | "output" | "undoItems" | "restoreWarning">>;
  restoreProgress?: () => { restored: number; total: number };
  pendingDirectories?: () => string[];
}

function restoreIssueReason(error: unknown): string {
  if ((error as NodeJS.ErrnoException | null)?.code) return restoreErrorMessage(error);
  const message = error instanceof Error ? error.message : "";
  if (["The original restore location changed. Recovery remains in quarantine.",
    "The restore destination changed. Recovery remains in quarantine.",
    "This file type cannot be restored automatically."].includes(message)) return message;
  return "This item could not be restored. Check the detailed result and recovery location.";
}

function restoreErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case "EEXIST": return "A file or folder already exists at the restore destination. It was left untouched.";
    case "EACCES":
    case "EPERM": return "Permission was denied. Check access to the original folder and recovery location before retrying.";
    case "ENOENT": return "A file or folder needed for restore no longer exists. Check the recovery location before retrying.";
    case "ENOTDIR": return "A required folder has been replaced by a file. Check the original restore location before retrying.";
    case "ENOTEMPTY": return "The folder still contains files, so the restore could not finish.";
    case "ENOSPC": return "There is not enough free storage to finish the restore.";
    case "EBUSY": return "A file or folder is in use. Close the app using it before retrying.";
    case "EXDEV": return "The restore location is on a different drive. Automatic restore cannot finish there.";
    case "EIO": return "The storage device could not read or write the data. Check the device before retrying.";
    default: return code ? "The operating system could not finish the restore. Check the recovery location before retrying."
      : error instanceof Error ? error.message : "The restore could not finish.";
  }
}

function id(): string {
  return `j_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const KNOWN_FOLDERS = ["Documents", "Downloads", "Desktop", "Pictures", "Videos", "Music"];
type RecycleRoot = { lexical: string; canonical: string };

function strictChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve missing children from their nearest existing parent. Do not follow a broken link. */
async function canonicalLocation(candidate: string): Promise<string> {
  let ancestor = candidate;
  while (true) {
    try {
      await lstat(ancestor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || path.dirname(ancestor) === ancestor) throw error;
      ancestor = path.dirname(ancestor);
      continue;
    }
    return path.resolve(await realpath(ancestor), path.relative(ancestor, candidate));
  }
}

async function validateRecyclePath(candidate: string, roots: RecycleRoot[]): Promise<string> {
  if (!path.isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) {
    throw new Error("Recycle paths must be absolute and must not contain parent traversal.");
  }
  const lexical = path.resolve(candidate);
  const canonical = await canonicalLocation(lexical);
  if (!roots.some((root) => strictChild(root.lexical, lexical) && strictChild(root.canonical, canonical))) {
    throw new Error("Recycle only items inside the approved personal folders. Folder roots and outside paths are not allowed.");
  }
  return canonical;
}

async function checkRecycleAccess(candidate: string, canonical: string): Promise<void> {
  const source = await lstat(canonical);
  const parent = await realpath(path.dirname(candidate));
  const parentStat = await lstat(parent);
  if ((source.mode & 0o444) === 0 || (process.platform !== "win32" && source.isDirectory() && (source.mode & 0o111) === 0)) {
    throw new Error("The selected item is not readable. Nothing was moved for this item.");
  }
  if ((parentStat.mode & 0o222) === 0 || (process.platform !== "win32" && (parentStat.mode & 0o111) === 0)) {
    throw new Error("The selected item's parent folder is not writable. Nothing was moved for this item.");
  }
  // Windows mode bits do not represent every ACL. Check access as well and preserve rename errors.
  await access(candidate, constants.R_OK | (source.isDirectory() ? constants.X_OK : 0));
  await access(parent, constants.W_OK | constants.X_OK);
}

/** Restore without replacing an existing file or directory. Keep failed items in quarantine. */
async function restoreExclusive(
  source: string,
  destination: string,
  created: Map<string, { dev: number; ino: number }>,
  validateDestination: (destination: string) => Promise<void>,
): Promise<void> {
  const sourceStat = await lstat(source);
  const sourceParent = path.dirname(source);
  const parentStat = await lstat(sourceParent);
  if ((parentStat.mode & 0o222) === 0 || (process.platform !== "win32" && (parentStat.mode & 0o111) === 0)) {
    throw Object.assign(new Error("Permission was denied for recovery cleanup."), { code: "EACCES" });
  }
  await access(sourceParent, constants.W_OK | constants.X_OK);
  await validateDestination(destination);
  const previous = created.get(destination);
  if (previous) {
    const current = await lstat(destination);
    if (current.dev !== previous.dev || current.ino !== previous.ino) {
      throw new Error("The restore destination changed. Recovery remains in quarantine.");
    }
  } else {
    if (sourceStat.isDirectory()) {
      await mkdir(destination, { mode: sourceStat.mode & 0o7777 });
    } else if (sourceStat.isSymbolicLink()) {
      await symlink(await readlink(source), destination);
    } else if (sourceStat.isFile()) {
      // link fails if the destination exists. rename can replace it on Unix.
      await link(source, destination);
    } else {
      throw new Error("This file type cannot be restored automatically.");
    }
    const current = await lstat(destination);
    created.set(destination, { dev: current.dev, ino: current.ino });
  }
  if (sourceStat.isDirectory()) {
    for (const name of await readdir(source)) {
      await restoreExclusive(path.join(source, name), path.join(destination, name), created, validateDestination);
    }
    await rmdir(source);
  } else {
    await unlink(source);
  }
}

/** 1x1 lime PNG as data URL — placeholder when no display capture exists. */
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export class NodeHands implements HandsClient {
  readonly backend = "node" as const;
  private journal: JournalEntry[] = [];
  private pendingUndos = new Set<string>();
  private stopped = false;
  private generation = 0;
  private scratch: string;
  private shellControllers = new Set<AbortController>();

  constructor(scratchRoot?: string, private readonly allowedRoots = KNOWN_FOLDERS.map((name) => path.join(os.homedir(), name))) {
    this.scratch = scratchRoot ?? path.join(os.tmpdir(), "lalime-hands");
  }

  isAvailable(): boolean {
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    for (const controller of this.shellControllers) controller.abort();
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

  async runPowerShell(command: string, summary: string, options?: { admin?: boolean }): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    if (options?.admin) return { ok: false, output: "Native Windows Hands is required for one-command administrator approval." };
    const generation = this.generation;
    const pre = await this.precheckPowerShell(command);
    if (pre.blocked) return { ok: false, output: pre.reason ?? "Blocked" };
    if (this.stopped || generation !== this.generation) return { ok: false, output: "Stopped by user." };

    // On non-Windows, record intent only — do not shell out to real PowerShell.
    if (process.platform !== "win32") {
      const jid = id();
      this.journal.push({ id: jid, summary, undone: false });
      return {
        ok: true,
        output: `[node-hands] Recorded PowerShell (not executed on ${process.platform}): ${command.slice(0, 200)}`,
        journalId: jid,
      };
    }

    const controller = new AbortController();
    this.shellControllers.add(controller);
    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        { signal: controller.signal, windowsHide: true, maxBuffer: 2_000_000 },
      );
      const jid = id();
      this.journal.push({ id: jid, summary, undone: false });
      return {
        ok: true,
        output: (stdout || stderr || "OK").toString().slice(0, 8000),
        journalId: jid,
      };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, output: "Stopped by user." };
      return {
        ok: false,
        output: err instanceof Error ? err.message : "PowerShell failed",
      };
    } finally {
      this.shellControllers.delete(controller);
    }
  }

  async moveToRecycleBin(paths: string[], summary: string): Promise<HandsResult> {
    if (this.stopped) return { ok: false, output: "Stopped by user." };
    const generation = this.generation;
    if (paths.length === 0) return { ok: false, output: "No files were selected. Nothing moved." };
    const roots: RecycleRoot[] = [];
    for (const root of this.allowedRoots) {
      try { roots.push({ lexical: path.resolve(root), canonical: await realpath(root) }); }
      catch { /* An unavailable root does not grant access. */ }
    }
    const selected: Array<{ path: string; canonical: string; entry: string }> = [];
    const seen = new Set<string>();
    let validatingPath = "";
    try {
      for (const candidate of paths) {
        validatingPath = candidate;
        const canonical = await validateRecyclePath(candidate, roots);
        const entry = path.join(await canonicalLocation(path.dirname(candidate)), path.basename(candidate));
        const identity = process.platform === "win32" ? entry.toLowerCase() : entry;
        // Validate every input before deduplication. A final link is its own directory entry.
        if (!seen.has(identity)) {
          seen.add(identity);
          selected.push({ path: candidate, canonical, entry });
        }
      }
    } catch (error) {
      return { ok: false, output: `No items were moved. Refused path: ${validatingPath}. ${error instanceof Error ? error.message : "The recycle scope could not be verified."}` };
    }
    let quarantine: string;
    try {
      const root = path.join(this.scratch, "quarantine");
      await mkdir(root, { recursive: true });
      quarantine = await mkdtemp(path.join(root, "move-"));
    } catch (err) {
      return { ok: false, output: `Nothing moved: ${err instanceof Error ? err.message : "Cannot create quarantine."}` };
    }
    // Keep original names available for manual recovery after this process exits.
    const recoveryManifest = JSON.stringify({
      version: 1,
      entries: selected.map((item, index) => ({ quarantineName: String(index), originalPath: path.resolve(item.path) })),
    });
    const manifestPath = path.join(quarantine, "recovery.json");
    try {
      await writeFile(manifestPath, recoveryManifest, { flag: "wx", mode: 0o600, flush: true });
    } catch (err) {
      return { ok: false, output: `No items were moved. Cannot save recovery manifest: ${err instanceof Error ? err.message : "Write failed."}` };
    }
    const moved: Array<{ from: string; to: string; expectedDestination: string; restored: boolean; isDirectory: boolean }> = [];
    const failures: string[] = [];

    for (const [index, item] of selected.entries()) {
      const p = item.path;
      if (this.stopped || generation !== this.generation) {
        failures.push(`Stopped by user. ${selected.length - index} remaining item(s) were not moved.`);
        break;
      }
      try {
        const canonical = await validateRecyclePath(p, roots);
        if (path.relative(item.canonical, canonical) !== "") throw new Error("The selected target changed after validation. This item was not moved.");
        await checkRecycleAccess(p, canonical);
        const isDirectory = (await lstat(p)).isDirectory();
        const expectedDestination = path.join(await realpath(path.dirname(p)), path.basename(p));
        // Access checks await filesystem work. Recheck scope before starting the move.
        const current = await validateRecyclePath(p, roots);
        if (path.relative(item.canonical, current) !== "" || path.relative(item.entry, expectedDestination) !== "") {
          throw new Error("The selected target changed after validation. This item was not moved.");
        }
        if (this.stopped || generation !== this.generation) {
          failures.push(`Stopped by user. ${selected.length - index} remaining item(s) were not moved.`);
          break;
        }
        const dest = path.join(quarantine, String(index));
        // Cross-device moves fail safely. A copy alone is not a recycle operation.
        await rename(p, dest);
        moved.push({ from: p, to: dest, expectedDestination, restored: false, isDirectory });
      } catch (err) {
        const reason = (err as NodeJS.ErrnoException | null)?.code === "ENOENT"
          ? "This file or folder no longer exists. Nothing was moved for this item."
          : err instanceof Error ? err.message : "Move failed.";
        failures.push(`${p}: ${reason}`);
      }
    }

    const output = `Moved ${moved.length} item(s) to quarantine (Recycle-Bin style).` +
      (failures.length ? ` Failed ${failures.length}: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? `; and ${failures.length - 5} more failure(s).` : ""}` : "");
    if (moved.length === 0) return { ok: false, output };
    const jid = id();
    const created = new Map<string, { dev: number; ino: number }>();
    this.journal.push({
      id: jid,
      summary,
      undone: false,
      restoreProgress: () => ({ restored: moved.filter((m) => m.restored).length, total: moved.length }),
      pendingDirectories: () => moved.filter((m) => m.isDirectory && !m.restored).map((m) => m.expectedDestination),
      restore: async () => {
        const errors: string[] = [];
        const undoItems: NonNullable<HandsResult["undoItems"]> = [];
        for (const m of moved) {
          if (m.restored) continue;
          try {
            await restoreExclusive(m.to, m.from, created, async (destination) => {
              await validateRecyclePath(destination, roots);
              const actual = path.join(await canonicalLocation(path.dirname(destination)), path.basename(destination));
              const expected = path.resolve(m.expectedDestination, path.relative(m.from, destination));
              if (path.relative(expected, actual) !== "") {
                throw new Error("The original restore location changed. Recovery remains in quarantine.");
              }
            });
            m.restored = true;
          } catch (err) {
            let reason = restoreIssueReason(err);
            let folderHint: string | undefined;
            if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") {
              try { await lstat(path.dirname(m.from)); }
              catch (parentError) {
                if ((parentError as NodeJS.ErrnoException | null)?.code === "ENOENT") {
                  const later = this.journal.slice(this.journal.findIndex((entry) => entry.id === jid) + 1);
                  const folder = later.flatMap((entry) => entry.pendingDirectories?.() ?? []).find((candidate) => strictChild(candidate, m.expectedDestination));
                  if (folder) folderHint = `Undo the change that moved '${path.basename(folder)}' first, then try this one again.`;
                }
              }
            }
            if (folderHint) reason = folderHint;
            let recoveryPath: string | undefined;
            try { await lstat(m.to); recoveryPath = m.to; }
            catch { /* Do not claim that a missing or inaccessible copy is available. */ }
            undoItems.push({ name: path.basename(m.from), reason, ...(recoveryPath ? { recoveryPath } : {}) });
            const recoveryLabel = recoveryPath && (err as NodeJS.ErrnoException | null)?.code === "EEXIST" ? "Original copy kept at" : "Recovery location";
            errors.push(`${m.from}: ${folderHint ?? restoreErrorMessage(err)} ${recoveryLabel}: ${m.to}`);
          }
        }
        let restoreWarning: string | undefined;
        try {
          const remaining = moved.filter((m) => !m.restored).map((m) => ({
            quarantineName: path.basename(m.to), originalPath: path.resolve(m.from),
          }));
          // Replace only after a complete write, so a failed update keeps the previous mapping.
          const updatePath = path.join(quarantine, `recovery-update-${id()}.json`);
          await writeFile(updatePath, JSON.stringify({ version: 1, entries: remaining }), { flag: "wx", mode: 0o600, flush: true });
          await rename(updatePath, manifestPath);
        } catch (err) {
          errors.push(`Recovery list update failed: ${restoreErrorMessage(err)}`);
          if (undoItems.length === 0) {
            const explanation = (err as NodeJS.ErrnoException | null)?.code ? restoreErrorMessage(err) : "Check the detailed result before retrying the recovery list update.";
            restoreWarning = `Recovery list update failed. The files were restored. ${explanation}`;
          }
        }
        return {
          ok: undoItems.length === 0,
          output: errors.length ? `Restored ${moved.filter((m) => m.restored).length} of ${moved.length} item(s). ${errors.join("; ")} Recovery list: ${manifestPath}` : `Undid: ${summary}`,
          undoItems,
          restoreWarning,
        };
      },
    });
    return {
      ok: failures.length === 0,
      output,
      journalId: jid,
      undoToken: jid,
    };
  }

  async openSettings(uri: string): Promise<HandsResult> {
    if (!/^ms-settings:[a-z0-9-]*$/i.test(uri) || /[\r\n]/.test(uri)) return { ok: false, output: "Invalid Windows Settings URI." };
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
    if (entry.undone) return { ok: false, output: "Already undone.", undoState: "already_restored", restoreProgress: entry.restoreProgress?.() };
    if (!entry.restore) return { ok: false, output: "This change has no automatic restore operation." };
    if (this.pendingUndos.has(journalId)) return { ok: false, output: "Undo is already in progress.", undoState: "in_progress", restoreProgress: entry.restoreProgress?.() };
    this.pendingUndos.add(journalId);
    try {
      const result = await entry.restore();
      entry.undone = result.ok && !result.restoreWarning;
      return { ...result, journalId, restoreProgress: entry.restoreProgress?.() };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "Restore failed. Recovery remains in quarantine.", journalId, restoreProgress: entry.restoreProgress?.() };
    } finally {
      this.pendingUndos.delete(journalId);
    }
  }
}

export async function readScratchNote(file: string): Promise<string> {
  return readFile(file, "utf8");
}
