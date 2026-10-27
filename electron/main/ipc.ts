import { clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { IPC, type DemoScenarioId } from "../../shared/ipc.js";
import type { ApprovalChoice } from "../../shared/types.js";
import type { SessionController } from "./session.js";
import { openRecoveryFolder } from "./recovery-folder.js";

function text(value: unknown, max = 32000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid input.");
  return value;
}

export function registerIpc(session: SessionController, getWindow: () => BrowserWindow | null): void {
  const push = (): void => { getWindow()?.webContents.send(IPC.snapshot, session.getSnapshot()); };
  session.on("snapshot", push);
  function handle(channel: string, callback: (...args: unknown[]) => unknown): void {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const window = getWindow();
      if (!window || event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error("Untrusted IPC sender.");
      }
      return callback(...args);
    });
  }
  handle(IPC.getSnapshot, () => session.getSnapshot());
  handle(IPC.completeOnboarding, () => session.completeOnboarding());
  handle(IPC.setMode, (mode) => {
    if (mode !== "live" && mode !== "demo") throw new Error("Invalid mode.");
    return session.setMode(mode);
  });
  handle(IPC.signInDemo, () => session.signInDemo());
  handle(IPC.signInChatgpt, () => session.signInChatgpt());
  handle(IPC.signInApiKey, (key) => session.signInApiKey(text(key, 4096)));
  handle(IPC.sendMessage, (message) => session.sendMessage(text(message)));
  handle(IPC.respondApproval, (choice, actionId) => {
    if (!["do_it", "not_now", "allow_for_task", "hold_confirmed"].includes(String(choice))) throw new Error("Invalid choice.");
    return session.respondApproval(choice as ApprovalChoice, text(actionId, 200));
  });
  handle(IPC.undo, (activityId) => session.undo(text(activityId, 200)));
  handle(IPC.beginApprovalHold, (actionId) => session.beginApprovalHold(text(actionId, 200)));
  handle(IPC.cancelApprovalHold, (actionId) => session.cancelApprovalHold(text(actionId, 200)));
  handle(IPC.revokeTaskGrant, (grantId) => session.revokeTaskGrant(text(grantId, 200)));
  handle(IPC.stop, () => session.stop());
  handle(IPC.dismissBlocked, () => session.dismissBlocked());
  handle(IPC.runDemoScenario, (id) => {
    if (!["downloads_cleanup", "wifi_fix", "night_light", "dangerous_block"].includes(String(id))) throw new Error("Invalid fixture.");
    return session.runDemoScenario(id as DemoScenarioId);
  });
  handle(IPC.writerStatus, () => session.writerStatus());
  handle(IPC.updateSettings, (settings) => session.updateSettings(settings));
  handle(IPC.connectProvider, (key) => session.connectProvider(key == null || key === "" ? undefined : text(key, 4096)));
  handle(IPC.retryConnectionCheck, (...args) => {
    if (args.length) throw new Error("Invalid input.");
    return session.retryConnectionCheck();
  });
  handle(IPC.disconnect, () => session.disconnect());
  handle(IPC.copyText, (value) => clipboard.writeText(text(value, 64000)));
  handle(IPC.openRecoveryFolder, (...args) => {
    if (args.length !== 0) throw new Error("Invalid input.");
    return openRecoveryFolder();
  });
}
