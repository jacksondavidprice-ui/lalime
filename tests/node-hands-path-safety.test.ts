import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ rename: vi.fn(), access: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), rename: hooks.rename, access: hooks.access,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let outside: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.rename.mockReset().mockImplementation(realFs.rename);
  hooks.access.mockReset().mockImplementation(realFs.access);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-path-test-"));
  allowed = path.join(root, "Documents");
  outside = path.join(root, "outside");
  await mkdir(allowed); await mkdir(outside);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("does not treat an arbitrary lalime folder as approved by default", async () => {
  const file = path.join(root, "lalime", "personal.txt");
  await mkdir(path.dirname(file)); await writeFile(file, "keep");
  const defaultHands = new NodeHands(path.join(root, "journal"));
  expect((await defaultHands.moveToRecycleBin([file], "No approved scope")).ok).toBe(false);
  expect(await readFile(file, "utf8")).toBe("keep");
  expect(hooks.rename).not.toHaveBeenCalled();
});

it("refuses a whole allowed folder root", async () => {
  await writeFile(path.join(allowed, "keep.txt"), "keep");
  expect((await hands.moveToRecycleBin([allowed], "Root")).ok).toBe(false);
  expect(await readFile(path.join(allowed, "keep.txt"), "utf8")).toBe("keep");
  expect(hooks.rename).not.toHaveBeenCalled();
});

it("rejects lexical parent traversal even when normalization returns inside the root", async () => {
  await mkdir(path.join(allowed, "nested"));
  const file = path.join(allowed, "keep.txt"); await writeFile(file, "keep");
  const traversal = `${allowed}${path.sep}nested${path.sep}..${path.sep}keep.txt`;
  expect((await hands.moveToRecycleBin([traversal], "Traversal")).ok).toBe(false);
  expect(await readFile(file, "utf8")).toBe("keep");
  expect(hooks.rename).not.toHaveBeenCalled();
});

it("preflights the entire batch before moving any allowed item", async () => {
  const good = path.join(allowed, "good.txt"); const bad = path.join(outside, "private.txt");
  await writeFile(good, "good"); await writeFile(bad, "private");
  const result = await hands.moveToRecycleBin([good, bad], "Mixed scope");
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/no items were moved/i);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(await readFile(good, "utf8")).toBe("good");
  expect(await readFile(bad, "utf8")).toBe("private");
  expect(hands.listJournal()).toEqual([]);
});

it("refuses a canonical junction escape", async () => {
  const bad = path.join(outside, "private.txt"); await writeFile(bad, "private");
  await symlink(outside, path.join(allowed, "linked"), "junction");
  expect((await hands.moveToRecycleBin([path.join(allowed, "linked", "private.txt")], "Linked scope")).ok).toBe(false);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(await readFile(bad, "utf8")).toBe("private");
});

it("rechecks canonical scope between moves and retains recovery for completed work", async () => {
  const first = path.join(allowed, "first.txt");
  const nested = path.join(allowed, "nested"); await mkdir(nested);
  const second = path.join(nested, "second.txt");
  await writeFile(first, "first"); await writeFile(second, "second");
  await writeFile(path.join(outside, "second.txt"), "private outside");
  hooks.rename.mockImplementationOnce(async (source: string, destination: string) => {
    await realFs.rename(source, destination);
    await realFs.rename(nested, path.join(allowed, "saved"));
    await symlink(outside, nested, "junction");
  });
  const result = await hands.moveToRecycleBin([first, second], "Scope changed");
  expect(result.ok).toBe(false);
  expect(hooks.rename).toHaveBeenCalledTimes(1);
  expect(await readFile(path.join(outside, "second.txt"), "utf8")).toBe("private outside");
  expect(await readFile(path.join(allowed, "saved", "second.txt"), "utf8")).toBe("second");
  expect(result.undoToken).toBeTruthy();
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(first, "utf8")).toBe("first");
});

it("rechecks scope after asynchronous permission checks and before rename", async () => {
  const nested = path.join(allowed, "nested"); await mkdir(nested);
  const selected = path.join(nested, "selected.txt"); await writeFile(selected, "selected");
  const privateFile = path.join(outside, "selected.txt"); await writeFile(privateFile, "private");
  hooks.access.mockImplementation(async (name: string, mode: number) => {
    await realFs.access(name, mode);
    if (name === nested) {
      await realFs.rename(nested, path.join(allowed, "saved"));
      await symlink(outside, nested, "junction");
    }
  });
  const result = await hands.moveToRecycleBin([selected], "Scope changed during checks");
  expect(result.ok).toBe(false);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(await readFile(privateFile, "utf8")).toBe("private");
  expect(await readFile(path.join(allowed, "saved", "selected.txt"), "utf8")).toBe("selected");
});

it.each(["outside", "another allowed folder"])("does not redirect Undo through a replacement junction to %s", async (destinationKind) => {
  const originalParent = path.join(allowed, "original"); await mkdir(originalParent);
  const source = path.join(originalParent, "report.txt"); await writeFile(source, "original report");
  const redirect = destinationKind === "outside" ? outside : path.join(allowed, "other");
  if (destinationKind !== "outside") await mkdir(redirect);
  const moved = await hands.moveToRecycleBin([source], "Recover report");
  expect(moved.ok).toBe(true);
  const savedParent = path.join(allowed, "saved-original");
  await realFs.rename(originalParent, savedParent);
  await symlink(redirect, originalParent, "junction");
  expect((await hands.undo(moved.undoToken!)).ok).toBe(false);
  await expect(readFile(path.join(redirect, "report.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(hands.listJournal()[0].undone).toBe(false);
  await rm(originalParent);
  await realFs.rename(savedParent, originalParent);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("original report");
});
