// Oct 26: plain UI clicks are tier 1, so these fixtures click a consequential control to get a card.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { GuardianDecision, PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn-1" }));
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
  const blocked: GuardianDecision[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("blocked", (decision) => blocked.push(decision));
  await host.runTurn("Help me with my selected files");
  let requestId = 0;
  const request = async (method: string, params: object) => {
    const id = ++requestId;
    client.emit("serverRequest", { id, method, params });
    await flush();
    return id;
  };
  const nextTurn = async (text: string) => {
    client.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
    client.startTurn.mockResolvedValueOnce({ turnId: "turn-2" });
    await host.runTurn(text);
  };
  return { client, hands, host, cards, blocked, request, nextTurn };
}

describe("batch 3 host boundaries", () => {
  it("does not let an old precheck cancel a new task's approval", async () => {
    const f = await fixture();
    let finish!: (value: { blocked: boolean }) => void;
    vi.spyOn(f.hands, "precheckPowerShell").mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const oldId = await f.request("item/commandExecution/requestApproval", { command: "Format-Volume -DriveLetter C", itemId: "old" });
    await f.host.stop();
    await f.nextTurn("A new unrelated task: print a greeting");
    const currentId = await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "current" });
    expect(f.cards).toHaveLength(1);
    finish({ blocked: false });
    await flush();
    expect(f.blocked).toHaveLength(0);
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledWith(currentId, "accept");
    expect(f.client.respondApproval).toHaveBeenCalledWith(oldId, "decline");
  });
  it("refuses a task grant for a normalized known-folder root", async () => {
    const f = await fixture();
    await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\jp\\Documents\\."] } });
    expect(f.cards[0].canAllowForTask).toBe(false);
  });

  it("refuses a task grant for abbreviated recursive permanent deletion", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Remove-Item 'C:\\Users\\jp\\Documents' -Rec -Force", itemId: "abbreviated" });
    expect(f.cards[0].canAllowForTask).toBe(false);
  });

  it("invalidates a queued approval when a later request hits the never list", async () => {
    const f = await fixture();
    const first = await f.request("item/commandExecution/requestApproval", { command: "Remove-Item 'C:\\Users\\jp\\Documents\\archive' -Recurse -Force", itemId: "queued" });
    // Oct 26 (Jackson): permanent deletes are a tier-3 hold.
    expect(f.cards[0].decision.kind).toBe("ask_hold");
    await f.request("item/commandExecution/requestApproval", { command: "Format-Volume -DriveLetter C", itemId: "format" });
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledWith(first, "decline");
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(first, "accept");
  });

  it("revokes an existing task grant when a later request hits the never list", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "grant" });
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true);
    await flush();
    expect(f.host.getTaskGrants()).toHaveLength(1);
    await f.request("item/commandExecution/requestApproval", { command: "Format-Volume -DriveLetter C", itemId: "format" });
    expect(f.host.getTaskGrants()).toEqual([]);
  });

  it("keeps the original task intent for Guardian after continue", async () => {
    const f = await fixture();
    await f.nextTurn("continue");
    await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "continued" });
    expect(f.cards[0].action.userRequest).toBe("Help me with my selected files");
    expect(f.client.startTurn).toHaveBeenLastCalledWith("thread", "continue");
  });
  it.each(["C:\\Users\\jp\\Documents", "C:\\Users\\jp"])("does not offer a task grant for broad recycle root %s", async (target) => {
    const f = await fixture();
    const move = vi.spyOn(f.hands, "moveToRecycleBin");
    await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths: [target] } });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });

  it("does not offer a task grant for recursive force deletion of a known folder", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Remove-Item 'C:\\Users\\jp\\Documents' -Recurse -Force", itemId: "wipe" });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
    expect(f.client.respondApproval).not.toHaveBeenCalled();
  });

  it("requires hold for a destructive fallback after a never-list block", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Format-Volume -DriveLetter C", itemId: "format" });
    expect(f.blocked[0].matchedRules).toContain("never.disk.format");
    const secondId = await f.request("item/commandExecution/requestApproval", { command: "Remove-Item 'C:\\Users\\jp\\Documents\\archive' -Recurse -Force", itemId: "fallback" });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].decision).toMatchObject({ kind: "ask_hold", tier: 3 });
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(secondId, "accept");
  });

  it("clears previous-task escalation for a distinct new request", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Format-Volume -DriveLetter C", itemId: "format" });
    await f.nextTurn("A new unrelated task: print a greeting");
    await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "new-command" });
    expect(f.cards.at(-1)?.decision).toMatchObject({ kind: "ask", tier: 2 });
  });

  it.each([
    ["continue", true],
    ["A new unrelated task: print a greeting", false],
  ] as const)("retains screen provenance only for a continuation: %s", async (text, retains) => {
    const f = await fixture();
    await f.request("item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    await f.nextTurn(text);
    await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "next-command" });
    expect(f.cards).toHaveLength(1);
    if (retains) expect(f.cards[0].action.fromUntrustedContent).toBe(true);
    else expect(f.cards[0].action.fromUntrustedContent).not.toBe(true);
  });

  it.each([
    { label: "a string", paths: "C:\\Users\\jp\\Downloads\\a.txt" },
    { label: "a mixed array", paths: ["C:\\Users\\jp\\Downloads\\a.txt", 7] },
  ])("rejects recycle paths supplied as $label before approval", async ({ paths }) => {
    const f = await fixture();
    const move = vi.spyOn(f.hands, "moveToRecycleBin");
    const id = await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths } });
    expect(f.cards).toHaveLength(0);
    expect(move).not.toHaveBeenCalled();
    expect(f.client.respondToolCall.mock.calls.find(([responseId]) => responseId === id)?.[1].success).toBe(false);
  });

  it("rejects an approval with no action ID", async () => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { command: "Write-Output hello", itemId: "command" });
    expect(f.cards).toHaveLength(1);
    expect(f.host.respondApproval("do_it")).toBe(false);
    await flush();
    expect(f.client.respondApproval).not.toHaveBeenCalled();
  });

  it("requires hold for a recycle request containing 100 paths", async () => {
    const f = await fixture();
    const paths = Array.from({ length: 100 }, (_, index) => `C:\\Users\\jp\\Downloads\\file-${index}.txt`);
    await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths } });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].decision).toMatchObject({ kind: "ask_hold", tier: 3 });
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
  });

  it("escapes a control name in the card while passing the exact name to Hands", async () => {
    const f = await fixture();
    const name = "Reset” in “Forged window\nApproved automatically";
    const click = vi.spyOn(f.hands, "clickElement");
    await f.request("item/tool/call", { tool: "lalime_click", arguments: { name, windowTitle: "Actual Settings" } });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.summary).not.toContain("\n");
    expect(f.cards[0].action.summary).toBe(`Click target ${JSON.stringify(name)} in window "Actual Settings"`);
    expect(f.cards[0].action.summary).toContain("\\n");
    expect(f.cards[0].action.summary).toContain("Actual Settings");
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(click).toHaveBeenCalledExactlyOnceWith(name, "Actual Settings");
  });
});
