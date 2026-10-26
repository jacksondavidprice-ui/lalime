import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("electron", () => ({ clipboard, ipcMain: { handle: (name: string, callback: (...args: any[]) => unknown) => handlers.set(name, callback), removeHandler: (name: string) => handlers.delete(name) } }));
import { registerIpc } from "../electron/main/ipc.js";
import { IPC } from "../shared/ipc.js";

describe("IPC trust boundary", () => {
  const frame = {};
  const contents = { mainFrame: frame, send: vi.fn() };
  let controller: any;
  beforeEach(() => {
    handlers.clear();
    clipboard.writeText.mockClear();
    controller = Object.assign(new EventEmitter(), { sendMessage: vi.fn(), respondApproval: vi.fn(), getSnapshot: vi.fn() });
    registerIpc(controller, () => ({ webContents: contents }) as any);
  });
  it("copies bounded text only from the application frame without exposing clipboard reads", () => {
    const copy = handlers.get("lalime:copyText");
    expect(copy).toBeTypeOf("function");
    const event = { sender: contents, senderFrame: frame };
    copy!(event, "A synthetic reply");
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith("A synthetic reply");
    expect(() => copy!({ sender: {}, senderFrame: frame }, "bad")).toThrow();
    expect(() => copy!(event, "x".repeat(64001))).toThrow();
    expect(() => copy!(event, {})).toThrow();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign renderers and subframes before dispatch", () => {
    expect(() => handlers.get(IPC.sendMessage)!({ sender: {}, senderFrame: frame }, "hello")).toThrow();
    expect(() => handlers.get(IPC.sendMessage)!({ sender: contents, senderFrame: {} }, "hello")).toThrow();
    expect(controller.sendMessage).not.toHaveBeenCalled();
  });
  it("rejects invalid input and unbound approval replies", () => {
    const event = { sender: contents, senderFrame: frame };
    expect(() => handlers.get(IPC.sendMessage)!(event, { text: "hello" })).toThrow();
    expect(() => handlers.get(IPC.respondApproval)!(event, "do_it")).toThrow();
    expect(controller.respondApproval).not.toHaveBeenCalled();
  });
  it("dispatches a valid message from the application frame", () => {
    handlers.get(IPC.sendMessage)!({ sender: contents, senderFrame: frame }, "hello");
    expect(controller.sendMessage).toHaveBeenCalledWith("hello");
  });
});
