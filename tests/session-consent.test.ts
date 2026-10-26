import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ directory: "", evaluate: vi.fn() }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => state.directory },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));
vi.mock("../guardian/src/index.js", () => ({ demoReviewer: undefined, evaluateAction: state.evaluate }));

import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";
import type { ProposedAction } from "../shared/types.js";

const sessions: SessionController[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => {
  state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-session-consent-"));
  state.evaluate.mockReset();
});
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
  rmSync(state.directory, { recursive: true, force: true });
});

async function fixture(hold = false) {
  state.evaluate.mockImplementation(async (action: ProposedAction) => ({
    actionId: action.id, kind: hold ? "ask_hold" : "ask", tier: hold ? 3 : 2,
    plainEnglish: action.summary, details: action.payload, matchedRules: [], undoable: false,
  }));
  class Client extends EventEmitter {
    startThread = vi.fn(async () => "thread");
    startTurn = vi.fn(async () => ({ turnId: "turn" }));
    interruptTurn = vi.fn(async () => undefined);
    stop = vi.fn();
    respondApproval = vi.fn();
    respondFileChangeApproval = vi.fn();
    respondToolCall = vi.fn();
  }
  const client = new Client();
  const session = new SessionController(new MockHands());
  sessions.push(session);
  session.attachLiveClient(client as never);
  await session.sendMessage("Perform my current task");
  const request = async (requestId: number, command = "Write-Output 'fixture'") => {
    client.emit("serverRequest", {
      id: requestId, method: "item/commandExecution/requestApproval",
      params: { itemId: `command-${requestId}`, command, cwd: "C:\\Fixture" },
    });
    await flush();
  };
  return { session, client, request };
}

describe("session consent contract", () => {
  it("retains the visible hold card after plain or early confirmation", async () => {
    const f = await fixture(true);
    await f.request(1);
    const card = f.session.getSnapshot().pendingApproval!;
    expect(card).not.toBeNull();
    expect(await f.session.respondApproval("do_it", card.action.id)).toBe(false);
    expect(f.session.getSnapshot().pendingApproval).toEqual(card);
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    expect(f.session.beginApprovalHold(card.action.id)).toBe(true);
    clock.mockReturnValue(1599);
    expect(await f.session.respondApproval("hold_confirmed", card.action.id)).toBe(false);
    expect(f.session.getSnapshot().pendingApproval).toEqual(card);
    expect(f.client.respondApproval).not.toHaveBeenCalled();
  });

  it("binds begin and cancel to the visible action and accepts a completed host hold", async () => {
    const f = await fixture(true);
    await f.request(1);
    const id = f.session.getSnapshot().pendingApproval!.action.id;
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    expect(f.session.beginApprovalHold("wrong-action")).toBe(false);
    expect(f.session.beginApprovalHold(id)).toBe(true);
    f.session.cancelApprovalHold(id);
    clock.mockReturnValue(2000);
    expect(await f.session.respondApproval("hold_confirmed", id)).toBe(false);
    expect(f.session.getSnapshot().pendingApproval?.action.id).toBe(id);
    expect(f.session.beginApprovalHold(id)).toBe(true);
    f.session.cancelApprovalHold("wrong-action");
    clock.mockReturnValue(3500);
    expect(await f.session.respondApproval("hold_confirmed", id)).toBe(true);
    await flush();
    expect(f.client.respondApproval).toHaveBeenCalledExactlyOnceWith(1, "accept");
    expect(f.session.getSnapshot().pendingApproval).toBeNull();
  });

  it("publishes task grants, revokes the exact grant, and clears grants at Stop", async () => {
    const f = await fixture();
    await f.request(1);
    const id = f.session.getSnapshot().pendingApproval!.action.id;
    expect(await f.session.respondApproval("allow_for_task", id)).toBe(true);
    await flush();
    const grants = f.session.getSnapshot().taskGrants!;
    expect(grants).toEqual([{ id, kind: "powershell", target: "Write-Output 'fixture'" }]);
    expect(f.session.revokeTaskGrant("wrong-grant")).toBe(false);
    expect(f.session.getSnapshot().taskGrants).toEqual(grants);
    expect(f.session.revokeTaskGrant(id)).toBe(true);
    expect(f.session.getSnapshot().taskGrants).toEqual([]);
    await f.request(2);
    const nextId = f.session.getSnapshot().pendingApproval!.action.id;
    expect(await f.session.respondApproval("allow_for_task", nextId)).toBe(true);
    expect(f.session.getSnapshot().taskGrants).toHaveLength(1);
    f.session.stop();
    expect(f.session.getSnapshot().taskGrants).toEqual([]);
  });

  it("publishes the authoritative queue count including the displayed approval", async () => {
    const f = await fixture();
    await f.request(1);
    const firstId = f.session.getSnapshot().pendingApproval!.action.id;
    await f.request(2, "Write-Output 'second'");
    expect(f.session.getSnapshot()).toMatchObject({ pendingApprovalCount: 2 });
    expect(f.session.getSnapshot().pendingApproval?.action.id).toBe(firstId);
    expect(await f.session.respondApproval("not_now", firstId)).toBe(true);
    await flush();
    expect(f.session.getSnapshot()).toMatchObject({ pendingApprovalCount: 1 });
    expect(f.session.getSnapshot().pendingApproval).not.toBeNull();
    expect(f.session.getSnapshot().pendingApproval?.action.id).not.toBe(firstId);
    f.session.stop();
    expect(f.session.getSnapshot()).toMatchObject({ pendingApprovalCount: 0, pendingApproval: null });
  });
});
