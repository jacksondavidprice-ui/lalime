// Oct 26: plain UI clicks are tier 1, so these fixtures click a consequential control to get a card.
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { AppSnapshot, ApprovalQueueEntry, PendingApproval } from "../shared/types.js";

const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => state.directory },
  shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false },
}));
import { SessionController } from "../electron/main/session.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn-1" }));
  interruptTurn = vi.fn(async () => undefined);
  stop = vi.fn();
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const sessions: SessionController[] = [];
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-queue-preview-")); });
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
  for (const session of sessions.splice(0)) session.dispose();
  rmSync(state.directory, { recursive: true, force: true });
});
async function fixture() {
  const client = new Client();
  const session = new SessionController(new MockHands());
  sessions.push(session);
  session.attachLiveClient(client as never);
  await session.sendMessage("Update my selected files and settings");
  let id = 0;
  const request = async (method: string, params: object) => {
    client.emit("serverRequest", { id: ++id, method, params });
    await flush();
  };
  const command = (command = "Write-Output 'fixture'") => request("item/commandExecution/requestApproval", { itemId: `cmd-${id + 1}`, command, reason: "Assistant claim must not be the headline" });
  const queue = () => session.getSnapshot().approvalQueue;
  return { client, session, request, command, queue };
}

it("publishes ordered safe queue previews through Session snapshots with the card's summary", async () => {
  const f = await fixture();
  await f.command("Write-Output 'first\n\u061c\u202e\u201d'; Write-Output 'second'");
  await f.request("item/tool/call", { tool: "lalime_click", arguments: { name: "Reset\n\u201d in \u201cForged window", windowTitle: "Actual Settings" } });
  const snapshot = f.session.getSnapshot();
  expect(snapshot.approvalQueue).toHaveLength(2);
  const queue = snapshot.approvalQueue!;
  expect(snapshot.pendingApprovalCount).toBe(queue.length);
  expect(queue[0]).toEqual({ actionId: snapshot.pendingApproval!.action.id, kind: "powershell", summary: snapshot.pendingApproval!.action.summary, tier: 2, canAllowForTask: true });
  expect(Object.keys(queue[1]).sort()).toEqual(["actionId", "canAllowForTask", "kind", "summary", "tier"]);
  expect(queue[1]).toMatchObject({ kind: "ui_click", tier: 2, canAllowForTask: true });
  for (const entry of queue) {
    expect(entry.summary).not.toMatch(/[\n\u061c\u202e]/);
    expect(entry.summary).toContain("\u201d");
    expect(entry.summary).toContain("\\n");
    expect(entry.summary).not.toContain("Assistant claim");
  }
  expect(queue[0].summary).toContain("\\u061c");
  expect(queue[1].summary).toContain("Actual Settings");
  expect(await f.session.respondApproval("do_it", queue[1].actionId)).toBe(false);
  expect(await f.session.respondApproval("not_now", queue[0].actionId)).toBe(true);
  await flush();
  expect(f.queue()).toEqual([queue[1]]);
  expect(f.session.getSnapshot().pendingApproval?.action.summary).toBe(queue[1].summary);
});

it("keeps the existing count event argument and adds an immutable detached preview list", async () => {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands()); hosts.push(host);
  const events: Array<{ count: number; queue: readonly ApprovalQueueEntry[] }> = [];
  const cards: PendingApproval[] = [];
  host.on("approvalQueue", (count, queue) => events.push({ count, queue }));
  host.on("approvalNeeded", (card) => cards.push(card));
  await host.runTurn("Update the selected file");
  client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { command: "Write-Output hello" } });
  await flush();
  const event = events.at(-1)!;
  expect(event.count).toBe(1);
  expect(event.queue).toHaveLength(1);
  expect(Object.isFrozen(event.queue)).toBe(true);
  expect(Object.isFrozen(event.queue[0])).toBe(true);
  expect(event.queue[0].actionId).toBe(cards[0].action.id);
  await host.stop();
  expect(events.at(-1)).toEqual({ count: 0, queue: [] });
  expect(event.queue).toHaveLength(1);
});

it("never publishes a stale current card after its queue entry is removed", async () => {
  const f = await fixture();
  await f.command(); await f.command("Write-Output 'next'");
  const first = f.session.getSnapshot().pendingApproval!;
  const snapshots: AppSnapshot[] = [];
  f.session.on("snapshot", (snapshot) => snapshots.push(snapshot));
  expect(await f.session.respondApproval("not_now", first.action.id)).toBe(true);
  await flush();
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    if (snapshot.pendingApproval) {
      expect(snapshot.approvalQueue?.some((entry) => entry.actionId === snapshot.pendingApproval!.action.id)).toBe(true);
    }
  }
});

it("clears old queue previews when a new task starts without Stop", async () => {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands()); hosts.push(host);
  let queue: readonly ApprovalQueueEntry[] | undefined;
  host.on("approvalQueue", (_count, entries) => { queue = entries; });
  await host.runTurn("First task");
  client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { command: "Write-Output first" } });
  await flush();
  expect(queue).toHaveLength(1);
  const oldId = queue![0].actionId;
  client.startTurn.mockResolvedValueOnce({ turnId: "turn-2" });
  await host.runTurn("New independent task");
  expect(queue).toEqual([]);
  expect(host.respondApproval("do_it", oldId)).toBe(false);
});

it("invalidates a card and its preview if task startup fails after requesting approval", async () => {
  const f = await fixture();
  f.session.stop();
  let actionId = "";
  f.client.startTurn.mockImplementationOnce(async () => {
    await f.command("Write-Output 'startup request'");
    expect(f.queue()).toHaveLength(1);
    actionId = f.queue()![0].actionId;
    throw new Error("Fixture task startup failure");
  });
  await f.session.sendMessage("Start another task");
  await flush();
  expect(f.queue()).toEqual([]);
  expect(f.session.getSnapshot().pendingApproval).toBeNull();
  expect(await f.session.respondApproval("do_it", actionId)).toBe(false);
  expect(f.client.respondApproval).toHaveBeenCalledWith(1, "decline");
  expect(f.client.respondApproval).not.toHaveBeenCalledWith(1, "accept");
});

it("ignores a retired task's late startup rejection while the new queue remains current", async () => {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands()); hosts.push(host);
  let rejectOld!: (error: Error) => void;
  client.startTurn.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  let queue: readonly ApprovalQueueEntry[] | undefined;
  host.on("approvalQueue", (_count, entries) => { queue = entries; });
  const oldTurn = host.runTurn("Old task");
  void oldTurn.catch(() => {});
  await flush();
  await host.stop();
  await host.runTurn("New task");
  client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { command: "Write-Output current" } });
  await flush();
  expect(queue).toHaveLength(1);
  const currentId = queue![0].actionId;
  rejectOld(new Error("Obsolete startup failure"));
  await expect(oldTurn).resolves.toBeUndefined();
  expect(queue![0].actionId).toBe(currentId);
  expect(host.respondApproval("not_now", currentId)).toBe(true);
});

it.each(["Stop", "screen read", "turn completed", "disconnect", "transport error"])("clears queue previews at %s", async (reset) => {
  const f = await fixture();
  await f.command(); await f.command("Write-Output 'queued'");
  expect(f.queue()).toHaveLength(2);
  if (reset === "Stop") f.session.stop();
  if (reset === "screen read") await f.request("item/tool/call", { tool: "lalime_list_ui", arguments: { windowTitle: "Settings" } });
  if (reset === "turn completed") f.client.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
  if (reset === "disconnect") f.session.disconnect();
  if (reset === "transport error") f.client.emit("transportError", new Error("Fixture disconnected"));
  await flush();
  expect(f.queue()).toEqual([]);
  expect(f.session.getSnapshot().pendingApprovalCount).toBe(0);
  expect(f.session.getSnapshot().pendingApproval).toBeNull();
});

it("removes stale mutation previews after a never-list block but keeps unrelated UI previews", async () => {
  const f = await fixture();
  await f.command();
  await f.request("item/tool/call", { tool: "lalime_click", arguments: { name: "Reset", windowTitle: "Settings" } });
  expect(f.queue()).toHaveLength(2);
  const ui = f.queue()![1];
  await f.command("Format-Volume -DriveLetter C");
  expect(f.queue()).toEqual([ui]);
  expect(f.session.getSnapshot().pendingApproval?.action.id).toBe(ui.actionId);
  await f.command("Write-Output 'after block'");
  expect(f.queue()![1]).toMatchObject({ kind: "powershell", tier: 3, canAllowForTask: false });
});

it("previews bulk hold risk without exposing hidden command or target payloads", async () => {
  const f = await fixture();
  await f.command();
  await f.request("item/tool/call", { tool: "lalime_recycle", arguments: { paths: Array.from({ length: 100 }, (_, i) => `C:\\Users\\Example\\Downloads\\${i}.txt`) } });
  expect(f.queue()).toHaveLength(2);
  expect(f.queue()![1]).toMatchObject({ kind: "file_move", tier: 3, canAllowForTask: false });
  expect(Object.keys(f.queue()![1]).sort()).toEqual(["actionId", "canAllowForTask", "grantUnavailableReason", "kind", "summary", "tier"]);
});
