import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ link: vi.fn(), unlink: vi.fn(), writeFile: vi.fn(), lstat: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({ ...await original<typeof import("node:fs/promises")>(), ...hooks }));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.link.mockReset().mockImplementation(realFs.link);
  hooks.unlink.mockReset().mockImplementation(realFs.unlink);
  hooks.writeFile.mockReset().mockImplementation(realFs.writeFile);
  hooks.lstat.mockReset().mockImplementation(realFs.lstat);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-batch12-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function file(name: string, content = "Original content") {
  const target = path.join(allowed, name);
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  return target;
}
async function batch() {
  const location = path.join(root, "journal", "quarantine");
  return path.join(location, (await readdir(location))[0]);
}

it("returns basename issues with plain collision reasons and separate full recovery paths", async () => {
  const source = await file("nested/report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  await writeFile(source, "Newer content");
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.undoItems).toHaveLength(1);
  expect(result.undoItems![0].name).toBe("report.txt");
  expect(result.undoItems![0].reason).toMatch(/already exists.*left untouched/i);
  expect(result.undoItems![0].reason).not.toContain(root);
  expect(result.undoItems![0].reason).not.toContain("EEXIST");
  expect(result.undoItems![0].recoveryPath).toBe(path.join(await batch(), "0"));
  expect(result.output).toContain(source);
  expect(await readFile(source, "utf8")).toBe("Newer content");
});

it("reports restored files with a warning when only the manifest update fails and keeps metadata retry safe", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  const manifest = path.join(await batch(), "recovery.json");
  const before = await readFile(manifest, "utf8");
  hooks.writeFile.mockRejectedValueOnce(Object.assign(new Error("EACCES: private raw path"), { code: "EACCES" }));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(true);
  expect(result.restoreProgress).toEqual({ restored: 1, total: 1 });
  expect(result.undoItems ?? []).toEqual([]);
  expect(result.restoreWarning).toMatch(/recovery list.*permission/i);
  expect(result.restoreWarning).not.toContain("EACCES");
  expect(result.restoreWarning).not.toContain(root);
  expect(result.output).toContain(manifest);
  expect(await readFile(source, "utf8")).toBe("Original content");
  expect(await readFile(manifest, "utf8")).toBe(before);
  expect(hands.listJournal()[0].undone).toBe(false);
  const retry = await hands.undo(moved.undoToken!);
  expect(retry.ok).toBe(true);
  expect(retry.restoreWarning).toBeUndefined();
  expect(hooks.link).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(manifest, "utf8")).entries).toEqual([]);
});

it("does not claim that a missing quarantine copy is kept in recovery", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  await rm(path.join(await batch(), "0"));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.undoItems).toEqual([{ name: "report.txt", reason: expect.stringMatching(/no longer exists/i) }]);
  expect(result.restoreProgress).toEqual({ restored: 0, total: 1 });
});

it("does not describe an already restored file as unrestored when metadata throws an unclassified error", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  hooks.writeFile.mockRejectedValueOnce(new Error(`Metadata failure at ${root}`));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(true);
  expect(result.restoreWarning).toMatch(/files were restored/i);
  expect(result.restoreWarning).not.toMatch(/could not be restored/i);
  expect(result.restoreWarning).not.toContain(root);
});

it("identifies already restored and concurrently running Undo requests as no-ops", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  let entered!: () => void; let release!: () => void;
  const atLink = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  hooks.link.mockImplementationOnce(async (from, to) => { entered(); await released; return realFs.link(from, to); });
  const first = hands.undo(moved.undoToken!);
  await atLink;
  const concurrent = await hands.undo(moved.undoToken!);
  release();
  expect((await first).ok).toBe(true);
  expect(concurrent.undoState).toBe("in_progress");
  const repeated = await hands.undo(moved.undoToken!);
  expect(repeated.undoState).toBe("already_restored");
  expect(repeated.restoreProgress).toEqual({ restored: 1, total: 1 });
  expect(hooks.link).toHaveBeenCalledTimes(1);
});

it("asks to undo a later parent-folder move first, then restores both changes without loss", async () => {
  const source = await file("Reports/report.txt");
  await file("Reports/other.txt", "Other original");
  const movedFile = await hands.moveToRecycleBin([source], "Report file");
  const folder = path.dirname(source);
  const movedFolder = await hands.moveToRecycleBin([folder], "Reports folder");
  const result = await hands.undo(movedFile.undoToken!);
  const reason = "Undo the change that moved 'Reports' first, then try this one again.";
  expect(result.ok).toBe(false);
  expect(result.output).toContain(reason);
  expect(result.undoItems).toEqual([{ name: "report.txt", reason, recoveryPath: expect.any(String) }]);
  expect(result.restoreProgress).toEqual({ restored: 0, total: 1 });
  expect((await hands.undo(movedFolder.undoToken!)).ok).toBe(true);
  expect((await hands.undo(movedFile.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("Original content");
  expect(await readFile(path.join(folder, "other.txt"), "utf8")).toBe("Other original");
});

it("returns a plain per-item issue for denied quarantine cleanup and preserves retry", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  hooks.unlink.mockRejectedValueOnce(Object.assign(new Error("EACCES: raw details"), { code: "EACCES" }));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.undoItems![0]).toMatchObject({ name: "report.txt", reason: expect.stringMatching(/permission/i), recoveryPath: path.join(await batch(), "0") });
  expect(result.undoItems![0].reason).not.toContain("EACCES");
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("Original content");
});

it("refuses cleanup when quarantine mode bits forbid writes even if the process could bypass them", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  const quarantine = await batch();
  hooks.lstat.mockImplementation(async (target) => {
    const info = await realFs.lstat(target);
    if (String(target) === quarantine) info.mode &= ~0o222;
    return info;
  });
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.undoItems![0].reason).toMatch(/permission/i);
  expect(await readFile(path.join(quarantine, "0"), "utf8")).toBe("Original content");
  hooks.lstat.mockImplementation(realFs.lstat);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
});

it.skipIf(process.platform === "win32")("reports a read-only quarantine directory honestly and restores after permissions return", async () => {
  const source = await file("report.txt");
  const moved = await hands.moveToRecycleBin([source], "Report");
  const quarantine = await batch();
  await chmod(quarantine, 0o555);
  try {
    const result = await hands.undo(moved.undoToken!);
    expect(result.ok).toBe(false);
    expect(result.undoItems![0].reason).toMatch(/permission/i);
    expect(await readFile(path.join(quarantine, "0"), "utf8")).toBe("Original content");
  } finally { await chmod(quarantine, 0o755); }
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("Original content");
});
