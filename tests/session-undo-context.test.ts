// Oct 26: plain UI clicks are tier 1, so these fixtures click a consequential control to get a card.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockHands } from "../hands/mock/index.js";
import { NodeHands } from "../hands/src/node-hands.js";
import type { HandsClient } from "../hands/src/types.js";
import type { ActivityEntry } from "../shared/types.js";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => state.directory }, shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false } }));
import { SessionController } from "../electron/main/session.js";
import { WriterService } from "../writer/index.js";
import { boundedDisplayText } from "../electron/main/live-agent.js";
class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  startTurn = vi.fn(async (_thread: string, _text: string) => ({ turnId: "turn" }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn();
  respondFileChangeApproval = vi.fn();
  respondToolCall = vi.fn();
  stop = vi.fn();
}
const sessions: SessionController[] = [];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => { state.directory = mkdtempSync(path.join(os.tmpdir(), "lalime-undo-context-")); });
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.restoreAllMocks(); rmSync(state.directory, { recursive: true, force: true }); });
async function fixture(hands: HandsClient = new MockHands()) {
  const session = new SessionController(hands); sessions.push(session);
  const client = new Client(); session.attachLiveClient(client as never);
  await session.sendMessage("Work with the selected report");
  const live = (session as unknown as { live: EventEmitter }).live;
  live.emit("activity", { summary: "Moved report.txt", undoable: true, actionId: "journal-1" });
  const entryId = session.getSnapshot().activity[0].id;
  const undo = vi.spyOn(hands, "undo").mockResolvedValue({ ok: true, output: "Restored report.txt" });
  return { hands, session, client, entryId, undo };
}
it("tells the active model about Undo through a withdrawn tool response without starting another turn", async () => {
  const f = await fixture();
  f.client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Fixture\\Downloads\\next.tmp"] } } });
  await flush();
  const approvalId = f.session.getSnapshot().pendingApproval!.action.id;
  await f.session.undo(f.entryId); await flush();
  expect(f.client.startTurn).toHaveBeenCalledTimes(1);
  expect(f.client.respondToolCall).toHaveBeenCalledTimes(1);
  const response = f.client.respondToolCall.mock.calls[0][1];
  expect(response.success).toBe(false);
  expect(JSON.stringify(response)).toContain("user_undo");
  expect(JSON.stringify(response)).toContain("restored");
  expect(JSON.stringify(response)).toContain("journal-1");
  expect(await f.session.respondApproval("do_it", approvalId)).toBe(false);
});
it.each([true, false])("reports an idle Undo result on the next user turn once, success=%s", async (ok) => {
  const f = await fixture(); f.undo.mockResolvedValue({ ok, output: ok ? "Restored report.txt" : "Destination occupied: report.txt" });
  await f.session.undo(f.entryId);
  f.session.stop(); await f.session.sendMessage("continue");
  const input = f.client.startTurn.mock.calls.at(-1)![1];
  expect(input).toContain("user_undo");
  expect(input).toContain(ok ? '"outcome":"restored"' : '"outcome":"failed"');
  expect(input).toContain("continue");
  if (!ok) expect(input).not.toContain('"outcome":"restored"');
  f.session.stop(); await f.session.sendMessage("Tell me the status");
  expect(f.client.startTurn.mock.calls.at(-1)![1]).not.toContain("user_undo");
});
it("keeps an undelivered Undo notice after failed turn startup", async () => {
  const f = await fixture(); await f.session.undo(f.entryId); f.session.stop();
  f.client.startTurn.mockRejectedValueOnce(new Error("Fixture startup failed"));
  await f.session.sendMessage("continue");
  await f.session.sendMessage("continue");
  expect(f.client.startTurn.mock.calls.at(-1)![1]).toContain("user_undo");
});
it("updates writer facts after verified Undo", async () => {
  const f = await fixture(); await f.session.undo(f.entryId);
  const facts = (f.session as unknown as { turnActivity: ActivityEntry[] }).turnActivity;
  expect(facts[0]).toMatchObject({ undone: true, undoResult: { status: "restored" } });
});
it("withdraws old consent immediately while the restore is still in flight", async () => {
  const f = await fixture();
  f.client.emit("serverRequest", { id: 1, method: "item/tool/call", params: { tool: "lalime_recycle", arguments: { paths: ["C:\\Users\\Fixture\\Downloads\\next.tmp"] } } });
  await flush();
  const approvalId = f.session.getSnapshot().pendingApproval!.action.id;
  let finish!: (value: { ok: boolean; output: string }) => void;
  f.undo.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = f.session.undo(f.entryId);
  const accepted = await f.session.respondApproval("do_it", approvalId);
  finish({ ok: true, output: "Restored report.txt" }); await pending; await flush();
  expect(accepted).toBe(false);
  expect(JSON.stringify(f.client.respondToolCall.mock.calls)).toContain("user_undo");
});
it("cancels an in-flight writer when Undo changes its facts", async () => {
  const f = await fixture();
  const controller = new AbortController();
  (f.session as unknown as { writerAbort: AbortController }).writerAbort = controller;
  await f.session.undo(f.entryId);
  expect(controller.signal.aborted).toBe(true);
});
it("refuses a command whose precheck finishes during Undo", async () => {
  const f = await fixture();
  let finishPrecheck!: (value: { blocked: boolean }) => void;
  vi.spyOn(f.hands, "precheckPowerShell").mockImplementation(() => new Promise((resolve) => { finishPrecheck = resolve; }));
  f.client.emit("serverRequest", { id: 8, method: "item/commandExecution/requestApproval", params: { command: "Write-Output hello" } });
  await flush();
  let finishUndo!: (value: { ok: boolean; output: string }) => void;
  f.undo.mockReturnValue(new Promise((resolve) => { finishUndo = resolve; }));
  const pending = f.session.undo(f.entryId);
  finishPrecheck({ blocked: false }); await flush();
  const card = f.session.getSnapshot().pendingApproval;
  if (card) await f.session.respondApproval("do_it", card.action.id);
  const responses = [...f.client.respondApproval.mock.calls];
  finishUndo({ ok: true, output: "Restored report.txt" }); await pending;
  expect(card).toBeNull();
  expect(responses).toContainEqual([8, "decline"]);
  expect(responses).not.toContainEqual([8, "accept"]);
});
it("waits for every overlapping Undo before presenting a newly requested action", async () => {
  const f = await fixture();
  (f.session as unknown as { live: EventEmitter }).live.emit("activity", { summary: "Moved other.txt", undoable: true, actionId: "journal-2" });
  const secondId = f.session.getSnapshot().activity[0].id;
  const finishes: Array<(value: { ok: boolean; output: string }) => void> = [];
  f.undo.mockImplementation(() => new Promise((resolve) => { finishes.push(resolve); }));
  const first = f.session.undo(f.entryId);
  f.client.emit("serverRequest", { id: 7, method: "item/commandExecution/requestApproval", params: { command: "Write-Output hello" } });
  await flush();
  const second = f.session.undo(secondId);
  finishes[0]({ ok: true, output: "Restored report.txt" }); await first; await flush();
  const duringSecond = f.session.getSnapshot().pendingApproval;
  finishes[1]({ ok: true, output: "Restored other.txt" }); await second; await flush();
  expect(duringSecond).toBeNull();
});
it("waits for an in-flight Undo before starting a user-requested turn with its result", async () => {
  const f = await fixture();
  let finish!: (value: { ok: boolean; output: string }) => void;
  f.undo.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const undo = f.session.undo(f.entryId); f.session.stop();
  const turn = f.session.sendMessage("continue"); await flush();
  const startsBeforeRestore = f.client.startTurn.mock.calls.length;
  finish({ ok: true, output: "Restored report.txt" }); await undo; await turn;
  expect(startsBeforeRestore).toBe(1);
  expect(f.client.startTurn.mock.calls.at(-1)![1]).toContain("user_undo");
});
it("does not publish a late writer result with pre-Undo facts", async () => {
  const f = await fixture();
    let finish!: (value: never) => void;
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
  const compose = vi.spyOn(WriterService.prototype, "composeReply").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } });
  await flush(); expect(compose).toHaveBeenCalledOnce();
  await f.session.undo(f.entryId);
  finish({ text: "Obsolete pre-Undo completion", used: true } as never); await flush();
  expect(f.session.getSnapshot().messages.map((message) => message.content).join("\n")).not.toContain("Obsolete pre-Undo completion");
});
it("does not carry an Undo notice into a replacement provider conversation", async () => {
  const f = await fixture(); await f.session.undo(f.entryId); f.session.disconnect();
  const replacement = new Client(); f.session.attachLiveClient(replacement as never);
  await f.session.sendMessage("A different task");
  expect(replacement.startTurn.mock.calls[0][1]).toBe("A different task");
});

it.each([true, false])("publishes the cancelled approval to the renderer before Undo completes, success=%s", async (ok) => {
  const f = await fixture();
  f.client.emit("serverRequest", { id: 20, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete\u202e\n" + "x".repeat(5000), windowTitle: "Editor" } } });
  f.client.emit("serverRequest", { id: 21, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Remove", windowTitle: "Editor" } } });
  await flush();
  const cardId = f.session.getSnapshot().pendingApproval!.action.id;
  let finish!: (value: { ok: boolean; output: string }) => void;
  f.undo.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pending = f.session.undo(f.entryId);
  const snapshot = f.session.getSnapshot();
  const notice = (snapshot.activity.find((entry) => entry.id === f.entryId) as ActivityEntry & {
    approvalWithdrawal?: { actionId: string; summary: string; reason: string; message: string; withdrawnCount: number };
  }).approvalWithdrawal;
  finish({ ok, output: ok ? "Restored report.txt" : "Destination occupied: report.txt" }); await pending; await flush();
  expect(snapshot.pendingApproval).toBeNull();
  expect(notice).toMatchObject({ actionId: cardId, reason: "user_undo", withdrawnCount: 2 });
  expect(notice!.message).toMatch(/cancelled.*approval.*Undo/);
  expect(notice!.summary).toContain("Delete");
  for (const text of [notice!.message, notice!.summary]) {
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).not.toMatch(/[\u202e\n]/);
    expect(text.replace(/\.\.\.\(\+\d+ more\)$/, "")).not.toMatch(/\\(?:u[0-9a-f]{0,3}|u\{[0-9a-f]*)?$/i);
  }
  expect(snapshot.messages.some((message) => message.content === notice!.message)).toBe(true);
  expect(f.session.getSnapshot().activity.find((entry) => entry.id === f.entryId)).toMatchObject({ approvalWithdrawal: notice });
  expect(await f.session.respondApproval("do_it", cardId)).toBe(false);
});

it("does not claim an approval was cancelled when Undo had no pending card", async () => {
  const f = await fixture(); await f.session.undo(f.entryId);
  expect(f.session.getSnapshot().activity[0]).not.toHaveProperty("approvalWithdrawal");
  expect(f.session.getSnapshot().messages.some((message) => /cancelled.*approval/.test(message.content))).toBe(false);
});

it.each([true, false])("gives the reply writer the verified Undo state, success=%s", async (ok) => {
  const f = await fixture();
  f.undo.mockResolvedValue({ ok, output: ok ? "Restored report.txt" : "Restored one item; destination occupied: report.txt" });
  await f.session.undo(f.entryId);
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } });
  await flush();
  expect(compose).toHaveBeenCalledOnce();
  const facts = compose.mock.calls[0][0];
  expect(facts.actions[0]).toMatchObject({ status: ok ? "skipped" : "failed", undoable: !ok });
  if (!ok) {
    expect(facts.outcome).toBe("partly_done");
    expect(facts.actions[0].summary).toMatch(/Undo failed/);
    expect(facts.errors).toContainEqual({ code: "UNDO_FAILED", plainHint: "Restored one item; destination occupied: report.txt" });
  }
});

it("includes an earlier task's failed Undo in the current writer facts", async () => {
  const f = await fixture();
  f.client.startTurn.mockResolvedValue({ turnId: "turn-2" });
  f.session.stop(); await f.session.sendMessage("Work on the next report");
  (f.session as unknown as { live: EventEmitter }).live.emit("activity", { summary: "Moved next-report.txt", undoable: true, actionId: "journal-2" });
  f.undo.mockResolvedValue({ ok: false, output: "One item restored; report.txt still needs recovery." });
  await f.session.undo(f.entryId);
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn-2", status: "completed" } });
  await flush();
  const facts = compose.mock.calls[0][0];
  expect(facts.outcome).toBe("partly_done");
  expect(facts.actions).toContainEqual(expect.objectContaining({ summary: "Undo failed for change: Moved report.txt", status: "failed" }));
  expect(facts.actions).toContainEqual(expect.objectContaining({ summary: "Moved next-report.txt", status: "done" }));
  expect(facts.errors).toContainEqual({ code: "UNDO_FAILED", plainHint: "One item restored; report.txt still needs recovery." });
});

it.each(["Mom\u2019s \u201cbirthday\u201d photos.zip", "\u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f"])("keeps visible curly quotes verbatim: %s", (text) => {
  expect(boundedDisplayText(text).text).toBe(text);
  expect(boundedDisplayText(text + "\u202e\u200b").text).toBe(text + "\\u202e\\u200b");
});

it("names Undo as the cause in every withdrawn tool reply and uses plural notice wording", async () => {
  const f = await fixture();
  for (const [id, name] of [[30, "Delete"], [31, "Remove"]] as const) {
    f.client.emit("serverRequest", { id, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name, windowTitle: "Editor" } } });
  }
  await flush(); await f.session.undo(f.entryId); await flush();
  const notice = f.session.getSnapshot().activity.find((entry) => entry.id === f.entryId)!.approvalWithdrawal!;
  expect(notice.message).toMatch(/^Lalime cancelled 2 waiting approvals because you pressed Undo: .*Delete.*and 1 more\.$/);
  expect(f.client.respondToolCall.mock.calls).toHaveLength(2);
  for (const [, response] of f.client.respondToolCall.mock.calls) {
    expect(response.contentItems[0].text).toContain("because the user pressed Undo");
  }
});

it.each([0, 2])("carries structured restore counts to the model and writer, restored=%s", async (restored) => {
  const f = await fixture();
  f.undo.mockResolvedValue({ ok: false, output: `Restored ${restored} of 3 items. A newer report.txt was left alone.`, restoreProgress: { restored, total: 3 } } as never);
  await f.session.undo(f.entryId);
  f.client.emit("serverRequest", { id: 40, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" } } });
  await flush();
  const response = JSON.stringify(f.client.respondToolCall.mock.calls);
  expect(response).toContain(restored ? '\\"outcome\\":\\"partly_restored\\"' : '\\"outcome\\":\\"failed\\"');
  expect(response).toContain(`\\"restored\\":${restored}`);
  expect(response).toContain('\\"total\\":3');
  expect(f.session.getSnapshot().activity[0].undoResult).toMatchObject({ status: "failed", restored, total: 3 });
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  expect(compose.mock.calls[0][0].actions[0].summary).toContain(restored ? "Partly restored (2 of 3)" : "Undo failed");
});

it("does not cut a recovery path in the model result or the writer error hint", async () => {
  const f = await fixture();
  const recoveryPath = "C:\\recovery\\" + "folder\\".repeat(80) + "old-copy.tmp";
  const output = `report.txt: a newer file with this name is already there, so it was left alone. The old copy is kept at ${recoveryPath}`;
  f.undo.mockResolvedValue({ ok: false, output }); await f.session.undo(f.entryId);
  f.client.emit("serverRequest", { id: 50, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" } } }); await flush();
  expect(JSON.stringify(f.client.respondToolCall.mock.calls)).toContain("old-copy.tmp");
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  const hint = compose.mock.calls[0][0].errors![0].plainHint;
  expect(hint.includes(recoveryPath) || (!hint.includes("C:") && /details/i.test(hint))).toBe(true);
  expect(f.session.getSnapshot().activity[0].undoResult).toMatchObject({ reason: output });
});

it("omits an oversized model detail as a whole instead of sending a partial recovery path", async () => {
  const f = await fixture();
  const output = "The old copy is kept at C:\\recovery\\" + "folder\\".repeat(700) + "old-copy.tmp";
  f.undo.mockResolvedValue({ ok: false, output }); await f.session.undo(f.entryId);
  f.client.emit("serverRequest", { id: 60, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" } } }); await flush();
  const noticeText = f.client.respondToolCall.mock.calls[0][1].contentItems.at(-1).text as string;
  expect(noticeText.includes("old-copy.tmp") || (!noticeText.includes("C:") && /details/i.test(noticeText))).toBe(true);
  expect(f.session.getSnapshot().activity[0].undoResult).toMatchObject({ reason: output });
});

it("does not truncate a file path in the writer's qualified Undo summary", async () => {
  const f = await fixture();
  (f.session as unknown as { live: EventEmitter }).live.emit("activity", { summary: "Recycled C:\\" + "long-folder\\".repeat(30) + "selected.txt", undoable: true, actionId: "journal-long" });
  const selected = f.session.getSnapshot().activity[0].id;
  f.undo.mockResolvedValue({ ok: false, output: "A newer file was left alone.", restoreProgress: { restored: 1, total: 2 } } as never);
  await f.session.undo(selected);
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  const summary = compose.mock.calls[0][0].actions[0].summary;
  expect(summary).toContain("Partly restored (1 of 2)");
  expect(summary.includes("selected.txt") || !summary.includes("C:")).toBe(true);
});

it("reports a real NodeHands partial restore consistently to the snapshot, model, and writer", async () => {
  const folder = path.join(state.directory, "Downloads"); mkdirSync(folder);
  const files = ["one.tmp", "two.tmp", "three.tmp"].map((name) => path.join(folder, name));
  for (const file of files) writeFileSync(file, "original");
  const hands = new NodeHands(path.join(state.directory, "journal"), [folder]);
  const f = await fixture(hands); f.undo.mockRestore();
  const moved = await hands.moveToRecycleBin(files, "Moved three files");
  expect(moved.ok).toBe(true);
  (f.session as unknown as { live: EventEmitter }).live.emit("activity", { summary: "Moved three files", undoable: true, actionId: moved.undoToken });
  const selected = f.session.getSnapshot().activity[0].id;
  writeFileSync(files[1], "newer file");
  await f.session.undo(selected);
  const result = f.session.getSnapshot().activity[0].undoResult!;
  expect(result).toMatchObject({ status: "failed", restored: 2, total: 3 });
  if (result.status !== "failed") throw new Error("Expected partial restore");
  expect(result.reason).not.toMatch(/EEXIST|link '/);
  expect(result.reason).toMatch(/left untouched/);
  const quarantineRoot = path.join(state.directory, "journal", "quarantine");
  const recoveryPath = path.join(quarantineRoot, readdirSync(quarantineRoot)[0], "1");
  expect(result.reason).toContain(recoveryPath);
  expect(readFileSync(recoveryPath, "utf8")).toBe("original");
  expect(readFileSync(files[1], "utf8")).toBe("newer file");
  f.client.emit("serverRequest", { id: 70, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" } } }); await flush();
  const modelText = f.client.respondToolCall.mock.calls[0][1].contentItems.at(-1).text as string;
  expect(modelText).toContain('"outcome":"partly_restored"');
  expect(modelText).toContain('"restored":2,"total":3');
  expect(modelText).not.toContain("EEXIST");
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  expect(compose.mock.calls[0][0]).toMatchObject({ outcome: "partly_done", actions: [expect.objectContaining({ summary: "Partly restored (2 of 3): Moved three files" }), expect.anything()] });
  expect(JSON.stringify(compose.mock.calls[0][0].errors)).not.toContain("EEXIST");
});

it("builds a useful writer hint from structured item issues instead of long recovery paths", async () => {
  const f = await fixture();
  const items = ["f1.tmp", "f2.tmp"].map((name) => ({ name, reason: "A newer file with that name is there, so it was left alone.", recoveryPath: "C:\\recovery\\" + "folder\\".repeat(50) + name }));
  f.undo.mockResolvedValue({ ok: false, output: "Full recovery details " + items[0].recoveryPath, restoreProgress: { restored: 1, total: 3 }, undoItems: items } as never);
  await f.session.undo(f.entryId);
  expect(f.session.getSnapshot().activity[0].undoResult).toMatchObject({ items });
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  const hint = compose.mock.calls[0][0].errors![0].plainHint;
  expect(hint).toContain("f1.tmp"); expect(hint).toContain("newer file");
  expect(hint).toContain("Lalime's recovery folder"); expect(hint).toContain("and 1 more");
  expect(hint).not.toContain("C:"); expect(hint).not.toContain("could not be fully verified");
  expect(hint.length).toBeLessThanOrEqual(240);
});

it("reports all restored files with a metadata warning to the snapshot, model, and writer", async () => {
  const f = await fixture(); const warning = "Your files were restored, but Lalime could not update its recovery list.";
  f.undo.mockResolvedValue({ ok: true, output: "Restored all files.", restoreProgress: { restored: 2, total: 2 }, restoreWarning: warning } as never);
  await f.session.undo(f.entryId);
  expect(f.session.getSnapshot().activity[0]).toMatchObject({ undone: true, undoResult: { status: "restored", warning, restored: 2, total: 2 } });
  expect(f.session.getSnapshot().messages.at(-1)!.content).toContain(warning);
  f.client.emit("serverRequest", { id: 80, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Delete", windowTitle: "Editor" } } }); await flush();
  const model = f.client.respondToolCall.mock.calls[0][1].contentItems.at(-1).text as string;
  expect(model).toContain('"outcome":"restored"'); expect(model).toContain(warning);
  f.session.setWriterConfig({ providerId: "openai", model: "gpt-test", apiKey: "sk-test" });
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture reply", used: true });
  f.client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } }); await flush();
  expect(compose.mock.calls[0][0].errors).toContainEqual({ code: "UNDO_WARNING", plainHint: warning });
  expect(compose.mock.calls[0][0].actions[0]).toMatchObject({ status: "skipped", undoable: false });
});

it.each(["already_restored", "in_progress"])("does not stamp failure for a backend %s no-op", async (undoState) => {
  const f = await fixture();
  const before = structuredClone(f.session.getSnapshot().activity[0]);
  f.undo.mockResolvedValue({ ok: false, output: undoState === "already_restored" ? "Already undone." : "Undo is already in progress.", undoState, restoreProgress: { restored: 1, total: 1 } } as never);
  await f.session.undo(f.entryId);
  expect(f.session.getSnapshot().activity[0]).toEqual(before);
  expect(f.session.getSnapshot().statusText).not.toBe("Undo failed");
});
