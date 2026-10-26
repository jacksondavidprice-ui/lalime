import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread"); startTurn = vi.fn(async () => ({ turnId: "turn" })); interruptTurn = vi.fn(async () => {});
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = []; const flush = () => new Promise<void>((r) => setImmediate(r));
afterEach(async () => { for (const h of hosts.splice(0)) await h.stop(); });
async function setup() {
  const client = new Client(), hands = new MockHands(), host = new LiveAgentHost(client, hands); hosts.push(host);
  const cards: any[] = [], activity: any[] = []; host.on("approvalNeeded", (x) => cards.push(x)); host.on("activity", (x) => activity.push(x));
  await host.runTurn("Repair my printer");
  const call = () => client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_run_powershell", arguments: { command: "Write-Output 'repair step'", why: "Check the repair" } } });
  return { host, client, hands, cards, activity, call };
}
it("records unverified changes after an executed command reports failure", async () => {
  const f = await setup(); vi.spyOn(f.hands, "runPowerShell").mockResolvedValue({ ok: false, output: "Failed after first step" });
  f.call(); await flush(); f.host.respondApproval("do_it", f.cards[0].action.id); await flush();
  expect(f.activity).toHaveLength(1); expect(f.activity[0]).toMatchObject({ undoable: false, stale: false });
  expect(f.activity[0].summary).toMatch(/may have partly run|unverified/i); expect(f.activity[0].details).toContain("Failed after first step");
  expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
it("retains an unverified command row if Stop interrupts the executing backend", async () => {
  const f = await setup(); let finish!: (r: { ok: boolean; output: string }) => void;
  const run = vi.spyOn(f.hands, "runPowerShell").mockImplementation(() => new Promise((r) => { finish = r; }));
  f.call(); await flush(); f.host.respondApproval("do_it", f.cards[0].action.id); await flush(); expect(run).toHaveBeenCalled();
  await f.host.stop(); finish({ ok: false, output: "Stopped by user" }); await flush();
  expect(f.activity).toHaveLength(1); expect(f.activity[0]).toMatchObject({ undoable: false, stale: true });
  expect(f.activity[0].summary).toMatch(/may have partly run|unverified/i);
});
it("records an uncertain result when Hands throws after invocation, without claiming success", async () => {
  const f = await setup(); vi.spyOn(f.hands, "runPowerShell").mockRejectedValue(new Error("raw-private-diagnostic"));
  f.call(); await flush(); f.host.respondApproval("do_it", f.cards[0].action.id); await flush();
  expect(f.activity).toHaveLength(1); expect(f.activity[0].summary).toMatch(/may have partly run|unverified/i);
  expect(JSON.stringify(f.activity)).not.toContain("raw-private-diagnostic"); expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
it("records no execution when the user declines the command", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell");
  f.call(); await flush(); f.host.respondApproval("not_now", f.cards[0].action.id); await flush(); expect(f.activity).toEqual([]); expect(run).not.toHaveBeenCalled();
});
