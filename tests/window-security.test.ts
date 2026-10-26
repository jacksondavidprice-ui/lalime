import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  windows: [] as any[],
  appListeners: new Map<string, (...args: any[]) => void>(),
  openExternal: vi.fn(async () => undefined),
  registerIpc: vi.fn(),
  controller: vi.fn(),
  dispose: vi.fn(),
  permissionRequest: vi.fn(),
  permissionCheck: vi.fn(),
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: (handler: unknown) => { this.openHandler = handler; },
      session: { setPermissionRequestHandler: mock.permissionRequest, setPermissionCheckHandler: mock.permissionCheck },
    });
    openHandler: any;
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    constructor(_options: unknown) { super(); mock.windows.push(this); }
    static getAllWindows() { return mock.windows; }
  }
  return {
    app: {
      whenReady: async () => undefined,
      on: (event: string, listener: (...args: any[]) => void) => mock.appListeners.set(event, listener),
      getAppPath: () => "/lime",
      isPackaged: false,
      quit: vi.fn(),
    },
    BrowserWindow: Window,
    globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
    nativeTheme: {},
    shell: { openExternal: mock.openExternal },
  };
});
vi.mock("../electron/main/session.js", async () => {
  const { EventEmitter } = await import("node:events");
  return { SessionController: class extends EventEmitter {
    constructor() { super(); mock.controller(); }
    stop = vi.fn();
    dispose = mock.dispose;
  } };
});
vi.mock("../electron/main/ipc.js", () => ({ registerIpc: mock.registerIpc }));
vi.mock("../electron/main/app-paths.js", () => ({
  MAIN_MODULE_DIR: "/lime/main",
  resolveHandsExePath: () => undefined,
  resolvePreloadScript: () => "/lime/preload.js",
  resolveRendererIndexHtml: () => "/lime/index.html",
  resolveWindowIcon: () => "/lime/icon.png",
}));
vi.mock("../electron/main/renderer-load.js", () => ({ resolveRendererLoad: () => ({ type: "url", url: "http://127.0.0.1:43123" }) }));

beforeAll(async () => {
  await import("../electron/main/index.js");
  await new Promise<void>((resolve) => setImmediate(resolve));
});
beforeEach(() => mock.openExternal.mockClear());

describe("Electron window security", () => {
  it.each([
    "file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-settings:privacy", "http://example.com",
    "https://user:pass@example.com", "https://example.com:8443", "not a URL",
  ])("does not open unsafe external URL %s", (url) => {
    expect(mock.windows[0].openHandler({ url })).toEqual({ action: "deny" });
    expect(mock.openExternal).not.toHaveBeenCalled();
  });

  it("opens a valid HTTPS link in the system browser while denying a new renderer", () => {
    expect(mock.windows[0].openHandler({ url: "https://example.com/help?q=lime#intro" })).toEqual({ action: "deny" });
    expect(mock.openExternal).toHaveBeenCalledExactlyOnceWith("https://example.com/help?q=lime#intro");
  });

  it.each(["will-navigate", "will-redirect"])("blocks %s away from the application", (eventName) => {
    const preventDefault = vi.fn();
    mock.windows[0].webContents.emit(eventName, { preventDefault }, "https://example.com");
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("allows navigation within the loaded application document", () => {
    const preventDefault = vi.fn();
    mock.windows[0].webContents.emit("will-navigate", { preventDefault }, "http://127.0.0.1:43123/#settings");
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("blocks navigation of embedded frames to another document", () => {
    const preventDefault = vi.fn();
    mock.windows[0].webContents.emit("will-frame-navigate", { preventDefault, url: "https://example.com", isMainFrame: false });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("blocks webview attachment", () => {
    const preventDefault = vi.fn();
    mock.windows[0].webContents.emit("will-attach-webview", { preventDefault }, {}, {});
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("denies permission requests and permission checks", () => {
    expect(mock.permissionRequest).toHaveBeenCalled();
    expect(mock.permissionCheck).toHaveBeenCalled();
    const reply = vi.fn();
    mock.permissionRequest.mock.lastCall![0]({}, "media", reply, {});
    expect(reply).toHaveBeenCalledExactlyOnceWith(false);
    expect(mock.permissionCheck.mock.lastCall![0]({}, "media", "https://example.com", {})).toBe(false);
  });

  it("disposes the session when its window closes and on application quit", () => {
    mock.dispose.mockClear();
    mock.windows[0].emit("closed");
    expect(mock.dispose).toHaveBeenCalledOnce();
    mock.appListeners.get("before-quit")?.();
    expect(mock.dispose).toHaveBeenCalledTimes(2);
  });

  it("reopens a window without duplicate session or IPC registration", async () => {
    mock.windows.length = 0;
    mock.appListeners.get("activate")?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mock.windows).toHaveLength(1);
    expect(mock.controller).toHaveBeenCalledTimes(1);
    expect(mock.registerIpc).toHaveBeenCalledTimes(1);
  });
});
