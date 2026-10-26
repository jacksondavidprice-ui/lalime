// Test packaged desktop contracts with a local HTTP fixture and MockHands.
// Native actions and Windows restoration are not tested by this fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.argv.find((arg) => arg.startsWith("--packaged-executable="))?.split("=").slice(1).join("=");
const appRoot = path.resolve(process.argv.find((arg) => arg.startsWith("--app-root="))?.slice("--app-root=".length) || root);
const evidence = path.resolve(process.argv.find((arg) => arg.startsWith("--evidence-dir="))?.slice("--evidence-dir=".length) || path.join(root, "scratch/qa-batch6/contracts"));
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(path.join(evidence, "profile-"));
const entry = path.join(profile, "bootstrap.cjs");
writeFileSync(entry, `const { app } = require('electron'); app.setPath('userData', ${JSON.stringify(profile)}); import(${JSON.stringify(pathToFileURL(path.join(appRoot, "dist-electron/electron/main/index.js")).href)}).catch(() => app.exit(1));`);
const env = {};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "USERPROFILE"]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.APPDATA = path.join(profile, "appdata");
env.LOCALAPPDATA = path.join(profile, "localappdata");
env.CODEX_HOME = path.join(profile, "codex");
env.LALIME_CODEX_BIN = path.join(profile, "no-codex.exe");
for (const directory of [env.APPDATA, env.LOCALAPPDATA]) mkdirSync(directory, { recursive: true });
const requests = [];
const errors = [];
const checks = [];
let pending = [];
let waiting;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers["x-api-key"], undefined);
    let body = "";
    for await (const chunk of request) { body += chunk; assert.ok(body.length < 1_000_000); }
    const parsed = JSON.parse(body);
    assert.equal(parsed.model, "explicit-local-contract-fixture");
    requests.push(parsed);
    const item = { parsed, response };
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(item); }
    else pending.push(item);
  } catch (error) {
    errors.push(error.message);
    response.writeHead(500).end("Fixture assertion failed");
  }
});
const nextRequest = () => new Promise((resolve, reject) => {
  if (pending.length) return resolve(pending.shift());
  const timer = setTimeout(() => { waiting = undefined; reject(new Error("Timed out waiting for HTTP fixture request")); }, 12_000);
  waiting = (item) => { clearTimeout(timer); resolve(item); };
});
const reply = (item, message) => item.response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
let toolId = 0;
const tool = (name, args) => ({ role: "assistant", content: null, tool_calls: [{ id: `contract-${++toolId}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const text = (content) => ({ role: "assistant", content });
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
let app;
let report;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  app = await electron.launch({ ...(executable ? { executablePath: path.resolve(executable) } : {}), args: executable ? [`--user-data-dir=${profile}`] : [entry], cwd: appRoot, env, timeout: 20_000 });
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 900, height: 900 });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByTestId("onboarding").waitFor();
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(executable));
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);

  // Capture the existing session through its real IPC getter. Replace only the
  // OS backend before any provider connects. Guardian and session stay intact.
  await app.evaluate(async ({ app }, sourceRoot) => {
    // Playwright's evaluate runs without an ESM dynamic-import callback, so
    // load the compiled module through require(esm) on the same module graph.
    const path = process.getBuiltinModule("node:path");
    const requireCompiled = process.getBuiltinModule("node:module").createRequire(path.join(sourceRoot, "package.json"));
    const { SessionController } = requireCompiled(path.join(app.isPackaged ? app.getAppPath() : sourceRoot, "dist-electron/electron/main/session.js"));
    const original = SessionController.prototype.getSnapshot;
    SessionController.prototype.getSnapshot = function () { globalThis.contractSession = this; return original.call(this); };
  }, appRoot);
  await page.evaluate(() => window.lalime.getSnapshot());
  await app.evaluate(async ({ app }, sourceRoot) => {
    // Playwright's evaluate runs without an ESM dynamic-import callback, so
    // load the compiled module through require(esm) on the same module graph.
    const path = process.getBuiltinModule("node:path");
    const requireCompiled = process.getBuiltinModule("node:module").createRequire(path.join(sourceRoot, "package.json"));
    const { MockHands } = requireCompiled(path.join(app.isPackaged ? app.getAppPath() : sourceRoot, "dist-electron/hands/mock/index.js"));
    const hands = new MockHands();
    globalThis.contractCalls = [];
    for (const method of ["listWindows", "listUiElements", "clickElement", "openSettings", "moveToRecycleBin", "undo"]) {
      const original = hands[method].bind(hands);
      hands[method] = async (...args) => {
        globalThis.contractCalls.push({ method, args });
        if (method === "undo" && globalThis.contractFailUndo) {
          globalThis.contractFailUndo = false;
          return { ok: false, output: "Fixture destination already exists." };
        }
        return original(...args);
      };
    }
    globalThis.contractSession.hands = hands;
  }, appRoot);
  const settings = await page.evaluate((baseUrl) => window.lalime.updateSettings({ providerId: "custom", model: "explicit-local-contract-fixture", baseUrl, allowComputerControl: true, allowScreenCapture: true }), `http://127.0.0.1:${server.address().port}/v1`);
  assert.equal(settings.ok, true);
  assert.equal((await page.evaluate(() => window.lalime.connectProvider())).ok, true);
  await page.evaluate(() => window.lalime.completeOnboarding());
  const snapshot = () => page.evaluate(() => window.lalime.getSnapshot());
  const waitState = async (predicate) => {
    const deadline = performance.now() + 10_000;
    while (!predicate(await snapshot())) {
      assert.ok(performance.now() < deadline, `Timed out waiting for desktop state: ${predicate}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const approval = async () => { await waitState((state) => !!state.pendingApproval); await page.getByTestId("approval-card").waitFor(); return (await snapshot()).pendingApproval; };
  const start = async (prompt) => { await page.evaluate((value) => window.lalime.sendMessage(value), prompt); return nextRequest(); };
  const finish = async (request) => { reply(request, text("Fixture task completed.")); await waitState((state) => !state.running); };
  const countCalls = (method) => app.evaluate((_, name) => globalThis.contractCalls.filter((call) => call.method === name).length, method);

  // RepeatGuard refuses a third identical call in one turn, so the revoke check
  // and the same-task reuse check each use at most two identical calls.
  let request = await start("Open Sound settings to test revoking one exact task grant.");
  reply(request, tool("lalime_open_settings", { uri: "ms-settings:sound" }));
  let card = await approval();
  assert.equal(card.canAllowForTask, true);
  await page.getByRole("button", { name: "Allow for this task", exact: true }).click();
  request = await nextRequest();
  assert.equal((await snapshot()).taskGrants.length, 1);
  assert.equal(await countCalls("openSettings"), 1);
  await page.getByRole("button", { name: "Open plan and activity", exact: true }).click();
  const activityDialog = page.getByRole("dialog", { name: "Plan and activity", exact: true });
  await activityDialog.getByTestId("task-grants").getByRole("button", { name: "Revoke", exact: true }).click();
  await waitState((state) => state.taskGrants.length === 0);
  await activityDialog.getByTestId("task-grants").waitFor({ state: "hidden" });
  await activityDialog.getByRole("button", { name: "Close", exact: true }).click();
  reply(request, tool("lalime_open_settings", { uri: "ms-settings:sound" }));
  await approval();
  assert.equal(await countCalls("openSettings"), 1);
  await page.getByTestId("approval-not-now").click();
  await finish(await nextRequest());

  request = await start("Open Display settings twice to test one exact task grant.");
  reply(request, tool("lalime_open_settings", { uri: "ms-settings:display" }));
  card = await approval();
  assert.equal(card.canAllowForTask, true);
  assert.equal((await snapshot()).pendingApprovalCount, 1);
  await page.getByRole("button", { name: "Allow for this task", exact: true }).click();
  request = await nextRequest();
  assert.equal((await snapshot()).taskGrants.length, 1);
  assert.equal(await countCalls("openSettings"), 2);
  reply(request, tool("lalime_open_settings", { uri: "ms-settings:display" }));
  request = await nextRequest();
  assert.equal(await countCalls("openSettings"), 3);
  assert.equal((await snapshot()).pendingApprovalCount, 0);
  await finish(request);
  pass("HTTP tool grant, same-task reuse, renderer Revoke, and fresh approval after revocation");

  request = await start("Move the fixture Downloads file to the Recycle Bin.");
  reply(request, tool("lalime_recycle", { paths: ["C:\\Users\\Fixture\\Downloads\\fixture.tmp"] }));
  await approval();
  await page.getByTestId("approval-do-it").click();
  await finish(await nextRequest());
  const change = (await snapshot()).activity.find((entry) => entry.undoable);
  assert.ok(change);
  await app.evaluate(() => { globalThis.contractFailUndo = true; });
  await page.evaluate((id) => window.lalime.undo(id), change.id);
  let undo = (await snapshot()).activity.find((entry) => entry.id === change.id);
  assert.equal(undo.undoResult.status, "failed");
  assert.notEqual(undo.undone, true);
  assert.equal(undo.undoable, true);
  assert.equal(await app.evaluate(() => globalThis.contractSession.hands.listJournal()[0].undone), false);
  await page.evaluate((id) => window.lalime.undo(id), change.id);
  undo = (await snapshot()).activity.find((entry) => entry.id === change.id);
  assert.equal(undo.undoResult.status, "restored");
  assert.equal(undo.undone, true);
  assert.equal(await app.evaluate(() => globalThis.contractSession.hands.listJournal()[0].undone), true);
  assert.equal(await countCalls("undo"), 2);
  await page.evaluate((id) => window.lalime.undo(id), change.id);
  assert.equal(await countCalls("undo"), 2);
  pass("real Undo IPC reports mock backend failure, permits retry, and records only verified success");

  request = await start("Move another fixture file so Undo can withdraw later pending consent.");
  reply(request, tool("lalime_recycle", { paths: ["C:\\Users\\Fixture\\Downloads\\undo-pending.tmp"] }));
  await approval();
  await page.getByTestId("approval-do-it").click();
  await finish(await nextRequest());
  const pendingUndoChange = (await snapshot()).activity.find(entry => entry.undoable && !entry.undone);
  assert.ok(pendingUndoChange);
  request = await start("Open settings after reviewing the new approval.");
  reply(request, tool("lalime_open_settings", { uri: "ms-settings:display" }));
  const withdrawnCard = await approval();
  const settingsCallsBeforeUndo = await countCalls("openSettings");
  await page.evaluate(id => window.lalime.undo(id), pendingUndoChange.id);
  await waitState(state => state.pendingApproval === null && state.pendingApprovalCount === 0);
  await page.getByTestId("approval-card").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(id => window.lalime.respondApproval("do_it", id), withdrawnCard.action.id), false);
  assert.equal(await countCalls("openSettings"), settingsCallsBeforeUndo);
  request = await nextRequest();
  const withdrawal = request.parsed.messages.at(-1).content;
  assert.match(withdrawal, /withdrew|withdrawn/i);
  assert.doesNotMatch(withdrawal, /User declined/i);
  assert.match(withdrawal, /user_undo/);
  assert.match(withdrawal, /restored/);
  const undoPageText = await page.locator("body").innerText();
  assert.doesNotMatch(undoPageText, /User declined/i);
  const withdrawalNotice = (await snapshot()).activity.find(entry => entry.id === pendingUndoChange.id).approvalWithdrawal;
  assert.equal(withdrawalNotice.actionId, withdrawnCard.action.id);
  assert.equal(withdrawalNotice.reason, "user_undo");
  assert.equal(withdrawalNotice.withdrawnCount, 1);
  const notice = page.getByTestId("approval-withdrawal");
  await notice.waitFor();
  assert.equal(await notice.getAttribute("role"), "status");
  assert.equal(await notice.getAttribute("aria-live"), "polite");
  await notice.getByText(withdrawalNotice.message, { exact: true }).waitFor();
  await finish(request);
  pass("Undo withdraws pending desktop consent, explains withdrawal in the renderer, and reports verified restoration without user-decline wording");

  request = await start("Look at the fixture windows and controls, then turn on Night light.");
  reply(request, tool("lalime_list_windows", {}));
  request = await nextRequest();
  assert.match(request.parsed.messages.at(-1).content, /Untrusted screen data/);
  reply(request, tool("lalime_list_ui", { windowTitle: "Settings" }));
  request = await nextRequest();
  assert.match(request.parsed.messages.at(-1).content, /Untrusted screen data/);
  reply(request, tool("lalime_click", { name: "Night light", windowTitle: "Settings" }));
  card = await approval();
  assert.equal(card.decision.kind, "ask");
  assert.equal(card.decision.tier, 2);
  assert.equal(card.action.fromUntrustedContent, true);
  assert.equal(card.canAllowForTask, false);
  assert.equal(await page.getByRole("button", { name: "Allow for this task", exact: true }).count(), 0);
  assert.ok(card.decision.matchedRules.includes("host.screen_observation_consent"));
  assert.equal((await snapshot()).blockedNotice, null);
  assert.equal(await countCalls("clickElement"), 0);
  await page.getByTestId("approval-do-it").click();
  await finish(await nextRequest());
  assert.equal(await countCalls("listWindows"), 1);
  assert.equal(await countCalls("listUiElements"), 1);
  assert.equal(await countCalls("clickElement"), 1);
  pass("HTTP list_windows/list_ui provenance leads to normal tier-2 approval before a mocked benign action");

  request = await start("Test the host service hold and two pending requests without executing a command.");
  // The HTTP provider intentionally has no shell tool and serializes tools.
  // Inject two protocol events at its existing transport boundary to exercise
  // command consent and a concurrent queue. No native command executor runs.
  await app.evaluate(() => {
    const client = globalThis.contractSession.apiClient;
    globalThis.contractDecisions = [];
    const host = globalThis.contractSession.live;
    const presented = new Set();
    globalThis.contractPreviewAttempts = [];
    globalThis.contractPresentedListener = card => presented.add(card.action.id);
    globalThis.contractPreviewListener = (_count, entries) => {
      for (const entry of entries) {
        if (!presented.has(entry.actionId)) globalThis.contractPreviewAttempts.push({
          id: entry.actionId,
          accepted: host.respondApproval("do_it", entry.actionId),
          hold: host.beginApprovalHold(entry.actionId),
        });
      }
    };
    host.on("approvalNeeded", globalThis.contractPresentedListener);
    host.on("approvalQueue", globalThis.contractPreviewListener);
    const original = client.respondApproval.bind(client);
    client.respondApproval = (id, decision) => { globalThis.contractDecisions.push({ id, decision }); return original(id, decision); };
    client.emit("serverRequest", { id: "contract-hold", method: "item/commandExecution/requestApproval", params: { itemId: "contract-command", command: "Start-Service Spooler" } });
    client.emit("serverRequest", { id: "contract-queued", method: "item/tool/call", params: { tool: "lalime_open_settings", arguments: { uri: "ms-settings:display" } } });
  });
  await waitState((state) => state.pendingApprovalCount === 2);
  card = await approval();
  assert.equal(card.decision.kind, "ask_hold");
  await page.getByTestId("approval-card").getByText("1 more waiting", { exact: true }).waitFor();
  const queue = (await snapshot()).approvalQueue;
  assert.equal(queue.length, 2);
  assert.equal(queue[0].actionId, card.action.id);
  assert.equal(queue[0].canAllowForTask, false);
  assert.equal(queue[1].canAllowForTask, true);
  assert.equal(await page.evaluate((id) => window.lalime.respondApproval("do_it", id), queue[1].actionId), false);
  assert.equal(await page.evaluate((id) => window.lalime.beginApprovalHold(id), queue[1].actionId), false);
  const composer = page.getByTestId("chat-input");
  await composer.fill("");
  await composer.press("ArrowUp");
  assert.equal(await composer.inputValue(), "");
  assert.equal((await snapshot()).pendingApproval.action.id, card.action.id);
  pass("pending host approval prevents Up-arrow recall and rejects queued preview IDs through IPC");
  await page.getByRole("button", { name: "1 more waiting", exact: true }).click();
  const preview = page.getByRole("list", { name: "Approval queue", exact: true });
  await preview.waitFor();
  assert.deepEqual(await preview.getByTestId("approval-queue-summary").allTextContents(), queue.map((entry) => entry.summary));
  assert.equal(await preview.getByRole("listitem").count(), 2);
  assert.equal(await preview.getByRole("listitem").first().getAttribute("aria-current"), "step");
  assert.equal(await preview.getByRole("button").count(), 0);
  await page.getByRole("button", { name: "1 more waiting", exact: true }).focus();
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  assert.equal((await snapshot()).pendingApprovalCount, 2);
  const holdId = card.action.id;
  const respond = (choice) => page.evaluate(({ choice, id }) => window.lalime.respondApproval(choice, id), { choice, id: holdId });
  assert.equal(await respond("do_it"), false);
  assert.equal(await respond("hold_confirmed"), false);
  assert.equal(await page.evaluate(() => window.lalime.beginApprovalHold("stale-contract")), false);
  assert.equal(await page.evaluate((id) => window.lalime.beginApprovalHold(id), holdId), true);
  assert.equal(await respond("hold_confirmed"), false);
  await page.evaluate((id) => window.lalime.cancelApprovalHold(id), holdId);
  // Let a valid hold duration elapse. Immediate rejection alone would not prove
  // that cancellation invalidated the host timer.
  await page.evaluate(() => { globalThis.contractCancelledAt = performance.now(); });
  await page.waitForFunction(() => performance.now() - globalThis.contractCancelledAt >= 1600);
  assert.equal(await respond("hold_confirmed"), false);
  assert.equal((await snapshot()).pendingApprovalCount, 2);
  assert.deepEqual(await app.evaluate(() => globalThis.contractDecisions), []);
  // Exercise the packaged renderer's host acknowledgement, timer, and release.
  await page.getByTestId("approval-do-it").focus();
  await page.keyboard.down("Space");
  await page.waitForFunction(() => document.querySelector('[data-testid="approval-card"]')?.textContent?.includes("Release to confirm"));
  await page.keyboard.up("Space");
  await waitState((state) => state.pendingApprovalCount === 1 && state.pendingApproval?.action.kind === "open_settings");
  await page.getByTestId("approval-card").getByText("1 more waiting", { exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual((await snapshot()).approvalQueue.map((entry) => entry.actionId), [queue[1].actionId]);
  assert.equal(await respond("do_it"), false);
  assert.equal(await respond("allow_for_task"), false);
  assert.equal(await respond("hold_confirmed"), false);
  assert.deepEqual(await app.evaluate(() => globalThis.contractDecisions), [{ id: "contract-hold", decision: "accept" }]);
  await page.getByTestId("approval-not-now").click();
  await waitState((state) => state.pendingApprovalCount === 0 && state.pendingApproval === null);
  await finish(request);
  assert.deepEqual((await snapshot()).approvalQueue, []);
  const previewAttempts = await app.evaluate(() => {
    const host = globalThis.contractSession.live;
    host.off("approvalNeeded", globalThis.contractPresentedListener);
    host.off("approvalQueue", globalThis.contractPreviewListener);
    return globalThis.contractPreviewAttempts;
  });
  for (const entry of queue) assert.ok(previewAttempts.some(attempt => attempt.id === entry.actionId));
  assert.ok(previewAttempts.every(attempt => attempt.accepted === false && attempt.hold === false));
  pass("real host rejects first and promoted preview consent synchronously before card emission");
  pass("desktop acknowledged hold, cancellation, exact read-only FIFO preview, stale promoted ID rejection, queue 2-to-1-to-0");

  request = await start("Check exact command grant eligibility without executing commands.");
  const emitCommand = (id, command) => app.evaluate((_, input) => {
    globalThis.contractSession.apiClient.emit("serverRequest", {
      id: input.id, method: "item/commandExecution/requestApproval",
      params: { itemId: input.id, command: input.command, cwd: "C:\\Users\\Fixture\\Downloads" },
    });
  }, { id, command });
  for (const [name, command, allowed] of [
    ["ordinary", "Write-Output fixture", true],
    ["escaped-summary", "Write-Output '" + "\u202e".repeat(900) + "'", true],
    ["invoke-executable", "Invoke-Item 'C:\\Users\\Fixture\\Downloads\\tool.exe'", false],
    ["unc-process", "Start-Process '\\\\server\\share\\report.pdf'", false],
    ["static-delete", "[IO.File]::Delete('C:\\Users\\Fixture\\Downloads\\a.tmp')", false],
    ["pipeline-delete", "Get-ChildItem 'C:\\Users\\Fixture\\Downloads\\*.tmp' | ForEach-Object { $_.Delete() }", false],
    ["chained-delete", "(Get-Item 'C:\\Users\\Fixture\\Downloads\\a.tmp').PSObject.BaseObject.Delete()", false],
    ["chained-pipeline-delete", "Get-ChildItem 'C:\\Users\\Fixture\\Downloads\\*.tmp' | ForEach-Object { $_.PSObject.BaseObject.Delete() }", false],
    ["long-summary", `Write-Output '${"x".repeat(6000)}'`, true],
  ]) {
    await page.getByTestId("approval-card").waitFor({ state: "hidden" });
    await emitCommand(`contract-${name}`, command);
    card = await approval();
    assert.equal(card.canAllowForTask, allowed, name);
    assert.equal((await snapshot()).approvalQueue[0].canAllowForTask, allowed, name);
    const allow = page.getByRole("button", { name: "Allow for this task", exact: true });
    if (allowed) await allow.waitFor();
    else {
      assert.equal(await allow.count(), 0, name);
      assert.equal(typeof card.grantUnavailableReason, "string", name);
      assert.ok(card.grantUnavailableReason.length > 0, name);
      assert.equal((await snapshot()).approvalQueue[0].grantUnavailableReason, card.grantUnavailableReason, name);
      await page.getByTestId("grant-unavailable").waitFor();
      const hint = await page.getByTestId("grant-unavailable").textContent();
      assert.ok(hint.startsWith(card.grantUnavailableReason), name);
      if (card.grantUnavailableReason.includes("uses syntax Lalime can't check")) assert.ok(hint.endsWith("You can still approve it once."), name);
      else assert.equal(hint, card.grantUnavailableReason, name);
      assert.equal(await page.evaluate((id) => window.lalime.respondApproval("allow_for_task", id), card.action.id), false, name);
      assert.deepEqual((await snapshot()).taskGrants, []);
    }
    if (name === "long-summary" || name === "escaped-summary") {
      const entry = (await snapshot()).approvalQueue[0];
      assert.equal(card.summaryTruncated, true);
      const visibleCommand = command.replace(/\u202e/g, "\\u202e");
      assert.equal(card.summaryFullLength, `Run: ${visibleCommand}`.length);
      for (const value of [card.action.summary, card.decision.plainEnglish]) {
        assert.ok(value.length <= 4096);
        assert.doesNotMatch(value.replace(/\.\.\.\(\+\d+ more\)$/, ""), /\\(?:u[0-9a-f]{0,3}|u\{[0-9a-f]*)?$/i);
      }
      assert.ok(card.action.summary.length <= 4096);
      assert.equal(card.action.payload, command);
      assert.equal(card.decision.details, command);
      assert.equal(entry.summary, card.action.summary);
      assert.equal(entry.summaryTruncated, true);
      assert.equal(entry.summaryFullLength, card.summaryFullLength);
      await page.getByTestId("approval-summary-truncated").waitFor();
      assert.equal(await page.getByTestId("approval-payload").count(), 0);
      await page.getByRole("button", { name: "Show full command", exact: true }).click();
      assert.equal(await page.getByTestId("approval-payload").textContent(), visibleCommand);
      assert.equal((await snapshot()).pendingApproval.action.id, card.action.id);
      pass("host truncation metadata reaches card and queue; renderer disclosure reveals the complete escaped command");
    }
    await page.getByTestId("approval-not-now").click();
    await waitState((state) => state.pendingApproval === null && state.pendingApprovalCount === 0);
    pass(`host-to-renderer command grant eligibility: ${name}`);
  }
  await page.getByTestId("approval-card").waitFor({ state: "hidden" });
  await app.evaluate(() => {
    for (let i = 0; i < 300; i++) globalThis.contractSession.apiClient.emit("serverRequest", {
      id: "contract-bounded-" + i, method: "item/commandExecution/requestApproval",
      params: { itemId: "contract-bounded-" + i, command: "Write-Output '" + i + ":" + "x".repeat(50000) + "'" },
    });
  });
  await waitState(state => state.pendingApprovalCount === 300);
  const boundedState = await snapshot();
  assert.equal(boundedState.approvalQueue.length, 50);
  assert.ok(boundedState.approvalQueue.every(entry => entry.summary.length <= 4096 && entry.summaryTruncated && entry.summaryFullLength > 50000));
  await page.getByRole("button", { name: "299 more waiting", exact: true }).click();
  const boundedPreview = page.getByRole("list", { name: "Approval queue", exact: true });
  await boundedPreview.waitFor();
  assert.equal(await boundedPreview.getByRole("listitem").count(), 20);
  assert.deepEqual(await boundedPreview.getByTestId("approval-queue-summary").allTextContents(), boundedState.approvalQueue.slice(0, 20).map(entry => entry.summary));
  await page.getByText("and 280 more waiting", { exact: true }).waitFor();
  assert.equal(await boundedPreview.getByRole("button").count(), 0);
  await page.getByRole("button", { name: "299 more waiting", exact: true }).click();
  pass("300 commands of 50k characters reach real renderer as 50 previews with exact count and 20 rows plus 280 omitted");
  card = await approval();
  const staleId = card.action.id;
  await page.evaluate(() => window.lalime.stop());
  await waitState((state) => state.stopped && !state.running && state.pendingApproval === null && state.pendingApprovalCount === 0);
  await page.getByTestId("approval-card").waitFor({ state: "hidden" });
  assert.deepEqual((await snapshot()).approvalQueue, []);
  assert.equal(await page.getByTestId("approval-queue-summary").count(), 0);
  assert.equal(await page.evaluate((id) => window.lalime.beginApprovalHold(id), staleId), false);
  for (const choice of ["do_it", "allow_for_task", "hold_confirmed"]) {
    assert.equal(await page.evaluate(({ id, choice }) => window.lalime.respondApproval(choice, id), { id: staleId, choice }), false);
  }
  reply(request, text("Fixture stopped."));
  assert.equal((await snapshot()).pendingApproval, null);
  assert.deepEqual((await snapshot()).taskGrants, []);
  pass("Stop clears renderer card and queue and rejects every stale consent choice");
  assert.deepEqual(errors, []);
  report = { passed: true, checks, packaged: Boolean(executable), appRoot, rendererUrl: page.url(), mockProvider: true, mockHands: true, nativeExecutionTested: false, windowsRestoreTested: false, injectedCommandAndQueueEvents: true, httpRequests: requests.length };
} catch (error) {
  report = { passed: false, packaged: Boolean(executable), appRoot, mockProvider: true, mockHands: true, nativeExecutionTested: false, checks, message: error.message, stack: error.stack, errors, httpRequests: requests.length };
  throw error;
} finally {
  try { if (app) await app.close(); }
  finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    writeFileSync(path.join(profile, "result.json"), JSON.stringify(report, null, 2));
    console.log(`Contract evidence: ${profile}`);
  }
}
