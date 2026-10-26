/** Browser checks for truthful first-use guidance and recorded activity recaps. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { AppSnapshot } from "../../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const initial: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [], plan: [], activity: [], pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null,
  running: false, stopped: false, statusText: "Ready", hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
async function publish(page: Page, patch: Partial<AppSnapshot>) {
  await page.evaluate(value => (window as any).firstUseFixture.publish(value), patch);
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2000);
  await page.addInitScript(state => {
    let current = state;
    const listeners = new Set<(snapshot: AppSnapshot) => void>();
    const sent: string[] = [];
    function publish(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    Object.defineProperty(window, "firstUseFixture", { value: { publish, sent } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (snapshot: AppSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async sendMessage(message: string) { sent.push(message); }, async stop() {}, async writerStatus() { return current.writer; },
    } });
  }, initial);
  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByTestId("empty-state").waitFor();
    await run(page); results.push(`PASS ${name}`);
  } catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
const records: AppSnapshot["activity"] = [
  { id: "read", at: 110, summary: "Read sample folder", undoable: false },
  { id: "change", at: 111, summary: "Moved sample", undoable: true, actionId: "move" },
  { id: "restored", at: 112, summary: "Restored sample", undoable: true, actionId: "back", undone: true, undoResult: { status: "restored" } },
];
async function record(page: Page, patch: Partial<AppSnapshot> = {}) {
  await publish(page, { messages: [{ id: "u", role: "user", content: "Review the sample", createdAt: 100 }], activity: records, ...patch });
}
try {
  for (const kind of ["partial", "refused"] as const) {
    await check(`named ${kind} result keeps five paths and the omitted count readable`, async page => {
      const paths = Array.from({ length: 5 }, (_, index) => `C:\\Users\\Example\\Downloads\\Mom’s photos\\sample-${index}-\u202e.txt`);
      const summary = `${kind === "partial" ? "Moved 1 item(s). Failed 8" : "No items were moved. Missing paths"}: ${paths.join("; ")}; and 3 more`;
      await record(page, { activity: [{ id: "named", at: 110, summary, undoable: false }] });
      const row = page.getByTestId("change-entry"); await row.waitFor();
      assert.equal(await row.locator("p").first().textContent(), summary.replaceAll("\u202e", "\\u202e"));
      assert.equal(await row.getByTestId("undo-button").count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/screenshots/batch11-${kind}-names.png` });
    });
  }
  await check("first use explains review and limited Undo without promising universal reversal", async page => {
    const note = page.getByRole("region", { name: "Before you begin" });
    await note.waitFor();
    await note.getByText("You review important steps before they run. Look for Undo beside changes that Lalime can restore.", { exact: true }).waitFor();
    await note.getByText("Choose an idea below to draft a message. You can edit it before sending.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "artifacts/screenshots/batch11-first-use.png" });
  });
  await check("keyboard suggestion only drafts and focuses the editable message", async page => {
    await page.getByTestId("suggestion-chip").first().focus(); await page.keyboard.press("Enter");
    const input = page.getByTestId("chat-input");
    assert((await input.inputValue()).length > 0);
    assert(await input.evaluate(el => el === document.activeElement));
    assert.deepEqual(await page.evaluate(() => (window as any).firstUseFixture.sent), []);
  });
  await check("recap counts records and actual Undo controls without claiming task success", async page => {
    await record(page);
    const recap = page.getByTestId("activity-recap"); await recap.waitFor();
    assert.equal(await recap.textContent(), "3 recorded steps. Undo available for 1. 1 restore verified.");
    assert.equal(await recap.getAttribute("role"), "status");
    assert.equal(await recap.getAttribute("aria-live"), "polite");
    await recap.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "artifacts/screenshots/batch11-recap.png" });
  });
  await check("recap updates after restoration and excludes earlier task records", async page => {
    await record(page, { activity: [{ ...records[0], at: 1 }, { ...records[1], undone: true, undoResult: { status: "restored" } }] });
    const recap = page.getByTestId("activity-recap"); await recap.waitFor();
    assert.equal(await recap.textContent(), "1 recorded step. No Undo actions available. 1 restore verified.");
  });
  await check("partial results never count as verified restores", async page => {
    await record(page, { activity: [{ ...records[1], undoResult: { status: "failed", restored: 2, total: 3, reason: "One item remains." } }] });
    const recap = page.getByTestId("activity-recap"); await recap.waitFor();
    assert.equal(await recap.textContent(), "1 recorded step. Undo available for 1.");
  });
  await check("recap waits while work or approvals remain and never invents completion", async page => {
    await record(page);
    await page.getByTestId("activity-recap").waitFor();
    for (const patch of [{ running: true }, { running: false, pendingApprovalCount: 2 }, { pendingApprovalCount: undefined }]) {
      await publish(page, patch); await page.getByTestId("activity-recap").waitFor({ state: "hidden" });
    }
    await publish(page, { pendingApprovalCount: 0, stopped: true });
    await page.getByTestId("activity-recap").waitFor();
    assert.equal(await page.getByText("All done", { exact: true }).count(), 0);
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch11-first-use-${process.env.LALIME_EVIDENCE ?? "result"}.txt`, `Command: LALIME_URL=${BASE} node src/tests/ui-first-use.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\nExact source:\n${await readFile("src/tests/ui-first-use.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
