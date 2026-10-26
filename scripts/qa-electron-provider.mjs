// Exercise the built desktop app with an explicit local mock HTTP provider.
// This fixture is not AI. It has no credentials and approves no host actions.
// Run after a build: node scripts/qa-electron-provider.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "scratch", "qa-electron-provider");
mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(path.join(artifacts, "profile-"));
const packagedExecutable = process.argv.find((arg) => arg.startsWith("--packaged-executable="))
  ?.slice("--packaged-executable=".length);
const entry = path.join(profile, "bootstrap.cjs");
writeFileSync(entry, `
const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
import(${JSON.stringify(pathToFileURL(path.join(root, "dist-electron/electron/main/index.js")).href)}).catch(() => app.exit(1));
`);

const env = {};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE"]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.LALIME_CODEX_BIN = path.join(profile, "codex-not-installed.exe");
env.CODEX_HOME = path.join(profile, "codex");
if (packagedExecutable) {
  env.APPDATA = path.join(profile, "appdata");
  env.LOCALAPPDATA = path.join(profile, "localappdata");
  mkdirSync(env.APPDATA, { recursive: true });
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
}

const requests = [];
const fixtureErrors = [];
const pageErrors = [];
const toolMessage = (id, name, args) => ({ role: "assistant", content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const textMessage = (content) => ({ role: "assistant", content });
const connectionChecks = [];
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, undefined, "Fixture must receive no credentials");
    assert.equal(request.headers["x-api-key"], undefined);
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      assert.ok(body.length < 1_000_000, "Fixture request is unexpectedly large");
    }
    const parsed = JSON.parse(body);
    // Batch 13: Connect sends one tool-free "Reply with OK." check before the conversation starts.
    if (!parsed.tools?.length && parsed.messages?.at(-1)?.content === "Reply with OK.") {
      connectionChecks.push(parsed);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: textMessage("OK"), finish_reason: "stop" }] }));
      return;
    }
    requests.push(parsed);
    assert.equal(parsed.model, "explicit-local-qa-fixture");
    let message;
    switch (requests.length) {
      case 1:
        message = toolMessage("fixture-plan", "lalime_update_plan", {
          steps: [{ label: "Check fixture connection", status: "done" }],
        });
        break;
      case 2:
        assert.ok(parsed.messages.some((item) => item.role === "tool" && item.tool_call_id === "fixture-plan" && /Plan shown/.test(item.content)));
        message = textMessage("The local mock provider fixture is connected.");
        break;
      case 3:
        message = toolMessage("fixture-settings", "lalime_open_settings", { uri: "ms-settings:display" });
        break;
      case 4:
        assert.ok(parsed.messages.some((item) => item.role === "tool" && item.tool_call_id === "fixture-settings" && item.content === "User declined."));
        message = textMessage("The fixture received your denial. No settings action was approved.");
        break;
      case 5:
        assert.ok(!parsed.tools.some((tool) => tool.function.name === "lalime_powershell"));
        // Deliberately request an unsupported tool. This literal must never execute.
        message = toolMessage("fixture-unsupported", "lalime_powershell", { command: "Write-Output 'unsupported-fixture-only'" });
        break;
      case 6:
        // Batch 13: an unregistered tool call now returns a paired error result to the model instead of ending the turn.
        assert.ok(parsed.messages.some((item) => item.role === "tool" && item.tool_call_id === "fixture-unsupported" && /Unknown tool/.test(item.content)));
        message = textMessage("The fixture received the unknown-tool error. Nothing ran.");
        break;
      default:
        throw new Error("Unexpected fixture request after the unsupported tool");
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }));
  } catch (error) {
    fixtureErrors.push(error.message);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Local QA fixture assertion failed" }));
  }
});

let app;
let report;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  app = await electron.launch({
    ...(packagedExecutable ? { executablePath: path.resolve(packagedExecutable) } : {}),
    args: packagedExecutable ? [`--user-data-dir=${profile}`] : [entry],
    cwd: root, env, timeout: 20_000,
  });
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByTestId("onboarding").waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(packagedExecutable));
  const initial = await page.evaluate(() => window.lalime.getSnapshot());
  assert.equal(initial.auth.state, "signed_out");
  assert.equal(initial.writer.enabled, false);
  assert.equal(initial.settings.allowScreenCapture, false);
  assert.equal(initial.mode, "live");
  const settings = await page.evaluate((baseUrl) => window.lalime.updateSettings({
    providerId: "custom", model: "explicit-local-qa-fixture", baseUrl,
    allowComputerControl: true, allowScreenCapture: false,
  }), `http://127.0.0.1:${port}/v1`);
  assert.equal(settings.ok, true);
  assert.equal((await page.evaluate(() => window.lalime.connectProvider())).ok, true);
  await page.evaluate(() => window.lalime.completeOnboarding());

  const waitForReply = async (text) => page.waitForFunction(async (expected) => {
    const state = await window.lalime.getSnapshot();
    return !state.running && state.messages.some((message) => message.role === "assistant" && message.content === expected);
  }, text);
  await page.evaluate(() => window.lalime.sendMessage("Run the local fixture connection check."));
  await waitForReply("The local mock provider fixture is connected.");
  assert.equal(requests.length, 2);
  assert.ok((await page.evaluate(() => window.lalime.getSnapshot())).plan.some((step) => step.label === "Check fixture connection"));
  console.log("PASS real desktop session, local HTTP fixture, plan tool, and final text");

  await page.evaluate(() => window.lalime.sendMessage("Ask to open Display settings so I can decline the fixture request."));
  await page.getByTestId("approval-card").waitFor();
  const pending = (await page.evaluate(() => window.lalime.getSnapshot())).pendingApproval;
  assert.equal(pending.action.kind, "open_settings");
  assert.match(pending.action.payload, /ms-settings:display/);
  assert.equal(requests.length, 3, "No tool result may reach the fixture before approval");
  await page.evaluate(() => window.lalime.respondApproval("do_it", "stale-fixture-action"));
  assert.equal((await page.evaluate(() => window.lalime.getSnapshot())).pendingApproval.action.id, pending.action.id);
  assert.equal(requests.length, 3, "Stale approval must not complete the tool");
  await page.getByTestId("approval-not-now").click();
  await waitForReply("The fixture received your denial. No settings action was approved.");
  assert.equal(requests.length, 4);
  const declined = await page.evaluate(() => window.lalime.getSnapshot());
  assert.equal(declined.pendingApproval, null);
  assert.equal(declined.activity.length, 0);
  console.log("PASS Guardian approval UI, stale approval rejection, and denial returned over HTTP");

  await page.evaluate(() => window.lalime.sendMessage("Check that the mock provider cannot invent a PowerShell tool."));
  await waitForReply("The fixture received the unknown-tool error. Nothing ran.");
  assert.equal(requests.length, 6);
  assert.equal(connectionChecks.length, 1);
  const rejected = await page.evaluate(() => window.lalime.getSnapshot());
  assert.equal(rejected.pendingApproval, null);
  assert.equal(rejected.activity.length, 0);
  assert.deepEqual(fixtureErrors, []);
  assert.deepEqual(pageErrors, []);
  console.log("PASS unsupported PowerShell tool rejected without execution");
  report = { passed: true, mockProvider: true, packaged: Boolean(packagedExecutable), httpRequests: requests.length,
    approvedHostActions: 0, nativeExecutionTested: false, checks: ["plan-and-text", "approval-deny", "stale-approval", "unknown-tool"] };
} catch (error) {
  report = { passed: false, mockProvider: true, message: error.message, httpRequests: requests.length, fixtureErrors, pageErrors };
  throw error;
} finally {
  try {
    if (app) await app.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (report) writeFileSync(path.join(profile, "result.json"), JSON.stringify(report, null, 2));
    console.log(`Isolated local-fixture QA artifacts: ${profile}`);
  }
}
