/** Typed IPC channel names and payloads between preload and renderer. */

import type {
  ActivityEntry,
  AppSnapshot,
  ApprovalChoice,
  AuthStatus,
  ChatMessage,
  GuardianDecision,
  PendingApproval,
  PlanStep,
} from "./types.js";

export const IPC = {
  getSnapshot: "lalime:getSnapshot",
  subscribe: "lalime:subscribe",
  snapshot: "lalime:snapshot",
  completeOnboarding: "lalime:completeOnboarding",
  setMode: "lalime:setMode",
  signInDemo: "lalime:signInDemo",
  signInChatgpt: "lalime:signInChatgpt",
  signInApiKey: "lalime:signInApiKey",
  sendMessage: "lalime:sendMessage",
  respondApproval: "lalime:respondApproval",
  beginApprovalHold: "lalime:beginApprovalHold",
  cancelApprovalHold: "lalime:cancelApprovalHold",
  revokeTaskGrant: "lalime:revokeTaskGrant",
  undo: "lalime:undo",
  stop: "lalime:stop",
  dismissBlocked: "lalime:dismissBlocked",
  runDemoScenario: "lalime:runDemoScenario",
  writerSetKey: "lalime:writerSetKey",
  writerClearKey: "lalime:writerClearKey",
  writerStatus: "lalime:writerStatus",
  writerCheckKey: "lalime:writerCheckKey",
  updateSettings: "lalime:updateSettings",
  connectProvider: "lalime:connectProvider",
  retryConnectionCheck: "lalime:retryConnectionCheck",
  disconnect: "lalime:disconnect",
  copyText: "lalime:copyText",
  openRecoveryFolder: "lalime:openRecoveryFolder",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type DemoScenarioId =
  | "downloads_cleanup"
  | "wifi_fix"
  | "night_light"
  | "dangerous_block";

export interface LalimeApi {
  getSnapshot: () => Promise<AppSnapshot>;
  subscribe: (cb: (snap: AppSnapshot) => void) => () => void;
  completeOnboarding: () => Promise<void>;
  setMode: (mode: "demo" | "live") => Promise<void>;
  signInDemo: () => Promise<void>;
  signInChatgpt: () => Promise<{ ok: boolean; message?: string }>;
  signInApiKey: (apiKey: string) => Promise<{ ok: boolean; message?: string }>;
  sendMessage: (text: string) => Promise<void>;
  respondApproval: (choice: ApprovalChoice, actionId?: string) => Promise<boolean | void>;
  beginApprovalHold?: (actionId: string) => Promise<boolean>;
  cancelApprovalHold?: (actionId: string) => Promise<void>;
  revokeTaskGrant?: (grantId: string) => Promise<boolean>;
  updateSettings: (settings: Partial<import("./settings.js").AppSettings>) => Promise<{ ok: boolean; message?: string }>;
  connectProvider: (apiKey?: string) => Promise<{ ok: boolean; message?: string }>;
  retryConnectionCheck?: () => Promise<{ ok: boolean; message?: string }>;
  disconnect: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  openRecoveryFolder?: () => Promise<{ ok: boolean; message?: string }>;
  undo: (activityId: string) => Promise<void>;
  stop: () => Promise<void>;
  dismissBlocked: () => Promise<void>;
  runDemoScenario: (id: DemoScenarioId) => Promise<void>;
  writerSetKey: (key: string) => Promise<{ ok: boolean; message?: string }>;
  writerClearKey: () => Promise<void>;
  writerStatus: () => Promise<{
    enabled: boolean;
    keyHint: string | null;
    encryptedAtRest?: boolean;
    lastError?: string;
  }>;
  writerCheckKey: () => Promise<{ ok: boolean; message?: string }>;
}

export type {
  ActivityEntry,
  AppSnapshot,
  ApprovalChoice,
  AuthStatus,
  ChatMessage,
  GuardianDecision,
  PendingApproval,
  PlanStep,
};
