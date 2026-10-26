import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => state.directory },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { SessionController } from "../electron/main/session.js";
import { MockHands } from "../hands/mock/index.js";
import type { HandsResult } from "../hands/src/types.js";

const sessions: SessionController[] = [];
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-undo-result-")); });
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  rmSync(state.directory, { recursive: true, force: true });
});

function fixture() {
  const hands = new MockHands();
  const session = new SessionController(hands);
  sessions.push(session);
  const client = Object.assign(new EventEmitter(), { stop: vi.fn(), interruptTurn: vi.fn(async () => undefined) });
  session.attachLiveClient(client as never);
  const live = (session as unknown as { live: EventEmitter }).live;
  live.emit("activity", { summary: "Moved report.txt", undoable: true, actionId: "journal-1" });
  const entryId = session.getSnapshot().activity[0].id;
  const undo = vi.spyOn(hands, "undo");
  return { session, undo, entryId, entry: () => session.getSnapshot().activity[0] };
}

describe("verified per-change undo results", () => {
  it("records a verified restore only after Hands succeeds", async () => {
    const f = fixture();
    f.undo.mockResolvedValue({ ok: true, output: "Restored report.txt" });
    await f.session.undo(f.entryId);
    expect(f.undo).toHaveBeenCalledExactlyOnceWith("journal-1");
    expect(f.entry()).toMatchObject({ undone: true, undoResult: { status: "restored" } });
    expect(f.session.getSnapshot().messages.map((message) => message.content).join("\n")).not.toMatch(/nothing permanent was lost/i);
  });

  it("records a failed restore reason and keeps the change available for retry", async () => {
    const f = fixture();
    f.undo.mockResolvedValueOnce({ ok: false, output: "The destination already exists." });
    await f.session.undo(f.entryId);
    expect(f.entry()).toMatchObject({ undoable: true, undoResult: { status: "failed", reason: "The destination already exists." } });
    expect(f.entry().undone).not.toBe(true);
    f.undo.mockResolvedValueOnce({ ok: true, output: "Restored report.txt" });
    await f.session.undo(f.entryId);
    expect(f.undo).toHaveBeenCalledTimes(2);
    expect(f.entry()).toMatchObject({ undone: true, undoResult: { status: "restored" } });
  });

  it("converts a thrown backend error to a safe failure without exposing its text", async () => {
    const f = fixture();
    const privateError = "Internal backend detail must not reach the UI";
    f.undo.mockRejectedValue(new Error(privateError));
    await expect(f.session.undo(f.entryId)).resolves.toBeUndefined();
    expect(f.entry()).toMatchObject({ undoable: true, undoResult: { status: "failed", reason: expect.any(String) } });
    expect(f.entry().undone).not.toBe(true);
    expect(JSON.stringify(f.session.getSnapshot())).not.toContain(privateError);
  });

  it("runs only one backend restore for concurrent requests on the same change", async () => {
    const f = fixture();
    let finish!: (result: HandsResult) => void;
    const pending = new Promise<HandsResult>((resolve) => { finish = resolve; });
    f.undo.mockReturnValue(pending);
    const first = f.session.undo(f.entryId);
    const second = f.session.undo(f.entryId);
    const callsWhilePending = f.undo.mock.calls.length;
    finish({ ok: true, output: "Restored report.txt" });
    expect(callsWhilePending).toBe(1);
    await Promise.all([first, second]);
    expect(f.entry()).toMatchObject({ undone: true, undoResult: { status: "restored" } });
  });

  it("ignores a repeat undo after the change has already been restored", async () => {
    const f = fixture();
    f.undo.mockResolvedValue({ ok: true, output: "Restored report.txt" });
    await f.session.undo(f.entryId);
    await f.session.undo(f.entryId);
    expect(f.undo).toHaveBeenCalledOnce();
    expect(f.entry().summary).not.toContain("Undone: Undone:");
  });

  it("leaves an unrelated change unchanged when one restore fails", async () => {
    const f = fixture();
    const live = (f.session as unknown as { live: EventEmitter }).live;
    live.emit("activity", { summary: "Moved notes.txt", undoable: true, actionId: "journal-2" });
    const unrelatedBefore = structuredClone(f.session.getSnapshot().activity[0]);
    f.undo.mockResolvedValue({ ok: false, output: "The source is unavailable." });
    await f.session.undo(f.entryId);
    expect(f.session.getSnapshot().activity[0]).toEqual(unrelatedBefore);
    expect(f.session.getSnapshot().activity[1]).toMatchObject({ undoResult: { status: "failed", reason: "The source is unavailable." } });
  });
});
