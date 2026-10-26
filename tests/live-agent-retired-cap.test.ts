import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { LiveAgentHost } from "../electron/main/live-agent.js";
import { MockHands } from "../hands/mock/index.js";
class Client extends EventEmitter {
  index = 0;
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async (): Promise<{ turnId?: string }> => ({ turnId: `turn-${++this.index}` }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn();
}
const hosts: LiveAgentHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.stop(); });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const client = new Client(); const hands = new MockHands();
  const host = new LiveAgentHost(client, hands); hosts.push(host);
  const list = vi.spyOn(hands, "listWindows");
  const send = (id: number, turnId: string) => client.emit("serverRequest", { id, method: "item/tool/call", params: { threadId: "thread", turnId, tool: "lalime_list_windows", arguments: {} } });
  return { client, host, list, send };
}
async function starting(f: ReturnType<typeof fixture>) {
  let release!: (value: { turnId?: string }) => void;
  f.client.startTurn.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const run = f.host.runTurn("Next task"); await flush();
  return { run, release };
}
it("retains at most the last 64 retired turn ids", async () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) { await f.host.runTurn("Task"); await f.host.stop(); }
  const retired = (f.host as unknown as { retiredTurnIds: Set<string> }).retiredTurnIds;
  expect(retired.size).toBe(64); expect(retired.has("turn-1")).toBe(false); expect(retired.has("turn-80")).toBe(true);
});
it("rejects an evicted old request after startup identifies the current turn", async () => {
  const f = fixture();
  for (let i = 0; i < 80; i++) { await f.host.runTurn("Task"); await f.host.stop(); }
  const pending = await starting(f); f.send(1, "turn-1"); await flush();
  expect(f.list).not.toHaveBeenCalled();
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(f.list).not.toHaveBeenCalled(); expect(f.client.respondToolCall).toHaveBeenCalledOnce();
  expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
it("holds a current early request and notifications until the returned id is known", async () => {
  const f = fixture(); const messages: string[] = [];
  f.host.on("messageDone", (message) => messages.push(message));
  const pending = await starting(f); f.send(2, "current");
  f.client.emit("item/completed", { threadId: "thread", turnId: "current", item: { type: "agentMessage", text: "Current answer" } });
  await flush(); expect(f.list).not.toHaveBeenCalled(); expect(messages).toEqual([]);
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(f.list).toHaveBeenCalledOnce(); expect(messages).toEqual(["Current answer"]);
});
it("rejects buffered requests exactly once and drops notifications on Stop", async () => {
  const f = fixture(); const messages: string[] = []; f.host.on("messageDone", (message) => messages.push(message));
  const pending = await starting(f); f.send(3, "current"); f.send(3, "current");
  f.client.emit("item/completed", { turnId: "current", item: { type: "agentMessage", text: "Stopped answer" } });
  await f.host.stop(); await flush();
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(f.list).not.toHaveBeenCalled(); expect(messages).toEqual([]);
  expect(f.client.respondToolCall).toHaveBeenCalledOnce(); expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
it.each(["count", "bytes"])("fails startup safely if the early event buffer exceeds its %s budget", async (limit) => {
  const f = fixture(); const pending = await starting(f); f.send(4, "current");
  for (let i = 0; i < (limit === "count" ? 300 : 1); i++) f.client.emit("item/agentMessage/delta", { turnId: "current", delta: limit === "bytes" ? "x".repeat(1_100_000) : "x" });
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(f.list).not.toHaveBeenCalled(); expect(f.client.respondToolCall).toHaveBeenCalledOnce();
  expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
it("rejects tagged early requests when startup returns no turn id", async () => {
  const f = fixture(); const pending = await starting(f); f.send(5, "unknown");
  pending.release({}); await pending.run; await flush();
  expect(f.list).not.toHaveBeenCalled(); expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});

it("counts the complete request envelope against the startup byte budget", async () => {
  const f = fixture(); const pending = await starting(f);
  f.client.emit("serverRequest", { id: "id-" + "x".repeat(1_100_000), method: "item/tool/call", params: { turnId: "current", tool: "lalime_list_windows", arguments: {} } });
  await flush(); const replies = [...f.client.respondToolCall.mock.calls];
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(replies).toHaveLength(1); expect(replies[0][1].success).toBe(false);
  expect(f.list).not.toHaveBeenCalled();
});

it("delivers a valid completion that arrives before the start response", async () => {
  const f = fixture(); const done = vi.fn(); f.host.on("turnDone", done);
  const pending = await starting(f);
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "current", status: "completed" } });
  expect(done).not.toHaveBeenCalled(); pending.release({ turnId: "current" }); await pending.run;
  expect(done).toHaveBeenCalledOnce();
});

it("rejects buffered requests when startup fails", async () => {
  const f = fixture(); let reject!: (error: Error) => void;
  f.client.startTurn.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const run = f.host.runTurn("Task"); const failure = expect(run).rejects.toThrow("Fixture start failed");
  await flush(); f.send(7, "current"); reject(new Error("Fixture start failed")); await failure; await flush();
  expect(f.list).not.toHaveBeenCalled(); expect(f.client.respondToolCall).toHaveBeenCalledOnce();
  expect(f.client.respondToolCall.mock.calls[0][1].success).toBe(false);
});
