/** Synthetic verified-restore and exact task-allowance browser checks. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const initial: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "u1", role: "user", content: "Organize sample files", createdAt: 100 }, { id: "a1", role: "assistant", content: "The sample files were moved.", createdAt: 110 }],
  plan: [], activity: [
    { id: "new2", at: 109, summary: "Moved second sample file", actionId: "act2", undoable: true },
    { id: "new1", at: 108, summary: "Moved first sample file", actionId: "act1", undoable: true },
    { id: "old", at: 20, summary: "Earlier sample change", actionId: "old-act", undoable: true }],
  taskGrants: [{ id: "grant1", kind: "ui_click", target: "Sample app > Exact button" }],
  pendingApproval: null, blockedNotice: null, running: false, stopped: false, statusText: "Ready",
  hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
type Harness = { publish(patch: Partial<AppSnapshot>): void; behavior(mode: string): void; undoCalls(): string[]; revokeCalls(): string[]; finish(): void };
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
const results: string[] = [];
let failures = 0;
async function fixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2000);
  await page.addInitScript((state: AppSnapshot) => {
    const animations: { target: string | null; frames: unknown; options: unknown }[] = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      animations.push({ target: this.getAttribute("data-restore-cue"), frames, options });
      return animate.call(this, frames, options);
    };
    Object.defineProperty(window, "restoreAnimations", { value: animations });
    let current = state;
    let mode = "restore";
    let finish: (() => void) | undefined;
    const calls: string[] = [], revoked: string[] = [];
    const listeners = new Set<(state: AppSnapshot) => void>();
    function publish(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const fn of listeners) fn(current); }
    Object.defineProperty(window, "activityFixture", { value: {
      publish, behavior(value: string) { mode = value; }, undoCalls() { return calls; }, revokeCalls() { return revoked; }, finish() { finish?.(); },
    } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(fn: (state: AppSnapshot) => void) { listeners.add(fn); return () => listeners.delete(fn); },
      async sendMessage() {}, async stop() { publish({ stopped: true }); }, async copyText() {}, async writerStatus() { return current.writer; },
      async revokeTaskGrant(id: string) { revoked.push(id); if (mode === "reject") throw new Error("Synthetic reject"); if (mode === "fail") return false; if (mode !== "silent") publish({ taskGrants: [] }); return true; },
      async undo(id: string) {
        calls.push(id);
        if (mode === "delay") await new Promise<void>((resolve) => { finish = resolve; });
        if (mode === "reject") throw new Error("Synthetic reject");
        if (mode === "silent") return;
        publish({ activity: current.activity.map((entry) => entry.id !== id ? entry : mode === "fail"
          ? { ...entry, undoResult: { status: "failed", reason: "Synthetic restore could not be verified" } }
          : { ...entry, undone: true, undoResult: { status: "restored" } }) });
      },
    } });
  }, initial);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  return page;
}
async function publish(page: Page, patch: Partial<AppSnapshot>) { await page.evaluate((value) => (window as unknown as { activityFixture: Harness }).activityFixture.publish(value), patch); }
async function behavior(page: Page, mode: string) { await page.evaluate((value) => (window as unknown as { activityFixture: Harness }).activityFixture.behavior(value), mode); }
async function calls(page: Page) { return page.evaluate(() => (window as unknown as { activityFixture: Harness }).activityFixture.undoCalls()); }
async function check(name: string, run: (page: Page) => Promise<void>) {
  if (process.env.ACTIVITY_CASE && !name.includes(process.env.ACTIVITY_CASE)) return;
  const page = await fixture();
  try { await run(page); results.push(`PASS ${name}`); }
  catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("batch7 summaries show invisible characters in visible and accessible text", async (page) => {
    const summary = "Moved\n\u201cfile\u201d \u202esafe\u202c\u200b\u2060\u{e0061}\u{e007f}";
    const expected = "Moved\\n\u201cfile\u201d \\u202esafe\\u202c\\u200b\\u2060\\u{e0061}\\u{e007f}";
    await publish(page, { activity: initial.activity.map((entry) => ({ ...entry, summary })) });
    await page.getByTestId("change-summary").getByText("Earlier activity", { exact: true }).click();
    const contexts = await page.getByTestId("change-summary").getByTestId("undo-button").evaluateAll((buttons) => buttons.map((button) => ({
      visible: button.closest("li")?.querySelector("p")?.textContent,
      description: (button.getAttribute("aria-describedby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" "),
    })));
    assert.equal(contexts.length, 3);
    for (const context of contexts) { assert.equal(context.visible, expected); assert.equal(context.description, expected); }
  });
  await check("batch7 summaries preserve existing escapes and literal markup", async (page) => {
    const summary = String.raw`Moved C:\new\test.txt \u202e <button id="spoofed-action">Undo all</button>`;
    await publish(page, { activity: [{ ...initial.activity[0], summary }] });
    const row = page.getByTestId("change-summary").getByTestId("change-entry");
    assert.equal(await row.locator("p").first().textContent(), summary);
    assert.equal(await row.locator("#spoofed-action").count(), 0);
    const description = await row.getByTestId("undo-button").evaluate((button) => document.getElementById(button.getAttribute("aria-describedby")!)?.textContent);
    assert.equal(description, summary);
  });
  await check("action context describes each Undo with its exact change", async (page) => {
    await page.getByTestId("change-summary").getByText("Earlier activity", { exact: true }).click();
    const contexts = await page.getByTestId("change-summary").getByTestId("undo-button").evaluateAll((buttons) => buttons.map((button) => {
      const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return { summary: button.closest("li")?.querySelector("p")?.textContent, described: ids.map((id) => document.getElementById(id)?.textContent).join(" "), unique: ids.every((id) => [...document.querySelectorAll("[id]")].filter((node) => node.id === id).length === 1) };
    }));
    assert.equal(contexts.length, 3);
    for (const context of contexts) { assert.equal(context.described, context.summary); assert(context.unique); }
  });
  await check("action context describes each Revoke on desktop and mobile without duplicate IDs", async (page) => {
    await publish(page, { taskGrants: [...initial.taskGrants!, { id: "grant2", kind: "shell", target: "echo second exact command" }] });
    async function verify() {
      const contexts = await page.getByTestId("task-grants").getByRole("button", { name: "Revoke", exact: true }).evaluateAll((buttons) => buttons.map((button) => {
        const ids = (button.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        return { target: button.closest("li")?.querySelector("p")?.textContent, described: ids.map((id) => document.getElementById(id)?.textContent).join(" "), unique: ids.every((id) => [...document.querySelectorAll("[id]")].filter((node) => node.id === id).length === 1) };
      }));
      assert(contexts.length >= 2);
      for (const context of contexts) { assert.equal(context.described, context.target); assert(context.unique); }
    }
    await verify();
    await page.setViewportSize({ width: 390, height: 700 });
    await page.getByRole("button", { name: "Open plan and activity", exact: true }).click();
    await page.getByRole("dialog", { name: "Plan and activity", exact: true }).waitFor();
    await verify();
  });
  await check("restore cue runs once only after authoritative verified transition", async (page) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const current = page.getByTestId("change-summary-current");
    await current.getByRole("button", { name: "Undo", exact: true }).first().click();
    await current.getByText("Restore verified", { exact: true }).waitFor();
    await page.waitForFunction(() => (window as unknown as { restoreAnimations: { target: string | null }[] }).restoreAnimations.some((entry) => entry.target === "new2"));
    await publish(page, { statusText: "Ready again" });
    const cues = await page.evaluate(() => (window as unknown as { restoreAnimations: { target: string | null; options: { duration: number; iterations?: number } }[] }).restoreAnimations.filter((entry) => entry.target === "new2"));
    assert.equal(cues.length, 1);
    assert(cues[0].options.duration > 0 && cues[0].options.duration <= 600, "A brief, single cue");
    assert.equal(cues[0].options.iterations ?? 1, 1);
  });
  await check("restore cue stays static for reduced motion and newly loaded restored history", async (page) => {
    await page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first().click();
    await page.getByTestId("change-summary-current").getByText("Restore verified", { exact: true }).waitFor();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await publish(page, { activity: [{ id: "historical", at: 108, summary: "Previously restored", actionId: "historical-action", undoable: true, undone: true, undoResult: { status: "restored" } }] });
    await page.getByTestId("change-summary-current").getByText("Previously restored", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { restoreAnimations: { target: string | null }[] }).restoreAnimations.filter((entry) => entry.target).length), 0);
  });
  await check("restore cue never celebrates failed or unverified results", async (page) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await behavior(page, "fail");
    await page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first().click();
    await page.getByRole("alert").filter({ hasText: "Could not restore this change. Review the result before trying again." }).waitFor();
    await page.getByText("Show details", { exact: true }).click();
    await page.getByTestId("undo-details").getByText("Synthetic restore could not be verified", { exact: true }).waitFor();
    await publish(page, { activity: initial.activity.map((entry) => ({ ...entry, undone: true })) });
    await page.getByText("Undo is not available for this entry.", { exact: true }).first().waitFor();
    assert.equal(await page.getByText("Restore verified", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { restoreAnimations: { target: string | null }[] }).restoreAnimations.filter((entry) => entry.target).length), 0);
  });
  await check("current turn excludes earlier activity from its undo batch", async (page) => {
    const current = page.getByTestId("change-summary-current");
    await current.waitFor();
    assert(!(await current.innerText()).includes("Earlier sample change"));
    await current.getByRole("button", { name: "Undo all available", exact: true }).click();
    await current.getByText("Restore verified", { exact: true }).first().waitFor();
    await page.waitForFunction(() => (window as unknown as { activityFixture: Harness }).activityFixture.undoCalls().length === 2);
    assert.deepEqual(await calls(page), ["new2", "new1"]);
  });
  await check("resolved IPC without verified restore never claims success", async (page) => {
    await behavior(page, "silent");
    await page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first().click();
    await page.getByText("The restore was not verified. Try again.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Restore verified", { exact: true }).count(), 0);
  });
  await check("failed Undo all stops on first failure and allows retry", async (page) => {
    await behavior(page, "fail");
    const current = page.getByTestId("change-summary-current");
    await current.getByRole("button", { name: "Undo all available", exact: true }).click();
    await current.getByRole("alert").filter({ hasText: "Could not restore this change. Review the result before trying again." }).waitFor();
    await current.getByText("Show details", { exact: true }).click();
    await current.getByTestId("undo-details").getByText("Synthetic restore could not be verified", { exact: true }).waitFor();
    assert.deepEqual(await calls(page), ["new2"]);
    await behavior(page, "restore");
    await current.getByRole("button", { name: "Try Undo again", exact: true }).click();
    await current.getByText("Restore verified", { exact: true }).waitFor();
  });
  await check("rejected restore is visible and retryable", async (page) => {
    await behavior(page, "reject");
    await page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first().click();
    await page.getByText("Could not restore this change. Review the result before trying again.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Try Undo again", exact: true }).waitFor();
  });
  await check("Undo all is sequential and cancel stops remaining restores", async (page) => {
    await behavior(page, "delay");
    await page.getByRole("button", { name: "Undo all available", exact: true }).click();
    await page.getByRole("button", { name: "Stop remaining restores", exact: true }).waitFor();
    assert.deepEqual(await calls(page), ["new2"]);
    await page.getByRole("button", { name: "Stop remaining restores", exact: true }).click();
    await page.evaluate(() => (window as unknown as { activityFixture: Harness }).activityFixture.finish());
    await page.getByText("Restore verified", { exact: true }).first().waitFor();
    assert.deepEqual(await calls(page), ["new2"]);
  });
  await check("new user turn cancels remaining restores", async (page) => {
    await behavior(page, "delay");
    await page.getByRole("button", { name: "Undo all available", exact: true }).click();
    await publish(page, { messages: [...initial.messages, { id: "u2", role: "user", content: "A new task", createdAt: 200 }], running: true });
    await page.evaluate(() => (window as unknown as { activityFixture: Harness }).activityFixture.finish());
    await page.getByTestId("change-summary").getByRole("button", { name: "Stop remaining restores", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(await calls(page), ["new2"]);
  });
  await check("running disables restore actions", async (page) => {
    await publish(page, { running: true });
    const undo = page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first();
    assert.equal(await undo.isDisabled(), true);
    assert.deepEqual(await calls(page), []);
  });
  await check("activity without user turn is labelled recorded history", async (page) => {
    await publish(page, { messages: [] });
    await page.getByTestId("change-summary").getByText("Recorded activity", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("change-summary-current").count(), 0);
    assert.equal(await page.getByTestId("empty-state").count(), 0, "An activity history is not an empty chat");
  });
  await check("exact grant target can be revoked", async (page) => {
    const grants = page.getByTestId("task-grants");
    await grants.getByText("Sample app > Exact button", { exact: true }).waitFor();
    await grants.getByRole("button", { name: "Revoke", exact: true }).click();
    await grants.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => (window as unknown as { activityFixture: Harness }).activityFixture.revokeCalls()), ["grant1"]);
  });
  await check("false revoke stays visible with retry", async (page) => {
    await behavior(page, "fail");
    const grants = page.getByTestId("task-grants");
    await grants.getByRole("button", { name: "Revoke", exact: true }).click();
    await grants.getByText("Could not revoke this allowance. Try again.", { exact: true }).waitFor();
    assert.equal(await grants.getByRole("button", { name: "Revoke", exact: true }).isDisabled(), false);
  });
  await check("successful revoke does not remove target before snapshot confirms", async (page) => {
    await behavior(page, "silent");
    const grants = page.getByTestId("task-grants");
    await grants.getByRole("button", { name: "Revoke", exact: true }).click();
    await grants.getByText("Sample app > Exact button", { exact: true }).waitFor();
  });
  await check("Stop snapshot cancels remaining restores", async (page) => {
    await behavior(page, "delay");
    await page.getByRole("button", { name: "Undo all available", exact: true }).click();
    await publish(page, { stopped: true });
    await page.evaluate(() => (window as unknown as { activityFixture: Harness }).activityFixture.finish());
    await page.getByRole("button", { name: "Stop remaining restores", exact: true }).waitFor({ state: "hidden" });
    assert.deepEqual(await calls(page), ["new2"]);
  });
  await check("pending approval disables restore actions", async (page) => {
    await publish(page, { pendingApproval: { action: { id: "pending", kind: "file_move", payload: "sample", userRequest: "sample" }, decision: { actionId: "pending", kind: "ask", tier: 2, plainEnglish: "Review sample", details: "Sample", matchedRules: [], undoable: false } } });
    assert.equal(await page.getByTestId("change-summary-current").getByRole("button", { name: "Undo", exact: true }).first().isDisabled(), true);
    assert.deepEqual(await calls(page), []);
  });
  await check("rail does not duplicate restore controls and earlier entries stay available", async (page) => {
    assert.equal(await page.getByRole("complementary", { name: "Plan and activity", exact: true }).getByTestId("undo-button").count(), 0);
    await page.getByTestId("change-summary").getByText("Earlier activity", { exact: true }).click();
    const row = page.getByTestId("change-entry").filter({ hasText: "Earlier sample change" });
    await row.getByRole("button", { name: "Undo", exact: true }).click();
    await row.getByText("Restore verified", { exact: true }).waitFor();
    assert.deepEqual(await calls(page), ["old"]);
  });
  await check("rejected revoke leaves an accessible retry", async (page) => {
    await behavior(page, "reject");
    const grants = page.getByTestId("task-grants");
    await grants.getByRole("button", { name: "Revoke", exact: true }).click();
    await grants.getByRole("alert").filter({ hasText: "Could not revoke this allowance" }).waitFor();
    assert.equal(await grants.getByRole("button", { name: "Revoke", exact: true }).isDisabled(), false);
  });
  await check("mobile changes and exact grant targets fit", async (page) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await mkdir("artifacts/screenshots", { recursive: true });
    await page.screenshot({ path: "artifacts/screenshots/change-summary-mobile.png" });
    await page.getByRole("button", { name: "Open plan and activity", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Plan and activity", exact: true });
    await dialog.getByTestId("task-grants").scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: "artifacts/screenshots/task-grants-mobile.png" });
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-activity-${process.env.LALIME_EVIDENCE ?? "result"}.txt`, `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=${process.env.LALIME_BROWSER_CHANNEL ?? "chromium"} node scripts/ui-activity-regressions.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact source:\n${await readFile("scripts/ui-activity-regressions.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
