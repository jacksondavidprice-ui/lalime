/** Renderer-only checks for disabled Undo context and connected result focus. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { ActivityEntry, AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const pending: NonNullable<AppSnapshot["pendingApproval"]> = {
  action: { id: "pending-example", kind: "shell", payload: "echo sample", summary: "Review sample", userRequest: "Review sample" },
  decision: { actionId: "pending-example", kind: "ask", tier: 2, plainEnglish: "Review", details: "Sample", matchedRules: [], undoable: false },
};
const initial: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "user", role: "user", content: "Organize samples", createdAt: 100 }], plan: [],
  activity: [
    { id: "same-entry", at: 110, summary: "Moved sample A", undoable: true, actionId: "action-a" },
    { id: "another-entry", at: 109, summary: "Moved sample B", undoable: true, actionId: "action-b" },
  ], pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null,
  running: false, stopped: false, statusText: "Ready", hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
type Harness = { publish(patch: Partial<AppSnapshot>): void; outcome(result: NonNullable<ActivityEntry["undoResult"]>): void; calls(): string[] };
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
async function publish(page: Page, patch: Partial<AppSnapshot>) {
  await page.evaluate(value => (window as unknown as { undoA11y: Harness }).undoA11y.publish(value), patch);
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  if (process.env.UNDO_A11Y_CASE && !name.includes(process.env.UNDO_A11Y_CASE)) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2200);
  await page.addInitScript((state: AppSnapshot) => {
    let current = state;
    let outcome: NonNullable<ActivityEntry["undoResult"]> = { status: "restored" };
    const calls: string[] = [];
    const listeners = new Set<(snapshot: AppSnapshot) => void>();
    function publish(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    Object.defineProperty(window, "undoA11y", { value: { publish, outcome(result: typeof outcome) { outcome = result; }, calls() { return calls; } } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (snapshot: AppSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async sendMessage() {}, async stop() {}, async copyText() {}, async writerStatus() { return current.writer; },
      async respondApproval(choice: string, id: string) { calls.push(`approval:${choice}:${id}`); return true; },
      async undo(id: string) { calls.push(`undo:${id}`); publish({ activity: current.activity.map(entry => entry.id === id ? { ...entry, undone: outcome.status === "restored", undoResult: outcome } : entry) }); },
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
const explanation = "Answer the waiting approval first, then you can undo.";
try {
  await check("pending approval visibly explains disabled Undo and Undo all", async page => {
    await publish(page, { pendingApproval: pending, pendingApprovalCount: 1 });
    const panel = page.getByTestId("change-summary");
    await panel.getByText(explanation, { exact: true }).waitFor();
    const buttons = panel.locator("button[data-undo-trigger]");
    assert.equal(await buttons.count(), 3);
    for (const button of await buttons.all()) { assert(await button.isDisabled()); await button.evaluate(element => (element as HTMLButtonElement).click()); }
    assert.deepEqual(await page.evaluate(() => (window as unknown as { undoA11y: Harness }).undoA11y.calls()), []);
    await publish(page, { pendingApproval: null, pendingApprovalCount: 0 });
    await panel.getByText(explanation, { exact: true }).waitFor({ state: "hidden" });
    for (const button of await buttons.all()) assert(await button.isEnabled());
  });
  await check("disabled Undo controls describe the waiting approval reason", async page => {
    await publish(page, { pendingApproval: pending, pendingApprovalCount: 1, running: true });
    const descriptions = await page.getByTestId("change-summary").locator("button[data-undo-trigger]").evaluateAll(buttons => buttons.map(button => {
      const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return { ids, connected: ids.every(id => document.getElementById(id)?.isConnected), text: ids.map(id => document.getElementById(id)?.textContent ?? "").join(" ") };
    }));
    assert.equal(descriptions.length, 3);
    for (const description of descriptions) { assert(description.ids.length > 0); assert(description.connected); assert(description.text.includes(explanation), "Every disabled Undo control must describe the pending approval reason"); }
  });
  await check("same activity failure then restored then failure focuses its connected result", async page => {
    const row = page.getByTestId("change-entry").filter({ hasText: "Moved sample A" });
    for (const [index, outcome] of [
      { status: "failed", reason: "First restore failed." },
      { status: "restored" },
      { status: "failed", reason: "Later restore failed." },
    ].entries()) {
      if (index === 2) await publish(page, { activity: initial.activity });
      await page.evaluate(value => (window as unknown as { undoA11y: Harness }).undoA11y.outcome(value as NonNullable<ActivityEntry["undoResult"]>), outcome);
      await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
      const role = outcome.status === "restored" ? "status" : "alert";
      const text = outcome.status === "restored" ? "Restore verified" : "Could not restore this change. Review the result before trying again.";
      const result = row.getByRole(role).filter({ hasText: text }); await result.waitFor();
      await page.waitForFunction(({ role, text }) => document.activeElement?.isConnected && document.activeElement.getAttribute("role") === role && document.activeElement.textContent?.includes(text), { role, text }, { timeout: 2200 });
      assert(await result.evaluate(element => element === document.activeElement && element.isConnected));
      assert.equal(await result.getAttribute("tabindex"), "-1");
    }
    assert.deepEqual(await page.evaluate(() => (window as unknown as { undoA11y: Harness }).undoA11y.calls()), ["undo:same-entry", "undo:same-entry", "undo:same-entry"]);
  });
  await check("raw tab is escaped in summary and preserved in full command", async page => {
    const raw = "echo\t‘sample’\necho\t\u202etarget";
    await publish(page, { pendingApproval: { ...pending, summaryTruncated: true, action: { ...pending.action, summary: raw, payload: raw } }, pendingApprovalCount: 1 });
    const summary = page.getByTestId("approval-summary"); await summary.waitFor();
    assert.equal(await summary.textContent(), "echo\\t‘sample’\\necho\\t\\u202etarget");
    await page.getByRole("button", { name: "Show full command", exact: true }).click();
    assert.equal(await page.getByRole("region", { name: "Full command", exact: true }).textContent(), "echo\t‘sample’\necho\t\\u202etarget");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { undoA11y: Harness }).undoA11y.calls()), []);
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch12-undo-accessibility-${process.env.LALIME_EVIDENCE ?? "result"}.txt`,
  `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=${process.env.LALIME_BROWSER_CHANNEL ?? "msedge"} UNDO_A11Y_CASE=${process.env.UNDO_A11Y_CASE ?? ""} node scripts/ui-undo-accessibility.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact test source:\n${await readFile("scripts/ui-undo-accessibility.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
