import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
vi.mock("../guardian/src/index.js", () => ({ demoReviewer: undefined, evaluateAction: async (a: any) => ({ actionId: a.id, kind: "ask", tier: 2, plainEnglish: a.summary, details: a.payload, matchedRules: [], undoable: false }) }));
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it.each(["lalime_click", "lalime_type"])("keeps %s grants bound to the exact window and input", async (tool) => {
  const client = Object.assign(new EventEmitter(), { startThread: async () => "thread", startTurn: async () => ({ turnId: "turn" }), interruptTurn: async () => {}, respondApproval: vi.fn(), respondFileChangeApproval: vi.fn(), respondToolCall: vi.fn() });
  const hands = new MockHands();
  const operation = vi.spyOn(hands, tool === "lalime_click" ? "clickElement" : "typeText");
  const host = new LiveAgentHost(client, hands);
  const cards: any[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Use the selected editor");
  const input = tool === "lalime_click" ? "name" : "text";
  try {
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool, arguments: { [input]: "a in window:b", windowTitle: "c" } } });
    await flush();
    expect(host.respondApproval("allow_for_task", cards[0].action.id)).toBe(true);
    await flush();
    client.emit("serverRequest", { id: 2, method: "item/tool/call", params: { tool, arguments: { [input]: "a", windowTitle: "b in window:c" } } });
    await flush();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(cards).toHaveLength(2);
  } finally { await host.stop(); }
});
