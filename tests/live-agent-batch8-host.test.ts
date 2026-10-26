import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
import type { ApprovalQueueEntry, PendingApproval } from "../shared/types.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: `turn-${++this.turn}` }));
  turn = 0;
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture() {
  const client = new Client();
  const hands = new MockHands();
  const host = new LiveAgentHost(client, hands, { allowComputerControl: true });
  hosts.push(host);
  const cards: PendingApproval[] = [];
  const queues: Array<{ count: number; entries: readonly ApprovalQueueEntry[] }> = [];
  const activity: Array<{ summary: string }> = [];
  host.on("approvalNeeded", (card) => cards.push(card));
  host.on("approvalQueue", (count, entries) => queues.push({ count, entries }));
  host.on("activity", (entry) => activity.push(entry));
  await host.runTurn("Help with these local files and the selected window");
  let id = 0;
  const send = (method: string, params: unknown) => {
    const requestId = ++id;
    client.emit("serverRequest", { id: requestId, method, params });
    return requestId;
  };
  const command = (command: string) => send("item/commandExecution/requestApproval", { itemId: `item-${id + 1}`, command });
  const tool = (tool: string, args: Record<string, unknown>) => send("item/tool/call", { tool, arguments: args });
  return { client, hands, host, cards, queues, activity, command, tool };
}

describe("batch 8 host queue, display, withdrawal and scope", () => {
  it.each(["failure", "Stop"])("records an accepted command that may have partly run after %s", async (ending) => {
    const f = await fixture();
    f.command("Write-Output uncertain"); await flush();
    f.host.respondApproval("do_it", f.cards[0].action.id); await flush();
    expect(f.activity).toHaveLength(0);
    if (ending === "Stop") await f.host.stop();
    else f.client.emit("item/completed", { threadId: "thread", turnId: "turn-1", item: { id: "item-1", type: "commandExecution", status: "failed", exitCode: 1 } });
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0].summary).toMatch(/may have partly run/i);
    expect(f.activity[0]).toMatchObject({ undoable: false, details: expect.stringContaining("Write-Output uncertain") });
    await f.host.stop(); expect(f.activity).toHaveLength(1);
  });
  it.each(["OneDrive", "OneDriveCommercial", "OneDriveConsumer"])("does not grant a redirected sync root from %s", async (key) => {
    vi.stubEnv(key, "C:\\Users\\Fixture\\CompanySync");
    const f = await fixture();
    f.tool("lalime_recycle", { paths: ["C:\\Users\\Fixture\\CompanySync"] }); await flush();
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].canAllowForTask).toBe(false);
  });
  it("bounds every queue preview to 50 while retaining exact total and synchronous removal", async () => {
    const f = await fixture();
    for (let i = 0; i < 300; i++) f.command(`Write-Output '${i}:${"x".repeat(50000)}'`);
    await flush();
    expect(f.queues.at(-1)?.count).toBe(300);
    expect(f.queues.at(-1)?.entries).toHaveLength(50);
    expect(f.queues.every((queue) => queue.entries.length <= 50)).toBe(true);
    expect(f.queues.reduce((sum, queue) => sum + queue.entries.length, 0)).toBeLessThanOrEqual(300 * 50);
    expect(f.host.respondApproval("not_now", f.cards[0].action.id)).toBe(true);
    expect(f.queues.at(-1)?.count).toBe(299);
    expect(f.queues.at(-1)?.entries).toHaveLength(50);
  }, 20_000);

  it("escapes and bounds decision text while keeping full command details", async () => {
    const f = await fixture();
    const command = `Write-Output '${"x".repeat(6000)}\u202e'`;
    f.command(command);
    await flush();
    expect(f.cards[0].decision.plainEnglish.length).toBeLessThanOrEqual(4096);
    expect(f.cards[0].decision.plainEnglish).not.toContain("\u202e");
    expect(f.cards[0].decision.details).toBe(command);
    expect(f.cards[0].action.payload).toBe(command);
  });

  it.each(["\u202e", "\u{e0001}"])("keeps complete escape sequences at all 12 truncation offsets for %s", async (invisible) => {
    const f = await fixture();
    for (let offset = 0; offset < 12; offset++) {
      f.command(`Write-Output '${"x".repeat(offset)}${invisible.repeat(900)}'`);
      await flush();
      const card = f.cards.at(-1)!;
      for (const value of [card.action.summary!, card.decision.plainEnglish]) {
        const prefix = value.replace(/\.\.\.\(\+\d+ more\)$/, "");
        expect(prefix).not.toMatch(/\\(?:u[0-9a-f]{0,3}|u\{[0-9a-f]*)?$/i);
        expect(value.length).toBeLessThanOrEqual(4096);
      }
      f.host.respondApproval("not_now", card.action.id);
      await flush();
    }
  });

  it.each(["stop", "new task", "screen read"])("reports host withdrawal, not user decline, after %s", async (cause) => {
    const f = await fixture();
    const id = f.tool("lalime_click", { name: "Save", windowTitle: "Editor" });
    await flush();
    expect(f.cards).toHaveLength(1);
    if (cause === "stop") await f.host.stop();
    else if (cause === "new task") await f.host.runTurn("A separate task");
    else f.tool("lalime_list_windows", {});
    await flush();
    const response = f.client.respondToolCall.mock.calls.find(([request]) => request === id)?.[1];
    expect(response?.success).toBe(false);
    expect(JSON.stringify(response)).toMatch(/withdrawn|no longer current|cancelled/i);
    expect(JSON.stringify(response)).not.toContain("User declined");
  });

  it("retains explicit user-decline wording", async () => {
    const f = await fixture();
    const id = f.tool("lalime_click", { name: "Save", windowTitle: "Editor" });
    await flush();
    f.host.respondApproval("not_now", f.cards[0].action.id);
    await flush();
    expect(JSON.stringify(f.client.respondToolCall.mock.calls.find(([request]) => request === id)?.[1])).toContain("User declined");
  });

  it.each(["OneDrive", "OneDrive - School", "Dokumente", "Documentos", "Téléchargements", "Escritorio", "Bilder", "文档", "下载", "DOCUME~1", "DOWNLO~1", "Documents.", "Downloads ", "OneDrive. "])("does not grant a broad folder alias: %s", async (name) => {
    const f = await fixture();
    f.tool("lalime_recycle", { paths: [`C:\\Users\\Fixture\\${name}`] });
    await flush();
    expect(f.cards).toHaveLength(1);
    expect(f.cards[0].canAllowForTask).toBe(false);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(false);
  });

  it("reuses a recycle grant for the same path set in a different order", async () => {
    const f = await fixture();
    const paths = ["C:\\Users\\Fixture\\Downloads\\a.tmp", "C:\\Users\\Fixture\\Downloads\\b.tmp"];
    const move = vi.spyOn(f.hands, "moveToRecycleBin");
    f.tool("lalime_recycle", { paths });
    await flush();
    expect(f.cards[0].canAllowForTask).toBe(true);
    expect(f.host.respondApproval("allow_for_task", f.cards[0].action.id)).toBe(true);
    await flush();
    f.tool("lalime_recycle", { paths: [...paths].reverse() });
    await flush();
    expect(f.cards).toHaveLength(1);
    expect(move).toHaveBeenCalledTimes(2);
    expect(move.mock.calls[1][0]).toEqual([...paths].reverse());
  });

  it("escapes bidi and invisible characters in successful recycle activity", async () => {
    const f = await fixture();
    f.tool("lalime_recycle", { paths: ["C:\\Users\\Fixture\\Downloads\\safe\u202e\u00ad.txt"] });
    await flush();
    f.host.respondApproval("do_it", f.cards[0].action.id);
    await flush();
    expect(f.activity).toHaveLength(1);
    expect(f.activity[0].summary).not.toMatch(/[\u202e\u00ad]/);
    expect(f.activity[0].summary).toContain("\\u202e");
  });
});
