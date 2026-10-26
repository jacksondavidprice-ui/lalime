import { contextBridge, ipcRenderer } from "electron";
import { IPC, type LalimeApi, type DemoScenarioId } from "../../shared/ipc.js";
import type { AppSnapshot, ApprovalChoice } from "../../shared/types.js";

const api: LalimeApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot) as Promise<AppSnapshot>,
  subscribe: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, snap: AppSnapshot): void => {
      cb(snap);
    };
    ipcRenderer.on(IPC.snapshot, listener);
    return () => ipcRenderer.removeListener(IPC.snapshot, listener);
  },
  completeOnboarding: () => ipcRenderer.invoke(IPC.completeOnboarding),
  setMode: (mode) => ipcRenderer.invoke(IPC.setMode, mode),
  signInDemo: () => ipcRenderer.invoke(IPC.signInDemo),
  signInChatgpt: () => ipcRenderer.invoke(IPC.signInChatgpt),
  signInApiKey: (apiKey: string) => ipcRenderer.invoke(IPC.signInApiKey, apiKey),
  sendMessage: (text: string) => ipcRenderer.invoke(IPC.sendMessage, text),
  respondApproval: (choice: ApprovalChoice, actionId?: string) =>
    ipcRenderer.invoke(IPC.respondApproval, choice, actionId),
  updateSettings: (settings) => ipcRenderer.invoke(IPC.updateSettings, settings),
  beginApprovalHold: (actionId) => ipcRenderer.invoke(IPC.beginApprovalHold, actionId),
  cancelApprovalHold: (actionId) => ipcRenderer.invoke(IPC.cancelApprovalHold, actionId),
  revokeTaskGrant: (grantId) => ipcRenderer.invoke(IPC.revokeTaskGrant, grantId),
  connectProvider: (apiKey) => ipcRenderer.invoke(IPC.connectProvider, apiKey),
  disconnect: () => ipcRenderer.invoke(IPC.disconnect),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  undo: (activityId: string) => ipcRenderer.invoke(IPC.undo, activityId),
  stop: () => ipcRenderer.invoke(IPC.stop),
  dismissBlocked: () => ipcRenderer.invoke(IPC.dismissBlocked),
  runDemoScenario: (id: DemoScenarioId) => ipcRenderer.invoke(IPC.runDemoScenario, id),
  writerSetKey: (key: string) => ipcRenderer.invoke(IPC.writerSetKey, key),
  writerClearKey: () => ipcRenderer.invoke(IPC.writerClearKey),
  writerStatus: () => ipcRenderer.invoke(IPC.writerStatus),
  writerCheckKey: () => ipcRenderer.invoke(IPC.writerCheckKey),
};

contextBridge.exposeInMainWorld("lalime", api);
