/** Browser regression checks for calm Undo results and recovery details. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { ActivityEntry, AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const recovery = String.raw`C:\Users\Example\AppData\Lalime\quarantine\move-123\1`;
const reason = `Restored 2 of 3 item(s). C:\\Samples\\Mom’s photo.txt: A newer file already exists. Original copy kept at: ${recovery}. Recovery list: C:\\Recovery\\recovery.json \u202e<button>Run</button>`;
const initial: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "u", role: "user", content: "Organize samples", createdAt: 100 }],
  plan: [], activity: [], pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null,
  running: false, stopped: false, statusText: "Ready", hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
async function publish(page: Page, result: ActivityEntry["undoResult"], undone = false) {
  await page.evaluate(({ result, undone }) => (window as any).undoDetailsFixture.publish({ activity: [{ id: "change", at: 110, summary: "Moved sample files", actionId: "move", undoable: true, undone, undoResult: result }] }), { result, undone });
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2000);
  await page.addInitScript(state => {
    let current = state;
    const listeners = new Set<(snapshot: AppSnapshot) => void>();
    function publish(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    const opened: number[] = [];
    let openResult = true;
    let deferOpen = false;
    let finishOpen: (() => void) | undefined;
    Object.defineProperty(window, "undoDetailsFixture", { value: { publish, opened, failOpen() { openResult = false; }, delayOpen() { deferOpen = true; }, finishOpen() { finishOpen?.(); } } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (snapshot: AppSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async sendMessage() {}, async stop() {}, async writerStatus() { return current.writer; },
      async openRecoveryFolder(...args: unknown[]) { opened.push(args.length); if (deferOpen) await new Promise<void>(resolve => { finishOpen = resolve; }); return { ok: openResult, message: "Synthetic private diagnostic C:\\Recovery\\recovery.json" }; },
    } });
  }, initial);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" }); await page.getByTestId("chat-home").waitFor();
    await run(page); results.push(`PASS ${name}`);
  } catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("a delayed folder failure never attaches to a newer restored result", async page => {
    await publish(page, { status: "failed", reason, items: [{ name: "sample.txt", reason: "Still needs attention.", recoveryPath: recovery }] } as ActivityEntry["undoResult"]);
    await page.evaluate(() => { const f = (window as any).undoDetailsFixture; f.failOpen(); f.delayOpen(); });
    const row = page.getByTestId("change-entry"); await row.getByRole("button", { name: "Open folder", exact: true }).click();
    await publish(page, { status: "restored" }, true); await row.getByTestId("undo-result").waitFor();
    await page.evaluate(() => (window as any).undoDetailsFixture.finishOpen());
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await row.getByText("Could not open the recovery folder. Try again.", { exact: true }).count(), 0);
  });
  await check("structured partial result shows short names and reasons with recovery action", async page => {
    await publish(page, { status: "failed", restored: 2, total: 3, reason,
      items: [{ name: "Mom’s photo\u202e.txt", reason: "A newer file has this name, so it was left alone.", recoveryPath: recovery }],
    } as ActivityEntry["undoResult"]);
    const row = page.getByTestId("change-entry"); const alert = row.getByRole("alert"); await alert.waitFor();
    await alert.getByText("Mom’s photo\\u202e.txt", { exact: true }).waitFor();
    await alert.getByText("A newer file has this name, so it was left alone.", { exact: true }).waitFor();
    assert.equal((await alert.innerText()).match(/2 of 3/g)?.length, 1);
    assert(!(await row.innerText()).includes(recovery));
    await row.getByText("Kept in Lalime's recovery folder", { exact: true }).waitFor();
    const open = row.getByRole("button", { name: "Open folder", exact: true }); await open.focus(); await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => (window as any).undoDetailsFixture.opened), [0]);
    assert.equal(await row.getByRole("button", { name: /restore as/i }).count(), 0);
    await page.screenshot({ path: "artifacts/screenshots/batch12-partial-undo.png" });
  });
  await check("folder launch failure is calm retryable and does not reveal a private path", async page => {
    await publish(page, { status: "failed", reason, items: [{ name: "sample.txt", reason: "Still needs attention.", recoveryPath: recovery }] } as ActivityEntry["undoResult"]);
    await page.evaluate(() => (window as any).undoDetailsFixture.failOpen());
    const row = page.getByTestId("change-entry"); const open = row.getByRole("button", { name: "Open folder", exact: true });
    await open.click(); await row.getByText("Could not open the recovery folder. Try again.", { exact: true }).waitFor();
    assert(await open.isEnabled()); assert(!(await row.innerText()).includes("recovery.json"));
  });
  await check("missing bridge hides Open folder while keeping recovery information", async page => {
    await page.evaluate(() => { delete (window as any).lalime.openRecoveryFolder; });
    await publish(page, { status: "failed", reason, items: [{ name: "sample.txt", reason: "Still needs attention.", recoveryPath: recovery }] } as ActivityEntry["undoResult"]);
    const row = page.getByTestId("change-entry"); await row.getByText("Kept in Lalime's recovery folder", { exact: true }).waitFor();
    assert.equal(await row.getByRole("button", { name: "Open folder", exact: true }).count(), 0);
    await row.getByText("Show details", { exact: true }).click();
    assert((await row.getByTestId("undo-details").textContent())?.includes(recovery));
  });
  await check("restored files with a recovery-list warning stay restored and keep diagnostics in details", async page => {
    await publish(page, { status: "restored", restored: 3, total: 3, warning: `Could not save C:\\Recovery\\recovery.json` } as ActivityEntry["undoResult"], true);
    const row = page.getByTestId("change-entry"); await row.getByTestId("undo-result").waitFor();
    await row.getByText("Your files are back. Lalime could not update its recovery list.", { exact: true }).waitFor();
    assert.equal(await row.getByRole("alert").count(), 0); assert(!(await row.innerText()).includes("recovery.json"));
    await row.getByText("Show details", { exact: true }).click();
    assert((await row.getByTestId("undo-details").textContent())?.includes("recovery.json"));
  });
  await check("legacy partial result says count once and hides recovery paths until requested", async page => {
    await publish(page, { status: "failed", restored: 2, total: 3, reason });
    const row = page.getByTestId("change-entry");
    const alert = row.getByRole("alert"); await alert.waitFor();
    assert.equal(await alert.textContent(), "Partly undone: 2 of 3 items are back.");
    assert(!(await row.innerText()).includes(recovery));
    const toggle = row.getByText("Show details", { exact: true }); await toggle.focus(); await page.keyboard.press("Enter");
    const details = row.getByTestId("undo-details"); await details.waitFor();
    assert.equal(await details.textContent(), reason.replaceAll("\u202e", "\\u202e"));
    assert.equal(await details.locator("button").count(), 0);
    assert.equal(await details.evaluate(el => getComputedStyle(el).whiteSpace), "pre-wrap");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await toggle.focus(); await page.keyboard.press("Enter"); await details.waitFor({ state: "hidden" });
    assert.equal(await row.getByRole("button", { name: "Open folder", exact: true }).count(), 0);
  });
  await check("legacy failed result keeps unknown paths out of the primary alert", async page => {
    await publish(page, { status: "failed", reason });
    const row = page.getByTestId("change-entry"); await row.getByRole("alert").waitFor();
    assert.equal(await row.getByRole("alert").textContent(), "Could not restore this change.");
    assert(!(await row.innerText()).includes("recovery.json"));
    assert.equal(await row.getByRole("button", { name: /restore as/i }).count(), 0);
  });
  await check("restored result removes its failure disclosure", async page => {
    await publish(page, { status: "failed", reason });
    await page.getByTestId("change-entry").getByRole("alert").waitFor();
    await publish(page, { status: "restored" }, true);
    await page.getByTestId("undo-result").waitFor();
    assert.equal(await page.getByTestId("change-entry").getByText("Show details", { exact: true }).count(), 0);
    assert.equal(await page.getByTestId("change-entry").getByRole("alert").count(), 0);
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch12-details-${process.env.LALIME_EVIDENCE ?? "result"}.txt`, `Command: LALIME_URL=${BASE} node scripts/ui-undo-details.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\nExact source:\n${await readFile("scripts/ui-undo-details.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
