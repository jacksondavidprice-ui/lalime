import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => state.directory }, shell: {}, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("../electron/main/writer-key.js", () => ({ loadWriterKey: () => undefined, describeWriter: () => ({ enabled: false }), setWriterLastError: vi.fn() }));
import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread"); startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => {}); stop = vi.fn();
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const sessions: SessionController[] = [];
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-output-")); });
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });
async function fixture() {
  const client = new Client(), session = new SessionController(new MockHands()); sessions.push(session);
  session.attachLiveClient(client as any); await session.sendMessage("Check the display");
  return { client, session };
}
for (const text of ["", "I'll start it.", "Let me check..."]) it(`uses a truthful activity fallback for final ${JSON.stringify(text)}`, async () => {
  const { client, session } = await fixture();
  client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_open_settings", arguments: { uri: "ms-settings:display" } } });
  // Opening Settings is tier 1 (Jackson, Oct 26): no card, it runs and is recorded.
  expect(session.getSnapshot().pendingApproval).toBeNull();
  await vi.waitFor(() => expect(session.getSnapshot().activity).toHaveLength(1));
  client.emit("item/completed", { item: { type: "agentMessage", text } });
  client.emit("turn/completed", { turn: { id: "turn", status: "completed" } });
  await vi.waitFor(() => expect(session.getSnapshot().running).toBe(false));
  const reply = session.getSnapshot().messages.at(-1)!.content;
  expect(reply).toMatch(/1 action.*What changed/i);
  expect(reply).toMatch(/could not confirm.*fixed/i);
  expect(reply).not.toMatch(/provider|I'll start|Let me check|nothing.*changed/i);
});
it("keeps raw Codex failure details out of chat", async () => {
  const { client, session } = await fixture();
  client.emit("turn/completed", { turn: { id: "turn", status: "failed", error: { message: "HTTP 400 private-key-detail Increase the token limit" } } });
  const reply = session.getSnapshot().messages.at(-1)!.content;
  expect(reply).toMatch(/problem talking to the AI service/i);
  expect(reply).not.toMatch(/400|private-key|token|model/i);
});
it("keeps raw Codex start failures out of chat", async () => {
  const client = new Client(), session = new SessionController(new MockHands()); sessions.push(session);
  client.startTurn.mockRejectedValue(new Error("HTTP 400 private-key-detail")); session.attachLiveClient(client as any);
  await session.sendMessage("Check the display");
  const reply = session.getSnapshot().messages.at(-1)!.content;
  expect(reply).toMatch(/problem talking to the AI service/i);
  expect(reply).not.toMatch(/400|private-key|Codex error/i);
});
it("keeps recorded work visible when a provider fails after a change", async () => {
  const { client, session } = await fixture();
  client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_open_settings", arguments: { uri: "ms-settings:display" } } });
  // Opening Settings is tier 1 (Jackson, Oct 26): no card, it runs and is recorded.
  expect(session.getSnapshot().pendingApproval).toBeNull();
  await vi.waitFor(() => expect(session.getSnapshot().activity).toHaveLength(1));
  client.emit("turn/completed", { turn: { id: "turn", status: "failed", error: { message: "HTTP 400" } } });
  const reply = session.getSnapshot().messages.at(-1)!.content;
  expect(reply).toMatch(/1 action.*What changed/i);
  expect(reply).toMatch(/could not confirm.*fixed/i);
  expect(reply).not.toMatch(/HTTP|nothing.*changed/i);
});
