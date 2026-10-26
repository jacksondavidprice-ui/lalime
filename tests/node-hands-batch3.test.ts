import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ link: vi.fn(), rename: vi.fn(), access: vi.fn(), symlink: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), ...hooks,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.link.mockReset().mockImplementation(realFs.link);
  hooks.rename.mockReset().mockImplementation(realFs.rename);
  hooks.access.mockReset().mockImplementation(realFs.access);
  hooks.symlink.mockReset().mockImplementation((target: string, destination: string) => realFs.symlink(target, destination, "junction"));
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-batch3-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function file(name: string, content = name) {
  const selected = path.join(allowed, name);
  await mkdir(path.dirname(selected), { recursive: true });
  await writeFile(selected, content);
  return selected;
}

it("runs exactly one concurrent Undo for a three-file journal", async () => {
  const files = await Promise.all(["one.txt", "two.txt", "three.txt"].map((name) => file(name)));
  const result = await hands.moveToRecycleBin(files, "Three files");
  let entered!: () => void; let release!: () => void;
  const atLink = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  hooks.link.mockImplementationOnce(async (source: string, destination: string) => {
    entered(); await released; await realFs.link(source, destination);
  });
  const first = hands.undo(result.undoToken!);
  await atLink;
  const second = await hands.undo(result.undoToken!);
  release();
  const firstResult = await first;
  expect(firstResult.ok).toBe(true);
  expect(second.ok).toBe(false);
  expect(second.output).toMatch(/in progress|already undone/i);
  expect(hooks.link).toHaveBeenCalledTimes(3);
  expect(hands.listJournal()[0].undone).toBe(true);
  for (const selected of files) expect(await readFile(selected, "utf8")).toBe(path.basename(selected));
});

it("releases its Undo lock after a real failure so pending items can be retried", async () => {
  const files = await Promise.all(["one.txt", "two.txt", "three.txt"].map((name) => file(name)));
  const moved = await hands.moveToRecycleBin(files, "Retry files");
  hooks.link.mockRejectedValueOnce(new Error("Fixture restore failure"));
  expect((await hands.undo(moved.undoToken!)).ok).toBe(false);
  expect(hands.listJournal()[0].undone).toBe(false);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  for (const selected of files) expect(await readFile(selected, "utf8")).toBe(path.basename(selected));
});

it("moves exact duplicates and a same-root parent-junction alias only once", async () => {
  const selected = await file("original/report.txt", "report original");
  const aliasParent = path.join(allowed, "alias");
  await symlink(path.dirname(selected), aliasParent, "junction");
  const result = await hands.moveToRecycleBin([selected, selected, path.join(aliasParent, "report.txt")], "One physical entry");
  expect(result.ok).toBe(true);
  expect(result.output).toContain("Moved 1 item(s)");
  expect(hooks.rename).toHaveBeenCalledTimes(1);
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(selected, "utf8")).toBe("report original");
  expect(await readFile(path.join(aliasParent, "report.txt"), "utf8")).toBe("report original");
});

it("validates an unsafe duplicate alias before deduplication and moves nothing", async () => {
  const selected = await file("original/report.txt", "report original");
  const unsafe = path.join(root, "outside-alias");
  await symlink(path.dirname(selected), unsafe, "junction");
  const result = await hands.moveToRecycleBin([selected, path.join(unsafe, "report.txt")], "Unsafe alias");
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/no items were moved/i);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(hands.listJournal()).toEqual([]);
  expect(await readFile(selected, "utf8")).toBe("report original");
});

it("keeps a final symlink and its target as separate directory entries", async () => {
  const content = await file("target/report.txt", "target report");
  const target = path.dirname(content);
  const alias = path.join(allowed, "final-link"); await symlink(target, alias, "junction");
  const moved = await hands.moveToRecycleBin([alias, target], "Two directory entries");
  expect(moved.ok).toBe(true);
  expect(moved.output).toContain("Moved 2 item(s)");
  expect(hooks.rename).toHaveBeenCalledTimes(2);
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await readFile(content, "utf8")).toBe("target report");
  expect(await readFile(path.join(alias, "report.txt"), "utf8")).toBe("target report");
});

it("does not move a canonical target that changes to another allowed folder after preflight", async () => {
  const first = await file("first.txt", "first");
  const target = await file("original/report.txt", "original");
  const other = await file("other/report.txt", "other");
  const alias = path.join(allowed, "alias"); await symlink(path.dirname(target), alias, "junction");
  hooks.rename.mockImplementationOnce(async (source: string, destination: string) => {
    await realFs.rename(source, destination);
    await rm(alias); await symlink(path.dirname(other), alias, "junction");
  });
  const result = await hands.moveToRecycleBin([first, path.join(alias, "report.txt")], "Canonical changed");
  expect(result.ok).toBe(false);
  expect(hooks.rename).toHaveBeenCalledTimes(1);
  expect(await readFile(target, "utf8")).toBe("original");
  expect(await readFile(other, "utf8")).toBe("other");
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
});

it("rechecks canonical identity after access checks even when the new target remains allowed", async () => {
  const target = await file("original/report.txt", "original");
  const other = await file("other/report.txt", "other");
  const alias = path.join(allowed, "alias"); await symlink(path.dirname(target), alias, "junction");
  hooks.access.mockImplementation(async (selected: string, mode: number) => {
    await realFs.access(selected, mode);
    if (selected === path.dirname(target)) {
      await rm(alias); await symlink(path.dirname(other), alias, "junction");
    }
  });
  const result = await hands.moveToRecycleBin([path.join(alias, "report.txt")], "Canonical changed in check");
  expect(result.ok).toBe(false);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(await readFile(target, "utf8")).toBe("original");
  expect(await readFile(other, "utf8")).toBe("other");
});
