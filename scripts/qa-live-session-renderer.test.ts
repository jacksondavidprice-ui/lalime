/** Live compiled session/IPC/preload/renderer QA. Transport/provider are fixtures; partial Undo uses real NodeHands. */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";
import { expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ directory: "", handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => transport.directory },
  shell: { openExternal: vi.fn() }, safeStorage: { isEncryptionAvailable: () => false },
  clipboard: { writeText: vi.fn() },
  ipcMain: {
    removeHandler: (name: string) => transport.handlers.delete(name),
    handle: (name: string, handler: (...args: any[]) => any) => transport.handlers.set(name, handler),
  },
}));
import { SessionController } from "../artifacts/codex-c-batch11/dist-electron/electron/main/session.js";
import { registerIpc } from "../artifacts/codex-c-batch11/dist-electron/electron/main/ipc.js";
import { MockHands } from "../artifacts/codex-c-batch11/dist-electron/hands/mock/index.js";
import { NodeHands } from "../artifacts/codex-c-batch11/dist-electron/hands/src/node-hands.js";
import { WriterService } from "../artifacts/codex-c-batch11/dist-electron/writer/index.js";
import * as writerKeys from "../artifacts/codex-c-batch11/dist-electron/electron/main/writer-key.js";

class Client extends EventEmitter {
  startThread = vi.fn(async () => "thread");
  turnCount = 0;
  startTurn = vi.fn(async () => ({ turnId: ++this.turnCount === 1 ? "turn" : `turn-${this.turnCount}` }));
  interruptTurn = vi.fn(async () => undefined);
  respondApproval = vi.fn(); respondFileChangeApproval = vi.fn(); respondToolCall = vi.fn(); stop = vi.fn();
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it.each([{ restored: true, historical: false }, { restored: false, historical: false }, { restored: false, historical: true }])("live compiled host withdrawal reaches real renderer: %j", async ({ restored, historical }) => {
  const evidence = path.resolve("scratch/qa-batch11");
  mkdirSync(evidence, { recursive: true });
  transport.directory = mkdtempSync(path.join(evidence, "live-session-profile-"));
  transport.handlers.clear();
  const hands = new MockHands();
  const session = new SessionController(hands);
  const client = new Client();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(7000);
  let closing = false;
  let publish = Promise.resolve();
  const deliveryErrors: string[] = [];
  const snapshots: any[] = [];
  let finishUndo: ((result: { ok: boolean; output: string }) => void) | undefined;
  try {
    session.attachLiveClient(client as never);
    const events = new EventEmitter();
    const frame = {};
    const contents = { mainFrame: frame, send(channel: string, snapshot: unknown) { events.emit(channel, {}, snapshot); } };
    registerIpc(session, () => ({ webContents: contents }) as never);
    let api: any;
    const preload = path.resolve("artifacts/codex-c-batch11/dist-electron/electron/preload/index.cjs");
    vm.runInNewContext(readFileSync(preload, "utf8"), { require(name: string) {
      expect(name).toBe("electron");
      return {
        contextBridge: { exposeInMainWorld(key: string, value: unknown) { expect(key).toBe("lalime"); api = value; } },
        ipcRenderer: {
          invoke: async (channel: string, ...args: unknown[]) => {
            const handler = transport.handlers.get(channel);
            if (!handler) throw new Error(`Missing registered IPC handler: ${channel}`);
            return handler({ sender: contents, senderFrame: frame }, ...args);
          },
          on: (channel: string, listener: (...args: any[]) => void) => events.on(channel, listener),
          removeListener: (channel: string, listener: (...args: any[]) => void) => events.removeListener(channel, listener),
        },
      };
    } }, { filename: preload, timeout: 1000 });
    await page.exposeFunction("qaInvoke", (method: string, args: unknown[]) => api[method](...args));
    await page.addInitScript((methods) => {
      const subscribers = new Set<(snapshot: unknown) => void>();
      const target = window as any;
      target.qaPublish = (snapshot: unknown) => { for (const callback of subscribers) callback(snapshot); };
      target.lalime = Object.fromEntries(methods.filter((method) => method !== "subscribe")
        .map((method) => [method, (...args: unknown[]) => target.qaInvoke(method, args)]));
      target.lalime.subscribe = (callback: (snapshot: unknown) => void) => {
        subscribers.add(callback); return () => subscribers.delete(callback);
      };
    }, Object.keys(api));
    api.subscribe((snapshot: unknown) => {
      snapshots.push(structuredClone(snapshot));
      publish = publish.then(async () => {
        if (!closing) await page.evaluate((value) => (window as any).qaPublish(value), snapshot);
      }).catch((error) => { deliveryErrors.push(String(error)); });
    });
    await page.goto(process.env.LALIME_URL ?? "http://127.0.0.1:43128", { waitUntil: "networkidle", timeout: 15000 });
    await page.getByTestId("chat-home").waitFor();
    // Request dispatch traverses the actual preload and registered IPC handler.
    await page.evaluate(() => (window as any).lalime.sendMessage("Work with the selected report"));
    (session as any).live.emit("activity", { summary: "Moved report.txt", undoable: true, actionId: "journal-live-1" });
    const entryId = session.getSnapshot().activity[0].id;
    if (historical) {
      client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } });
      await flush(); await publish;
      await page.evaluate(() => (window as any).lalime.sendMessage("Now work on the next report"));
      (session as any).live.emit("activity", { summary: "Moved next-report.txt", undoable: true, actionId: "journal-live-2" });
    }
    vi.spyOn(hands, "undo").mockImplementation(() => new Promise((resolve) => { finishUndo = resolve; }));
    for (let id = 101; id <= 102; id++) {
      client.emit("serverRequest", { id, method: "item/tool/call", params: {
        tool: "lalime_click", arguments: { name: id === 101 ? "Save\u202e" : "Close", windowTitle: "Editor" },
      } });
    }
    await flush(); await publish;
    const before = await api.getSnapshot();
    expect(before.pendingApprovalCount).toBe(2);
    expect(before.pendingApproval).not.toBeNull();
    const oldId = before.pendingApproval.action.id;
    await page.getByTestId("approval-card").waitFor();
    expect(await page.getByTestId("undo-button").first().isDisabled()).toBe(true);
    // Concurrent Undo is a transport request because the renderer correctly disables this button here.
    await page.evaluate((id) => {
      (window as any).qaUndoDone = false;
      (window as any).qaUndoError = null;
      void (window as any).lalime.undo(id).then(() => { (window as any).qaUndoDone = true; },
        (error: unknown) => { (window as any).qaUndoError = String(error); });
    }, entryId);
    await vi.waitFor(() => expect(finishUndo).toBeTypeOf("function"));
    await publish;
    const during = await api.getSnapshot();
    const notice = during.activity.find((entry: any) => entry.id === entryId).approvalWithdrawal;
    expect(notice).toMatchObject({ actionId: oldId, reason: "user_undo", withdrawnCount: 2 });
    expect(during.pendingApproval).toBeNull();
    expect(during.pendingApprovalCount).toBe(0);
    const withdrawal = page.getByTestId("approval-withdrawal");
    await withdrawal.waitFor();
    expect(await withdrawal.getAttribute("role")).toBe("status");
    expect(await withdrawal.getAttribute("aria-live")).toBe("polite");
    expect(await withdrawal.textContent()).toContain(notice.message);
    expect(await withdrawal.textContent()).not.toMatch(/declined/i);
    expect(await withdrawal.textContent()).toContain("Lalime cancelled 2 waiting approvals because you pressed Undo:");
    await page.getByTestId("approval-card").waitFor({ state: "detached" });
    expect(await page.evaluate((id) => (window as any).lalime.respondApproval("do_it", id), oldId)).toBe(false);
    const output = restored ? "Restored report.txt" : "Restored one item; destination occupied: report.txt";
    finishUndo!({ ok: restored, output });
    await page.waitForFunction(() => (window as any).qaUndoDone || (window as any).qaUndoError);
    expect(await page.evaluate(() => (window as any).qaUndoError)).toBeNull();
    await flush(); await publish;
    const final = await api.getSnapshot();
    const entry = final.activity.find((candidate: any) => candidate.id === entryId);
    expect(entry.approvalWithdrawal).toEqual(notice);
    expect(entry.undoResult.status).toBe(restored ? "restored" : "failed");
    const providerReplies = client.respondToolCall.mock.calls.flatMap((call: any[]) => call[1].contentItems.map((item: any) => item.text)).join("\n");
    expect(client.respondToolCall).toHaveBeenCalledTimes(2);
    expect(providerReplies).toContain("user_undo");
    expect(providerReplies).toMatch(/withdrawn|withdrew/);
    expect(providerReplies).not.toMatch(/User declined/);
    expect(providerReplies).toContain(restored ? '"outcome":"restored"' : '"outcome":"failed"');
    if (restored) {
      expect(entry.undone).toBe(true);
      await page.getByTestId("undo-result").waitFor();
      expect(await page.getByTestId("undo-result").textContent()).toMatch(/Restore verified/i);
    } else {
      expect(entry.undone).not.toBe(true);
      expect(providerReplies).toContain(output);
      await page.getByRole("alert").filter({ hasText: output }).waitFor();
      expect(await page.getByTestId("undo-result").count()).toBe(0);
      expect(await page.getByTestId("change-summary").textContent()).toContain(output);
    }
    // Inspect the actual session's writer input, not a separately constructed facts packet.
    vi.spyOn(writerKeys, "loadWriterKey").mockReturnValue("fixture-placeholder");
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture writer response", used: true });
    client.emit("turn/completed", { threadId: "thread", turn: { id: historical ? "turn-2" : "turn", status: "completed" } });
    await vi.waitFor(() => expect(compose).toHaveBeenCalledOnce());
    const facts = compose.mock.calls[0][0];
    writeFileSync(path.join(evidence, `live-writer-facts-${restored ? "restored" : "failed"}-${historical ? "historical" : "current"}.json`), JSON.stringify({ final, providerReplies: client.respondToolCall.mock.calls, writerFacts: facts, renderedNotice: await withdrawal.textContent(), renderedChanges: await page.getByTestId("change-summary").textContent() }, null, 2));
    await page.screenshot({ path: path.join(evidence, `live-writer-${restored ? "restored" : "failed"}-${historical ? "historical" : "current"}.png`), fullPage: true });
    expect(deliveryErrors).toEqual([]);
    expect.soft(facts.actions).toContainEqual(expect.objectContaining({ status: restored ? "skipped" : "failed", undoable: !restored }));
    if (!restored) {
      expect.soft(facts.outcome).toBe("partly_done");
      expect.soft(facts.errors ?? []).toContainEqual({ code: "UNDO_FAILED", plainHint: output });
      expect.soft(facts.actions.some((action: any) => /Undo failed/.test(action.summary))).toBe(true);
    }
    await flush(); await publish;
    expect(deliveryErrors).toEqual([]);
    writeFileSync(path.join(evidence, `live-session-${restored ? "restored" : "failed"}-${historical ? "historical" : "current"}.json`), JSON.stringify({
      coverage: "Real compiled SessionController/LiveAgentHost/registerIpc/preload and production Edge renderer; mocked Electron transport/provider/Hands; concurrent Undo sent through API because UI button is disabled",
      before, during, final, providerReplies: client.respondToolCall.mock.calls, writerFacts: facts,
      renderedNotice: await withdrawal.textContent(), renderedChanges: await page.getByTestId("change-summary").textContent(),
      snapshotCount: snapshots.length, deliveryErrors,
    }, null, 2));
    await page.screenshot({ path: path.join(evidence, `live-session-${restored ? "restored" : "failed"}-${historical ? "historical" : "current"}.png`), fullPage: true });
  } finally {
    finishUndo?.({ ok: false, output: "QA cleanup" });
    closing = true;
    session.dispose();
    await publish;
    await browser.close();
    vi.restoreAllMocks();
  }
}, 60000);

it("live NodeHands partial restore and readable command reach the renderer and model", async () => {
  const evidence = path.resolve("scratch/qa-batch11");
  mkdirSync(evidence, { recursive: true });
  transport.directory = mkdtempSync(path.join(evidence, "live-partial-profile-"));
  transport.handlers.clear();
  const documents = path.join(transport.directory, "Documents");
  mkdirSync(documents);
  const files = ["one.txt", "Mom\u2019s birthday photos.zip", "three.txt"].map(name => path.join(documents, name));
  for (const file of files) writeFileSync(file, "Original " + path.basename(file));
  const journal = path.join(transport.directory, "journal");
  const hands = new NodeHands(journal, [documents]);
  const session = new SessionController(hands);
  const client = new Client();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(7000);
  let closing = false;
  let publish = Promise.resolve();
  const deliveryErrors: string[] = [];
  const snapshots: any[] = [];
  try {
    session.attachLiveClient(client as never);
    const events = new EventEmitter();
    const frame = {};
    const contents = { mainFrame: frame, send(channel: string, snapshot: unknown) { events.emit(channel, {}, snapshot); } };
    registerIpc(session, () => ({ webContents: contents }) as never);
    let api: any;
    const preload = path.resolve("artifacts/codex-c-batch11/dist-electron/electron/preload/index.cjs");
    vm.runInNewContext(readFileSync(preload, "utf8"), { require(name: string) {
      expect(name).toBe("electron");
      return {
        contextBridge: { exposeInMainWorld(key: string, value: unknown) { expect(key).toBe("lalime"); api = value; } },
        ipcRenderer: {
          invoke: async (channel: string, ...args: unknown[]) => {
            const handler = transport.handlers.get(channel);
            if (!handler) throw new Error(`Missing registered IPC handler: ${channel}`);
            return handler({ sender: contents, senderFrame: frame }, ...args);
          },
          on: (channel: string, listener: (...args: any[]) => void) => events.on(channel, listener),
          removeListener: (channel: string, listener: (...args: any[]) => void) => events.removeListener(channel, listener),
        },
      };
    } }, { filename: preload, timeout: 1000 });
    await page.exposeFunction("qaInvoke", (method: string, args: unknown[]) => api[method](...args));
    await page.addInitScript((methods) => {
      const subscribers = new Set<(snapshot: unknown) => void>();
      const target = window as any;
      target.qaPublish = (snapshot: unknown) => { for (const callback of subscribers) callback(snapshot); };
      target.lalime = Object.fromEntries(methods.filter((method) => method !== "subscribe")
        .map((method) => [method, (...args: unknown[]) => target.qaInvoke(method, args)]));
      target.lalime.subscribe = (callback: (snapshot: unknown) => void) => {
        subscribers.add(callback); return () => subscribers.delete(callback);
      };
    }, Object.keys(api));
    api.subscribe((snapshot: unknown) => {
      snapshots.push(structuredClone(snapshot));
      publish = publish.then(async () => {
        if (!closing) await page.evaluate((value) => (window as any).qaPublish(value), snapshot);
      }).catch((error) => { deliveryErrors.push(String(error)); });
    });
    await page.goto(process.env.LALIME_URL ?? "http://127.0.0.1:43128", { waitUntil: "networkidle", timeout: 15000 });
    await page.getByTestId("chat-home").waitFor();

    const welcome = page.getByRole("region", { name: "Before you begin" });
    await welcome.waitFor();
    expect(await welcome.textContent()).toContain("You review important steps before they run. Look for Undo beside changes that Lalime can restore.");
    expect(await welcome.textContent()).toContain("Choose an idea below to draft a message. You can edit it before sending.");
    await page.screenshot({ path: path.join(evidence, "live-first-use.png"), fullPage: true });

    await page.evaluate(() => (window as any).lalime.sendMessage("Review my birthday archive"));
    const moved = await hands.moveToRecycleBin(files, "Moved three QA files");
    expect(moved.ok).toBe(true);
    (session as any).live.emit("activity", { summary: "Moved Mom\u2019s birthday photos.zip and two files", undoable: true, actionId: moved.undoToken });
    const entryId = session.getSnapshot().activity[0].id;
    writeFileSync(files[1], "Newer file must survive");
    const command = "Get-Content\t'" + files[1] + "' # bidi \u202e invisible \u200b literal \\t \\u2019\n" + "# continued\n".repeat(450);
    client.emit("serverRequest", { id: 201, method: "item/commandExecution/requestApproval", params: { itemId: "readable-command", command } });
    await flush(); await publish;
    const before = await api.getSnapshot();
    expect(before.pendingApproval).not.toBeNull();
    expect(before.pendingApproval.summaryTruncated).toBe(true);
    expect(before.pendingApproval.action.summary).toContain("Mom\u2019s birthday photos.zip");
    expect(before.pendingApproval.action.summary).toContain("\\u202e");
    expect(before.pendingApproval.action.summary).toContain("\\u200b");
    const card = page.getByTestId("approval-card");
    await card.waitFor();
    expect(await page.getByTestId("approval-summary").textContent()).toContain("Mom\u2019s birthday photos.zip");
    await page.getByRole("button", { name: "Show full command", exact: true }).click();
    const fullCommand = await page.getByTestId("approval-payload").textContent();
    expect(fullCommand).toContain("Get-Content\t'");
    expect(fullCommand).toContain("\n# continued\n");
    expect(fullCommand).toContain("Mom\u2019s birthday photos.zip");
    expect(fullCommand).toContain("\\u202e");
    expect(fullCommand).toContain("\\u200b");
    expect(fullCommand).toContain("literal \\t \\u2019");
    expect(fullCommand).not.toMatch(/[\u202e\u200b]/);
    expect(await page.getByTestId("approval-payload").evaluate(element => getComputedStyle(element).whiteSpace)).toBe("pre-wrap");
    await page.screenshot({ path: path.join(evidence, "live-readable-command.png"), fullPage: true });
    // This concurrent Undo deliberately uses the actual IPC API: pending consent disables the UI button.
    await page.evaluate(id => (window as any).lalime.undo(id), entryId);
    await flush(); await publish;
    const final = await api.getSnapshot();
    const entry = final.activity.find((item: any) => item.id === entryId);
    expect(entry.undoResult).toMatchObject({ status: "failed", restored: 2, total: 3 });
    expect(entry.undone).not.toBe(true);
    expect(entry.undoResult.reason).not.toMatch(/EEXIST|errno|link '/i);
    expect(entry.undoResult.reason).toMatch(/already exists/i);
    expect(entry.undoResult.reason).toMatch(/left untouched/i);
    expect(entry.undoResult.reason).toContain("Mom\u2019s birthday photos.zip");
    expect(entry.approvalWithdrawal).toMatchObject({ reason: "user_undo", withdrawnCount: 1 });
    expect(entry.approvalWithdrawal.message).toContain("because you pressed Undo");
    await card.waitFor({ state: "detached" });
    expect(await page.getByTestId("approval-withdrawal").textContent()).not.toMatch(/declined/i);
    const change = page.getByTestId("change-summary");
    expect(await change.textContent()).toContain("Partly undone: 2 of 3 items are back.");
    expect(await change.textContent()).toContain(entry.undoResult.reason);
    const providerReplies = client.respondApproval.mock.calls.map(call => JSON.stringify(call)).join("\n")
      + "\n" + client.respondToolCall.mock.calls.map(call => JSON.stringify(call)).join("\n");
    // A subsequent tool receives the host's actual stored Undo notice, as the live model would.
    client.emit("serverRequest", { id: 202, method: "item/tool/call", params: { tool: "lalime_click", arguments: { name: "Save", windowTitle: "Editor" } } });
    await flush(); await publish;
    const modelText = client.respondToolCall.mock.calls.flatMap(call => call[1].contentItems.map((item: any) => item.text)).join("\n");
    expect(modelText).toContain('"outcome":"partly_restored"');
    expect(modelText).toContain('"restored":2,"total":3');
    expect(modelText).not.toMatch(/EEXIST|errno/);
    expect(modelText).toContain("left untouched");
    const batch = path.join(journal, "quarantine", readdirSync(path.join(journal, "quarantine"))[0]);
    expect(entry.undoResult.reason).toContain(path.join(batch, "recovery.json"));
    expect(readFileSync(files[0], "utf8")).toBe("Original one.txt");
    expect(readFileSync(files[2], "utf8")).toBe("Original three.txt");
    expect(readFileSync(files[1], "utf8")).toBe("Newer file must survive");
    expect(readFileSync(path.join(batch, "1"), "utf8")).toBe("Original Mom\u2019s birthday photos.zip");
    expect(JSON.parse(readFileSync(path.join(batch, "recovery.json"), "utf8")).entries).toEqual([
      { quarantineName: "1", originalPath: files[1] },
    ]);
    vi.spyOn(writerKeys, "loadWriterKey").mockReturnValue("fixture-placeholder");
    const compose = vi.spyOn(WriterService.prototype, "composeReply").mockResolvedValue({ text: "Fixture writer response", used: true });
    client.emit("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } });
    await vi.waitFor(() => expect(compose).toHaveBeenCalledOnce());
    const facts = compose.mock.calls[0][0];
    expect(facts.outcome).toBe("partly_done");
    expect(facts.actions.some((action: any) => /Partly restored \(2 of 3\)/.test(action.summary))).toBe(true);
    expect(JSON.stringify(facts.errors)).not.toMatch(/EEXIST|errno/);
    await flush(); await publish;
    expect(deliveryErrors).toEqual([]);
    writeFileSync(path.join(evidence, "live-node-partial.json"), JSON.stringify({ coverage: "Real compiled SessionController/NodeHands/registerIpc/preload with production Edge renderer; fake Electron transport and provider only; three real scratch files", before, final, fullCommand, modelText, providerReplies, writerFacts: facts, snapshotCount: snapshots.length, renderedChanges: await change.textContent(), deliveryErrors }, null, 2));
    await page.getByRole("alert").filter({ hasText: "Partly undone: 2 of 3 items are back." }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, "live-node-partial.png"), fullPage: true });
    // The recap uses the live host's failed-with-counts snapshot, not a renderer fixture.
    const partialRecap = page.getByTestId("activity-recap");
    await partialRecap.waitFor();
    const partialRecapText = await partialRecap.textContent();
    expect(partialRecapText).toBe("1 recorded step. Undo available for 1.");
    expect(await partialRecap.textContent()).not.toMatch(/restore verified|all done|everything undoable/i);

    await page.evaluate(() => (window as any).lalime.sendMessage("Recycle only these named scratch files"));
    const existing = path.join(documents, "batch11-existing.txt");
    writeFileSync(existing, "Original batch11 file");
    const missing = Array.from({ length: 8 }, (_, index) => path.join(documents, "missing-" + index + "-marker.txt"));
    client.emit("serverRequest", { id: 301, method: "item/tool/call", params: {
      threadId: "thread", turnId: "turn-2", tool: "lalime_recycle", arguments: { paths: [existing, ...missing] },
    } });
    await vi.waitFor(() => expect(session.getSnapshot().pendingApproval).not.toBeNull());
    await publish;
    const recycleCard = await api.getSnapshot();
    expect(recycleCard.pendingApproval.action.paths).toEqual([existing, ...missing]);
    const recycleId = recycleCard.pendingApproval.action.id;
    if (recycleCard.pendingApproval.decision.kind === "ask_hold") {
      expect(await api.beginApprovalHold(recycleId)).toBe(true);
      await vi.waitFor(async () => expect(await api.respondApproval("hold_confirmed", recycleId)).toBe(true), { timeout: 5000, interval: 100 });
    } else {
      expect(await api.respondApproval("do_it", recycleId)).toBe(true);
    }
    await vi.waitFor(() => expect(client.respondToolCall.mock.calls.some(call => call[0] === 301)).toBe(true));
    await publish;
    const failureResponse = client.respondToolCall.mock.calls.find(call => call[0] === 301)![1];
    const failureModelText = failureResponse.contentItems.map((item: any) => item.text).join("\n");
    expect(failureResponse.success).toBe(false);
    expect(failureModelText).toContain("Moved 1 item(s)");
    expect(failureModelText).toContain("Failed 8");
    expect(failureModelText).toContain("and 3 more");
    expect(failureModelText).not.toMatch(/ENOENT|lstat|errno/);
    const failedSnapshot = await api.getSnapshot();
    const failedEntry = failedSnapshot.activity.find((item: any) => item.actionId && item.actionId !== moved.undoToken);
    expect(failedEntry).toBeDefined();
    expect(failedEntry.summary).toMatch(/partially completed/i);
    const failureRow = page.getByTestId("change-entry").filter({ hasText: "Recycle partially completed:" });
    await failureRow.waitFor();
    const failureRenderedText = await failureRow.textContent();
    for (const file of missing.slice(0, 5)) {
      expect(failureModelText).toContain(file);
      expect(failureRenderedText).toContain(file);
    }
    for (const file of missing.slice(5)) {
      expect(failureModelText).not.toContain(file);
      expect(failureRenderedText).not.toContain(file);
    }
    expect(failureRenderedText).toContain("and 3 more");
    expect(failureRenderedText).not.toMatch(/ENOENT|lstat|errno/);
    await page.setViewportSize({ width: 390, height: 700 });
    await failureRow.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, "live-batch11-named-failures.png"), fullPage: true });

    const longCommand = "Get-Content '" + existing + "' #" + "x".repeat(100_001);
    client.emit("serverRequest", { id: 302, method: "item/commandExecution/requestApproval", params: {
      threadId: "thread", turnId: "turn-2", itemId: "batch11-long-command", command: longCommand,
    } });
    await vi.waitFor(() => expect(session.getSnapshot().pendingApproval).not.toBeNull());
    await publish;
    const longSnapshot = await api.getSnapshot();
    const longHint = "This command is too long to check for Allow-for-task. You can still approve it once.";
    expect(longSnapshot.pendingApproval.grantUnavailableReason).toBe(longHint);
    expect(longSnapshot.pendingApproval.canAllowForTask).toBe(false);
    const longCard = page.getByTestId("approval-card");
    await longCard.waitFor();
    expect(await longCard.textContent()).toContain(longHint);
    expect(await longCard.getByRole("button", { name: /Allow for this task/i }).count()).toBe(0);
    await longCard.getByTestId("grant-unavailable").scrollIntoViewIfNeeded();
    await vi.waitFor(async () => expect(await longCard.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1));
    await page.screenshot({ path: path.join(evidence, "live-batch11-long-command.png"), fullPage: true });
    expect(deliveryErrors).toEqual([]);
    writeFileSync(path.join(evidence, "live-batch11-named-failures.json"), JSON.stringify({
      coverage: "Real compiled SessionController/LiveAgentHost/NodeHands/registerIpc/preload and Edge renderer; fake Electron transport and provider; actual one-file move plus eight missing paths",
      failureResponse, failedSnapshot, failureModelText, failureRenderedText,
      longCard: longSnapshot.pendingApproval, renderedLongHint: await longCard.textContent(),
      partialRecap: partialRecapText, deliveryErrors,
    }, null, 2));

  } finally {
    closing = true;
    session.dispose();
    await publish;
    await browser.close();
    vi.restoreAllMocks();
  }
}, 60000);
