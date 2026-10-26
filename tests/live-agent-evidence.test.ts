import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval, ProposedAction } from "../shared/types.js";

const policy = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("../guardian/src/index.js", () => ({
  demoReviewer: undefined,
  evaluateAction: policy.evaluate,
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
beforeEach(() => {
  policy.evaluate.mockReset();
  policy.evaluate.mockImplementation(async (action: ProposedAction) => ({
    actionId: action.id, kind: "ask", tier: 2, plainEnglish: action.summary,
    details: action.payload, matchedRules: [], undoable: false,
  }));
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
});

async function fixture() {
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowScreenCapture: true, allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  const activity: Array<{ summary: string; details?: string; undoable: boolean }> = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("activity", (entry) => activity.push(entry));
  await host.runTurn("Help me with this task");
  const request = async (id: number, method: string, params: object) => {
    client.emit("serverRequest", { id, method, params: { threadId: "thread", turnId: "turn", ...params } });
    await flush();
  };
  return { client, hands, host, cards, activity, request };
}

describe("live host evidence and activity", () => {
  it("derives command approval text from the command and separates the assistant explanation", async () => {
    const f = await fixture();
    const command = "Remove-Item 'C:\\Users\\Example\\Documents\\report.txt'";
    const reason = "Clear the browser cache";
    await f.request(1, "item/commandExecution/requestApproval", { itemId: "command-1", command, reason });
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].action.summary).toContain(command);
    expect(f.cards[0].action.summary).not.toContain(reason);
    expect(f.cards[0]).toMatchObject({ assistantExplanation: reason });
    expect(f.cards[0].decision.plainEnglish).not.toContain(reason);
  });

  it("supplies actual file targets to Guardian even when the explanation is harmless", async () => {
    const f = await fixture();
    const grantRoot = "C:\\Users\\Example\\Documents";
    const changedPath = `${grantRoot}\\report.txt`;
    await f.request(1, "item/fileChange/requestApproval", {
      grantRoot, reason: "Read a public help page", changes: [{ path: changedPath, kind: "delete" }],
    });
    expect(policy.evaluate).toHaveBeenCalledOnce();
    const action = policy.evaluate.mock.calls[0][0] as ProposedAction;
    expect(action.paths).toEqual(expect.arrayContaining([grantRoot, changedPath]));
    expect(action.payload).toContain(changedPath);
    expect(action.summary).not.toBe("Read a public help page");
  });

  it.each([
    ["lalime_list_windows", "File Explorer"],
    ["lalime_list_ui", "Night light"],
  ])("marks %s output as untrusted data and flags later actions", async (tool, fixtureText) => {
    const f = await fixture();
    await f.request(1, "item/tool/call", { tool, arguments: { windowTitle: "Editor" } });
    const response = f.client.respondToolCall.mock.calls[0][1];
    expect(response.success).toBe(true);
    const text = response.contentItems.map((item: { text?: string }) => item.text ?? "").join("\n");
    expect(text).toMatch(/untrusted/i);
    expect(text).toMatch(/data/i);
    expect(text).toContain(fixtureText);
    await f.request(2, "item/tool/call", { tool: "lalime_type", arguments: { text: "hello", windowTitle: "Editor" } });
    expect(policy.evaluate.mock.calls.at(-1)?.[0]).toMatchObject({ fromUntrustedContent: true });
  });

  it("clears screen-content provenance when a new task starts", async () => {
    const f = await fixture();
    await f.request(1, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn" } });
    f.client.startTurn.mockResolvedValueOnce({ turnId: "next-turn" });
    await f.host.runTurn("A new task independent of the screen");
    await f.request(2, "item/tool/call", { turnId: "next-turn", tool: "lalime_type", arguments: { text: "hello", windowTitle: "Editor" } });
    expect(policy.evaluate.mock.calls.at(-1)?.[0].fromUntrustedContent).not.toBe(true);
  });

  it("flags an action while a screen read is still in progress", async () => {
    const f = await fixture();
    let finish!: (value: { ok: boolean; windows: Array<{ title: string }> }) => void;
    vi.spyOn(f.hands, "listWindows").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await f.request(1, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    await f.request(2, "item/tool/call", { tool: "lalime_type", arguments: { text: "hello", windowTitle: "Editor" } });
    finish({ ok: true, windows: [{ title: "Editor" }] });
    await flush();
    expect(policy.evaluate.mock.calls.at(-1)?.[0]).toMatchObject({ fromUntrustedContent: true });
  });

  it("uses file-change item targets when the approval only provides its item id", async () => {
    const f = await fixture();
    const changedPath = "C:\\Users\\Example\\Documents\\report.txt";
    f.client.emit("item/started", {
      threadId: "thread", turnId: "turn",
      item: { id: "file-1", type: "fileChange", changes: [{ path: changedPath, kind: "delete" }] },
    });
    await f.request(1, "item/fileChange/requestApproval", { itemId: "file-1", reason: "Read public help" });
    expect(policy.evaluate.mock.calls[0][0].paths).toContain(changedPath);
    expect(policy.evaluate.mock.calls[0][0].payload).toContain(changedPath);
  });

  it("records an accepted command only after matching successful completion, once", async () => {
    const f = await fixture();
    const command = "Write-Output 'fixture only'";
    await f.request(1, "item/commandExecution/requestApproval", { itemId: "command-1", command });
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledWith(1, "accept");
    expect(f.activity).toHaveLength(0);
    const completion = { threadId: "thread", turnId: "turn", item: { id: "command-1", type: "commandExecution", command, status: "completed", exitCode: 0 } };
    f.client.emit("item/completed", { ...completion, item: { ...completion.item, id: "unapproved-command" } });
    expect(f.activity).toHaveLength(0);
    f.client.emit("item/completed", completion);
    f.client.emit("item/completed", completion);
    expect(f.activity).toHaveLength(1);
    expect(`${f.activity[0].summary}\n${f.activity[0].details}`).toContain(command);
    expect(f.activity[0].undoable).toBe(false);
  });

  it("records uncertainty without claiming success for a failed command", async () => {
    const f = await fixture();
    await f.request(1, "item/commandExecution/requestApproval", { itemId: "command-1", command: "Write-Output 'fixture only'" });
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    f.client.emit("item/completed", { threadId: "thread", turnId: "turn", item: { id: "command-1", type: "commandExecution", status: "completed", exitCode: 1 } });
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0]).toMatchObject({ summary: expect.stringMatching(/may have partly run/i), undoable: false, stale: true });
  });

  it.each([true, false])("records typing activity only when Hands succeeds (%s)", async (ok) => {
    const f = await fixture();
    const type = vi.spyOn(f.hands, "typeText").mockResolvedValue({ ok, output: ok ? "Text entered" : "Window unavailable" });
    await f.request(1, "item/tool/call", { tool: "lalime_type", arguments: { text: "fixture text", windowTitle: "Editor" } });
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(type).toHaveBeenCalledExactlyOnceWith("fixture text", "Editor");
    expect(f.activity).toHaveLength(ok ? 1 : 0);
    if (ok) {
      expect(f.activity[0].summary).toContain("Editor");
      expect(f.activity[0].undoable).toBe(false);
    }
  });
});
