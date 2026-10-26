import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import { NodeHands } from "../hands/src/node-hands.js";

const ownedRoots: string[] = [];
afterEach(async () => {
  for (const root of ownedRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("recycles and restores 600 unique files within five seconds without losing content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lalime-large-batch-"));
  ownedRoots.push(root);
  const allowed = path.join(root, "Documents"); await mkdir(allowed);
  const entries = Array.from({ length: 600 }, (_, index) => ({
    file: path.join(allowed, `report-${index}.txt`),
    content: `Disposable original content ${index}\n`,
  }));
  await Promise.all(entries.map((entry) => writeFile(entry.file, entry.content)));
  const hands = new NodeHands(path.join(root, "journal"), [allowed]);
  const started = performance.now();
  const moved = await hands.moveToRecycleBin(entries.map((entry) => entry.file), "600 disposable files");
  const moveElapsed = performance.now() - started;
  expect(moved.ok).toBe(true);
  expect(moved.output).toContain("Moved 600 item(s)");
  expect(moved.undoToken).toBeTruthy();
  const restored = await hands.undo(moved.undoToken!);
  const elapsed = performance.now() - started;
  console.info(`NodeHands 600-file timing: move=${moveElapsed.toFixed(1)}ms undo=${(elapsed - moveElapsed).toFixed(1)}ms total=${elapsed.toFixed(1)}ms`);
  expect(restored.ok).toBe(true);
  expect(hands.listJournal()).toEqual([{ id: moved.journalId, summary: "600 disposable files", undone: true }]);
  const contents = await Promise.all(entries.map((entry) => readFile(entry.file, "utf8")));
  expect(contents).toEqual(entries.map((entry) => entry.content));
  expect(elapsed).toBeLessThan(5000);
}, 30000);
