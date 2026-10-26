import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
it.each([
  ["unknown_tool", {}],
  ["lalime_run_powershell", { cmd: 42 }],
])("returns %s validation errors to Codex without ending the turn", async (tool, args) => {
  const client = Object.assign(new EventEmitter(), {
    startThread: vi.fn(async () => "thread"), startTurn: vi.fn(async () => ({ turnId: "turn" })),
    interruptTurn: vi.fn(async () => {}), respondApproval: vi.fn(), respondFileChangeApproval: vi.fn(), respondToolCall: vi.fn(),
  });
  const hands = new MockHands(); const run = vi.spyOn(hands, "runPowerShell");
  const host = new LiveAgentHost(client, hands); const errors = vi.fn(); host.on("error", errors);
  try {
    await host.runTurn("Check the printer");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool, arguments: args } });
    await vi.waitFor(() => expect(client.respondToolCall).toHaveBeenCalled());
    expect(client.respondToolCall.mock.calls[0][1].success).toBe(false);
    expect(errors).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
    client.emit("serverRequest", { id: 2, method: "item/tool/call", params: { tool: "lalime_list_windows", arguments: {} } });
    await vi.waitFor(() => expect(client.respondToolCall).toHaveBeenCalledTimes(2));
    expect(client.respondToolCall.mock.calls[1][1].success).toBe(true);
  } finally { await host.stop(); }
});
