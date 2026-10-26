import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ lstat: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), lstat: hooks.lstat,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let allowed: string;
let file: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.lstat.mockReset().mockImplementation(realFs.lstat);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-permission-test-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  file = path.join(allowed, "private.txt"); await writeFile(file, "private original");
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => {
  await chmod(allowed, 0o700).catch(() => {});
  await chmod(file, 0o600).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

it.each(["unreadable file", "read-only parent"])("fails closed for %s even if the process can rename it", async (condition) => {
  const target = condition === "unreadable file" ? file : allowed;
  const mode = condition === "unreadable file" ? 0 : 0o555;
  hooks.lstat.mockImplementation(async (name: string) => {
    const stat = await realFs.lstat(name);
    if (name === target) stat.mode = (stat.mode & ~0o777) | mode;
    return stat;
  });
  const result = await hands.moveToRecycleBin([file], condition);
  expect(result.ok).toBe(false);
  expect(result.undoToken).toBeUndefined();
  expect(await readFile(file, "utf8")).toBe("private original");
  expect(hands.listJournal()).toEqual([]);
});

it.skipIf(process.platform === "win32").each(["file", "parent"])("refuses actual POSIX permissions on %s", async (target) => {
  await chmod(target === "file" ? file : allowed, target === "file" ? 0 : 0o555);
  const result = await hands.moveToRecycleBin([file], "Restricted");
  expect(result.ok).toBe(false);
  expect(result.undoToken).toBeUndefined();
  await chmod(allowed, 0o700); await chmod(file, 0o600);
  expect(await readFile(file, "utf8")).toBe("private original");
});
