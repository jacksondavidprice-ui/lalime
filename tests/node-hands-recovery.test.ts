import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

vi.mock("node:child_process", () => ({
  execFile: (_file: unknown, _args: unknown, _options: unknown, callback: (error: null, result: unknown) => void) =>
    callback(null, { stdout: "Fixture command result", stderr: "" }),
}));

describe("NodeHands recoverable quarantine", () => {
  let root: string;
  let hands: NodeHands;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lalime-recovery-test-"));
    hands = new NodeHands(path.join(root, "journal"), [root]);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function file(relative: string, content: string) {
    const name = path.join(root, relative);
    await mkdir(path.dirname(name), { recursive: true });
    await writeFile(name, content);
    return name;
  }

  it("restores same-name files from separate folders without losing either", async () => {
    const desktop = await file("Desktop/report.txt", "desktop original");
    const downloads = await file("Downloads/report.txt", "downloads original");
    const result = await hands.moveToRecycleBin([desktop, downloads], "Recycle reports");
    expect(result.ok).toBe(true);
    await expect(readFile(desktop)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(downloads)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(desktop, "utf8")).toBe("desktop original");
    expect(await readFile(downloads, "utf8")).toBe("downloads original");
  });

  it("reports a missing-only request as failure with no undo claim", async () => {
    const result = await hands.moveToRecycleBin([path.join(root, "missing")], "Missing");
    expect(result.ok).toBe(false);
    expect(result.undoToken).toBeUndefined();
    expect(hands.listJournal()).toEqual([]);
  });

  it("preserves three same-name files from three separate folders", async () => {
    const originals = await Promise.all(["Desktop", "Downloads", "Documents"].map(async (folder) => ({
      name: await file(`${folder}/report.txt`, `${folder} original`), content: `${folder} original`,
    })));
    const result = await hands.moveToRecycleBin(originals.map((entry) => entry.name), "Three reports");
    expect(result.ok).toBe(true);
    for (const entry of originals) await expect(readFile(entry.name)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await hands.undo(result.undoToken!)).ok).toBe(true);
    for (const entry of originals) expect(await readFile(entry.name, "utf8")).toBe(entry.content);
  });

  it("reports partial failure while retaining recovery for successful moves", async () => {
    const source = await file("real.txt", "keep me");
    const result = await hands.moveToRecycleBin([source, path.join(root, "missing")], "Partial");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("1");
    expect(result.output).toContain("missing");
    expect(result.undoToken).toBe(result.journalId);
    expect(result.journalId).toBeTruthy();
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(source, "utf8")).toBe("keep me");
  });

  it("does not replace a new destination, retains failed recovery, and can retry", async () => {
    const source = await file("report.txt", "original");
    const result = await hands.moveToRecycleBin([source], "Report");
    await writeFile(source, "new work");
    const undo = await hands.undo(result.journalId!);
    expect(undo.ok).toBe(false);
    expect(undo.output).toContain("report.txt");
    expect(await readFile(source, "utf8")).toBe("new work");
    expect(hands.listJournal()[0].undone).toBe(false);
    await rename(source, path.join(root, "new-work.txt"));
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(source, "utf8")).toBe("original");
    expect(await readFile(path.join(root, "new-work.txt"), "utf8")).toBe("new work");
  });

  it("retains completed restores when another item fails and retries only pending items", async () => {
    const first = await file("first.txt", "first");
    const second = await file("second.txt", "second");
    const result = await hands.moveToRecycleBin([first, second], "Two");
    await writeFile(second, "new");
    expect((await hands.undo(result.journalId!)).ok).toBe(false);
    expect(await readFile(first, "utf8")).toBe("first");
    await rename(second, path.join(root, "new.txt"));
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(second, "utf8")).toBe("second");
  });

  it("restores nested directories and refuses existing destination directories", async () => {
    const source = path.join(root, "folder");
    await file("folder/nested/a.txt", "nested original");
    const result = await hands.moveToRecycleBin([source], "Folder");
    await mkdir(source);
    await file("folder/current.txt", "current");
    expect((await hands.undo(result.journalId!)).ok).toBe(false);
    expect(await readdir(source)).toEqual(["current.txt"]);
    await rename(source, path.join(root, "current-folder"));
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(path.join(source, "nested/a.txt"), "utf8")).toBe("nested original");
  });

  it("reports a restore filesystem failure without marking the journal undone", async () => {
    const source = await file("folder/a.txt", "original");
    const result = await hands.moveToRecycleBin([source], "Restore failure");
    await rename(path.dirname(source), path.join(root, "moved-parent"));
    expect((await hands.undo(result.journalId!)).ok).toBe(false);
    expect(hands.listJournal()[0].undone).toBe(false);
    await rename(path.join(root, "moved-parent"), path.dirname(source));
    expect((await hands.undo(result.journalId!)).ok).toBe(true);
    expect(await readFile(source, "utf8")).toBe("original");
  });

  it("does not advertise automatic recovery for commands with no restore operation", async () => {
    const result = await hands.runPowerShell("Write-Output fixture", "Fixture command");
    expect(result.ok).toBe(true);
    expect(result.undoToken).toBeUndefined();
    expect((await hands.undo(result.journalId!)).ok).toBe(false);
    expect(hands.listJournal()[0].undone).toBe(false);
  });
});
