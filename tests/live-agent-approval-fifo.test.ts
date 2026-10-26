import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread"); startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined); respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture() {
  const client = new Client(); const hands = new MockHands(); const host = new LiveAgentHost(client, hands);
  hosts.push(host); const cards: PendingApproval[] = []; host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Start the service and open settings");
  const command = () => client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { command: "Start-Service Spooler" } });
  const settings = () => client.emit("serverRequest", { id: 2, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Uninstall", windowTitle: "Apps" } } });
  return { client, hands, host, cards, command, settings };
}
it("presents the service hold before the settings request emitted after it", async () => {
  const f = await fixture(); f.command(); f.settings(); await flush();
  expect(f.cards[0].action.payload).toBe("Start-Service Spooler");
  expect(f.cards[0].decision.kind).toBe("ask_hold");
  f.host.respondApproval("not_now", f.cards[0].action.id); await flush();
  expect(f.cards[1].action.payload).toContain("Uninstall");
});
it.each([false, true])("holds later cards until the earlier precheck finishes (blocked=%s)", async (blocked) => {
  const f = await fixture(); let finish!: (value: { blocked: boolean; reason?: string }) => void;
  vi.spyOn(f.hands, "precheckPowerShell").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  f.command(); f.settings(); await flush(); expect(f.cards).toEqual([]);
  finish({ blocked, reason: blocked ? "Fixture refuses service command" : undefined }); await flush();
  expect(f.cards[0].action.payload).toContain(blocked ? "Uninstall" : "Start-Service Spooler");
});
it("withdraws a later prepared approval on Stop while an earlier precheck is pending", async () => {
  const f = await fixture(); let finish!: (value: { blocked: boolean }) => void;
  vi.spyOn(f.hands, "precheckPowerShell").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  f.command(); f.settings(); await flush(); await f.host.stop(); finish({ blocked: false }); await flush();
  expect(f.cards).toEqual([]); expect(f.client.respondApproval).toHaveBeenCalledWith(1, "decline");
  expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
