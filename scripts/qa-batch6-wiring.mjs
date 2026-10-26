/** Batch 6 artifact checks. No native command execution or Electron launch. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.resolve(process.argv.find(arg => arg.startsWith("--app-root="))?.slice("--app-root=".length) || path.join(root, "artifacts/codex-c-batch6"));
const build = path.join(appRoot, "dist-electron");
const evidence = path.resolve(process.argv.find(arg => arg.startsWith("--evidence-dir="))?.slice("--evidence-dir=".length) || path.join(root, "scratch/qa-batch6"));
const repro = process.argv.includes("--delete-repro");
const results = [];
const observations = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, message: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}

if (!repro) {
  const calls = [];
  const listeners = new Map();
  let snapshot = { pendingApprovalCount: 2, approvalQueue: [
    { actionId: "first", kind: "powershell", summary: "Exact \\n summary", tier: 3, canAllowForTask: false, grantUnavailableReason: "Review this command each time.", summaryTruncated: true, summaryFullLength: 6000 },
    { actionId: "second", kind: "open_settings", summary: "Open display settings", tier: 2, canAllowForTask: true },
  ] };
  let api;
  const preload = path.join(build, "electron/preload/index.cjs");
  await check("isolated compiled preload exposes only the Electron-backed bridge", () => {
    vm.runInNewContext(readFileSync(preload, "utf8"), { require(name) {
      assert.equal(name, "electron");
      return {
        contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "lalime"); api = value; } },
        ipcRenderer: {
          invoke: async (...args) => { calls.push(args); return args[0] === "lalime:getSnapshot" ? snapshot : true; },
          on: (channel, fn) => listeners.set(channel, fn),
          removeListener: (channel, fn) => { assert.equal(listeners.get(channel), fn); listeners.delete(channel); },
        },
      };
    } }, { filename: preload, timeout: 1000 });
    assert.equal(typeof api, "object");
  });
  await check("getSnapshot preserves authoritative queue entries and count", async () => {
    assert.deepEqual(await api.getSnapshot(), snapshot);
    assert.deepEqual(calls.pop(), ["lalime:getSnapshot"]);
  });
  for (const [method, args] of [
    ["respondApproval", ["hold_confirmed", "first"]],
    ["respondApproval", ["allow_for_task", "second"]],
    ["beginApprovalHold", ["first"]],
    ["cancelApprovalHold", ["first"]],
    ["revokeTaskGrant", ["grant-first"]],
  ]) await check(`${method} preserves channel, arguments, and acknowledgement (${args[0]})`, async () => {
    assert.equal(await api[method](...args), true);
    assert.deepEqual(calls.pop(), [`lalime:${method}`, ...args]);
  });
  await check("snapshot subscription preserves entries and unsubscribes the same listener", () => {
    let received;
    const unsubscribe = api.subscribe(value => { received = value; });
    listeners.get("lalime:snapshot")({}, snapshot);
    assert.deepEqual(received, snapshot);
    unsubscribe();
    assert.equal(listeners.size, 0);
  });
  const { LiveAgentHost } = await import(pathToFileURL(path.join(build, "electron/main/live-agent.js")));
  const { MockHands } = await import(pathToFileURL(path.join(build, "hands/mock/index.js")));
  class Client extends EventEmitter {
    startThread = async () => "thread";
    startTurn = async () => ({ turnId: "turn" });
    interruptTurn = async () => {};
    responses = [];
    respondApproval = (id, decision) => this.responses.push({ id, decision });
    respondFileChangeApproval = () => {};
    respondToolCall = () => {};
  }
  async function withHost(fn) {
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true, maxToolCalls: 1000 });
    const cards = [];
    snapshot = { pendingApproval: null, pendingApprovalCount: 0, approvalQueue: [] };
    host.on("approvalNeeded", card => { cards.push(card); snapshot.pendingApproval = card; });
    host.on("approvalQueue", (count, entries) => { snapshot.pendingApprovalCount = count; snapshot.approvalQueue = entries; });
    let id = 0;
    const command = async payload => {
      client.emit("serverRequest", { id: ++id, method: "item/commandExecution/requestApproval", params: { itemId: `command-${id}`, command: payload } });
      await new Promise(resolve => setImmediate(resolve));
    };
    try { await host.runTurn("Review local fixture commands without executing them"); await fn({ client, host, cards, command }); }
    finally { await host.stop(); }
  }
  await check("compiled host reason reaches card and queue through the compiled preload", () => withHost(async ({ command }) => {
    await command("[IO.File]::Delete('C:\\Users\\Fixture\\Downloads\\a.tmp')");
    const state = await api.getSnapshot();
    assert.equal(state.pendingApproval.canAllowForTask, false);
    assert.equal(typeof state.pendingApproval.grantUnavailableReason, "string");
    assert.ok(state.pendingApproval.grantUnavailableReason.length > 0);
    assert.equal(state.approvalQueue[0].grantUnavailableReason, state.pendingApproval.grantUnavailableReason);
  }));
  await check("compiled host capped summary and full raw command survive preload snapshot and subscription", () => withHost(async ({ command }) => {
    const raw = `Write-Output '${"x".repeat(6000)}'`;
    await command(raw);
    const state = await api.getSnapshot();
    const card = state.pendingApproval;
    assert.equal(card.summaryTruncated, true);
    assert.equal(card.summaryFullLength, `Run: ${raw}`.length);
    assert.ok(card.action.summary.length <= 4096);
    assert.match(card.action.summary, /\.\.\.\(\+\d+ more\)$/);
    assert.equal(card.action.payload, raw);
    assert.equal(card.decision.details, raw);
    assert.equal(state.approvalQueue[0].summary, card.action.summary);
    assert.equal(state.approvalQueue[0].summaryTruncated, true);
    assert.equal(state.approvalQueue[0].summaryFullLength, card.summaryFullLength);
    let received;
    const unsubscribe = api.subscribe(value => { received = value; });
    listeners.get("lalime:snapshot")({}, state);
    assert.deepEqual(received, state);
    unsubscribe();
  }));
  await check("compiled host bounds 300 long-command previews to 50 with exact count through preload", () => withHost(async ({ host, cards, command }) => {
    const sizes = [];
    host.on("approvalQueue", (count, entries) => sizes.push({ count, size: entries.length }));
    for (let i = 0; i < 300; i++) await command("Write-Output '" + i + ":" + "x".repeat(50000) + "'");
    const state = await api.getSnapshot();
    assert.equal(state.pendingApprovalCount, 300);
    assert.equal(state.approvalQueue.length, 50);
    assert.ok(sizes.every(value => value.size <= 50));
    assert.ok(state.approvalQueue.every(entry => entry.summary.length <= 4096 && entry.summaryTruncated && entry.summaryFullLength > 50000));
    assert.equal(host.respondApproval("not_now", cards[0].action.id), true);
    assert.equal((await api.getSnapshot()).pendingApprovalCount, 299);
    assert.equal((await api.getSnapshot()).approvalQueue.length, 50);
  }));
  await check("compiled host truncates both display fields at complete escape boundaries", () => withHost(async ({ host, cards, command }) => {
    for (const invisible of ["\u202e", "\u{e0001}"]) for (let offset = 0; offset < 12; offset++) {
      const raw = "Write-Output '" + "x".repeat(offset) + invisible.repeat(900) + "'";
      await command(raw);
      const card = cards.at(-1);
      for (const value of [card.action.summary, card.decision.plainEnglish]) {
        assert.ok(value.length <= 4096);
        assert.ok(!value.includes(invisible));
        assert.doesNotMatch(value.replace(/\.\.\.\(\+\d+ more\)$/, ""), /\\(?:u[0-9a-f]{0,3}|u\{[0-9a-f]*)?$/i);
      }
      assert.equal(card.action.payload, raw);
      assert.equal(host.respondApproval("not_now", card.action.id), true);
      await new Promise(resolve => setImmediate(resolve));
    }
  }));
  for (const raw of ["Invoke-Item 'C:\\Users\\Fixture\\Downloads\\tool.exe'", "Start-Process '\\\\server\\share\\report.pdf'"]) {
    await check("compiled host gives executable or UNC launch a card and reason without reusable consent: " + raw, () => withHost(async ({ host, command }) => {
      await command(raw);
      const state = await api.getSnapshot();
      const card = state.pendingApproval;
      assert.ok(card);
      assert.equal(card.canAllowForTask, false);
      assert.ok(card.grantUnavailableReason.length > 0);
      assert.equal(state.approvalQueue[0].grantUnavailableReason, card.grantUnavailableReason);
      assert.equal(host.respondApproval("allow_for_task", card.action.id), false);
      assert.deepEqual(host.getTaskGrants(), []);
    }));
  }
  await check("fresh compiled NodeHands full Undo restores fixture bytes and prunes recovery entries", async () => {
    const { NodeHands } = await import(pathToFileURL(path.join(build, "hands/src/node-hands.js")));
    mkdirSync(evidence, { recursive: true });
    const fixture = mkdtempSync(path.join(evidence, "node-restore-"));
    const documents = path.join(fixture, "Documents");
    mkdirSync(documents);
    const files = ["one.txt", "two.txt", "three.txt"].map(name => path.join(documents, name));
    for (const file of files) writeFileSync(file, "Original " + path.basename(file));
    const journal = path.join(fixture, "journal");
    const hands = new NodeHands(journal, [documents]);
    const moved = await hands.moveToRecycleBin(files, "Three QA fixture files");
    assert.equal(moved.ok, true);
    assert.ok(moved.undoToken);
    const batches = readdirSync(path.join(journal, "quarantine"));
    assert.equal(batches.length, 1);
    const manifest = path.join(journal, "quarantine", batches[0], "recovery.json");
    assert.equal(JSON.parse(readFileSync(manifest, "utf8")).entries.length, 3);
    assert.equal((await hands.undo(moved.undoToken)).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(manifest, "utf8")).entries, []);
    for (const file of files) assert.equal(readFileSync(file, "utf8"), "Original " + path.basename(file));
    observations.push({ nodeHandsRecoveryFixture: fixture, manifest, restored: files.length });
  });
  await check("compiled host rejects first preview consent before card emission", () => withHost(async ({ client, host, cards, command }) => {
    const attempts = [];
    host.on("approvalQueue", (_count, entries) => {
      if (entries.length === 1 && cards.length === 0) attempts.push(host.respondApproval("do_it", entries[0].actionId));
    });
    await command("Write-Output fixture");
    assert.deepEqual(attempts, [false]);
    assert.deepEqual(client.responses, []);
    assert.equal(host.respondApproval("not_now", cards[0].action.id), true);
  }));
  await check("compiled host rejects promoted preview consent before the next card emission", () => withHost(async ({ client, host, cards, command }) => {
    await command("Write-Output first");
    await command("Write-Output second");
    const nextId = snapshot.approvalQueue[1].actionId;
    const attempts = [];
    host.on("approvalQueue", (_count, entries) => {
      if (entries.length === 1 && entries[0].actionId === nextId) attempts.push(host.respondApproval("do_it", nextId));
    });
    assert.equal(host.respondApproval("not_now", cards[0].action.id), true);
    assert.deepEqual(attempts, [false]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cards.at(-1).action.id, nextId);
    assert.equal(client.responses.some(response => response.decision === "accept"), false);
    assert.equal(host.respondApproval("not_now", nextId), true);
  }));
  await check("compiled host rejects a preview hold before card emission", () => withHost(async ({ host, cards, command }) => {
    const attempts = [];
    host.on("approvalQueue", (_count, entries) => {
      if (entries.length === 1 && cards.length === 0) attempts.push(host.beginApprovalHold(entries[0].actionId));
    });
    await command("Start-Service Spooler");
    assert.deepEqual(attempts, [false]);
    assert.equal(cards[0].decision.kind, "ask_hold");
    assert.equal(host.beginApprovalHold(cards[0].action.id), true);
    host.cancelApprovalHold(cards[0].action.id);
  }));
} else {
  const { permitsPowerShellTaskGrant } = await import(pathToFileURL(path.join(build, "electron/main/powershell-grants.js")));
  const { LiveAgentHost } = await import(pathToFileURL(path.join(build, "electron/main/live-agent.js")));
  const { MockHands } = await import(pathToFileURL(path.join(build, "hands/mock/index.js")));
  const folder = "C:\\Users\\Fixture\\Downloads";
  const commands = [
    `[IO.File]::Delete('${folder}\\a.tmp')`,
    `(Get-Item '${folder}\\a.tmp').PSObject.BaseObject.Delete()`,
    `Get-ChildItem '${folder}\\*.tmp' | ForEach-Object { $_.PSObject.BaseObject.Delete() }`,
  ];
  for (const command of commands) {
    const classification = permitsPowerShellTaskGrant(command);
    const observation = { command, classification };
    observations.push(observation);
    await check(`classifier refuses task grant: ${command}`, () => assert.equal(classification, false));
    class Client extends EventEmitter {
      startThread = async () => "thread";
      startTurn = async () => ({ turnId: "turn" });
      interruptTurn = async () => {};
      responses = [];
      respondApproval = (id, decision) => this.responses.push({ id, decision });
      respondFileChangeApproval = () => {};
      respondToolCall = () => {};
    }
    const client = new Client();
    const host = new LiveAgentHost(client, new MockHands(), { allowComputerControl: true });
    const cards = [];
    host.on("approvalNeeded", card => cards.push(card));
    try {
      await host.runTurn("Work with the selected temporary file");
      client.emit("serverRequest", { id: 1, method: "item/commandExecution/requestApproval", params: { itemId: "command-1", command, cwd: folder } });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cards.length, 1, "Repro must reach a genuine host approval card");
      observation.canAllowForTask = cards[0].canAllowForTask;
      observation.decision = cards[0].decision.kind;
      observation.accepted = host.respondApproval("allow_for_task", cards[0].action.id);
      await new Promise(resolve => setImmediate(resolve));
      observation.grants = host.getTaskGrants();
      observation.responses = [...client.responses];
      await check(`host refuses reusable grant: ${command}`, () => {
        assert.equal(observation.canAllowForTask, false, "Host card must not offer a reusable grant");
        assert.equal(observation.accepted, false, "Host must reject forged reusable approval");
        assert.deepEqual(observation.grants, []);
        assert.equal(observation.responses.some(response => response.decision === "accept"), false);
      });
    } finally { await host.stop(); }
  }
}
const report = { build, actualElectronIpc: false, nativeExecutionTested: false, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results, observations };
mkdirSync(evidence, { recursive: true });
const output = path.join(evidence, repro ? "chained-delete-repro.json" : "compiled-preload-wiring.json");
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(`${report.passed} passed, ${report.failed} failed; evidence: ${output}`);
if (report.failed) process.exitCode = 1;
