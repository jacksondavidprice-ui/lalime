import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const state = vi.hoisted(() => ({ root: "", trashItem: vi.fn() }));
vi.mock("electron", () => ({
  app: { getPath: () => state.root }, shell: { trashItem: state.trashItem },
}));
let files: string[];
beforeEach(() => {
  state.root = mkdtempSync(path.join(os.tmpdir(), "lalime-partial-count-"));
  files = ["one.txt", "two.txt"].map((name) => path.join(state.root, name));
  for (const file of files) writeFileSync(file, "Disposable fixture");
  state.trashItem.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { rmSync(state.root, { recursive: true, force: true }); });

describe("Windows recycle completion evidence", () => {
  it("returns the verified count when a later shell operation fails", async () => {
    state.trashItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Fixture failure"));
    const result = await new WindowsHandsBridge().moveToRecycleBin(files, "All files moved");
    expect(result).toMatchObject({ ok: false, completedItems: 1 });
    expect(result.undoToken).toBeUndefined();
    expect(state.trashItem).toHaveBeenCalledTimes(2);
  });

  it("reports zero completed items when the first shell operation fails", async () => {
    state.trashItem.mockRejectedValueOnce(new Error("Fixture failure"));
    const result = await new WindowsHandsBridge().moveToRecycleBin(files, "All files moved");
    expect(result).toMatchObject({ ok: false, completedItems: 0 });
    expect(state.trashItem).toHaveBeenCalledTimes(1);
  });

  it("returns the verified count when all operations complete", async () => {
    const result = await new WindowsHandsBridge().moveToRecycleBin(files, "All files moved");
    expect(result).toMatchObject({ ok: true, completedItems: 2 });
    expect(result.undoToken).toBeUndefined();
  });
});
