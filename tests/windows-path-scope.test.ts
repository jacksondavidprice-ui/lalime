import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowsHandsBridge } from "../hands/src/windows-bridge.js";

const state = vi.hoisted(() => ({ trashItem: vi.fn(), getPath: vi.fn() }));
vi.mock("electron", () => ({ shell: { trashItem: state.trashItem }, app: { getPath: state.getPath } }));
let scratch: string;
let allowed: string;
let outside: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "lalime-path-scope-"));
  allowed = path.join(scratch, "Relocated Documents");
  outside = path.join(scratch, "private");
  mkdirSync(allowed);
  mkdirSync(outside);
  file = path.join(allowed, "safe.txt");
  writeFileSync(file, "Disposable content");
  writeFileSync(path.join(outside, "private.txt"), "Disposable content");
  state.trashItem.mockReset().mockResolvedValue(undefined);
  state.getPath.mockReset().mockImplementation((name: string) => {
    if (name === "documents") return allowed;
    throw new Error("Folder unavailable");
  });
});
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

describe("Windows recycle allowed roots", () => {
  it("accepts files inside the operating system's relocated Documents folder", async () => {
    expect((await new WindowsHandsBridge().moveToRecycleBin([file], "Recycle")).ok).toBe(true);
    expect(state.trashItem).toHaveBeenCalledWith(file);
  });

  it("allows a known folder that is itself redirected through a junction", async () => {
    const redirected = path.join(scratch, "Documents Redirect");
    symlinkSync(allowed, redirected, process.platform === "win32" ? "junction" : "dir");
    state.getPath.mockImplementation((name: string) => {
      if (name === "documents") return redirected;
      throw new Error("Folder unavailable");
    });
    const target = path.join(redirected, "safe.txt");
    expect((await new WindowsHandsBridge().moveToRecycleBin([target], "Recycle")).ok).toBe(true);
    expect(state.trashItem).toHaveBeenCalledWith(target);
  });
  it.each(["outside", "root", "traversal", "prefix", "junction"])("rejects %s before any item is recycled", async (kind) => {
    let target = path.join(outside, "private.txt");
    if (kind === "root") target = allowed;
    if (kind === "traversal") target = `${allowed}${path.sep}..${path.sep}private${path.sep}private.txt`;
    if (kind === "prefix") {
      const sibling = `${allowed}-private`;
      mkdirSync(sibling);
      target = path.join(sibling, "secret.txt");
      writeFileSync(target, "Disposable content");
    }
    if (kind === "junction") {
      const link = path.join(allowed, "linked-private");
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      target = path.join(link, "private.txt");
    }
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, target], "Recycle");
    expect(result.ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });

  it("fails closed when operating system roots cannot be discovered", async () => {
    state.getPath.mockImplementation(() => { throw new Error("Unavailable"); });
    expect((await new WindowsHandsBridge().moveToRecycleBin([file], "Recycle")).ok).toBe(false);
    expect(state.trashItem).not.toHaveBeenCalled();
  });

  it("rechecks a later path that becomes an escaping junction during a batch", async () => {
    const folder = path.join(allowed, "later");
    mkdirSync(folder);
    state.trashItem.mockImplementationOnce(async () => {
      rmSync(folder, { recursive: true });
      symlinkSync(outside, folder, process.platform === "win32" ? "junction" : "dir");
    });
    const result = await new WindowsHandsBridge().moveToRecycleBin([file, folder], "Recycle");
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/1.*completed/i);
    expect(state.trashItem).toHaveBeenCalledTimes(1);
  });
});
