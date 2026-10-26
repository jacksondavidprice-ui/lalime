import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

it("contains a disconnected provider response without an unhandled rejection", async () => {
  class Client extends EventEmitter {
    async startThread() { return "thread"; }
    async startTurn() { return { turnId: "turn" }; }
    async interruptTurn() {}
    respondApproval() {}
    respondFileChangeApproval() {}
    respondToolCall() { throw new Error("Provider disconnected"); }
  }
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands());
  const status = vi.fn();
  host.on("status", status);
  await host.runTurn("Help");
  client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_list_windows", arguments: {} } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(status).toHaveBeenCalledWith("Provider disconnected");
  await host.stop();
});
