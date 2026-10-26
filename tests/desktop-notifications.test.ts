import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  windows: [] as any[], notifications: [] as any[], source: null as any,
  appEvents: new Map<string, (...args: any[]) => void>(),
  supported: true, failShow: false, throwSupported: false,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    focused = false; minimized = false; destroyed = false;
    isFocused = () => this.focused;
    isMinimized = () => this.minimized;
    isDestroyed = () => this.destroyed;
    restore = vi.fn(); show = vi.fn(); focus = vi.fn();
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
    });
    constructor(_options: unknown) { super(); state.windows.push(this); }
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    static getAllWindows() { return state.windows; }
  }
  class Notification extends EventEmitter {
    constructor(readonly options: unknown) { super(); state.notifications.push(this); }
    static isSupported() { if (state.throwSupported) throw new Error("OS unavailable"); return state.supported; }
    show = vi.fn(() => { if (state.failShow) throw new Error("OS unavailable"); });
    close = vi.fn();
  }
  return {
    app: { whenReady: async () => undefined, on: (event: string, fn: (...args: any[]) => void) => state.appEvents.set(event, fn), getAppPath: () => "/fixture", isPackaged: false, quit: vi.fn() },
    BrowserWindow: Window, Notification, nativeTheme: {},
    globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() }, shell: { openExternal: vi.fn() },
  };
});
vi.mock("../electron/main/session.js", async () => {
  const { EventEmitter } = await import("node:events");
  return { SessionController: class extends EventEmitter {
    constructor() { super(); state.source = this; }
    dispose = vi.fn(); stop = vi.fn();
  } };
});
vi.mock("../electron/main/ipc.js", () => ({ registerIpc: vi.fn() }));
vi.mock("../electron/main/app-paths.js", () => ({
  MAIN_MODULE_DIR: "/fixture/main", resolveHandsExePath: () => undefined,
  resolvePreloadScript: () => "/fixture/preload.js", resolveRendererIndexHtml: () => "/fixture/index.html", resolveWindowIcon: () => "/fixture/icon.png",
}));
vi.mock("../electron/main/renderer-load.js", () => ({ resolveRendererLoad: () => ({ type: "url", url: "http://127.0.0.1:43123" }) }));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function snapshot(change: Record<string, unknown> = {}) {
  state.source.emit("snapshot", { running: false, stopped: false, statusText: "Ready", pendingApproval: null, ...change });
}
function approval(id: string) {
  snapshot({ running: true, pendingApproval: { action: { id, payload: "PRIVATE COMMAND", summary: "PRIVATE TASK" }, decision: { plainEnglish: "PRIVATE REASON" } } });
}
beforeAll(async () => { await import("../electron/main/index.js"); await flush(); });
beforeEach(async () => {
  state.windows[0]?.emit("closed");
  state.windows.length = 0;
  state.notifications.length = 0;
  state.supported = true; state.failShow = false; state.throwSupported = false;
  state.appEvents.get("activate")?.();
  await flush();
});
afterEach(() => vi.restoreAllMocks());

describe("desktop notification integration", () => {
  it("notifies once per approval while unfocused without exposing task text", () => {
    approval("one"); approval("one"); approval("two");
    expect(state.notifications).toHaveLength(2);
    expect(JSON.stringify(state.notifications.map((n) => n.options))).not.toContain("PRIVATE");
    expect(state.notifications[0].options).toMatchObject({ title: "Lalime", body: expect.stringMatching(/approval/i) });
    expect(state.notifications[0].show).toHaveBeenCalledOnce();
  });

  it("does not notify while the window is focused", () => {
    state.windows[0].focused = true;
    approval("one");
    expect(state.notifications).toHaveLength(0);
  });

  it("restores and focuses the window on click without acting on the session", () => {
    approval("one");
    const window = state.windows[0]; window.minimized = true;
    expect(state.notifications).toHaveLength(1);
    state.notifications[0].emit("click");
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(state.source.stop).not.toHaveBeenCalled();
  });

  it("notifies once when a task completes successfully after at least 30 seconds", () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    snapshot({ running: true });
    clock.mockReturnValue(30000);
    snapshot({ statusText: "Done" }); snapshot({ statusText: "Done" });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].options).toMatchObject({ body: expect.stringMatching(/finished/i) });
  });

  it.each(["short", "stopped", "error"])("does not announce a %s task as completed", (kind) => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    snapshot({ running: true });
    clock.mockReturnValue(kind === "short" ? 29999 : 40000);
    snapshot({ stopped: kind === "stopped", statusText: kind === "error" ? "Something went wrong" : kind === "stopped" ? "Stopped" : "Done" });
    expect(state.notifications).toHaveLength(0);
  });

  it("handles unavailable notification support and OS failures safely", () => {
    state.supported = false;
    expect(() => approval("one")).not.toThrow();
    expect(state.notifications).toHaveLength(0);
    state.supported = true; state.throwSupported = true;
    expect(() => approval("two")).not.toThrow();
    state.throwSupported = false; state.failShow = true;
    expect(() => approval("three")).not.toThrow();
  });

  it("removes the snapshot listener and retires notifications when the window closes", () => {
    approval("one");
    expect((state.source as EventEmitter).listenerCount("snapshot")).toBe(1);
    state.windows[0].emit("closed");
    expect((state.source as EventEmitter).listenerCount("snapshot")).toBe(0);
    expect(state.notifications[0].close).toHaveBeenCalledOnce();
    approval("two");
    expect(state.notifications).toHaveLength(1);
    state.notifications[0].emit("click");
    expect(state.windows[0].focus).not.toHaveBeenCalled();
  });
});
