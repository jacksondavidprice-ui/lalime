import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ link: vi.fn(), writeFile: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(), ...hooks,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let hands: NodeHands;
let files: string[];
beforeEach(async () => {
  hooks.link.mockReset().mockImplementation(realFs.link);
  hooks.writeFile.mockReset().mockImplementation(realFs.writeFile);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-undo-reporting-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  files = ["one.txt", `${"long".repeat(45)}.txt`, "three.txt"].map((name) => path.join(allowed, name));
  for (const file of files) await writeFile(file, `Original ${path.basename(file)}`);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function batchPath() {
  const folder = path.join(root, "journal", "quarantine");
  return path.join(folder, (await readdir(folder))[0]);
}

it("explains a destination collision without errno and returns cumulative progress across retries", async () => {
  const moved = await hands.moveToRecycleBin(files, "Three files");
  const batch = await batchPath();
  await writeFile(files[1], "Newer file must survive");
  const first = await hands.undo(moved.undoToken!);
  expect(first.ok).toBe(false);
  expect(first.output).not.toMatch(/EEXIST|\blink\s+'|errno/i);
  expect(first.restoreProgress).toEqual({ restored: 2, total: 3 });
  expect(first.output).toMatch(/already exists/i);
  expect(first.output).toMatch(/left untouched/i);
  expect(first.output).toContain(files[1]);
  expect(first.output).toContain(`Original copy kept at: ${path.join(batch, "1")}`);
  expect(first.output).toContain(path.join(batch, "recovery.json"));
  expect(await readFile(files[1], "utf8")).toBe("Newer file must survive");
  expect(await readFile(path.join(batch, "1"), "utf8")).toBe(`Original ${path.basename(files[1])}`);
  const second = await hands.undo(moved.undoToken!);
  expect(second.restoreProgress).toEqual({ restored: 2, total: 3 });
  expect(first.restoreProgress).toEqual({ restored: 2, total: 3 });
  await rm(files[1]);
  const third = await hands.undo(moved.undoToken!);
  expect(third.ok).toBe(true);
  expect(third.restoreProgress).toEqual({ restored: 3, total: 3 });
  expect((await hands.undo(moved.undoToken!)).restoreProgress).toEqual({ restored: 3, total: 3 });
});

it.each([
  ["EACCES", /permission/i],
  ["ENOENT", /no longer exists|missing/i],
  ["EIO", /read or write|storage/i],
])("translates %s into plain words and preserves the full recovery path", async (code, explanation) => {
  const moved = await hands.moveToRecycleBin([files[1]], "One file");
  const batch = await batchPath();
  hooks.link.mockRejectedValueOnce(Object.assign(new Error(`${code}: opaque syscall details`), { code }));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(explanation);
  expect(result.restoreProgress).toEqual({ restored: 0, total: 1 });
  expect(result.output).not.toContain(code);
  expect(result.output).not.toContain("opaque syscall");
  expect(result.output).toContain(files[1]);
  expect(result.output).toContain(path.join(batch, "0"));
  expect((await hands.undo(moved.undoToken!)).restoreProgress).toEqual({ restored: 1, total: 1 });
});

it("reports all restored files even when saving the recovery list fails", async () => {
  const moved = await hands.moveToRecycleBin(files, "Three files");
  hooks.writeFile.mockRejectedValueOnce(Object.assign(new Error("EACCES: opaque metadata syscall"), { code: "EACCES" }));
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/permission/i);
  expect(result.restoreProgress).toEqual({ restored: 3, total: 3 });
  expect(result.output).not.toContain("EACCES");
  expect(result.output).toContain(path.join(await batchPath(), "recovery.json"));
  const retry = await hands.undo(moved.undoToken!);
  expect(retry.ok).toBe(true);
  expect(retry.restoreProgress).toEqual({ restored: 3, total: 3 });
});

it("counts only moved journal entries when the original recycle batch partially failed", async () => {
  const moved = await hands.moveToRecycleBin([files[0], path.join(allowed, "missing.txt")], "Partial move");
  expect(moved.ok).toBe(false);
  const result = await hands.undo(moved.undoToken!);
  expect(result.ok).toBe(true);
  expect(result.restoreProgress).toEqual({ restored: 1, total: 1 });
});
