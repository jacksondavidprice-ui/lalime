import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ unlink: vi.fn(), symlink: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), unlink: hooks.unlink, symlink: hooks.symlink,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let originalLink: string;
let target: string;
let other: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.unlink.mockReset().mockImplementation(realFs.unlink);
  // Directory junctions work on Windows without symbolic-link privileges.
  hooks.symlink.mockReset().mockImplementation((source: string, destination: string) => realFs.symlink(source, destination, "junction"));
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-link-retry-"));
  target = path.join(root, "target"); other = path.join(root, "other");
  await mkdir(target); await mkdir(other);
  await writeFile(path.join(target, "note.txt"), "target original");
  await writeFile(path.join(other, "note.txt"), "other original");
  originalLink = path.join(root, "link");
  await symlink(target, originalLink, "junction");
  hands = new NodeHands(path.join(root, "journal"), [root]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function failFirstCleanup() {
  const moved = await hands.moveToRecycleBin([originalLink], "Move directory link");
  expect(moved.ok).toBe(true);
  hooks.unlink.mockRejectedValueOnce(Object.assign(new Error("Fixture cleanup denied"), { code: "EACCES" }));
  const first = await hands.undo(moved.undoToken!);
  expect(first.ok).toBe(false);
  expect(first.output).toContain("Permission was denied");
  expect(hands.listJournal()[0].undone).toBe(false);
  return moved.undoToken!;
}

it("finishes a symlink restore retry after quarantine cleanup fails without changing either target", async () => {
  const token = await failFirstCleanup();
  expect((await hands.undo(token)).ok).toBe(true);
  expect(hands.listJournal()[0].undone).toBe(true);
  expect(await readFile(path.join(originalLink, "note.txt"), "utf8")).toBe("target original");
  expect(await readFile(path.join(target, "note.txt"), "utf8")).toBe("target original");
  expect(await readFile(path.join(other, "note.txt"), "utf8")).toBe("other original");
});

it("does not remove or replace a different symlink installed before the retry", async () => {
  const token = await failFirstCleanup();
  const saved = path.join(root, "saved-restored-link");
  await realFs.rename(originalLink, saved);
  await symlink(other, originalLink, "junction");
  const expectedLink = await readlink(originalLink);
  expect((await hands.undo(token)).ok).toBe(false);
  expect(hands.listJournal()[0].undone).toBe(false);
  expect(await readlink(originalLink)).toBe(expectedLink);
  expect(await readFile(path.join(originalLink, "note.txt"), "utf8")).toBe("other original");
  expect(await readFile(path.join(target, "note.txt"), "utf8")).toBe("target original");
});
