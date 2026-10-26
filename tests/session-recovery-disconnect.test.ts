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
  shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false },
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

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async () => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  stop = vi.fn();
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
}
const sessions: SessionController[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-disconnect-recovery-")); });
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  rmSync(state.directory, { recursive: true, force: true });
});

describe("recovery after provider transport closure", () => {
  it.each([false, true])("retains a completed change when its result cannot reach the provider (ok=%s)", async (ok) => {
    const hands = new MockHands();
    const client = new Client();
    const session = new SessionController(hands);
    sessions.push(session);
    session.attachLiveClient(client as never);
    let finish!: (result: HandsResult) => void;
    const move = vi.spyOn(hands, "moveToRecycleBin").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await session.sendMessage("Recycle the selected file");
    client.emit("serverRequest", {
      id: 1, method: "item/tool/call",
      params: { threadId: "thread", turnId: "turn", tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Example\\Downloads\\old.txt"] } },
    });
    await flush();
    await session.respondApproval("do_it", session.getSnapshot().pendingApproval!.action.id);
    await flush();
    expect(move).toHaveBeenCalledOnce();
    client.respondToolCall.mockImplementation(() => { throw new Error("Provider transport closed"); });
    client.emit("exit");
    finish({ ok, output: "Moved one file. Recovery is available.", journalId: "recovery-journal", undoToken: "recovery-journal" });
    await flush();
    expect(session.getSnapshot().activity).toHaveLength(1);
    expect(session.getSnapshot().activity[0]).toMatchObject({ actionId: "recovery-journal", undoable: true });
    expect(session.getSnapshot().running).toBe(false);
    expect(move).toHaveBeenCalledOnce();
    expect(client.startTurn).toHaveBeenCalledOnce();
  });
});
