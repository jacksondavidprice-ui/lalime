import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class Client extends EventEmitter {
  async startThread() { return "thread"; }
  async startTurn() { return { turnId: "turn" }; }
  async interruptTurn() {}
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
async function setup() {
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands);
  const cards: PendingApproval[] = [];
  const activity = vi.fn();
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("activity", activity);
  await host.runTurn("Help with my computer");
  return { client, hands, host, cards, activity };
}

describe("truthful undo availability", () => {
  it.each([
    ["item/commandExecution/requestApproval", { command: "Get-Date" }],
    ["item/fileChange/requestApproval", { reason: "Change a file" }],
    ["item/tool/call", { tool: "lalime_open_settings", arguments: { uri: "ms-settings:display" } }],
    ["item/tool/call", { tool: "lalime_click", arguments: { name: "Apply", windowTitle: "Editor" } }],
    ["item/tool/call", { tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Demo\\Downloads\\file.txt"] } }],
  ])("does not promise undo in a %s approval without a restore token", async (method, params) => {
    const f = await setup();
    f.client.emit("serverRequest", { id: 1, method, params });
    await flush();
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].decision.undoable).toBe(false);
    await f.host.stop();
  });

  it.each([
    ["item/tool/call", { tool: "lalime_open_settings", arguments: { uri: "ms-settings:display" } }],
  ])("does not offer undo for a completed %s action", async (method, params) => {
    const f = await setup();
    f.client.emit("serverRequest", { id: 1, method, params });
    await flush();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(f.activity.mock.calls[0][0].undoable).toBe(false);
    await f.host.stop();
  });

  it("accepts an approved command without claiming that execution completed", async () => {
    const f = await setup();
    f.client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { command: "Get-Date" } });
    await flush();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledExactlyOnceWith(1, "accept");
    expect(f.activity).not.toHaveBeenCalled();
    await f.host.stop();
  });

  it.each([
    [{ ok: true, output: "Recycled" }, false],
    [{ ok: true, output: "Recycled", journalId: "restore-1" }, true],
    [{ ok: false, output: "Failed", journalId: "restore-1" }, false],
  ])("requires successful recycle and a restore token for undo: %j", async (result, undoable) => {
    const f = await setup();
    f.hands.moveToRecycleBin = async () => result;
    f.client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Demo\\Downloads\\file.txt"] } } });
    await flush();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    if (result.ok) {
      expect(f.activity.mock.calls[0][0].undoable).toBe(undoable);
    } else {
      expect(f.activity).not.toHaveBeenCalled();
    }
    await f.host.stop();
  });
});
