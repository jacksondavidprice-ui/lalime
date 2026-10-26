import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { ApprovalQueueEntry, PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
type DisplayMetadata = { summaryTruncated?: boolean; summaryFullLength?: number; grantUnavailableReason?: string };
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); vi.restoreAllMocks(); });
async function fixture() {
  const client = new Client();
  const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true });
  hosts.push(host);
  const cards: Array<PendingApproval & DisplayMetadata> = [];
  let queue: ReadonlyArray<ApprovalQueueEntry & DisplayMetadata> = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("approvalQueue", (_count, entries) => { queue = entries; });
  await host.runTurn("Help with the selected local task");
  let requestId = 0;
  const command = async (command: string) => {
    const id = ++requestId;
    client.emit("serverRequest", { id, method: "item/commandExecution/requestApproval", params: { itemId: `cmd-${id}`, command } });
    await flush();
    return id;
  };
  return { client, host, cards, queue: () => queue, command };
}

describe("batch 7 approval previews and presentation binding", () => {
  it.each([0x00ad, 0x180e, 0x3164, 0xffa0, 0x115f, 0xfff9, 0xfffa, 0xfffb, 0xe0000, 0xe007f])("escapes invisible code point %s on the card and queue", async (codePoint) => {
    const f = await fixture();
    const invisible = String.fromCodePoint(codePoint);
    await f.command(`Write-Output 'before${invisible}after'`);
    expect(f.cards).toHaveLength(1);
    const summary = f.cards[0].action.summary!;
    expect(summary).not.toContain(invisible);
    expect(summary).toContain(codePoint.toString(16));
    expect(f.queue()[0].summary).toBe(summary);
    expect(f.cards[0].action.payload).toContain(invisible);
  });

  it.each([6000, 200_000])("caps a %i-unit summary once at enqueue while preserving raw details and exact metadata", async (size) => {
    const f = await fixture();
    const command = `Write-Output '${"x".repeat(size)}'`;
    await f.command(command);
    const card = f.cards[0];
    const summary = card.action.summary!;
    expect(summary.length).toBeLessThanOrEqual(4096);
    const suffix = summary.match(/\.\.\.\(\+(\d+) more\)$/);
    expect(suffix).not.toBeNull();
    expect(card).toMatchObject({ summaryTruncated: true, summaryFullLength: `Run: ${command}`.length });
    expect(Number(suffix![1])).toBe(card.summaryFullLength! - (summary.length - suffix![0].length));
    expect(card.action.payload).toBe(command);
    expect(card.decision.details).toBe(command);
    const before = f.queue()[0];
    await f.command("Write-Output next");
    expect(f.queue()[0]).toEqual(before);
    expect(f.queue()[0]).toMatchObject({ summary, summaryTruncated: true, summaryFullLength: card.summaryFullLength });
  });

  it("caps a 5000-path recycle preview and preserves all targets for the hold card", async () => {
    const f = await fixture();
    const paths = Array.from({ length: 5000 }, (_, i) => `C:\\Users\\Fixture\\Downloads\\${i}.tmp`);
    f.client.emit("serverRequest", { id: 5001, method: "item/tool/call", params: { tool: "lalime_recycle", arguments: { paths } } });
    await flush();
    expect(f.cards).toHaveLength(1);
    const card = f.cards[0];
    expect(card.decision.kind).toBe("ask_hold");
    expect(card.action.paths).toEqual(paths);
    expect(card.action.summary!.length).toBeLessThanOrEqual(4096);
    expect(card.summaryTruncated).toBe(true);
    expect(card.summaryFullLength).toBe(`Move to the Recycle Bin: ${paths.join(", ")}`.length);
    expect(f.queue()[0].summary).toBe(card.action.summary);
  });

  it.each(["Remove-Item 'C:\\Users\\Fixture\\Downloads\\a.tmp'", "& $taskCommand"])("explains why a command has no reusable grant: %s", async (command) => {
    const f = await fixture();
    await f.command(command);
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.cards[0].grantUnavailableReason).toEqual(expect.any(String));
    expect(f.cards[0].grantUnavailableReason!.length).toBeGreaterThan(0);
    expect(f.queue()[0].grantUnavailableReason).toBe(f.cards[0].grantUnavailableReason);
  });

  it("does not attach unavailable or truncated metadata to an ordinary eligible card", async () => {
    const f = await fixture();
    await f.command("Write-Output hello");
    expect(f.cards[0].canAllowForTask).toBe(true);
    expect(f.cards[0]).not.toHaveProperty("grantUnavailableReason");
    expect(f.cards[0]).not.toHaveProperty("summaryTruncated");
    expect(f.queue()[0]).not.toHaveProperty("summaryTruncated");
  });

  it("rejects a queue-preview ID before its first approvalNeeded event", async () => {
    const f = await fixture();
    const attempts: boolean[] = [];
    f.host.on("approvalQueue", (_count, queue) => {
      if (queue.length === 1) attempts.push(f.host.respondApproval("not_now", queue[0].actionId));
    });
    await f.command("Write-Output hello");
    expect(attempts).toEqual([false]);
    expect(f.client.respondApproval).not.toHaveBeenCalled();
    expect(f.host.respondApproval("not_now", f.cards[0].action.id)).toBe(true);
  });

  it("rejects the next queue ID during the handoff before it becomes the current card", async () => {
    const f = await fixture();
    await f.command("Write-Output first");
    await f.command("Write-Output second");
    const nextId = f.queue()[1].actionId;
    const attempts: boolean[] = [];
    f.host.on("approvalQueue", (_count, queue) => {
      if (queue.length === 1 && queue[0].actionId === nextId) attempts.push(f.host.respondApproval("do_it", nextId));
    });
    expect(f.host.respondApproval("not_now", f.cards[0].action.id)).toBe(true);
    expect(attempts).toEqual([false]);
    await flush();
    expect(f.cards.at(-1)?.action.id).toBe(nextId);
    expect(f.client.respondApproval).not.toHaveBeenCalledWith(2, "accept");
    expect(f.host.respondApproval("not_now", nextId)).toBe(true);
  });

  it("does not begin a hold using a preview ID before the card is emitted", async () => {
    const f = await fixture();
    const attempts: boolean[] = [];
    f.host.on("approvalQueue", (_count, queue) => {
      if (queue.length === 1) attempts.push(f.host.beginApprovalHold(queue[0].actionId));
    });
    await f.command("Start-Service Spooler");
    expect(f.cards[0].decision.kind).toBe("ask_hold");
    expect(attempts).toEqual([false]);
    expect(f.host.beginApprovalHold(f.cards[0].action.id)).toBe(true);
  });

  it("clears the presented ID on Stop and a new task, including hold state", async () => {
    const f = await fixture();
    await f.command("Start-Service Spooler");
    const stoppedId = f.cards[0].action.id;
    expect(f.host.beginApprovalHold(stoppedId)).toBe(true);
    await f.host.stop();
    expect(f.host.respondApproval("not_now", stoppedId)).toBe(false);
    expect(f.host.beginApprovalHold(stoppedId)).toBe(false);
    await f.host.runTurn("Help with a separate local task");
    await f.command("Start-Service Spooler");
    const replacedId = f.cards.at(-1)!.action.id;
    expect(f.host.respondApproval("not_now", stoppedId)).toBe(false);
    expect(f.host.beginApprovalHold(replacedId)).toBe(true);
    await f.host.runTurn("Another distinct local task");
    expect(f.host.respondApproval("not_now", replacedId)).toBe(false);
    expect(f.host.beginApprovalHold(replacedId)).toBe(false);
    await f.command("Write-Output hello");
    expect(f.host.respondApproval("not_now", f.cards.at(-1)!.action.id)).toBe(true);
  });
});
