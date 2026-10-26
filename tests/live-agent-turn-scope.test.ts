import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

it("rejects a retired turn while the next turn is starting", async () => {
  let release!: (value: { turnId: string }) => void;
  class Client extends EventEmitter {
    async startThread() { return "thread"; }
    startTurn = vi.fn(async () => ({ turnId: "old-turn" }));
    async interruptTurn() {}
    respondApproval() {}
    respondFileChangeApproval() {}
    respondToolCall = vi.fn();
  }
  const client = new Client();
  const hands = new MockHands();
  const list = vi.spyOn(hands, "listWindows");
  const host = new LiveAgentHost(client, hands);
  await host.runTurn("First request");
  await host.stop();
  client.startTurn.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const next = host.runTurn("Next request");
  await new Promise<void>((resolve) => setImmediate(resolve));
  client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { threadId: "thread", turnId: "old-turn", tool: "lalime_list_windows", arguments: {} } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(list).not.toHaveBeenCalled();
  expect(client.respondToolCall.mock.calls[0][1].success).toBe(false);
  release({ turnId: "new-turn" });
  await next;
  await host.stop();
});
