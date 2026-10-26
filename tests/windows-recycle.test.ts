import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const state = vi.hoisted(() => ({ trashItem: vi.fn(), getPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { trashItem: state.trashItem }, app: { getPath: state.getPath } }));
const roots: string[] = [];
beforeEach(() => { state.trashItem.mockReset().mockResolvedValue(undefined); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lalime-recycle-test-"));
  roots.push(root);
  state.getPath.mockReturnValue(root);
  const files = ["one.txt", "two.txt", "three.txt"].map((name) => path.join(root, name));
  for (const file of files) writeFileSync(file, "Disposable test content");
  const client = new WindowsHandsBridge();
  // Prevent old native deletion from running during the red phase.
  const native = vi.spyOn(client as unknown as { call: (...args: unknown[]) => Promise<unknown> }, "call")
    .mockResolvedValue({ ok: true, output: "Native deletion", journalId: "fake-native-undo" });
  return { client, files, native };
}

describe("Windows recycle service", () => {
  it("uses Electron recycle-only behavior and never invents automatic undo", async () => {
    const { client, files, native } = fixture();
    const result = await client.moveToRecycleBin(files, "Recycle test files");
    expect(state.trashItem.mock.calls.map(([file]) => file)).toEqual(files);
    expect(native).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.journalId).toBeUndefined();
    expect(client.listJournal()).toEqual([]);
    expect(result.output).toMatch(/manually/i);
  });

  it("reports partial completion and never falls back to native deletion", async () => {
    const { client, files, native } = fixture();
    state.trashItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Recycling unavailable"));
    const result = await client.moveToRecycleBin(files, "Recycle test files");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/1.*completed/i);
    expect(state.trashItem).toHaveBeenCalledTimes(2);
    expect(native).not.toHaveBeenCalled();
  });

  it("does not start another item after Stop followed by resume", async () => {
    const { client, files } = fixture();
    let finish!: () => void;
    state.trashItem.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = client.moveToRecycleBin(files, "Recycle test files");
    await vi.waitFor(() => expect(state.trashItem).toHaveBeenCalledTimes(1));
    client.stop();
    client.resume();
    finish();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/stopped/i);
    expect(state.trashItem).toHaveBeenCalledTimes(1);
  });

  it.each([{ paths: [] }, { paths: ["relative.txt"] }, { paths: ["C:\\*"] }, { paths: ["C:\\bad\u0000name"] }])("rejects invalid paths before changing any file: %j", async ({ paths: files }) => {
    const { client, native } = fixture();
    expect((await client.moveToRecycleBin(files, "Invalid request")).ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it("preflights missing paths before recycling any item", async () => {
    const { client, files } = fixture();
    const result = await client.moveToRecycleBin([files[0], path.join(path.dirname(files[0]), "missing.txt")], "Missing file");
    expect(result.ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });

  it("rejects a new batch while stopped", async () => {
    const { client, files } = fixture();
    client.stop();
    expect((await client.moveToRecycleBin(files, "Stopped")).ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });
});
