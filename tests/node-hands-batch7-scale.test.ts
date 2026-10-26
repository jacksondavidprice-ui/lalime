import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const hooks = vi.hoisted(() => ({ writeFile: vi.fn(), rename: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), ...hooks,
}));
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

let root: string;
let allowed: string;
let hands: NodeHands;
beforeEach(async () => {
  hooks.writeFile.mockReset().mockImplementation(realFs.writeFile);
  hooks.rename.mockReset().mockImplementation(realFs.rename);
  root = await mkdtemp(path.join(os.tmpdir(), "lalime-batch7-"));
  allowed = path.join(root, "Documents"); await mkdir(allowed);
  hands = new NodeHands(path.join(root, "journal"), [allowed]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("recycles and restores a maximum-length basename without adding quarantine filename characters", async () => {
  const source = path.join(allowed, `${"n".repeat(251)}.txt`);
  const original = "Disposable maximum-basename content";
  await writeFile(source, original);
  const moved = await hands.moveToRecycleBin([source], "Long filename");
  expect(moved.ok).toBe(true);
  expect(moved.undoToken).toBeTruthy();
  await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await hands.undo(moved.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe(original);
  expect(hands.listJournal()).toEqual([{ id: moved.journalId, summary: "Long filename", undone: true }]);
});

function missingFiles(count: number) {
  return Array.from({ length: count }, (_, index) => path.join(allowed, `missing-${String(index).padStart(2, "0")}-marker.txt`));
}

it.each([5, 25])("reports the first five of %i failed moves and accurately counts omissions", async (count) => {
  const files = missingFiles(count);
  const result = await hands.moveToRecycleBin(files, "Missing files");
  expect(result.ok).toBe(false);
  expect(result.output).toContain("Moved 0 item(s)");
  expect(result.output).toContain(`Failed ${count}`);
  for (const file of files.slice(0, 5)) expect(result.output).toContain(path.basename(file));
  for (const file of files.slice(5)) expect(result.output).not.toContain(path.basename(file));
  if (count > 5) expect(result.output).toContain(`and ${count - 5} more`);
  else expect(result.output).not.toMatch(/\d+ more/);
  expect(result.journalId).toBeUndefined();
  expect(result.undoToken).toBeUndefined();
  expect(hands.listJournal()).toEqual([]);
});

it("bounds failure details without losing recovery for a partially completed batch", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "existing original");
  const missing = missingFiles(25);
  const result = await hands.moveToRecycleBin([source, ...missing], "Partial batch");
  expect(result.ok).toBe(false);
  expect(result.output).toContain("Moved 1 item(s)");
  expect(result.output).toContain("Failed 25");
  expect(result.output).toContain("and 20 more");
  for (const file of missing.slice(5)) expect(result.output).not.toContain(path.basename(file));
  expect(result.undoToken).toBeTruthy();
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("existing original");
});

it("persists a private recovery manifest before moving a long filename so a new process can identify it", async () => {
  const source = path.join(allowed, `${"r".repeat(251)}.txt`);
  await writeFile(source, "recoverable original");
  hooks.rename.mockImplementationOnce(async (from: string, to: string) => {
    const manifest = JSON.parse(await readFile(path.join(path.dirname(to), "recovery.json"), "utf8"));
    expect(manifest).toEqual({ version: 1, entries: [{ quarantineName: path.basename(to), originalPath: source }] });
    const write = hooks.writeFile.mock.calls.find(([file]) => path.basename(String(file)) === "recovery.json");
    expect(write?.[2]).toMatchObject({ flag: "wx", mode: 0o600 });
    await realFs.rename(from, to);
  });
  const result = await hands.moveToRecycleBin([source], "Durable recovery");
  expect(result.ok).toBe(true);
  const quarantineRoot = path.join(root, "journal", "quarantine");
  const batches = await readdir(quarantineRoot);
  expect(batches).toHaveLength(1);
  const batch = path.join(quarantineRoot, batches[0]);
  const manifestPath = path.join(batch, "recovery.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.entries[0].originalPath).toBe(source);
  expect(await readFile(path.join(batch, manifest.entries[0].quarantineName), "utf8")).toBe("recoverable original");
  expect(new NodeHands(path.join(root, "journal"), [allowed]).listJournal()).toEqual([]);
  if (process.platform !== "win32") expect((await stat(manifestPath)).mode & 0o777).toBe(0o600 & ~process.umask());
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("recoverable original");
});

it("moves nothing when its recovery manifest cannot be written", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "keep original");
  hooks.writeFile.mockImplementation(async (file, data, options) => {
    if (path.basename(String(file)) === "recovery.json") throw new Error("Fixture recovery manifest denied");
    return realFs.writeFile(file, data, options);
  });
  const result = await hands.moveToRecycleBin([source], "Manifest failure");
  expect(result.ok).toBe(false);
  expect(result.output).toMatch(/nothing moved|no items were moved/i);
  expect(result.output).toMatch(/manifest/i);
  expect(hooks.rename).not.toHaveBeenCalled();
  expect(await readFile(source, "utf8")).toBe("keep original");
  expect(hands.listJournal()).toEqual([]);
});

it("preserves partial recovery for a valid batch with a manifest larger than one MiB", async () => {
  const source = path.join(allowed, "existing.txt"); await writeFile(source, "keep original");
  const minimumEntryBytes = Buffer.byteLength(JSON.stringify({
    quarantineName: "1", originalPath: path.join(allowed, `0-${"m".repeat(240)}.txt`),
  }), "utf8") + 1;
  // Later indices add digits; this actual-path measurement is a lower bound per entry.
  const count = Math.ceil((1024 * 1024) / minimumEntryBytes) + 1;
  const missing = Array.from({ length: count }, (_, index) => path.join(allowed, `${index}-${"m".repeat(240)}.txt`));
  const result = await hands.moveToRecycleBin([source, ...missing], "Oversized recovery manifest");
  expect(result.ok).toBe(false);
  expect(result.output).toContain("Moved 1 item(s)");
  expect(result.output).toContain(`Failed ${count}`);
  expect(hooks.rename).toHaveBeenCalledTimes(1);
  const quarantineRoot = path.join(root, "journal", "quarantine");
  const batches = await readdir(quarantineRoot);
  const manifestText = await readFile(path.join(quarantineRoot, batches[0], "recovery.json"), "utf8");
  expect(Buffer.byteLength(manifestText, "utf8")).toBeGreaterThan(1024 * 1024);
  expect(JSON.parse(manifestText).entries.map((entry: { originalPath: string }) => entry.originalPath)).toEqual([source, ...missing]);
  expect((await hands.undo(result.undoToken!)).ok).toBe(true);
  expect(await readFile(source, "utf8")).toBe("keep original");
  expect(hands.listJournal()).toEqual([{ id: result.journalId, summary: "Oversized recovery manifest", undone: true }]);
}, 30000);
