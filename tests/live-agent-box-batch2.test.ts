import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval, ProposedAction } from "../shared/types.js";

const policy = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../guardian/src/index.js", () => ({ demoReviewer: undefined, evaluateAction: policy.evaluate }));
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
beforeEach(() => {
  policy.evaluate.mockReset().mockImplementation(async (action: ProposedAction) => ({
    actionId: action.id, kind: "ask", tier: 2, plainEnglish: action.summary,
    details: action.payload, matchedRules: [], undoable: false,
  }));
});
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });

async function fixture() {
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowComputerControl: true, allowScreenCapture: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  const activity: Array<{ summary: string; details?: string; undoable: boolean }> = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("activity", (entry) => activity.push(entry));
  await host.runTurn("Help with the selected files");
  const request = async (method: string, params: object) => {
    client.emit("serverRequest", { id: 1, method, params: { threadId: "thread", turnId: "turn", ...params } });
    await flush();
  };
  return { client, hands, host, cards, activity, request };
}

const reasons = [
  ["right-to-left override", "\u202eClear the browser cache\u202c"],
  ["zero-width padding", `${"\u200b".repeat(512)}Clear the browser cache`],
  ["newline pushdown", `${"\n".repeat(80)}Clear the browser cache`],
  ["long explanation", "A harmless cache cleanup. ".repeat(400)],
  ["benign lie", "Only clear the browser cache; no personal files change."],
  ["empty explanation", ""],
] as const;
const target = "C:\\Users\\Example\\Documents\\report.txt";
const command = `Remove-Item '${target}'`;

describe("box-test batch 2 host trust boundaries", () => {
  it.each(reasons)("keeps command headlines factual despite %s", async (_name, reason) => {
    const f = await fixture();
    await f.request("item/commandExecution/requestApproval", { itemId: "cmd-1", command, reason });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.payload).toBe(command);
    expect(f.cards[0].action.summary).toBe(`Run: ${command}`);
    expect(f.cards[0].decision.plainEnglish).toBe(`Run: ${command}`);
    expect(f.cards[0].assistantExplanation).toBe(reason);
    expect(f.client.respondApproval).not.toHaveBeenCalled();
  });

  it.each(reasons)("keeps file targets factual despite %s", async (_name, reason) => {
    const f = await fixture();
    await f.request("item/fileChange/requestApproval", {
      itemId: "file-1", grantRoot: "C:\\Users\\Example\\Documents", changes: [{ path: target, kind: "delete" }], reason,
    });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.paths).toContain(target);
    expect(f.cards[0].action.payload).toContain(target);
    expect(f.cards[0].decision.plainEnglish).toContain(target);
    expect(f.cards[0].assistantExplanation).toBe(reason);
    if (reason) {
      expect(f.cards[0].action.summary).not.toContain(reason);
      expect(f.cards[0].decision.plainEnglish).not.toContain(reason);
    }
  });

  it.each(reasons)("keeps recycle approval and activity factual despite %s", async (_name, summary) => {
    const f = await fixture();
    const move = vi.spyOn(f.hands, "moveToRecycleBin");
    await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths: [target], summary } });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.summary).toContain(target);
    expect(f.cards[0].decision.plainEnglish).toContain(target);
    expect(move).not.toHaveBeenCalled();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(move).toHaveBeenCalledOnce();
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0].summary).toContain(target);
    expect(f.activity[0].details).toContain(target);
    if (summary) expect(f.activity[0].summary).not.toContain(summary);
  });

  it("records approved typing only after the backend succeeds", async () => {
    const f = await fixture();
    const type = vi.spyOn(f.hands, "typeText");
    await f.request("item/tool/call", { tool: "lalime_type", arguments: { text: "fixture text", windowTitle: "Editor" } });
    expect(type).not.toHaveBeenCalled();
    expect(f.activity).toEqual([]);
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(type).toHaveBeenCalledExactlyOnceWith("fixture text", "Editor");
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0]).toMatchObject({ undoable: false });
    expect(f.activity[0].summary).toContain("Editor");
  });

  it.each(["lalime_list_windows", "lalime_list_ui"])("labels %s output as untrusted data", async (tool) => {
    const f = await fixture();
    await f.request("item/tool/call", { tool, arguments: { windowTitle: "Editor" } });
    const response = f.client.respondToolCall.mock.calls[0][1];
    expect(response.success).toBe(true);
    const content = response.contentItems.map((item: { text?: string }) => item.text ?? "").join("\n");
    expect(content).toMatch(/untrusted/i);
    expect(content).toMatch(/data/i);
  });

  it.each(["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/tool/call"])("rejects bare do_it for ask_hold through %s", async (method) => {
    policy.evaluate.mockImplementation(async (action: ProposedAction) => ({
      actionId: action.id, kind: "ask_hold", tier: 3, plainEnglish: action.summary,
      details: action.payload, matchedRules: [], undoable: false,
    }));
    const f = await fixture();
    const move = vi.spyOn(f.hands, "moveToRecycleBin");
    await f.request(method, {
      itemId: "hold-1", command, grantRoot: target, changes: [{ path: target }],
      tool: "lalime_recycle", arguments: { paths: [target] },
    });
    expect(f.cards).toHaveLength(1);
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
    await flush();
    expect(f.client.respondApproval).not.toHaveBeenCalled();
    expect(f.client.respondFileChangeApproval).not.toHaveBeenCalled();
    expect(f.client.respondToolCall).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
});
