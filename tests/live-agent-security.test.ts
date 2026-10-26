import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import { NodeHands } from "../hands/src/node-hands.js";
import type { PendingApproval } from "../shared/types.js";

class TestClient extends EventEmitter {
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
async function fixture(options = {}) {
  const client = new TestClient();
  const hands = new MockHands();
  const host = new LiveAgentHost(client as never, hands, options);
  hosts.push(host);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card: PendingApproval) => cards.push(card));
  await host.runTurn("Help with my computer");
  const request = async (id: number, method: string, params: unknown) => {
    client.emit("serverRequest", { id, method, params });
    await flush();
  };
  return { client, hands, host, cards, request };
}

describe("live agent security boundaries", () => {
  it("queues approvals and binds a decision to the displayed action", async () => {
    const f = await fixture();
    await f.request(1, "item/fileChange/requestApproval", { reason: "First change" });
    await f.request(2, "item/fileChange/requestApproval", { reason: "Second change" });
    expect(f.cards).toHaveLength(1);
    f.host.respondApproval("do_it", "stale-action");
    await flush();
    expect(f.client.respondFileChangeApproval).not.toHaveBeenCalled();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(f.client.respondFileChangeApproval).toHaveBeenCalledWith(1, "accept");
    expect(f.cards).toHaveLength(2);
  });

  it("sends one decline per pending request when stopped", async () => {
    const f = await fixture();
    await f.request(1, "item/fileChange/requestApproval", { reason: "Change file" });
    await f.host.stop();
    await flush();
    expect(f.client.respondApproval).not.toHaveBeenCalled();
    expect(f.client.respondFileChangeApproval).toHaveBeenCalledExactlyOnceWith(1, "decline");
  });

  it("does not create an approval after a delayed precheck completes following Stop", async () => {
    const f = await fixture();
    let finish!: (value: { blocked: boolean }) => void;
    f.hands.precheckPowerShell = () => new Promise((resolve) => { finish = resolve; });
    await f.request(1, "item/commandExecution/requestApproval", { command: "Get-Date" });
    await f.host.stop();
    finish({ blocked: false });
    await flush();
    expect(f.cards).toHaveLength(0);
    expect(f.client.respondApproval).toHaveBeenCalledExactlyOnceWith(1, "decline");
  });

  it.each(["lalime_click", "lalime_type", "lalime_open_settings"])("requires consent for %s", async (tool) => {
    const f = await fixture();
    const click = vi.spyOn(f.hands, "clickElement");
    const type = vi.spyOn(f.hands, "typeText");
    const open = vi.spyOn(f.hands, "openSettings");
    await f.request(1, "item/tool/call", { tool, arguments: { name: "Send", text: "hello", uri: "ms-settings:display", windowTitle: "Editor" } });
    expect(f.cards).toHaveLength(1);
    expect(click).not.toHaveBeenCalled();
    expect(type).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    f.host.respondApproval("not_now", f.cards[0].action.id);
    await flush();
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
  });

  it.each(["C:\\Windows\\notepad.exe", "https://example.com", "ms-settings:display & calc.exe", "ms-settings:display\n"])("rejects unsafe Settings URI %s", async (uri) => {
    const f = await fixture();
    const open = vi.spyOn(f.hands, "openSettings");
    await f.request(1, "item/tool/call", { tool: "lalime_open_settings", arguments: { uri } });
    expect(open).not.toHaveBeenCalled();
    expect(f.cards).toHaveLength(0);
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
  });

  it("enforces privacy and computer-control settings before backend calls", async () => {
    const f = await fixture({ allowScreenCapture: false, allowComputerControl: false });
    const shot = vi.spyOn(f.hands, "screenshot");
    const click = vi.spyOn(f.hands, "clickElement");
    await f.request(1, "item/tool/call", { tool: "lalime_screenshot", arguments: {} });
    await f.request(2, "item/tool/call", { tool: "lalime_click", arguments: { name: "Send" } });
    expect(shot).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(f.client.respondToolCall.mock.calls.every((call) => call[1].success === false)).toBe(true);
  });

  it.each([
    ["lalime_list_windows", false],
    ["lalime_list_ui", false],
    ["lalime_list_windows", true],
    ["lalime_list_ui", true],
  ] as const)("blocks %s without screen permission when computer control is %s", async (tool, allowComputerControl) => {
    const f = await fixture({ allowScreenCapture: false, allowComputerControl });
    const windows = vi.spyOn(f.hands, "listWindows");
    const elements = vi.spyOn(f.hands, "listUiElements");
    await f.request(1, "item/tool/call", { tool, arguments: { windowTitle: "Editor" } });
    expect(windows).not.toHaveBeenCalled();
    expect(elements).not.toHaveBeenCalled();
    expect(f.client.respondToolCall).toHaveBeenCalledOnce();
    const response = f.client.respondToolCall.mock.calls[0][1];
    expect(response.success).toBe(false);
    expect(response.contentItems[0].text).toMatch(/disabled/i);
  });

  it.each(["lalime_list_windows", "lalime_list_ui"])("allows %s with screen permission and computer control off", async (tool) => {
    const f = await fixture({ allowScreenCapture: true, allowComputerControl: false });
    const windows = vi.spyOn(f.hands, "listWindows");
    const elements = vi.spyOn(f.hands, "listUiElements");
    await f.request(1, "item/tool/call", { tool, arguments: { windowTitle: "Editor" } });
    if (tool === "lalime_list_windows") {
      expect(windows).toHaveBeenCalledExactlyOnceWith();
      expect(elements).not.toHaveBeenCalled();
    } else {
      expect(elements).toHaveBeenCalledExactlyOnceWith("Editor");
      expect(windows).not.toHaveBeenCalled();
    }
    expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(true);
  });

  it("passes model and custom instructions and limits tool calls per turn", async () => {
    const f = await fixture({ model: "chosen-model", instructions: "Use concise replies.", maxToolCalls: 1 });
    expect(f.client.startThread.mock.calls[0][0]).toMatchObject({ model: "chosen-model" });
    expect(f.client.startThread.mock.calls[0][0].developerInstructions).toContain("Use concise replies.");
    const list = vi.spyOn(f.hands, "listWindows");
    await f.request(1, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    await f.request(2, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    expect(list).toHaveBeenCalledTimes(1);
    expect(f.client.respondToolCall.mock.calls[1][1].success).toBe(false);
  });

  it("rejects unsafe Settings URI in NodeHands before launching a process", async () => {
    const result = await new NodeHands().openSettings("invalid-scheme:blocked");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Settings URI");
  });
});
