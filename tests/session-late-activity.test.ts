import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockHands } from "../hands/mock/index.js";
import type { HandsResult } from "../hands/src/types.js";

const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => state.directory },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));
vi.mock("../guardian/src/index.js", () => ({
  demoReviewer: undefined,
  evaluateAction: async (action: { id: string; payload: string }) => ({
    actionId: action.id, kind: "ask", tier: 2, plainEnglish: "Recycle files",
    details: action.payload, matchedRules: [], undoable: false,
  }),
  evaluateActionSync: vi.fn(),
}));
import { SessionController } from "../electron/main/session.js";
import { WriterService } from "../writer/index.js";
import * as writerKeys from "../electron/main/writer-key.js";

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
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-late-activity-")); });
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
  rmSync(state.directory, { recursive: true, force: true });
});

async function pendingRecycle() {
  const hands = new MockHands();
  const client = new Client();
  const session = new SessionController(hands);
  sessions.push(session);
  session.attachLiveClient(client as never);
  let finish!: (result: HandsResult) => void;
  const move = vi.spyOn(hands, "moveToRecycleBin").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await session.sendMessage("Recycle old files");
  client.emit("serverRequest", {
    id: 1, method: "item/tool/call",
    params: { threadId: "thread", turnId: "turn-1", tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Example\\Downloads\\old.txt"] } },
  });
  await flush();
  const pending = session.getSnapshot().pendingApproval;
  expect(pending).not.toBeNull();
  await session.respondApproval("do_it", pending!.action.id);
  await flush();
  expect(move).toHaveBeenCalledOnce();
  return {
    session, client, move,
    finish: () => finish({ ok: false, output: "Moved one file before Stop. Recovery is available.", journalId: "late-journal", undoToken: "late-journal" }),
  };
}

describe("late completed changes remain recoverable", () => {
  it("retains an in-flight partial recycle result after Stop without restarting the task", async () => {
    const f = await pendingRecycle();
    f.session.stop();
    f.finish();
    await flush();
    expect(f.session.getSnapshot().activity).toHaveLength(1);
    expect(f.session.getSnapshot().activity[0]).toMatchObject({ actionId: "late-journal", undoable: true });
    expect(f.session.getSnapshot()).toMatchObject({ stopped: true, running: false, statusText: "Stopped" });
    expect(f.client.startTurn).toHaveBeenCalledOnce();
    expect(f.move).toHaveBeenCalledOnce();
  });

  it("preserves late recovery but does not credit it to the next task's writer facts", async () => {
    const f = await pendingRecycle();
    f.session.stop();
    f.client.startTurn.mockResolvedValueOnce({ turnId: "turn-2" });
    await f.session.sendMessage("Explain what a monitor is");
    f.finish();
    await flush();
    expect(f.session.getSnapshot().activity).toHaveLength(1);
    expect(f.session.getSnapshot().activity[0]).toMatchObject({ actionId: "late-journal", undoable: true });
    vi.spyOn(writerKeys, "loadWriterKey").mockReturnValue("sk-ant-test");
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "A monitor is a screen.", source: "fallback" });
    f.client.emit("item/completed", { threadId: "thread", turnId: "turn-2", item: { type: "agentMessage", text: "A monitor is a screen." } });
    f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn-2", status: "completed" } });
    await flush();
    expect(compose).toHaveBeenCalledOnce();
    expect(compose.mock.calls[0][0].actions).toEqual([]);
    expect(f.move).toHaveBeenCalledOnce();
  });
});
