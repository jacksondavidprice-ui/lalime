import { ipcMain, type BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc.js";
import type { ApprovalChoice } from "../../shared/types.js";
import type { DemoScenarioId } from "../../shared/ipc.js";
import type { SessionController } from "./session.js";

export function registerIpc(
  session: SessionController,
  getWindow: () => BrowserWindow | null,
): void {
  const push = (): void => {
    getWindow()?.webContents.send(IPC.snapshot, session.getSnapshot());
  };
  session.on("snapshot", push);

  ipcMain.handle(IPC.getSnapshot, () => session.getSnapshot());
  ipcMain.handle(IPC.completeOnboarding, () => session.completeOnboarding());
  ipcMain.handle(IPC.setMode, (_e, mode: "demo" | "live") => session.setMode(mode));
  ipcMain.handle(IPC.signInDemo, () => session.signInDemo());
  ipcMain.handle(IPC.signInChatgpt, () => session.signInChatgpt());
  ipcMain.handle(IPC.signInApiKey, (_e, key: string) => session.signInApiKey(key));
  ipcMain.handle(IPC.sendMessage, (_e, text: string) => session.sendMessage(text));
  ipcMain.handle(IPC.respondApproval, (_e, choice: ApprovalChoice) =>
    session.respondApproval(choice),
  );
  ipcMain.handle(IPC.undo, (_e, activityId: string) => session.undo(activityId));
  ipcMain.handle(IPC.stop, () => session.stop());
  ipcMain.handle(IPC.dismissBlocked, () => session.dismissBlocked());
  ipcMain.handle(IPC.runDemoScenario, (_e, id: DemoScenarioId) =>
    session.runDemoScenario(id),
  );
  ipcMain.handle(IPC.writerSetKey, (_e, key: string) => session.writerSetKey(key));
  ipcMain.handle(IPC.writerClearKey, () => {
    session.writerClearKey();
  });
  ipcMain.handle(IPC.writerStatus, () => session.writerStatus());
  ipcMain.handle(IPC.writerCheckKey, () => session.writerCheckKey());
}
