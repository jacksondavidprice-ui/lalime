import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { HandsResult } from "../hands/src/types.js";
import type { PendingApproval } from "../shared/types.js";

vi.mock("../guardian/src/index.js", () => ({
  demoReviewer: undefined,
  evaluateAction: async (action: { id: string; payload: string }) => ({
    actionId: action.id, kind: "ask", tier: 2, plainEnglish: "Recycle selected files",
    details: action.payload, matchedRules: [], undoable: false,
  }),
}));

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const hosts: LiveAgentHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });

async function runRecycle(result: HandsResult) {
  const client = new Client();
  const hands = new MockHands();
  vi.spyOn(hands, "moveToRecycleBin").mockResolvedValue(result);
  const host = new LiveAgentHost(client, hands, { allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  const activity: Array<{ summary: string; details?: string; actionId?: string; undoable: boolean }> = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("activity", (entry) => activity.push(entry));
  await host.runTurn("Recycle these files");
  client.emit("serverRequest", {
    id: 1, method: "item/tool/call",
    params: {
      threadId: "thread", turnId: "turn", tool: "lalime_recycle",
      arguments: { paths: ["C:\\Users\\Example\\Downloads\\one.txt", "C:\\Users\\Example\\Downloads\\missing.txt"], summary: "All files moved" },
    },
  });
  await flush();
  expect(cards).toHaveLength(1);
  host.respondApproval("do_it", cards[0].action.id);
  await flush();
  return { client, activity };
}

describe("partial recycle activity", () => {
  it("retains an honest recovery entry for files moved by a failed batch", async () => {
    const output = "Moved 1 item(s) to quarantine. Failed 1: missing.txt does not exist.";
    const f = await runRecycle({ ok: false, output, journalId: "recovery-1", undoToken: "recovery-1" });
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0]).toMatchObject({ actionId: "recovery-1", undoable: true });
    expect(f.activity[0].summary).toMatch(/partial|incomplete|failed/i);
    expect(f.activity[0].summary).toContain("missing.txt");
    expect(f.activity[0].summary).not.toContain("All files moved");
    expect(f.activity[0].details).toContain(output);
  });

  it("does not invent a change or recovery entry when nothing moved", async () => {
    const f = await runRecycle({ ok: false, output: "Moved 0 item(s). Missing files." });
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
    expect(f.activity).toHaveLength(0);
  });

  it("retains manual recovery information for a partial Windows batch without an undo token", async () => {
    const output = "Recycle stopped after 1 completed item(s). Restore completed items manually from the Recycle Bin.";
    const result = { ok: false, output, completedItems: 1 };
    const f = await runRecycle(result);
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0].undoable).toBe(false);
    expect(f.activity[0].actionId).toBeUndefined();
    expect(f.activity[0].summary).toMatch(/partial|incomplete|failed/i);
    expect(f.activity[0].summary).not.toContain("All files moved");
    expect(f.activity[0].details).toContain(output);
  });
});
