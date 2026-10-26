import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  openPath: vi.fn(), invoke: vi.fn(), expose: vi.fn(),
}));
vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: { openPath: mocks.openPath },
  ipcMain: {
    handle: (name: string, callback: (...args: any[]) => any) => mocks.handlers.set(name, callback),
    removeHandler: (name: string) => mocks.handlers.delete(name),
  },
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke, on: vi.fn(), removeListener: vi.fn() },
}));
import { registerIpc } from "../electron/main/ipc.js";

describe("fixed recovery folder IPC", () => {
  const frame = {};
  const contents = { mainFrame: frame, send: vi.fn() };
  const event = { sender: contents, senderFrame: frame };
  let temporary: string;
  let root: string;
  let recovery: string;
  const handler = () => {
    const callback = mocks.handlers.get("lalime:openRecoveryFolder");
    expect(callback, "host must register the recovery-folder action").toBeTypeOf("function");
    return callback!;
  };

  beforeEach(() => {
    temporary = mkdtempSync(path.join(os.tmpdir(), "lalime-recovery-ipc-test-"));
    vi.spyOn(os, "tmpdir").mockReturnValue(temporary);
    root = path.join(temporary, "lalime-hands");
    recovery = path.join(root, "quarantine");
    mocks.handlers.clear();
    mocks.openPath.mockReset().mockResolvedValue("");
    mocks.invoke.mockReset().mockResolvedValue({ ok: true });
    const session = Object.assign(new EventEmitter(), { getSnapshot: vi.fn() });
    registerIpc(session as any, () => ({ webContents: contents }) as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens only the existing default quarantine directory", async () => {
    mkdirSync(recovery, { recursive: true });
    expect(await handler()(event)).toEqual({ ok: true });
    expect(mocks.openPath).toHaveBeenCalledExactlyOnceWith(recovery);
  });

  it.each(["foreign sender", "subframe", "missing frame"])("rejects %s before opening", (kind) => {
    mkdirSync(recovery, { recursive: true });
    const untrusted = kind === "foreign sender" ? { sender: {}, senderFrame: frame }
      : { sender: contents, senderFrame: kind === "subframe" ? {} : null };
    expect(() => handler()(untrusted)).toThrow("Untrusted IPC sender.");
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it.each(["C:\\Users\\Other", undefined, { path: "elsewhere" }])("rejects an extra renderer argument %j", (argument) => {
    mkdirSync(recovery, { recursive: true });
    expect(() => handler()(event, argument)).toThrow("Invalid input.");
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("reports an absent folder without creating it", async () => {
    expect(await handler()(event)).toEqual({ ok: false, message: "There are no recovery files yet." });
    expect(existsSync(root)).toBe(false);
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it.each(["root", "quarantine"])("rejects a redirected %s directory", async (location) => {
    const outside = path.join(temporary, "outside");
    mkdirSync(path.join(outside, "quarantine"), { recursive: true });
    if (location === "root") symlinkSync(outside, root, "junction");
    else {
      mkdirSync(root);
      symlinkSync(outside, recovery, "junction");
    }
    expect(await handler()(event)).toEqual({ ok: false, message: "The recovery folder could not be opened safely." });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it.each(["root", "quarantine"])("rejects a regular file at %s", async (location) => {
    if (location === "quarantine") mkdirSync(root);
    writeFileSync(location === "root" ? root : recovery, "fixture");
    expect(await handler()(event)).toEqual({ ok: false, message: "The recovery folder could not be opened safely." });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])("reports a %s open error without exposing OS details", async (kind) => {
    mkdirSync(recovery, { recursive: true });
    if (kind === "returned") mocks.openPath.mockResolvedValue("private OS detail");
    else mocks.openPath.mockRejectedValue(new Error("private OS detail"));
    expect(await handler()(event)).toEqual({ ok: false, message: "The recovery folder could not be opened." });
  });

  it("exposes a zero-argument preload method", async () => {
    await import("../electron/preload/index.js");
    const api = mocks.expose.mock.calls.find(([name]) => name === "lalime")?.[1];
    expect(api?.openRecoveryFolder).toBeTypeOf("function");
    expect(await api.openRecoveryFolder("renderer-supplied-path")).toEqual({ ok: true });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("lalime:openRecoveryFolder");
  });
});
