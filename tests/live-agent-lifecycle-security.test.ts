import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
describe("terminal turn boundaries", () => {
  it("invalidates pending consent when a provider turn completes", async () => {
    const client = new Client();
    const hands = new MockHands();
    const click = vi.spyOn(hands, "clickElement");
    const host = new LiveAgentHost(client, hands);
    let card: PendingApproval | undefined;
    host.on("approvalNeeded", (pending) => { card = pending; });
    await host.runTurn("Help");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Send", windowTitle: "Editor" } } });
    await flush();
    expect(card).toBeDefined();
    client.emit("turn/completed", { turn: { id: "turn", status: "interrupted" } });
    host.respondApproval("do_it", card!.action.id);
    await flush();
    expect(click).not.toHaveBeenCalled();
    expect(client.respondToolCall.mock.calls[0][1].success).toBe(false);
  });

  it("ignores message fragments after Stop", async () => {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands());
    const delta = vi.fn();
    const done = vi.fn();
    host.on("delta", delta);
    host.on("messageDone", done);
    await host.runTurn("Help");
    await host.stop();
    client.emit("item/agentMessage/delta", { turnId: "turn", delta: "late text" });
    client.emit("item/completed", { turnId: "turn", item: { type: "agentMessage", text: "late text" } });
    expect(delta).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("rejects missing UI targets before creating consent or dispatching", async () => {
    const client = new Client();
    const hands = new MockHands();
    const click = vi.spyOn(hands, "clickElement");
    const host = new LiveAgentHost(client, hands);
    const card = vi.fn();
    host.on("approvalNeeded", card);
    await host.runTurn("Help");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Send" } } });
    await flush();
    expect(card).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(client.respondToolCall.mock.calls[0][1].success).toBe(false);
    await host.stop();
  });
});
