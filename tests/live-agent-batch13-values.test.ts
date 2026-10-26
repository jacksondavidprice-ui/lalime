import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { LALIME_DYNAMIC_TOOLS } from "../electron/main/agent-prompt.js";
import { MockHands } from "../hands/mock/index.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread"); startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined); respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((r) => setImmediate(r));
afterEach(async () => { for (const h of hosts.splice(0)) await h.stop(); vi.restoreAllMocks(); });
async function setup(options = {}) {
  const client = new Client(), hands = new MockHands(); const host = new LiveAgentHost(client, hands, options); hosts.push(host);
  const cards: any[] = [], activity: any[] = []; host.on("approvalNeeded", (p) => cards.push(p)); host.on("activity", (p) => activity.push(p));
  await host.runTurn("Adjust the volume and repair the printer");
  const call = (id: number, tool: string, args: object) => client.emit("serverRequest", { id, method: "item/tool/call", params: { tool, arguments: args } });
  return { host, client, hands, cards, activity, call, response: (id: number) => client.respondToolCall.mock.calls.find(([key]) => key === id)?.[1] };
}
it("advertises explicit named value targeting", () => {
  expect(LALIME_DYNAMIC_TOOLS.find((t) => t.name === "lalime_set_value")?.inputSchema).toMatchObject({ required: ["name", "value", "windowTitle"] });
});
// Jackson, Oct 26: typing and setting values are tier 1.
it.each([25, "on", "Headphones"])("sets an ordinary named value without a card: %j", async (value) => {
  const f = await setup(); const set = vi.fn(async () => ({ ok: true, output: "value set" })); Object.assign(f.hands, { setElementValue: set });
  f.call(1, "lalime_set_value", { name: "Volume", value, windowTitle: "Settings" }); await flush();
  expect(f.cards).toHaveLength(0);
  expect(set).toHaveBeenCalledExactlyOnceWith("Volume", String(value), "Settings"); expect(f.response(1)?.success).toBe(true); expect(f.activity).toHaveLength(1);
});
it.each<[string, string | number, string]>([["Action", "Remove everything", "Reset this PC"], ["Command", "Get-Date", "Windows PowerShell"]])("gates a consequential named value and sends its text to Hands: %s=%j in %s", async (name, value, windowTitle) => {
  const f = await setup(); const set = vi.fn(async () => ({ ok: true, output: "value set" })); Object.assign(f.hands, { setElementValue: set });
  f.call(1, "lalime_set_value", { name, value, windowTitle }); await flush();
  expect(f.cards).toHaveLength(1); expect(f.cards[0].action.kind).toBe("ui_type");
  expect(f.cards[0].action.summary).toContain(name); expect(set).not.toHaveBeenCalled();
  f.host.respondApproval("do_it", f.cards[0].action.id); await flush();
  expect(set).toHaveBeenCalledExactlyOnceWith(name, String(value), windowTitle); expect(f.response(1)?.success).toBe(true); expect(f.activity).toHaveLength(1);
});
it.each([{ name: "Volume", value: 20 }, { name: "", windowTitle: "Settings", value: 20 }, { name: "Volume", windowTitle: "Settings", value: {} }])("rejects invalid value target before consent: %j", async (args) => {
  const f = await setup(); const set = vi.fn(); Object.assign(f.hands, { setElementValue: set });
  f.call(1, "lalime_set_value", args); await flush(); expect(f.response(1)?.success).toBe(false); expect(f.cards).toHaveLength(0); expect(set).not.toHaveBeenCalled();
});
it("honors computer-control setting for both new tool routes", async () => {
  const f = await setup({ allowComputerControl: false }); const run = vi.spyOn(f.hands, "runPowerShell");
  f.call(1, "lalime_run_powershell", { command: "Get-Service Spooler", why: "diagnose" });
  f.call(2, "lalime_set_value", { name: "Volume", value: 20, windowTitle: "Settings" }); await flush();
  expect(f.response(1)?.success).toBe(false); expect(f.response(2)?.success).toBe(false); expect(f.cards).toHaveLength(0); expect(run).not.toHaveBeenCalled();
});
it("executes tier-three repair only after a real timed hold", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell").mockResolvedValue({ ok: true, output: "service started" });
  f.call(1, "lalime_run_powershell", { command: "Start-Service Spooler", why: "repair printer", admin: true }); await flush();
  const id = f.cards[0].action.id; expect(f.cards[0].decision.kind).toBe("ask_hold");
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  expect(f.host.beginApprovalHold(id)).toBe(true); expect(f.host.respondApproval("hold_confirmed", id)).toBe(false);
  clock.mockReturnValue(1700); expect(f.host.respondApproval("hold_confirmed", id)).toBe(true); await flush(); expect(run).toHaveBeenCalledTimes(1);
});
it("rejects an in-flight precheck when Stop occurs", async () => {
  const f = await setup(); let finish!: (v: { blocked: boolean }) => void;
  vi.spyOn(f.hands, "precheckPowerShell").mockImplementation(() => new Promise((r) => { finish = r; })); const run = vi.spyOn(f.hands, "runPowerShell");
  f.call(1, "lalime_run_powershell", { command: "Get-Service Spooler", why: "diagnose" }); await flush(); await f.host.stop(); finish({ blocked: false }); await flush();
  expect(f.cards).toHaveLength(0); expect(run).not.toHaveBeenCalled(); expect(f.response(1)?.success).toBe(false);
});
it("cannot reuse a non-admin command grant for its admin form", async () => {
  const f = await setup(); vi.spyOn(f.hands, "runPowerShell").mockResolvedValue({ ok: true, output: "checked" });
  const args = { command: "Get-Service Spooler", why: "diagnose" }; f.call(1, "lalime_run_powershell", args); await flush();
  expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true); await flush();
  f.call(2, "lalime_run_powershell", { ...args, admin: true }); await flush(); expect(f.cards).toHaveLength(2); expect(f.cards[1].canAllowForTask).toBe(false);
});
