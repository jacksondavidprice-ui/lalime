/** Compiled SessionController startup QA. Provider and Hands are local fixtures. */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => electron.directory },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() }, clipboard: { writeText: vi.fn() },
}));
import { SessionController } from "../artifacts/codex-c-batch11/dist-electron/electron/main/session.js";
import { MockHands } from "../artifacts/codex-c-batch11/dist-electron/hands/mock/index.js";

class Client extends EventEmitter {
  index = 0;
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async (): Promise<{ turnId?: string }> => ({ turnId: `turn-${++this.index}` }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn(); stop = vi.fn();
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const fixtures: ReturnType<typeof fixture>[] = [];
function fixture(label: string) {
  const evidence = path.resolve("scratch/qa-batch11");
  mkdirSync(evidence, { recursive: true });
  electron.directory = mkdtempSync(path.join(evidence, "startup-profile-"));
  const hands = new MockHands(); const client = new Client(); const session = new SessionController(hands);
  const snapshots: unknown[] = [];
  session.on("snapshot", (snapshot: unknown) => snapshots.push(structuredClone(snapshot)));
  session.attachLiveClient(client as never);
  const list = vi.spyOn(hands, "listWindows");
  const send = (id: number, turnId: string) => client.emit("serverRequest", {
    id, method: "item/tool/call", params: { threadId: "thread", turnId, tool: "lalime_list_windows", arguments: {} },
  });
  const answer = (turnId: string, text: string) => client.emit("item/completed", {
    threadId: "thread", turnId, item: { type: "agentMessage", text },
  });
  const complete = (turnId: string) => client.emit("turn/completed", {
    threadId: "thread", turn: { id: turnId, status: "completed" },
  });
  const f = { session, client, hands, list, send, answer, complete, snapshots, evidence, label };
  fixtures.push(f); return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    writeFileSync(path.join(f.evidence, `startup-${f.label}.json`), JSON.stringify({
      snapshots: f.snapshots, responses: f.client.respondToolCall.mock.calls, listCalls: f.list.mock.calls.length,
    }, null, 2));
    f.session.dispose(); await flush();
  }
});
async function starting(f: ReturnType<typeof fixture>) {
  let release!: (value: { turnId?: string }) => void;
  let reject!: (reason: Error) => void;
  f.client.startTurn.mockImplementation(() => new Promise((resolve, fail) => { release = resolve; reject = fail; }));
  const run = f.session.sendMessage("Read the open windows for this task");
  await flush(); return { run, release, reject };
}
function refused(f: ReturnType<typeof fixture>, id: number) {
  const replies = f.client.respondToolCall.mock.calls.filter((call) => call[0] === id);
  expect(replies).toHaveLength(1); expect(replies[0][1].success).toBe(false);
}
function visible(f: ReturnType<typeof fixture>) {
  return f.session.getSnapshot().messages.map((message: { content: string }) => message.content).join("\n");
}

it("caps retired IDs at 64 and rejects an evicted ID while preserving current early events", async () => {
  const f = fixture("retired-cap");
  for (let i = 0; i < 80; i++) { await f.session.sendMessage("Task"); f.session.stop(); await flush(); }
  const retired = (f.session as any).live.retiredTurnIds as Set<string>;
  expect(retired.size).toBe(64); expect(retired.has("turn-1")).toBe(false); expect(retired.has("turn-80")).toBe(true);
  const pending = await starting(f);
  f.send(101, "turn-1"); f.answer("turn-1", "STALE EVICTED ANSWER");
  f.send(102, "current"); f.answer("current", "Current early answer");
  await flush(); expect(f.list).not.toHaveBeenCalled(); expect(visible(f)).not.toContain("Current early answer");
  pending.release({ turnId: "current" }); await pending.run; await flush();
  refused(f, 101); expect(f.list).toHaveBeenCalledOnce();
  f.complete("current"); await flush();
  expect(visible(f)).toContain("Current early answer"); expect(visible(f)).not.toContain("STALE EVICTED ANSWER");
  expect(f.session.getSnapshot().running).toBe(false);
});

it.each(["stop", "failed-start"])("rejects stale requests after %s and keeps the next turn's early answer", async (mode) => {
  const f = fixture(mode); const pending = await starting(f);
  f.send(201, "abandoned"); f.send(201, "abandoned"); f.answer("abandoned", "STALE ABANDONED ANSWER");
  if (mode === "stop") { f.session.stop(); pending.release({ turnId: "abandoned" }); }
  else pending.reject(new Error("Fixture startup failed"));
  await pending.run; await flush(); refused(f, 201); expect(f.list).not.toHaveBeenCalled();
  expect(f.session.getSnapshot().running).toBe(false);
  const next = await starting(f);
  f.send(202, "abandoned"); f.answer("abandoned", "STALE LATE ANSWER");
  f.send(203, "current"); f.answer("current", "Fresh early answer");
  next.release({ turnId: "current" }); await next.run; await flush();
  refused(f, 202); expect(f.list).toHaveBeenCalledOnce();
  f.complete("current"); await flush();
  expect(visible(f)).toContain("Fresh early answer"); expect(visible(f)).not.toContain("STALE");
});

it.each(["count", "bytes"])("bounds the startup %s buffer and reports failure in real snapshots", async (limit) => {
  const f = fixture(`buffer-${limit}`); const pending = await starting(f); f.send(301, "current");
  for (let i = 0; i < (limit === "count" ? 300 : 1); i++) {
    f.client.emit("item/agentMessage/delta", { turnId: "current", delta: limit === "bytes" ? "x".repeat(1_100_000) : "x" });
  }
  pending.release({ turnId: "current" }); await pending.run; await flush();
  refused(f, 301); expect(f.list).not.toHaveBeenCalled();
  expect(visible(f)).toContain("The provider sent too much data before the task started. Please try again.");
  expect(f.session.getSnapshot().running).toBe(false);
});

it("rejects tagged requests if startup does not identify a turn", async () => {
  const f = fixture("missing-id"); const pending = await starting(f); f.send(401, "unknown");
  pending.release({}); await pending.run; await flush();
  refused(f, 401); expect(f.list).not.toHaveBeenCalled();
});

it("publishes the answer when valid message and completion both arrive before startup returns", async () => {
  const f = fixture("early-completion"); const pending = await starting(f);
  f.answer("current", "Completed before startup returned"); f.complete("current");
  expect(visible(f)).not.toContain("Completed before startup returned");
  pending.release({ turnId: "current" }); await pending.run; await flush();
  expect(visible(f)).toContain("Completed before startup returned");
  expect(f.session.getSnapshot().running).toBe(false);
  expect(f.snapshots.some((snapshot: any) => snapshot.messages.some((message: any) => message.content === "Completed before startup returned"))).toBe(true);
});
