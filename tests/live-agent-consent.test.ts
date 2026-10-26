import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";

const policy = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../guardian/src/index.js", () => ({ demoReviewer: undefined, evaluateAction: policy.evaluate }));
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((r) => setImmediate(r));
beforeEach(() => {
  policy.evaluate.mockReset();
  policy.evaluate.mockImplementation(async (a: any) => ({ actionId: a.id, kind: "ask", tier: 2,
    plainEnglish: a.summary, details: a.payload, matchedRules: [], undoable: false }));
});
afterEach(async () => { for (const h of hosts.splice(0)) await h.stop(); vi.restoreAllMocks(); });
async function fixture(hold = false) {
  if (hold) policy.evaluate.mockImplementation(async (a: any) => ({ actionId: a.id, kind: "ask_hold", tier: 3,
    plainEnglish: a.summary, details: a.payload, matchedRules: [], undoable: false }));
  class Client extends EventEmitter {
    startThread = vi.fn(async () => "thread"); startTurn = vi.fn(async () => ({ turnId: "turn" }));
    interruptTurn = vi.fn(async () => {}); respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
  }
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true });
  hosts.push(host);
  const cards: any[] = []; host.on("approvalNeeded", (c) => cards.push(c));
  await host.runTurn("My current task");
  const request = async (id: number, command = "Write-Output 'fixture'", cwd = "C:\\Test") => {
    client.emit("serverRequest", { id, method: "item/commandExecution/requestApproval", params: { itemId: `cmd-${id}`, command, cwd } });
    await flush();
  };
  return { client, host: host as any, cards, request };
}

it.each(["do_it", "allow_for_task", "hold_confirmed"])("rejects bare %s for hold approval", async (choice) => {
  const f = await fixture(true); await f.request(1);
  const accepted = f.host.respondApproval(choice, f.cards[0].action.id);
  await flush(); expect(f.client.respondApproval).not.toHaveBeenCalled();
  expect(accepted).toBe(false);
});
it("requires a bound host-timed hold, and consumes it once", async () => {
  const f = await fixture(true); await f.request(1); const id = f.cards[0].action.id;
  const clock = vi.spyOn(performance, "now").mockReturnValue(100);
  expect(f.host.beginApprovalHold("wrong")).toBe(false);
  expect(f.host.beginApprovalHold(id)).toBe(true);
  clock.mockReturnValue(1599); expect(f.host.respondApproval("hold_confirmed", id)).toBe(false);
  clock.mockReturnValue(1600); expect(f.host.respondApproval("hold_confirmed", id)).toBe(true);
  await flush(); expect(f.client.respondApproval).toHaveBeenCalledExactlyOnceWith(1, "accept");
  expect(f.host.respondApproval("hold_confirmed", id)).toBe(false);
});
it("cancels a hold on release cancellation, Stop, or a different pending action", async () => {
  const f = await fixture(true); await f.request(1); await f.request(2); const id = f.cards[0].action.id;
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  f.host.beginApprovalHold(id); f.host.cancelApprovalHold(id); clock.mockReturnValue(2000);
  expect(f.host.respondApproval("hold_confirmed", id)).toBe(false);
  f.host.beginApprovalHold(id); expect(f.host.respondApproval("not_now", id)).toBe(true);
  await flush(); clock.mockReturnValue(4000);
  expect(f.host.respondApproval("hold_confirmed", f.cards[1].action.id)).toBe(false);
  f.host.beginApprovalHold(f.cards[1].action.id); await f.host.stop();
  clock.mockReturnValue(6000); expect(f.host.respondApproval("hold_confirmed", f.cards[1].action.id)).toBe(false);
});
it("grants only the same operation and target in the current task, with revocation", async () => {
  const f = await fixture(); await f.request(1);
  expect(f.cards[0].canAllowForTask).toBe(true);
  expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true); await flush();
  const grants = f.host.getTaskGrants(); expect(grants).toHaveLength(1);
  await f.request(2); expect(f.cards).toHaveLength(1); expect(f.client.respondApproval).toHaveBeenCalledWith(2, "accept");
  expect(policy.evaluate).toHaveBeenCalledTimes(2);
  await f.request(3, "Write-Output 'different'"); expect(f.cards).toHaveLength(2);
  f.host.respondApproval("not_now", f.cards[1].action.id); await flush();
  expect(f.host.revokeTaskGrant(grants[0].id)).toBe(true);
  await f.request(4); expect(f.cards).toHaveLength(3);
});
it("does not extend an exact command grant to another working directory", async () => {
  const f = await fixture(); await f.request(1); f.host.respondApproval("allow_for_task", f.cards[0].action.id); await flush();
  await f.request(2, "Write-Output 'fixture'", "C:\\Other"); expect(f.cards).toHaveLength(2);
});
it("does not bypass a fresh block or raised tier with an existing grant", async () => {
  const f = await fixture(); await f.request(1); f.host.respondApproval("allow_for_task", f.cards[0].action.id); await flush();
  policy.evaluate.mockImplementationOnce(async (a: any) => ({ actionId: a.id, kind: "block", tier: 4, plainEnglish: "Blocked", details: a.payload, matchedRules: [], undoable: false }));
  await f.request(2); expect(f.client.respondApproval).toHaveBeenCalledWith(2, "decline");
  policy.evaluate.mockImplementationOnce(async (a: any) => ({ actionId: a.id, kind: "ask_hold", tier: 3, plainEnglish: "Hold", details: a.payload, matchedRules: [], undoable: false }));
  await f.request(3); expect(f.cards).toHaveLength(2); expect(f.cards[1].canAllowForTask).toBe(false);
  expect(f.host.respondApproval("allow_for_task", f.cards[1].action.id)).toBe(false);
});
it("clears grants at Stop and at a new task", async () => {
  const f = await fixture(); await f.request(1); f.host.respondApproval("allow_for_task", f.cards[0].action.id); await flush();
  await f.host.stop(); expect(f.host.getTaskGrants()).toEqual([]);
  await f.host.runTurn("New task"); await f.request(2); expect(f.cards).toHaveLength(2);
  f.host.respondApproval("allow_for_task", f.cards[1].action.id); await flush();
  await f.host.runTurn("Another task"); expect(f.host.getTaskGrants()).toEqual([]);
});
