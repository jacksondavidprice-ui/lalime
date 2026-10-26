import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const state = vi.hoisted(() => ({ trashItem: vi.fn(), getPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { trashItem: state.trashItem }, app: { getPath: state.getPath } }));
let scratch: string;
let allowed: string;
let folder: string;
let file: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "lalime-recycle-dedupe-"));
  allowed = path.join(scratch, "Documents");
  folder = path.join(allowed, "Reports");
  mkdirSync(folder, { recursive: true });
  file = path.join(folder, "report.txt");
  writeFileSync(file, "Disposable content");
  state.trashItem.mockReset().mockResolvedValue(undefined);
  state.getPath.mockReset().mockImplementation((name: string) => {
    if (name === "documents") return allowed;
    throw new Error("Unavailable known folder");
  });
});
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

describe("Windows recycle deduplication", () => {
  it("recycles an exact duplicate once and reports one completed item", async () => {
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, file], "Recycle report");
    expect(result.ok).toBe(true);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(file);
    expect(result.output).toMatch(/^Moved 1 item/);
  });

  it("recycles one directory entry once when reached through a same-root parent junction", async () => {
    const alias = path.join(allowed, "Alias");
    symlinkSync(folder, alias, process.platform === "win32" ? "junction" : "dir");
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, path.join(alias, "report.txt")], "Recycle report");
    expect(result.ok).toBe(true);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(file);
    expect(result.output).toMatch(/^Moved 1 item/);
  });

  it.skipIf(process.platform !== "win32")("uses Windows case-insensitive identity", async () => {
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, file.toUpperCase()], "Recycle report");
    expect(result.ok).toBe(true);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(file);
    expect(result.output).toMatch(/^Moved 1 item/);
  });

  it("keeps a final junction entry distinct from the directory it points to", async () => {
    const alias = path.join(allowed, "Final Junction");
    symlinkSync(folder, alias, process.platform === "win32" ? "junction" : "dir");
    const result = await new WindowsHandsBridge().moveToRecycleBin([folder, alias], "Recycle two entries");
    expect(result.ok).toBe(true);
    expect(state.trashItem.mock.calls.map(([target]) => target)).toEqual([folder, alias]);
    expect(result.output).toMatch(/^Moved 2 item/);
  });
  it("validates an outside alias even if it resolves to an already selected file", async () => {
    const alias = path.join(scratch, "Outside Alias");
    symlinkSync(folder, alias, process.platform === "win32" ? "junction" : "dir");
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, path.join(alias, "report.txt")], "Invalid alias");
    expect(result.ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });

  it("validates a traversal alias before dropping duplicates", async () => {
    const alias = `${folder}${path.sep}..${path.sep}Reports${path.sep}report.txt`;
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, alias], "Invalid alias");
    expect(result.ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });

  it.each(["parent", "final"])("rejects a %s junction retargeted inside the allowed root between items", async (kind) => {
    const original = path.join(allowed, "Original Target");
    const replacement = path.join(allowed, "Replacement Target");
    mkdirSync(original);
    mkdirSync(replacement);
    writeFileSync(path.join(original, "second.txt"), "Original selected content");
    writeFileSync(path.join(replacement, "second.txt"), "Unselected replacement content");
    const alias = path.join(allowed, "Mutable Junction");
    symlinkSync(original, alias, process.platform === "win32" ? "junction" : "dir");
    const selected = kind === "parent" ? path.join(alias, "second.txt") : alias;
    state.trashItem.mockImplementationOnce(async () => {
      rmSync(alias, { recursive: true });
      symlinkSync(replacement, alias, process.platform === "win32" ? "junction" : "dir");
    });
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, selected], "Recycle selected entries");
    expect(result.ok).toBe(false);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(file);
    expect(result.output).toMatch(/1 completed item/);
    expect(result.output).toMatch(/changed/i);
    expect(result.completedItems).toBe(1);
  });
  it("checks Stop between unique entries and counts only completed unique items", async () => {
    const second = path.join(folder, "second.txt");
    writeFileSync(second, "Disposable content");
    const client = new WindowsHandsBridge();
    state.trashItem.mockImplementationOnce(async () => { client.stop(); client.resume(); });
    const result = await client.moveToRecycleBin([file, file, second], "Stop batch");
    expect(result.ok).toBe(false);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(file);
    expect(result.output).toMatch(/Stopped after 1 completed item/);
  });
});
