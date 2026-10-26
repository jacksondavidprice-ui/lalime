import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });

async function fixture() {
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowScreenCapture: true, allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Turn on Night light in Settings");
  const request = (id: number, method: string, params: object) => {
    client.emit("serverRequest", { id, method, params: { threadId: "thread", turnId: "turn", ...params } });
  };
  request(1, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
  await flush();
  expect(client.respondToolCall.mock.calls[0][1].success).toBe(true);
  return { client, hands, host, cards, request };
}

describe("approvals bind to the current screen observation", () => {
  it("declines an approved command when a second screen read starts before execution resumes", async () => {
    const f = await fixture();
    f.request(2, "item/commandExecution/requestApproval", { itemId: "command-2", command: "Write-Output 'fixture only'" });
    await flush();
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.fromUntrustedContent).toBe(true);
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true);
    f.request(3, "item/tool/call", { tool: "lalime_list_ui", arguments: { windowTitle: "Settings" } });
    await flush();
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(2, "accept");
    expect(f.client.respondApproval).toHaveBeenCalledWith(2, "decline");
  });

  it("does not click after a second screen read invalidates the accepted card", async () => {
    const f = await fixture();
    const click = vi.spyOn(f.hands, "clickElement");
    f.request(2, "item/tool/call", { tool: "lalime_click", arguments: { name: "Night light", windowTitle: "Settings" } });
    await flush();
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.fromUntrustedContent).toBe(true);
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true);
    f.request(3, "item/tool/call", { tool: "lalime_list_ui", arguments: { windowTitle: "Settings" } });
    await flush();
    expect(click).not.toHaveBeenCalled();
    const response = f.client.respondToolCall.mock.calls.find(([id]) => id === 2)?.[1];
    expect(response?.success).toBe(false);
  });

  it("does not queue an old observation's card when another read starts during Guardian evaluation", async () => {
    const f = await fixture();
    const click = vi.spyOn(f.hands, "clickElement");
    f.request(2, "item/tool/call", { tool: "lalime_click", arguments: { name: "Night light", windowTitle: "Settings" } });
    f.request(3, "item/tool/call", { tool: "lalime_list_ui", arguments: { windowTitle: "Settings" } });
    await flush();
    expect(f.cards).toHaveLength(0);
    expect(click).not.toHaveBeenCalled();
    const response = f.client.respondToolCall.mock.calls.find(([id]) => id === 2)?.[1];
    expect(response?.success).toBe(false);
  });
});
