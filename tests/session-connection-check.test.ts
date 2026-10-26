import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({ directory: "", api: [] as any[], codex: [] as any[], check: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => state.directory }, shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("../electron/main/codex-client.js", () => ({ CodexAppServerClient: class extends EventEmitter {
  constructor() { super(); state.codex.push(this); }
  start = vi.fn(async () => {}); stop = vi.fn();
  startThread = vi.fn(async () => "check-thread");
  startTurn = vi.fn(async () => ({ turnId: "check-turn" }));
  interruptTurn = vi.fn(async () => {});
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
  readAccount = vi.fn(async () => ({ account: { type: "chatgpt", email: "person@example.test", planType: "plus" } }));
} }));
vi.mock("../electron/main/api-agent-client.js", () => ({ ApiAgentClient: class extends EventEmitter {
  constructor() { super(); state.api.push(this); }
  start = vi.fn(async () => {}); stop = vi.fn(); checkConnection = (...args: unknown[]) => state.check(...args);
} }));
import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";
const sessions: SessionController[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lime-connection-")); state.api = []; state.codex = []; state.check.mockReset().mockResolvedValue(undefined); });
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks(); });
function fixture(providerId = "ollama") {
  const session = new SessionController(new MockHands()); sessions.push(session);
  expect(session.updateSettings({ providerId, model: "fixture-model" }).ok).toBe(true);
  return session;
}

it("checks API model access before reporting ready, without adding chat messages", async () => {
  let finish!: () => void;
  state.check.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const session = fixture(); const connecting = session.connectProvider(); await flush();
  expect(state.check).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().connection).toEqual({ state: "checking", model: "fixture-model" });
  finish(); expect((await connecting).ok).toBe(true);
  expect(session.getSnapshot().connection).toEqual({ state: "ready", model: "fixture-model" });
  expect(session.getSnapshot().messages).toEqual([]);
});

it("reports a plain failure without exposing raw model errors, and can retry", async () => {
  state.check.mockRejectedValueOnce(new Error("Rejected secret-test-key from https://private.example"));
  const session = fixture(); expect((await session.connectProvider()).ok).toBe(false);
  expect(session.getSnapshot().connection).toMatchObject({ state: "failed", model: "fixture-model", reason: expect.any(String) });
  expect(JSON.stringify(session.getSnapshot())).not.toContain("secret-test-key");
  expect((await session.retryConnectionCheck()).ok).toBe(true);
  expect(session.getSnapshot().connection?.state).toBe("ready");
});

it("discards a successful check after disconnect", async () => {
  let finish!: () => void;
  state.check.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const session = fixture(); const connecting = session.connectProvider(); await flush();
  expect(state.check).toHaveBeenCalled(); session.disconnect(); finish(); await connecting;
  expect(session.getSnapshot().auth.state).toBe("signed_out");
  expect(session.getSnapshot().connection).toBeUndefined();
});

it("checks ChatGPT with no tools and reports provider account/plan only after a reply", async () => {
  const session = fixture("chatgpt"); const connecting = session.signInChatgpt(); await flush();
  const client = state.codex[0];
  expect(session.getSnapshot().connection?.state).toBe("checking");
  expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({ model: "fixture-model", dynamicTools: [] }));
  client.emit("item/completed", { threadId: "check-thread", turnId: "check-turn", item: { type: "agentMessage", text: "OK" } });
  client.emit("turn/completed", { threadId: "check-thread", turn: { id: "check-turn", status: "completed" } });
  await connecting;
  expect(session.getSnapshot().connection).toEqual({ state: "ready", model: "fixture-model", account: "person@example.test", plan: "plus" });
  expect(session.getSnapshot().messages).toEqual([]);
});

it("rejects tools attempted during the ChatGPT connection check", async () => {
  const session = fixture("chatgpt"); const connecting = session.signInChatgpt(); await flush();
  const client = state.codex[0];
  client.emit("serverRequest", { id: 23, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Settings" } } });
  await flush();
  expect(client.respondToolCall).toHaveBeenCalledWith(23, expect.objectContaining({ success: false }));
  session.disconnect(); await connecting;
  expect(session.getSnapshot().pendingApproval).toBeNull();
});

it("handles a closed transport while refusing a check tool without throwing from the event", async () => {
  const session = fixture("chatgpt"); const connecting = session.signInChatgpt(); await flush();
  const client = state.codex[0]; client.respondToolCall.mockImplementation(() => { throw new Error("private transport detail"); });
  expect(() => client.emit("serverRequest", { id: 24, method: "item/tool/call" })).not.toThrow();
  expect((await connecting).ok).toBe(false);
  expect(session.getSnapshot().connection?.state).toBe("failed");
  expect(JSON.stringify(session.getSnapshot())).not.toContain("private transport detail");
});

it("keeps a new task from starting during a connection retry", async () => {
  const session = fixture(); await session.connectProvider();
  let finish!: () => void; state.check.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const retry = session.retryConnectionCheck(); await flush();
  await session.sendMessage("Repair my printer");
  try { expect(session.getSnapshot().messages).toEqual([]); expect(session.getSnapshot().running).toBe(false); }
  finally { finish(); await retry; }
});

it("lets retry replace a stalled check without requiring a turn deadline", async () => {
  let finish!: () => void;
  state.check.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const session = fixture(); const first = session.connectProvider(); await flush();
  const retry = session.retryConnectionCheck(); await flush();
  try { expect(state.check).toHaveBeenCalledTimes(2); }
  finally { finish(); }
  expect((await first).ok).toBe(false); expect((await retry).ok).toBe(true);
  expect(session.getSnapshot().connection?.state).toBe("ready");
});

it("carries structured diagnosis to the snapshot and clears it for a new task", async () => {
  const session = fixture("chatgpt"); const connecting = session.signInChatgpt(); await flush();
  const client = state.codex[0];
  client.emit("item/completed", { threadId: "check-thread", turnId: "check-turn", item: { type: "agentMessage", text: "OK" } });
  client.emit("turn/completed", { threadId: "check-thread", turn: { id: "check-turn", status: "completed" } });
  await connecting; await session.sendMessage("My printer is stuck");
  const repairPlan = { symptom: "Printer is stuck", causes: [{ label: "Queued print job", likelihood: "likely", evidence: "Queue shows a waiting job" }], fixes: [{ label: "Restart the print service", cause: "Queued print job", status: "pending" }] };
  client.emit("serverRequest", { id: 30, method: "item/tool/call", params: { tool: "lalime_update_plan", arguments: repairPlan } });
  await flush(); expect(session.getSnapshot().repairPlan).toEqual(repairPlan);
  client.emit("turn/completed", { threadId: "check-thread", turn: { id: "check-turn", status: "completed" } }); await flush();
  client.startTurn.mockResolvedValue({ turnId: "next-turn" });
  await session.sendMessage("Now help with sound");
  expect(session.getSnapshot().repairPlan).toBeUndefined();
});
