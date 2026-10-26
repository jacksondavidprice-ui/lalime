/** Mobile repair checklist checks against the renderer snapshot bridge. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { DEFAULT_SETTINGS } from "../shared/settings.ts";

const base = process.env.LALIME_URL ?? "http://127.0.0.1:43131";
const repairPlan = {
  symptom: "Wi-Fi keeps dropping",
  causes: [
    { label: "Router is restarting", likelihood: "possible" },
    { label: "Adapter is asleep", likelihood: "likely", evidence: "Power saving is enabled" },
    { label: "Airplane mode is on", likelihood: "ruled_out", evidence: "Airplane mode is off" },
  ],
  fixes: [
    { label: "Check connection", status: "pending" },
    { label: "Check adapter", status: "trying", cause: "Adapter is asleep" },
    { label: "Restart Wi-Fi", status: "worked" },
    { label: "Reconnect router", status: "failed" },
    { label: "Use a cable", status: "skipped" },
    { label: "Reset adapter", status: "declined" },
  ],
};
const initial = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "repair-answer", role: "assistant", content: "I am checking the connection.", createdAt: Date.now() }],
  plan: [{ id: "step-1", label: "Check the connection", status: "pending" }], repairPlan,
  activity: [], pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null,
  running: false, stopped: false, statusText: "Ready", settings: DEFAULT_SETTINGS,
  connection: { state: "ready", model: "test-model" },
  hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
await mkdir("artifacts/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
async function publish(page: Page, patch: unknown) {
  await page.evaluate(value => (window as any).repairFixture.publish(value), patch);
}
async function check(name: string, test: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(1800);
  await page.addInitScript(state => {
    let current = state;
    const listeners = new Set<(value: typeof state) => void>();
    Object.defineProperty(window, "repairFixture", { value: { publish(patch: any) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }, omitRepairPlan() { delete (current as any).repairPlan; for (const listener of listeners) listener(current); } } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (value: typeof state) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async writerStatus() { return current.writer; }, async sendMessage() {}, async stop() {},
    } });
  }, initial);
  try {
    await page.goto(base, { waitUntil: "networkidle", timeout: 15000 });
    await page.getByTestId("chat-home").waitFor();
    await test(page); results.push(`PASS ${name}`);
  } catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("repair diagnosis is visible with likely causes first and clear ruled-out evidence", async page => {
    const card = page.getByTestId("repair-checklist");
    await card.getByText("Wi-Fi keeps dropping", { exact: true }).waitFor();
    const causes = card.getByTestId("repair-cause");
    assert.equal(await causes.count(), 3);
    assert.match(await causes.first().innerText(), /Adapter is asleep/);
    assert.match(await causes.last().innerText(), /Ruled out/);
    assert.match(await causes.last().innerText(), /Airplane mode is off/);
    assert.equal(await page.getByTestId("step-timeline").count(), 0);
    await card.evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: "artifacts/screenshots/batch13-repair-causes.png" });
  });
  await check("every repair status has readable text and a declined fix says You said no", async page => {
    const card = page.getByTestId("repair-checklist");
    await card.waitFor();
    for (const status of ["Pending", "Trying", "Worked", "Failed", "Skipped", "You said no"]) {
      await card.getByText(status, { exact: true }).waitFor();
    }
    assert.equal(await card.getByTestId("repair-fix").count(), 6);
    const trying = card.getByTestId("repair-fix").filter({ hasText: "Check adapter" });
    assert.equal(await trying.getAttribute("aria-current"), "step");
    assert.equal(await trying.locator("svg").evaluate(el => getComputedStyle(el).animationName), "none");
    await card.getByText("You said no", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/screenshots/batch13-repair-fixes.png" });
  });
  await check("repair updates are live and cannot keep a stale checklist after host clearing", async page => {
    await page.getByTestId("repair-checklist").waitFor();
    await publish(page, { repairPlan: { ...repairPlan, fixes: [{ label: "Check adapter", status: "worked" }] } });
    await page.getByTestId("repair-fix").getByText("Worked", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("repair-fix").count(), 1);
    await publish(page, { repairPlan: undefined });
    await page.getByTestId("step-timeline").getByText("Check the connection", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("repair-checklist").count(), 0);
    await page.screenshot({ path: "artifacts/screenshots/batch13-repair-fallback.png" });
  });
  await check("checklist labels hide commands and paths including evidence and cause references", async page => {
    const unsafe = ["C:\\Users\\Sample\\private.txt", "reports/private.txt", "Remove-Item notes", "netsh winsock reset", "./repair.sh", "\\\\server\\private", "echo secret", "powershell -Command Stop-Service", "cat /etc/passwd"];
    await publish(page, { repairPlan: { symptom: unsafe[0], causes: unsafe.map(label => ({ label, likelihood: "likely", evidence: label })), fixes: unsafe.map(label => ({ label, cause: label, status: "pending" })) } });
    const card = page.getByTestId("repair-checklist"); await card.waitFor();
    const text = await card.innerText(); for (const raw of unsafe) assert(!text.includes(raw), raw);
    await publish(page, { repairPlan: { symptom: "Wi-Fi keeps dropping", causes: [{ label: "Adapter is asleep", likelihood: "likely", evidence: unsafe[2] }], fixes: [{ label: "Check adapter", cause: unsafe[3], status: "pending" }] } });
    assert(!(await card.innerText()).includes(unsafe[2])); assert(!(await card.innerText()).includes(unsafe[3]));
  });
  await check("phone checklist wraps long labels without horizontal overflow", async page => {
    await page.getByTestId("repair-checklist").waitFor();
    await publish(page, { repairPlan: { ...repairPlan, symptom: "Connection ".repeat(60) } });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const box = await page.getByTestId("repair-checklist").boundingBox();
    assert(box && box.width <= 390 && box.x >= 0);
    assert.equal(await page.getByTestId("repair-checklist").getAttribute("aria-label"), "Repair checklist");
  });
  await check("a full legacy snapshot that omits repairPlan clears the previous diagnosis", async page => {
    await page.getByTestId("repair-checklist").waitFor();
    await page.evaluate(() => (window as any).repairFixture.omitRepairPlan());
    await page.getByTestId("step-timeline").waitFor();
    assert.equal(await page.getByTestId("repair-checklist").count(), 0);
  });
  await check("standalone commands and file names are hidden while ordinary repair instructions remain", async page => {
    const unsafe = ["whoami", "report.txt", "backup.json", "repair.ps1", "python -c print(1)", "node repair.js", "sc query Spooler", "net stop Spooler", "ping localhost", "del notes", "taskkill /PID 123", "dir logs", "call repair", "start calc", "copy notes backup"];
    await publish(page, { repairPlan: { symptom: "Wi-Fi keeps dropping", causes: [], fixes: unsafe.map(label => ({ label, status: "pending" })).concat([{ label: "Restart the Print Spooler", status: "pending" }]) } });
    const card = page.getByTestId("repair-checklist"); await card.waitFor();
    const text = await card.innerText(); for (const raw of unsafe) assert(!text.includes(raw), raw);
    await card.getByText("Restart the Print Spooler", { exact: true }).waitFor();
  });
} finally {
  await browser.close();
  await mkdir("artifacts", { recursive: true });
  const label = process.env.LALIME_EVIDENCE ?? "latest";
  const source = await readFile(new URL(import.meta.url), "utf8");
  await writeFile(`artifacts/b13t2-repair-${label}.txt`, `Command: LALIME_URL=${base} node scripts/ui-repair-checklist.ts\n${results.join("\n")}\n${results.length - failures} passed; ${failures} failed\n\nAccepted test source:\n${source}`);
}
if (failures) process.exitCode = 1;
