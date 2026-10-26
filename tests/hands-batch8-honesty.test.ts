import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const hooks = vi.hoisted(() => ({ writeFile: vi.fn(), trashItem: vi.fn(), getPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { trashItem: hooks.trashItem }, app: { getPath: hooks.getPath } }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(), writeFile: hooks.writeFile,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let files: string[];
let hands: NodeHands;
beforeEach(async () => {
  hooks.writeFile.mockReset().mockImplementation(realFs.writeFile);
  hooks.trashItem.mockReset().mockResolvedValue(undefined);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-batch8-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  files = ["one.txt", "two.txt", "three.txt"].map((name) => path.join(allowed, name));
  for (const file of files) await writeFile(file, `Original ${path.basename(file)}`);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
  hooks.getPath.mockReset().mockReturnValue(allowed);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function manifestPath() {
  const batches = await readdir(path.join(root, "journal", "quarantine"));
  return path.join(root, "journal", "quarantine", batches[0], "recovery.json");
}
async function entries(file: string) { return JSON.parse(await readFile(file, "utf8")).entries; }

it("drops all restored entries after a complete Undo", async () => {
  const moved = await hands.moveToRecycleBin(files, "Three files");
  const manifest = await manifestPath();
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await entries(manifest)).toEqual([]);
  for (const file of files) expect(await readFile(file, "utf8")).toBe(`Original ${path.basename(file)}`);
});

it("keeps only failed recovery entries and names the manifest after partial Undo", async () => {
  const moved = await hands.moveToRecycleBin(files, "Three files");
  const manifest = await manifestPath();
  await writeFile(files[1], "New file must survive");
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.output).toContain(`Recovery list: ${manifest}`);
  expect(await entries(manifest)).toEqual([{ quarantineName: "1", originalPath: files[1] }]);
  expect(await readFile(files[1], "utf8")).toBe("New file must survive");
  await rm(files[1]);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await entries(manifest)).toEqual([]);
  expect(await readFile(files[1], "utf8")).toBe("Original two.txt");
});

it("reports manifest update failure honestly, retains the previous mapping, and permits retry", async () => {
  const moved = await hands.moveToRecycleBin(files, "Three files");
  const manifest = await manifestPath();
  const before = await readFile(manifest, "utf8");
  hooks.writeFile.mockRejectedValueOnce(new Error("Fixture metadata write denied"));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.output).toContain(`Recovery list: ${manifest}`);
  expect(result.output).toContain("Fixture metadata write denied");
  expect(await readFile(manifest, "utf8")).toBe(before);
  expect(hands.listJournal()[0].undone).toBe(false);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await entries(manifest)).toEqual([]);
});

it("names the Node path that caused a whole-batch scope refusal", async () => {
  const outside = path.join(root, "outside.txt"); await writeFile(outside, "Outside content");
  const result = await hands.moveToRecycleBin([files[0], outside], "Mixed selection");
  expect(result.ok).toBe(false);
  expect(result.output).toContain(outside);
  expect(result.output).toMatch(/no items were moved/i);
  expect(await readFile(files[0], "utf8")).toBe("Original one.txt");
});

it("names a missing Windows path before moving anything", async () => {
  const missing = path.join(allowed, "missing.txt");
  const result = await new WindowsHandsBridge().moveToRecycleBin([files[0], missing], "Missing");
  expect(result.ok).toBe(false);
  expect(result.output).toContain(missing);
  expect(hooks.trashItem).not.toHaveBeenCalled();
});

it("names the Windows path that caused a whole-batch scope refusal", async () => {
  const outside = path.join(root, "outside.txt"); await writeFile(outside, "Outside content");
  const result = await new WindowsHandsBridge().moveToRecycleBin([files[0], outside], "Mixed selection");
  expect(result.ok).toBe(false);
  expect(result.output).toContain(outside);
  expect(result.output).toMatch(/no items were moved/i);
  expect(hooks.trashItem).not.toHaveBeenCalled();
});

it("names the unprocessed Windows paths after Stop during a batch", async () => {
  const bridge = new WindowsHandsBridge();
  hooks.trashItem.mockImplementationOnce(async () => { bridge.stop(); bridge.resume(); });
  const result = await bridge.moveToRecycleBin(files, "Stop after first");
  expect(result.ok).toBe(false);
  expect(result.completedItems).toBe(1);
  expect(result.output).toContain(files[1]);
  expect(result.output).toContain(files[2]);
  expect(hooks.trashItem).toHaveBeenCalledTimes(1);
});

it("names the Windows item that disappears after the preceding item completes", async () => {
  hooks.trashItem.mockImplementationOnce(async () => { await rm(files[1]); });
  const result = await new WindowsHandsBridge().moveToRecycleBin(files, "Disappearing item");
  expect(result.ok).toBe(false);
  expect(result.completedItems).toBe(1);
  expect(result.output).toContain(files[1]);
  expect(hooks.trashItem).toHaveBeenCalledTimes(1);
});

it("names the Windows item whose recycle operation fails", async () => {
  hooks.trashItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Fixture denied"));
  const result = await new WindowsHandsBridge().moveToRecycleBin(files, "Native refusal");
  expect(result.ok).toBe(false);
  expect(result.completedItems).toBe(1);
  expect(result.output).toContain(files[1]);
  expect(result.output).toMatch(/partly moved/i);
});
