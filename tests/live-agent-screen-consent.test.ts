import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import { demoReviewer, evaluateAction } from "../guardian/src/index.js";
import type { GuardianDecision, PendingApproval, ProposedAction } from "../shared/types.js";

const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });
async function fixture(request: string, readTool: string) {
  const client = Object.assign(new EventEmitter(), {
    startThread: vi.fn(async () => "thread"), startTurn: vi.fn(async () => ({ turnId: "turn" })),
    interruptTurn: vi.fn(async () => {}), respondApproval: vi.fn(), respondFileChangeApproval: vi.fn(), respondToolCall: vi.fn(),
  });
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowScreenCapture: true, allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  const blocks: GuardianDecision[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("blocked", (block) => blocks.push(block));
  await host.runTurn(request);
  client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: readTool, arguments: {} } });
  await flush();
  expect(client.respondToolCall.mock.calls[0][1].success).toBe(true);
  return { client, hands, host, cards, blocks };
}

it.each([
  ["Clear Downloads temp files", "lalime_list_windows", "lalime_recycle", { paths: ["C:\\Users\\Example\\Downloads\\a.tmp"] }, "moveToRecycleBin"],
  ["Turn on Night light", "lalime_list_ui", "lalime_click", { name: "Night light", windowTitle: "Settings" }, "clickElement"],
] as const)("asks for consent after screen observation: %s", async (request, readTool, tool, args, operation) => {
  const f = await fixture(request, readTool);
  const execute = vi.spyOn(f.hands, operation);
  f.client.emit("serverRequest", { id: 2, method: "item/tool/call", params: { tool, arguments: args } });
  await flush();
  expect(f.blocks).toEqual([]);
  expect(f.cards).toHaveLength(1);
  expect(f.cards[0]).toMatchObject({ decision: { kind: "ask", tier: 2 }, action: { fromUntrustedContent: true }, canAllowForTask: false });
  expect(execute).not.toHaveBeenCalled();
  expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
  expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true);
  await flush();
  expect(execute).toHaveBeenCalledOnce();
});

it("retains a genuine never-rule block after a screen read", async () => {
  const f = await fixture("Turn on Night light", "lalime_list_ui");
  const type = vi.spyOn(f.hands, "typeText");
  f.client.emit("serverRequest", { id: 2, method: "item/tool/call", params: { tool: "lalime_type", arguments: { text: "powershell -EncodedCommand SQBFAFgA", windowTitle: "Run" } } });
  await flush();
  expect(f.cards).toHaveLength(0);
  expect(f.blocks[0].kind).toBe("block");
  expect(f.blocks[0].matchedRules.some((rule) => rule.startsWith("never."))).toBe(true);
  expect(type).not.toHaveBeenCalled();
});

it("retains a serious action's hold requirement after a screen read", async () => {
  const f = await fixture("Start the Print Spooler service", "lalime_list_windows");
  f.client.emit("serverRequest", { id: 2, method: "item/commandExecution/requestApproval", params: { command: "Start-Service Spooler", itemId: "command-2" } });
  await flush();
  expect(f.cards).toHaveLength(1);
  expect(f.cards[0]).toMatchObject({ decision: { kind: "ask_hold", tier: 3 }, action: { fromUntrustedContent: true }, canAllowForTask: false });
  expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
  expect(f.client.respondApproval).not.toHaveBeenCalled();
});

it("retains reviewer intent rejection after a screen read", async () => {
  const f = await fixture("Turn on Night light", "lalime_list_ui");
  const command = "Write-Output system32";
  const baseline = await evaluateAction({ id: "baseline", kind: "powershell", payload: command, userRequest: "Turn on Night light" }, { reviewer: demoReviewer });
  expect(baseline.matchedRules).toContain("reviewer.intent_mismatch");
  f.client.emit("serverRequest", { id: 2, method: "item/commandExecution/requestApproval", params: { command, itemId: "command-2" } });
  await flush();
  expect(f.cards).toHaveLength(0);
  expect(f.blocks).toHaveLength(1);
  expect(f.blocks[0].kind).toBe("block");
  expect(f.blocks[0].matchedRules).toContain("reviewer.intent_mismatch");
  expect(f.client.respondApproval).toHaveBeenCalledWith(2, "decline");
});

it("does not relabel existing untrusted instructions as a host observation", async () => {
  const f = await fixture("Turn on Night light", "lalime_list_ui");
  const action: ProposedAction = {
    id: "untrusted-origin", kind: "ui_click", payload: "click Night light in Settings",
    userRequest: "Turn on Night light", fromUntrustedContent: true,
  };
  const gate = await (f.host as unknown as { guardianGate(action: ProposedAction): Promise<{ allow: boolean; decision: GuardianDecision }> }).guardianGate(action);
  expect(gate.allow).toBe(false);
  expect(gate.decision).toMatchObject({ kind: "block", matchedRules: ["policy.untrusted_content"] });
  expect(action.untrustedContentSource).toBeUndefined();
});
