// Oct 26: plain UI clicks are tier 1, so these fixtures click a consequential control to get a card.
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { PendingApproval } from "../shared/types.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const hosts: LiveAgentHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });

async function fixture() {
  class Client extends EventEmitter {
    startThread = vi.fn(async () => "thread");
    startTurn = vi.fn(async () => ({ turnId: "turn" }));
    interruptTurn = vi.fn(async () => {});
    respondApproval = vi.fn();
    respondFileChangeApproval = vi.fn();
    respondToolCall = vi.fn();
  }
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowScreenCapture: true, allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Update my local text file");
  const send = (id: number, method: string, params: unknown) => client.emit("serverRequest", { id, method, params });
  const requestAction = async (kind: "command" | "file" | "tool") => {
    if (kind === "command") send(1, "item/commandExecution/requestApproval", {
      itemId: "command-1", command: "Set-Content C:\\Users\\Test\\Documents\\note.txt 'hello'", cwd: "C:\\Users\\Test\\Documents",
    });
    if (kind === "file") send(1, "item/fileChange/requestApproval", {
      itemId: "file-1", changes: [{ path: "C:\\Users\\Test\\Documents\\note.txt" }],
    });
    if (kind === "tool") send(1, "item/tool/call", {
      tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" },
    });
    await flush();
    expect(cards).toHaveLength(1);
    expect(cards[0].decision.kind).toBe("ask");
  };
  const beginScreenRead = () => {
    let finish!: (value: { ok: boolean; windows: Array<{ title: string }> }) => void;
    const read = vi.spyOn(hands, "listWindows").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    send(2, "item/tool/call", { tool: "lalime_list_windows", arguments: {} });
    expect(read).toHaveBeenCalledOnce();
    return () => finish({ ok: true, windows: [{ title: "Untrusted fixture window" }] });
  };
  return { client, hands, host, cards, requestAction, beginScreenRead };
}

it.each(["command", "file", "tool"] as const)("invalidates a queued %s approval when a screen read starts, before it resolves", async (kind) => {
  const f = await fixture();
  const click = vi.spyOn(f.hands, "clickElement");
  await f.requestAction(kind);
  const finishRead = f.beginScreenRead();
  try {
    expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(false);
    await flush();
    expect(click).not.toHaveBeenCalled();
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(1, "accept");
    expect(f.client.respondFileChangeApproval).not.toHaveBeenCalledWith(1, "accept");
    if (kind === "command") expect(f.client.respondApproval).toHaveBeenCalledWith(1, "decline");
    if (kind === "file") expect(f.client.respondFileChangeApproval).toHaveBeenCalledWith(1, "decline");
    if (kind === "tool") expect(f.client.respondToolCall).toHaveBeenCalledWith(1, expect.objectContaining({ success: false }));
  } finally { finishRead(); await flush(); }
});

it("rejects a task grant from an approval queued before an in-flight screen read", async () => {
  const f = await fixture();
  await f.requestAction("command");
  const finishRead = f.beginScreenRead();
  try {
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
    await flush();
    expect(f.host.getTaskGrants()).toEqual([]);
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(1, "accept");
  } finally { finishRead(); await flush(); }
});

it("revokes existing task grants as soon as screen reading starts", async () => {
  const f = await fixture();
  await f.requestAction("command");
  expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true);
  await flush();
  expect(f.host.getTaskGrants()).toHaveLength(1);
  const finishRead = f.beginScreenRead();
  try {
    expect(f.host.getTaskGrants()).toEqual([]);
  } finally { finishRead(); await flush(); }
});

it("rechecks consent provenance after approval resolves but before a command accepts", async () => {
  const f = await fixture();
  await f.requestAction("command");
  expect(f.host.respondApproval("do_it", f.cards[0].action.id)).toBe(true);
  const finishRead = f.beginScreenRead();
  try {
    await flush();
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(1, "accept");
    expect(f.client.respondApproval).toHaveBeenCalledWith(1, "decline");
  } finally { finishRead(); await flush(); }
});
