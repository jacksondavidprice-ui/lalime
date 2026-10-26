import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockHands } from "../hands/mock/index.js";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => state.directory },
  shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false },
}));
import { SessionController } from "../electron/main/session.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  stop = vi.fn();
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const sessions: SessionController[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-session-batch3-")); });
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  rmSync(state.directory, { recursive: true, force: true });
});
async function fixture() {
  const session = new SessionController(new MockHands());
  sessions.push(session);
  const client = new Client();
  session.attachLiveClient(client as never);
  await session.sendMessage("Help me with the selected task");
  return { session, client };
}
describe("batch 3 session integration", () => {
  it("sends untrusted UI text labeling through the actual provider response", async () => {
    const f = await fixture();
    f.client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_list_ui", arguments: { windowTitle: "Settings" } } });
    await flush();
    expect(f.client.respondToolCall).toHaveBeenCalledOnce();
    const response = f.client.respondToolCall.mock.calls[0][1];
    expect(response.success).toBe(true);
    const text = response.contentItems.map((item: { text?: string }) => item.text ?? "").join("\n");
    expect(text).toMatch(/untrusted/i);
    expect(text).toContain("Night light");
  });
  it("records a shell activity only on matching confirmed execution", async () => {
    const f = await fixture();
    const command = "Write-Output fixture";
    f.client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { itemId: "cmd-1", command } });
    await flush();
    expect(f.session.getSnapshot().pendingApproval).not.toBeNull();
    await f.session.respondApproval("do_it", f.session.getSnapshot().pendingApproval!.action.id);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledWith(1, "accept");
    expect(f.session.getSnapshot().activity).toHaveLength(0);
    f.client.emit("item/completed", { threadId: "thread", turnId: "turn", item: { id: "cmd-1", type: "commandExecution", command, status: "completed", exitCode: 0 } });
    expect(f.session.getSnapshot().activity).toHaveLength(1);
    expect(f.session.getSnapshot().activity[0].details).toBe(command);
  });
});
