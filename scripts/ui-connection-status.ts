/** Browser checks for verified connection status and editable repair examples. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const ready = { state: "ready", account: "sample@example.test", plan: "Plus", model: "sample-model" };
const initial = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [], plan: [], activity: [], pendingApproval: null, pendingApprovalCount: 0,
  blockedNotice: null, running: false, stopped: false, statusText: "Ready",
  hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
  settings: { ...DEFAULT_SETTINGS, maxToolCalls: 37, requestTimeoutMs: 60000, model: "sample-model" }, connection: ready,
};
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
async function publish(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(value => (window as any).connectionFixture.publish(value), patch);
}
async function settings(page: Page) {
  await page.getByTestId("settings-button").click();
  await page.getByTestId("provider-settings").waitFor();
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  if (process.env.CONNECTION_CASE && !name.includes(process.env.CONNECTION_CASE)) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(1800);
  await page.addInitScript(state => {
    let current = state;
    const listeners = new Set<(value: typeof state) => void>();
    const saved: unknown[] = [];
    const sent: string[] = [];
    let retries = 0;
    let deferCheck = false;
    let rejectCheck: (() => void) | undefined;
    function publish(patch: any) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    Object.defineProperty(window, "connectionFixture", { value: { publish, saved, sent, retries: () => retries,
      omitConnection() { delete (current as any).connection; for (const listener of listeners) listener(current); },
      delayCheck() { deferCheck = true; }, rejectCheck() { rejectCheck?.(); },
    } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (value: typeof state) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async writerStatus() { return current.writer; }, async sendMessage(value: string) { sent.push(value); }, async stop() {},
      async updateSettings(value: unknown) { saved.push(value); return { ok: true }; },
      async connectProvider() { publish({ connection: { state: "checking", model: "sample-model" } }); return { ok: true }; },
      async retryConnectionCheck() { retries++; publish({ connection: { state: "checking", model: "sample-model" } }); if (deferCheck) await new Promise((_, reject) => { rejectCheck = () => reject(new Error("Synthetic late failure")); }); return { ok: true }; },
      async disconnect() { publish({ auth: { state: "signed_out" }, connection: undefined }); },
    } });
  }, initial);
  try {
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    await page.getByTestId("chat-home").waitFor();
    await run(page); results.push(`PASS ${name}`);
  } catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("save only on a legacy host does not claim an active model check", async page => {
    await publish(page, { connection: undefined }); await settings(page);
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    await page.getByTestId("connection-panel").getByText("You are signed in, but this connection has not been verified yet.", { exact: true }).waitFor();
  });
  await check("legacy Retry never saves an unsent settings draft or clears the conversation", async page => {
    await publish(page, { connection: undefined });
    await page.evaluate(() => { delete (window as any).lalime.retryConnectionCheck; });
    await settings(page); await page.getByTestId("provider-model").fill("unsaved-model");
    await page.getByTestId("connection-panel").getByRole("button", { name: "Retry", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).connectionFixture.saved), []);
    await page.getByTestId("connection-panel").getByText("This version cannot verify the connection yet. Use Save and sign in to reconnect.", { exact: true }).waitFor();
  });
  await check("late verification failure cannot replace a newer host Ready result", async page => {
    await publish(page, { connection: { state: "failed", model: "sample-model", reason: "Try again." } });
    await page.evaluate(() => (window as any).connectionFixture.delayCheck());
    await settings(page); await page.getByTestId("connection-panel").getByRole("button", { name: "Retry", exact: true }).click();
    await publish(page, { connection: ready });
    await page.getByTestId("connection-panel").getByText("Ready: try asking something", { exact: true }).waitFor();
    await page.evaluate(() => (window as any).connectionFixture.rejectCheck());
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByTestId("connection-panel").getByText("Ready: try asking something", { exact: true }).waitFor();
  });
  await check("omitted connection in a complete snapshot clears a previous ready signal", async page => {
    await page.getByTestId("connection-status").getByText("Ready", { exact: true }).waitFor();
    await page.evaluate(() => (window as any).connectionFixture.omitConnection());
    await page.getByTestId("connection-status").getByText("Checking", { exact: true }).waitFor();
    assert.equal(await page.getByText("Ready", { exact: true }).count(), 0);
  });
  await check("legacy idle status text cannot imply Ready without verification", async page => {
    await publish(page, { connection: undefined, statusText: "Ready" });
    await page.getByTestId("connection-status").getByText("Checking", { exact: true }).waitFor();
    assert.equal(await page.getByText("Ready", { exact: true }).count(), 0);
  });
  await check("legacy maximum-tools setting is absent from the settings form", async page => {
    await settings(page); await page.getByText("Model options", { exact: true }).click();
    assert.equal(await page.getByLabel(/Maximum tools per turn/i).count(), 0);
    assert(!(await page.getByTestId("provider-settings").innerText()).includes("Maximum tools per turn"));
  });
  await check("legacy request timeout is absent and never resubmitted", async page => {
    await settings(page); await page.getByTestId("provider-select").selectOption("openai");
    await page.getByText("Model options", { exact: true }).click();
    assert.equal(await page.getByLabel(/Request timeout in seconds/i).count(), 0);
    await page.getByRole("button", { name: "Save settings", exact: true }).click();
    const saved = await page.evaluate(() => (window as any).connectionFixture.saved);
    assert(!Object.hasOwn(saved[0], "requestTimeoutMs"));
  });
  await check("saving settings never resends a legacy maxToolCalls value", async page => {
    await settings(page); await page.getByRole("button", { name: "Save settings", exact: true }).click();
    const saved = await page.evaluate(() => (window as any).connectionFixture.saved);
    assert.equal(saved.length, 1); assert(!Object.hasOwn(saved[0], "maxToolCalls"));
    assert.equal(saved[0].model, "sample-model");
  });
  await check("connection checking becomes a verified ready panel with account plan and model", async page => {
    await settings(page); await page.getByTestId("provider-connect").click();
    const panel = page.getByTestId("connection-panel");
    await panel.getByText(/Checking/).first().waitFor();
    await page.screenshot({ path: "artifacts/screenshots/batch13-checking.png" });
    assert.equal(await panel.getByText("Ready: try asking something", { exact: true }).count(), 0);
    await publish(page, { connection: ready });
    await panel.getByText("Ready: try asking something", { exact: true }).waitFor();
    for (const value of [ready.account, ready.plan, ready.model]) assert((await panel.innerText()).includes(value));
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/screenshots/batch13-ready.png" });
  });
  await check("API-key connection verifies the selected model without inventing account details", async page => {
    await publish(page, { connection: undefined }); await settings(page);
    await page.getByTestId("provider-select").selectOption("openai");
    await page.getByTestId("provider-model").fill("api-sample-model");
    await page.getByTestId("settings-api-key").fill("synthetic-placeholder");
    await page.getByRole("button", { name: "Save and connect", exact: true }).click();
    const panel = page.getByTestId("connection-panel");
    await panel.getByText("Checking your connection", { exact: true }).waitFor();
    await publish(page, { auth: { state: "signed_in", method: "api_key" }, connection: { state: "ready", model: "api-sample-model" } });
    await panel.getByText("Ready: try asking something", { exact: true }).waitFor();
    await panel.getByText("api-sample-model", { exact: true }).waitFor();
    assert.equal(await panel.locator("dt").count(), 1);
    assert.equal(await page.getByTestId("settings-api-key").inputValue(), "");
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/screenshots/batch13-api-ready.png" });
  });
  for (const prompt of ["My Wi-Fi keeps dropping", "Printer says offline", "Free up disk space"]) {
    await check(`repair example fills and focuses without sending: ${prompt}`, async page => {
      await settings(page);
      await page.getByTestId("connection-panel").getByRole("button", { name: prompt, exact: true }).click();
      await page.getByTestId("settings-modal").waitFor({ state: "hidden" });
      const composer = page.getByRole("textbox", { name: "Message Lalime", exact: true });
      assert.equal(await composer.inputValue(), prompt);
      assert(await composer.evaluate(element => document.activeElement === element));
      assert.deepEqual(await page.evaluate(() => (window as any).connectionFixture.sent), []);
    });
  }
  await check("a refused Retry shows its plain reason and allows another attempt", async page => {
    await publish(page, { connection: { state: "failed", model: "sample-model", reason: "Try again." } });
    await page.evaluate(() => { (window as any).lalime.retryConnectionCheck = async () => ({ ok: false, message: "Finish the current task before checking the connection." }); });
    await settings(page); const panel = page.getByTestId("connection-panel");
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    await panel.getByText("Finish the current task before checking the connection.", { exact: true }).waitFor();
    assert(await panel.getByRole("button", { name: "Retry", exact: true }).isEnabled());
  });
  await check("failed connection shows a plain reason and retries verification", async page => {
    await publish(page, { connection: { state: "failed", model: "sample-model", reason: "Could not reach the provider. Check your connection." } });
    await settings(page);
    const panel = page.getByTestId("connection-panel");
    await panel.getByText("Could not reach the provider. Check your connection.", { exact: true }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/screenshots/batch13-failed.png" });
    await panel.getByRole("button", { name: "Retry", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).connectionFixture.retries()), 1);
    await panel.getByText(/Checking/).first().waitFor();
  });
  await check("mobile header status stays visible and keeps its width across connection states", async page => {
    const pill = page.getByTestId("connection-status");
    const widths: number[] = [];
    for (const [label, patch] of [
      ["Ready", { connection: ready, running: false }],
      ["Working", { running: true }],
      ["Checking", { running: false, connection: { state: "checking", model: "sample-model" } }],
      ["Problem", { connection: { state: "failed", model: "sample-model", reason: "Connection unavailable." } }],
      ["Signed out", { auth: { state: "signed_out" }, connection: undefined }],
    ] as const) {
      await publish(page, patch);
      await pill.getByText(label, { exact: true }).waitFor();
      const box = await pill.boundingBox(); assert(box && box.width > 0 && box.height > 0);
      assert(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 700);
      widths.push(box.width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `artifacts/screenshots/batch13-header-${label.toLowerCase().replace(" ", "-")}.png` });
    }
    assert(Math.max(...widths) - Math.min(...widths) <= 1, `Status pill widths must stay fixed: ${widths.join(", ")}`);
  });
  await check("signed-in legacy snapshot never implies a verified ready connection", async page => {
    await publish(page, { connection: undefined });
    await page.getByTestId("connection-status").getByText("Checking", { exact: true }).waitFor();
    await settings(page);
    assert.equal(await page.getByTestId("connection-panel").getByText("Ready: try asking something", { exact: true }).count(), 0);
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch13-connection-${process.env.LALIME_EVIDENCE ?? "result"}.txt`,
  `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=${process.env.LALIME_BROWSER_CHANNEL ?? "msedge"} node scripts/ui-connection-status.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact test source:\n${await readFile("scripts/ui-connection-status.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
