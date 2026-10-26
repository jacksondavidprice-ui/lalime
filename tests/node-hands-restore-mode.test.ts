import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ lstat: vi.fn(), mkdir: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), lstat: hooks.lstat, mkdir: hooks.mkdir,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let directory: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.lstat.mockReset().mockImplementation(realFs.lstat);
  hooks.mkdir.mockReset().mockImplementation(realFs.mkdir);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-restore-mode-"));
  directory = path.join(root, "private-folder");
  await mkdir(directory, { mode: 0o700 });
  await mkdir(path.join(directory, "nested"), { mode: 0o700 });
  await writeFile(path.join(directory, "nested", "note.txt"), "private original");
  hands = new NodeHands(path.join(root, "journal"), [root]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("requests private original permissions for every restored directory", async () => {
  hooks.lstat.mockImplementation(async (file: string) => {
    const result = await realFs.lstat(file);
    if (result.isDirectory() && file.includes(`${path.sep}quarantine${path.sep}`)) {
      result.mode = (result.mode & ~0o777) | 0o700;
    }
    return result;
  });
  const recycled = await hands.moveToRecycleBin([directory], "Private directory");
  expect(recycled.ok).toBe(true);
  hooks.mkdir.mockClear();
  expect((await hands.undo(recycled.undoToken!)).ok).toBe(true);
  const restored = hooks.mkdir.mock.calls.filter(([file]) => file === directory || file === path.join(directory, "nested"));
  expect(restored).toHaveLength(2);
  for (const [, options] of restored) expect(options).toMatchObject({ mode: 0o700 });
  expect(await readFile(path.join(directory, "nested", "note.txt"), "utf8")).toBe("private original");
});

it.skipIf(process.platform === "win32")("does not widen actual POSIX private-directory permissions on Undo", async () => {
  await chmod(directory, 0o700); await chmod(path.join(directory, "nested"), 0o700);
  const recycled = await hands.moveToRecycleBin([directory], "Private directory");
  expect(recycled.ok).toBe(true);
  expect((await hands.undo(recycled.undoToken!)).ok).toBe(true);
  expect((await stat(directory)).mode & 0o777).toBe(0o700 & ~process.umask());
  expect((await stat(path.join(directory, "nested"))).mode & 0o777).toBe(0o700 & ~process.umask());
  expect(await readFile(path.join(directory, "nested", "note.txt"), "utf8")).toBe("private original");
});
