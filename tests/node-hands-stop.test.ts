import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), rename: hooks.rename,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let hands: NodeHands;
let first: string;
let second: string;
beforeEach(async () => {
  hooks.rename.mockReset().mockImplementation(realFs.rename);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-stop-test-"));
  hands = new NodeHands(path.join(root, "journal"), [root]);
  first = path.join(root, "first.txt");
  second = path.join(root, "second.txt");
  await writeFile(first, "first original");
  await writeFile(second, "second original");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it.each([false, true])("stops later recycle moves after Stop while a rename is pending (resumed: %s)", async (resume) => {
  let entered!: () => void;
  let release!: () => void;
  const renameEntered = new Promise<void>((resolve) => { entered = resolve; });
  const renameReleased = new Promise<void>((resolve) => { release = resolve; });
  hooks.rename.mockImplementationOnce(async (source: string, destination: string) => {
    await realFs.rename(source, destination);
    entered();
    await renameReleased;
  });
  const pending = hands.moveToRecycleBin([first, second], "Two disposable files");
  await renameEntered;
  hands.stop();
  if (resume) hands.resume();
  release();
  const result = await pending;
  expect(hooks.rename).toHaveBeenCalledTimes(1);
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/stopped/i);
  expect(result.output).toContain("Moved 1");
  expect(result.journalId).toBeTruthy();
  expect(result.undoToken).toBe(result.journalId);
  expect(await readFile(second, "utf8")).toBe("second original");
  await expect(readFile(first)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await hands.undo(result.journalId!)).ok).toBe(true);
  expect(await readFile(first, "utf8")).toBe("first original");
  hands.resume();
  const next = await hands.moveToRecycleBin([second], "New operation");
  expect(next.ok).toBe(true);
  expect((await hands.undo(next.journalId!)).ok).toBe(true);
  expect(await readFile(second, "utf8")).toBe("second original");
});

it("does not revive a batch stopped and resumed during quarantine setup", async () => {
  const pending = hands.moveToRecycleBin([first, second], "Before any move");
  hands.stop();
  hands.resume();
  const result = await pending;
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/stopped/i);
  expect(result.undoToken).toBeUndefined();
  expect(hands.listJournal()).toEqual([]);
  expect(await readFile(first, "utf8")).toBe("first original");
  expect(await readFile(second, "utf8")).toBe("second original");
});
