// Verify the built desktop app with an isolated profile and no provider credentials.
// Run after npm run build: node scripts/qa-electron.mjs
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { _electron as electron } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "scratch", "qa-electron");
mkdirSync(artifacts, { recursive: true });
const profile = mkdtempSync(path.join(artifacts, "profile-"));
const packagedArgument = process.argv.find((arg) => arg.startsWith("--packaged-executable="));
const packagedExecutable = packagedArgument?.slice("--packaged-executable=".length);
const corruptSettings = process.argv.includes("--corrupt-settings");
if (corruptSettings) {
  writeFileSync(path.join(profile, "settings.json"), '{"allowComputerControl":true,');
}
const entry = path.join(profile, "bootstrap.cjs");
const main = pathToFileURL(path.join(root, "dist-electron/electron/main/index.js")).href;
writeFileSync(entry, `
const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(profile)});
import(${JSON.stringify(main)}).catch(() => app.exit(1));
`);

const env = {};
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE"]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.LALIME_CODEX_BIN = path.join(profile, "codex-not-installed.exe");
env.CODEX_HOME = path.join(profile, "codex");
if (packagedExecutable) {
  // Keep the default profile isolated if the runtime does not accept the path switch.
  env.APPDATA = path.join(profile, "appdata");
  env.LOCALAPPDATA = path.join(profile, "localappdata");
  mkdirSync(env.APPDATA, { recursive: true });
  mkdirSync(env.LOCALAPPDATA, { recursive: true });
}

let app;
const failures = [];
try {
  app = await electron.launch({
    ...(packagedExecutable ? { executablePath: path.resolve(packagedExecutable) } : {}),
    args: packagedExecutable ? [`--user-data-dir=${profile}`] : [entry],
    cwd: root, env, timeout: 20_000,
  });
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => failures.push(error.message));
  await page.getByTestId("onboarding").waitFor();
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), profile);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(packagedExecutable));
  const bridge = await page.evaluate(() => typeof window.lalime?.getSnapshot);
  assert.equal(bridge, "function", "Desktop preload did not expose the real IPC bridge");
  const snapshot = await page.evaluate(() => window.lalime.getSnapshot());
  assert.equal(snapshot.auth.state, "signed_out");
  assert.equal(snapshot.mode, "live");
  assert.equal(snapshot.onboardingComplete, false);
  assert.equal(snapshot.settings.allowComputerControl, false);
  assert.equal(snapshot.settings.allowScreenCapture, false);
  assert.equal(snapshot.writer.enabled, false);
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("sign-in-chatgpt").click();
  await page.getByTestId("auth-error").waitFor();
  assert.match(await page.getByTestId("auth-error").innerText(), /Codex|install/i);
  assert.equal((await page.evaluate(() => window.lalime.getSnapshot())).auth.state, "error");
  assert.deepEqual(failures, []);
  await page.waitForFunction(() => {
    let element = document.querySelector('[data-testid="auth-error"]');
    while (element) {
      if (Number(getComputedStyle(element).opacity) < 0.99) return false;
      element = element.parentElement;
    }
    return true;
  });
  await page.screenshot({ path: path.join(profile, "missing-provider.png") });
  const clipboardPermission = await page.evaluate(async () => {
    try { return (await navigator.permissions.query({ name: "clipboard-write" })).state; }
    catch { return "unavailable"; }
  });
  console.log(`Clipboard write permission (no clipboard content read or written): ${clipboardPermission}`);
  const copySample = "Disposable QA reply for the copy action.";
  await app.evaluate(({ BrowserWindow, clipboard }, state) => {
    // Capture only this app's attempted write. Never read or change the host clipboard.
    clipboard.writeText = (text) => { globalThis.__qaCopiedText = text; };
    BrowserWindow.getAllWindows()[0].webContents.send("lalime:snapshot", state);
  }, {
    ...snapshot, auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
    messages: [{ id: "qa-copy", role: "assistant", content: copySample, createdAt: Date.now() }],
  });
  await page.getByTestId("copy-reply").click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.__qaCopiedText), copySample);
  console.log("PASS copy reply through real IPC to a captured clipboard writer");
  console.log("PASS desktop bridge, isolated signed-out profile, onboarding, and missing-provider error");
  if (corruptSettings) console.log("PASS malformed settings and invalid encrypted key recover to safe defaults");
} finally {
  if (app) await app.close();
  console.log(`Isolated QA artifacts: ${profile}`);
}
