import { app, BrowserWindow, globalShortcut, nativeTheme, shell } from "electron";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  MAIN_MODULE_DIR,
  resolveHandsExePath,
  resolvePreloadScript,
  resolveRendererIndexHtml,
  resolveWindowIcon,
  type AppPathContext,
} from "./app-paths.js";
import { SessionController } from "./session.js";
import { registerIpc } from "./ipc.js";
import { resolveRendererLoad } from "./renderer-load.js";
import { attachDesktopNotifications } from "./notifications.js";

function pathContext(): AppPathContext {
  return {
    mainModuleDir: MAIN_MODULE_DIR,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  };
}

/**
 * Wire Hands.exe into the environment before SessionController creates the bridge.
 * On Windows the product defaults to real Hands — no LALIME_HANDS env var required.
 */
function configureHandsEnv(): void {
  const ctx = pathContext();
  if (ctx.resourcesPath) {
    process.env.LALIME_RESOURCES_PATH = ctx.resourcesPath;
  }
  const exe = resolveHandsExePath(ctx);
  if (exe) {
    process.env.LALIME_HANDS_EXE = exe;
  }
  // Product default on Windows is Hands.exe; only honor explicit overrides.
  if (process.platform === "win32" && !process.env.LALIME_HANDS) {
    process.env.LALIME_HANDS = "windows";
  }
}

let mainWindow: BrowserWindow | null = null;
let session: SessionController | null = null;

async function createWindow(): Promise<void> {
  if (mainWindow) return;
  if (!session) {
    session = new SessionController();
    registerIpc(session, () => mainWindow);
  }

  const ctx = pathContext();
  const iconPath = resolveWindowIcon(ctx);
  const preload = resolvePreloadScript(ctx);

  // Dark native title bar so the frame matches the charcoal UI.
  nativeTheme.themeSource = "dark";

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    title: "Lalime",
    // Matches --color-paper so there is no light flash before first paint.
    backgroundColor: "#111113",
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const external = new URL(url);
      if (external.protocol === "https:" && !external.username && !external.password && !external.port) {
        void shell.openExternal(external.href).catch(() => undefined);
      }
    } catch {
      // An invalid link does not authorize an external application.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  const window = mainWindow;
  const detachNotifications = attachDesktopNotifications(session, window);
  window.on("closed", () => {
    detachNotifications();
    if (mainWindow === window) mainWindow = null;
    session?.dispose();
  });

  const distIndexHtml = resolveRendererIndexHtml(ctx);
  const target = resolveRendererLoad({
    env: process.env,
    distIndexHtml,
  });
  const appUrl = new URL(target.type === "url" ? target.url : pathToFileURL(target.path).href);
  appUrl.hash = "";
  const guardNavigation = (event: { preventDefault(): void }, destination: string) => {
    try {
      const next = new URL(destination);
      next.hash = "";
      if (next.href === appUrl.href) return;
    } catch {
      // Invalid destinations cannot load in the privileged application window.
    }
    event.preventDefault();
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);
  mainWindow.webContents.on("will-frame-navigate", (event) => guardNavigation(event, event.url));

  if (target.type === "url") {
    await mainWindow.loadURL(target.url);
  } else {
    if (!existsSync(target.path)) {
      throw new Error(
        `Missing ${target.path}. Run "npm run build" first, or use "npm run dev" for hot reload.`,
      );
    }
    await mainWindow.loadFile(target.path);
  }

  globalShortcut.register("CommandOrControl+Alt+Escape", () => {
    session?.stop();
  });
}

app.whenReady().then(() => {
  // Packaged builds must never enable scripted demo fixtures.
  if (app.isPackaged) {
    process.env.LALIME_PACKAGED = "1";
    delete process.env.LALIME_DEMO;
  }
  configureHandsEnv();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  session?.dispose();
  globalShortcut.unregisterAll();
});
