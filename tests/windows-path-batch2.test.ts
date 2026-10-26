import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const state = vi.hoisted(() => ({ trashItem: vi.fn(), getPath: vi.fn(), roots: ["documents", "downloads", "desktop", "pictures", "videos", "music", "lalime"] }));
vi.mock("electron", () => ({ shell: { trashItem: state.trashItem }, app: { getPath: state.getPath } }));
vi.mock("../guardian/src/never-list.js", () => ({ ALLOWED_MUTATION_ROOTS: state.roots }));
let scratch: string;
let downloads: string;
let documents: string;
let outside: string;
let valid: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "lalime-path-batch2-"));
  downloads = path.join(scratch, "profile", "Downloads");
  documents = path.join(scratch, "profile", "Documents");
  outside = path.join(scratch, "outside");
  for (const folder of [downloads, documents, outside]) mkdirSync(folder, { recursive: true });
  valid = path.join(downloads, "safe.txt");
  for (const file of [valid, path.join(documents, "report.txt"), path.join(outside, "private.txt")]) writeFileSync(file, "Disposable fixture");
  state.roots.splice(0, state.roots.length, "documents", "downloads", "desktop", "pictures", "videos", "music", "lalime");
  state.trashItem.mockReset().mockResolvedValue(undefined);
  state.getPath.mockReset().mockImplementation((name: string) => {
    if (name === "downloads") return downloads;
    if (name === "documents") return documents;
    throw new Error("Unavailable known folder");
  });
});
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

async function rejectsBatch(target: string) {
  const result = await new WindowsHandsBridge().moveToRecycleBin([valid, target], "Recycle disposable fixtures");
  expect(result.ok).toBe(false);
  expect(state.trashItem).not.toHaveBeenCalled();
}

describe("Windows recycle batch boundary checks", () => {
  it("rejects lexical parent traversal even if it reaches another allowed folder", async () => {
    await rejectsBatch(`${downloads}${path.sep}..${path.sep}Documents${path.sep}report.txt`);
  });
  it("rejects lexical parent traversal even if it returns to the same allowed folder", async () => {
    mkdirSync(path.join(downloads, "child"));
    await rejectsBatch(`${downloads}${path.sep}child${path.sep}..${path.sep}safe.txt`);
  });
  it("rejects Downloads/../../outside before touching an earlier valid item", async () => {
    await rejectsBatch(`${downloads}${path.sep}..${path.sep}..${path.sep}outside${path.sep}private.txt`);
  });
  it("rejects the Downloads root itself", async () => { await rejectsBatch(downloads); });
  it("rejects mixed valid and direct outside targets before any recycling", async () => {
    await rejectsBatch(path.join(outside, "private.txt"));
  });
  it("rejects a canonical escape through a directory junction", async () => {
    const linked = path.join(downloads, "redirect");
    symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
    await rejectsBatch(path.join(linked, "private.txt"));
  });
  it("rechecks a later item after a path changes to an escaping junction", async () => {
    const target = path.join(downloads, "later");
    mkdirSync(target);
    state.trashItem.mockImplementationOnce(async () => {
      rmSync(target, { recursive: true });
      symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir");
    });
    const result = await new WindowsHandsBridge().moveToRecycleBin([valid, target], "Recycle disposable fixtures");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/1.*completed/i);
    expect(state.trashItem).toHaveBeenCalledExactlyOnceWith(valid);
  });
  it("honors Guardian's allowed root names instead of independently granting a removed root", async () => {
    state.roots.splice(0, state.roots.length, "documents");
    expect((await new WindowsHandsBridge().moveToRecycleBin([valid], "Recycle")).ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });
  it("does not interpret Guardian's lalime name as an arbitrary folder grant", async () => {
    const folder = path.join(scratch, "lalime");
    mkdirSync(folder);
    const file = path.join(folder, "data.txt");
    writeFileSync(file, "Disposable fixture");
    await rejectsBatch(file);
  });
  it("still accepts direct files from both approved known folders", async () => {
    const files = [valid, path.join(documents, "report.txt")];
    expect((await new WindowsHandsBridge().moveToRecycleBin(files, "Recycle fixtures")).ok).toBe(true);
    expect(state.trashItem.mock.calls.map(([file]) => file)).toEqual(files);
  });
});
