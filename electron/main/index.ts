import { app, BrowserWindow, globalShortcut, shell } from "electron";
import { existsSync } from "node:fs";
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
  session = new SessionController();
  registerIpc(session, () => mainWindow);

  const ctx = pathContext();
  const iconPath = resolveWindowIcon(ctx);
  const preload = resolvePreloadScript(ctx);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 640,
    title: "Lalime",
    backgroundColor: "#f7f6f2",
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const distIndexHtml = resolveRendererIndexHtml(ctx);
  const target = resolveRendererLoad({
    env: process.env,
    distIndexHtml,
  });

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
