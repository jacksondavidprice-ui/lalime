import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { LALIME_DYNAMIC_TOOLS, RepeatGuard } from "../electron/main/agent-prompt.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((r) => setImmediate(r));
afterEach(async () => { for (const h of hosts.splice(0)) await h.stop(); vi.restoreAllMocks(); });
async function setup(options = {}) {
  const client = new Client(), hands = new MockHands();
  const host = new LiveAgentHost(client, hands, options); hosts.push(host);
  const cards: PendingApproval[] = [], activity: any[] = [], plans: any[] = [], repairs: any[] = [];
  host.on("approvalNeeded", (x) => cards.push(x)); host.on("activity", (x) => activity.push(x));
  host.on("plan", (x) => plans.push(x)); host.on("repairPlan", (x) => repairs.push(x));
  await host.runTurn("Diagnose and repair the printer");
  const call = (id: number, tool: string, args: object = {}) => client.emit("serverRequest", { id, method: "item/tool/call", params: { tool, arguments: args } });
  const response = (id: number) => client.respondToolCall.mock.calls.find(([key]) => key === id)?.[1];
  return { client, hands, host, cards, activity, plans, repairs, call, response };
}
const repair = { command: "Get-Service Spooler", why: "Check the printer service" };

it("declares the host repair tool with explicit optional admin intent", () => {
  const tool = LALIME_DYNAMIC_TOOLS.find((t) => t.name === "lalime_run_powershell");
  expect(tool).toBeDefined();
  expect(tool!.inputSchema).toMatchObject({ properties: { command: { type: "string" }, why: { type: "string" }, admin: { type: "boolean" } }, required: ["command", "why"] });
});
it("keeps long diagnostic sessions running beyond the former tool limit", async () => {
  const f = await setup({ maxToolCalls: 1 });
  for (let id = 1; id <= 45; id++) { f.call(id, "lalime_list_windows"); await flush(); expect(f.response(id)?.success).toBe(true); }
});
it("repeated observations succeed with a soft note and reset after a different call", async () => {
  const f = await setup();
  for (let id = 1; id <= 3; id++) { f.call(id, "lalime_list_ui", { windowTitle: "Settings" }); await flush(); expect(f.response(id)?.success).toBe(true); }
  expect(JSON.stringify(f.response(3))).toMatch(/already tried|repeated/i);
  const guard = new RepeatGuard();
  guard.check("lalime_click", { name: "OK" }); guard.check("lalime_click", { name: "OK" });
  guard.check("lalime_list_windows", {});
  expect(guard.check("lalime_click", { name: "OK" })).toBeNull();
});
it("emits structured diagnosis without requiring legacy steps", async () => {
  const f = await setup();
  const plan = { symptom: "Printer is offline", causes: [{ label: "Printer service stopped", likelihood: "likely", evidence: "Service reports stopped" }], fixes: [{ label: "Restart the printer service", cause: "Printer service stopped", status: "pending" }] };
  f.call(1, "lalime_update_plan", plan); await flush();
  expect(f.response(1)?.success).toBe(true); expect(f.repairs).toEqual([plan]);
  f.call(2, "lalime_update_plan", { steps: [{ label: "Verify printer", status: "running" }] }); await flush();
  expect(f.response(2)?.success).toBe(true); expect(f.plans.at(-1)[0].label).toBe("Verify printer");
});
it("does not expose command or path labels in the structured repair plan", async () => {
  const f = await setup();
  f.call(1, "lalime_update_plan", { symptom: "Printer\n offline", causes: [{ label: "Get-Service Spooler", likelihood: "likely", evidence: "C:\\Users\\jp\\secret.txt" }], fixes: [{ label: "Inspect C:\\Users\\jp\\secret.txt", status: "pending" }], steps: [{ label: "Remove-Item C:\\temp\\a", status: "pending" }] });
  await flush(); expect(f.response(1)?.success).toBe(true);
  const shown = JSON.stringify({ repair: f.repairs, plan: f.plans });
  expect(shown).not.toMatch(/Get-Service|Remove-Item|secret\.txt|C:\\\\/); expect(f.repairs[0].symptom).toBe("Printer offline");
});
it("prechecks, asks Guardian, and executes the actual command only after consent", async () => {
  const f = await setup(); const pre = vi.spyOn(f.hands, "precheckPowerShell");
  const run = vi.spyOn(f.hands, "runPowerShell").mockResolvedValue({ ok: true, output: "Spooler Running" });
  f.call(1, "lalime_run_powershell", repair); await flush();
  expect(pre).toHaveBeenCalledWith(repair.command); expect(run).not.toHaveBeenCalled(); expect(f.cards).toHaveLength(1);
  expect(f.cards[0].action.summary).toContain(repair.command); expect(f.cards[0].assistantExplanation).toBe(repair.why);
  f.host.respondApproval("do_it", f.cards[0].action.id); await flush();
  expect(run).toHaveBeenCalledWith(repair.command, expect.stringContaining(repair.command), { admin: false });
  expect(f.response(1)?.success).toBe(true); expect(JSON.stringify(f.response(1))).toMatch(/untrusted.*command output/i);
  expect(f.activity).toHaveLength(1); expect(f.activity[0].undoable).toBe(false);
});
it("admin intent appears on the card and cannot use a task grant", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell").mockResolvedValue({ ok: true, output: "checked" });
  f.call(1, "lalime_run_powershell", { ...repair, admin: true }); await flush();
  expect(f.cards).toHaveLength(1); expect(f.cards[0].action.summary).toMatch(/administrator/i);
  expect(f.cards[0].canAllowForTask).toBe(false); expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
  expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true); await flush();
  expect(run).toHaveBeenCalledWith(repair.command, expect.stringMatching(/administrator/i), { admin: true });
  f.call(2, "lalime_run_powershell", { ...repair, admin: true }); await flush(); expect(f.cards).toHaveLength(2);
});
it("keeps tier-three hold enforcement for the repair tool", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell");
  f.call(1, "lalime_run_powershell", { command: "Start-Service Spooler", why: "Start printer service", admin: true }); await flush();
  expect(f.cards).toHaveLength(1); expect(f.cards[0].decision.kind).toBe("ask_hold");
  expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false); expect(run).not.toHaveBeenCalled();
});
it.each([{}, { command: 4, why: "check" }, { command: "", why: "check" }, { ...repair, admin: "yes" }, { command: "Get-Service", why: "" }])("rejects malformed repair arguments before precheck: %j", async (args) => {
  const f = await setup(); const pre = vi.spyOn(f.hands, "precheckPowerShell"), run = vi.spyOn(f.hands, "runPowerShell");
  f.call(1, "lalime_run_powershell", args); await flush(); expect(f.response(1)?.success).toBe(false); expect(pre).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled(); expect(f.cards).toHaveLength(0);
});
it("honors Hands rejection and Guardian never rules without execution", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell");
  vi.spyOn(f.hands, "precheckPowerShell").mockResolvedValueOnce({ blocked: true, reason: "precheck blocked" });
  f.call(1, "lalime_run_powershell", repair); await flush(); expect(f.response(1)?.success).toBe(false);
  f.call(2, "lalime_run_powershell", { command: "Format-Volume -DriveLetter C", why: "repair" }); await flush();
  expect(f.response(2)?.success).toBe(false); expect(f.cards).toHaveLength(0); expect(run).not.toHaveBeenCalled();
});
it("does not execute an approved command after Stop or a new screen read", async () => {
  const f = await setup(); const run = vi.spyOn(f.hands, "runPowerShell");
  f.call(1, "lalime_run_powershell", repair); await flush(); expect(f.cards).toHaveLength(1);
  f.host.respondApproval("do_it", f.cards[0].action.id); f.call(2, "lalime_list_windows"); await flush(); expect(run).not.toHaveBeenCalled();
  f.call(3, "lalime_run_powershell", repair); await flush(); expect(f.cards).toHaveLength(2);
  f.host.respondApproval("do_it", f.cards[1].action.id); await f.host.stop(); await flush(); expect(run).not.toHaveBeenCalled();
});
it("never duplicates screenshot data into text results", async () => {
  const f = await setup(); const url = "data:image/png;base64,c2NyZWVu";
  vi.spyOn(f.hands, "screenshot").mockResolvedValue({ ok: true, output: url, imageDataUrl: url });
  f.call(1, "lalime_screenshot"); await flush();
  expect(f.response(1).contentItems.filter((x: any) => x.type === "inputText").map((x: any) => x.text).join(" ")).not.toContain("base64");
  expect(f.response(1).contentItems).toContainEqual({ type: "inputImage", imageUrl: url });
});
