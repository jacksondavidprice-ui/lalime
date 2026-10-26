import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const shell = vi.hoisted(() => ({ trashItem: vi.fn(), getPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { trashItem: shell.trashItem }, app: { getPath: shell.getPath } }));
let root: string;
let allowed: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-batch11-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  shell.trashItem.mockReset().mockResolvedValue(undefined);
  shell.getPath.mockReset().mockReturnValue(allowed);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function paths(count: number) { return Array.from({ length: count }, (_, index) => path.join(allowed, `item-${index}-marker.txt`)); }
function expectFive(output: string, selected: string[]) {
  for (const file of selected.slice(0, 5)) expect(output).toContain(file);
  for (const file of selected.slice(5)) expect(output).not.toContain(file);
  expect(output).toContain(`and ${selected.length - 5} more`);
}

it("shows five named Node failures in plain words, counts the rest, and preserves partial Undo", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "Keep original");
  const missing = paths(8);
  const hands = new NodeHands(path.join(root, "journal"), [allowed]);
  const result = await hands.moveToRecycleBin([source, ...missing], "Partial recycle");
  expect(result.ok).toBe(false);
  expect(result.output).toContain("Moved 1 item(s)");
  expect(result.output).toContain("Failed 8");
  expectFive(result.output, missing);
  expect(result.output).not.toMatch(/ENOENT|lstat|errno/);
  expect(result.output).toMatch(/no longer exists|missing/i);
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("Keep original");
});

it("shows five Windows missing paths and moves none of a mixed batch", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "Keep original");
  const missing = paths(8);
  const result = await new WindowsHandsBridge().moveToRecycleBin([source, ...missing], "Mixed missing");
  expect(result.ok).toBe(false);
  expectFive(result.output, missing);
  expect(result.output).toMatch(/no items were moved/i);
  expect(shell.trashItem).not.toHaveBeenCalled();
  expect(await readFile(source, "utf8")).toBe("Keep original");
});

it("shows five unprocessed Windows targets after Stop and preserves the actual completed count", async () => {
  const files = paths(9);
  for (const file of files) await writeFile(file, "Disposable fixture");
  const bridge = new WindowsHandsBridge();
  shell.trashItem.mockImplementationOnce(async () => { bridge.stop(); bridge.resume(); });
  const result = await bridge.moveToRecycleBin(files, "Stopped batch");
  expect(result.ok).toBe(false);
  expect(result.completedItems).toBe(1);
  expectFive(result.output, files.slice(1));
  expect(shell.trashItem).toHaveBeenCalledTimes(1);
});

it("retains the complete Node refused path and whole-batch no-move behavior", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "Keep original");
  const outside = path.join(root, "outside.txt"); await writeFile(outside, "Outside original");
  const result = await new NodeHands(path.join(root, "journal"), [allowed]).moveToRecycleBin([source, outside], "Scope refusal");
  expect(result.ok).toBe(false);
  expect(result.output).toContain(outside);
  expect(result.output).toMatch(/no items were moved/i);
  expect(await readFile(source, "utf8")).toBe("Keep original");
  expect(await readFile(outside, "utf8")).toBe("Outside original");
});
