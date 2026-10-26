import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => unknown>());
vi.mock("electron", () => ({ clipboard: {}, ipcMain: { handle: (name: string, callback: (...args: any[]) => unknown) => handlers.set(name, callback), removeHandler: (name: string) => handlers.delete(name) } }));
import { registerIpc } from "../electron/main/ipc.js";

it("binds hold and revoke operations to bounded IDs and the application frame", () => {
  const frame = {};
  const contents = { mainFrame: frame, send: vi.fn() };
  const controller = Object.assign(new EventEmitter(), { respondApproval: vi.fn(() => false), beginApprovalHold: vi.fn(() => true), cancelApprovalHold: vi.fn(), revokeTaskGrant: vi.fn(() => true) });
  registerIpc(controller as never, () => ({ webContents: contents }) as never);
  const event = { sender: contents, senderFrame: frame };
  for (const method of ["beginApprovalHold", "cancelApprovalHold", "revokeTaskGrant"] as const) {
    const handler = handlers.get(`lalime:${method}`);
    expect(handler).toBeTypeOf("function");
    expect(() => handler!(event, "")).toThrow();
    expect(() => handler!(event, "x".repeat(201))).toThrow();
    expect(() => handler!({ sender: contents, senderFrame: {} }, "action-1")).toThrow();
    handler!(event, "action-1");
    expect(controller[method]).toHaveBeenCalledExactlyOnceWith("action-1");
  }
  expect(handlers.get("lalime:respondApproval")!(event, "hold_confirmed", "action-1")).toBe(false);
  expect(controller.respondApproval).toHaveBeenCalledWith("hold_confirmed", "action-1");
});
