import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { DEVELOPER_INSTRUCTIONS, LALIME_DYNAMIC_TOOLS } from "../electron/main/agent-prompt.js";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

const pages = ["startupapps", "appsfeatures", "storagesense", "storagepolicies", "troubleshoot", "network-status", "windowsupdate", "printers"];
it.each(pages)("makes the Settings repair route discoverable to the model: %s", (page) => {
  const tool = LALIME_DYNAMIC_TOOLS.find((tool) => tool.name === "lalime_open_settings")!;
  expect(tool.description).toContain(`ms-settings:${page}`);
});

it("distinguishes opening repair Settings from executing or verifying a repair", () => {
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/opening a Settings page is not a completed repair/i);
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/do not type repair commands into a terminal/i);
  expect(DEVELOPER_INSTRUCTIONS).toContain("Use lalime_run_powershell");
  expect(DEVELOPER_INSTRUCTIONS).toMatch(/user must answer.*UAC/i);
});

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// Jackson, Oct 26: opening a Settings page is tier 1. Hands opens it without a card and
// the step is journalled; any change made on the page goes through its own gate.
it.each(pages)("opens %s without a card and records it", async (page) => {
  const client = new Client(); const hands = new MockHands();
  const open = vi.spyOn(hands, "openSettings");
  const host = new LiveAgentHost(client, hands);
  const cards: PendingApproval[] = []; const activity: unknown[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("activity", (item) => activity.push(item));
  try {
    await host.runTurn("Open the requested repair Settings page");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: {
      tool: "lalime_open_settings", arguments: { uri: `ms-settings:${page}` },
    } });
    await flush();
    expect(cards).toHaveLength(0);
    expect(open).toHaveBeenCalledExactlyOnceWith(`ms-settings:${page}`);
    expect(client.respondToolCall).toHaveBeenCalledWith(1, expect.objectContaining({ success: true }));
    expect(activity).toHaveLength(1);
  } finally { await host.stop(); }
});

it.each(["Uninstall", "Reset", "Turn off"])("keeps a %s click on a repair page behind a Guardian card", async (name) => {
  const client = new Client(); const hands = new MockHands();
  const click = vi.spyOn(hands, "clickElement");
  const host = new LiveAgentHost(client, hands);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  try {
    await host.runTurn("Fix my startup apps");
    client.emit("serverRequest", { id: 1, method: "item/tool/call", params: {
      tool: "lalime_click", arguments: { name, windowTitle: "Settings" },
    } });
    await flush();
    expect(click).not.toHaveBeenCalled();
    expect(cards).toHaveLength(1);
    expect(cards[0].decision).toMatchObject({ kind: "ask", tier: 2, undoable: false });
    host.respondApproval("do_it", cards[0].action.id);
    await flush();
    expect(click).toHaveBeenCalledExactlyOnceWith(name, "Settings");
  } finally { await host.stop(); }
});
