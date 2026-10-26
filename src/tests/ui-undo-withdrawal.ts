/** Browser contract for host withdrawal notices and verified Undo outcomes. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Locator, type Page } from "playwright";
import type { ActivityEntry, AppSnapshot } from "../../shared/types";

type WithdrawalNotice = NonNullable<ActivityEntry["approvalWithdrawal"]>;
type Snapshot = AppSnapshot;
type UndoOutcome = ActivityEntry["undoResult"] | "reject" | "silent";
type Harness = { publish(patch: Partial<Snapshot>): void; replies(): string[]; delayUndo(): void; finishUndo(): void; outcome(value: UndoOutcome): void; outcomes(values: UndoOutcome[]): void; failVerification(): void };
const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const pending: NonNullable<AppSnapshot["pendingApproval"]> = {
  action: { id: "pending-step", kind: "file_move", payload: "sample", summary: "Move another sample", userRequest: "Organize samples" },
  decision: { actionId: "pending-step", kind: "ask", tier: 2, plainEnglish: "Review sample", details: "Sample", matchedRules: [], undoable: true },
};
const initial: Snapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "u1", role: "user", content: "Organize sample files", createdAt: 100 }, { id: "a1", role: "assistant", content: "The sample files were moved.", createdAt: 110 }],
  plan: [], activity: [
    { id: "affected", at: 109, summary: "Moved sample A", actionId: "move-a", undoable: true },
    { id: "unrelated", at: 108, summary: "Moved sample B", actionId: "move-b", undoable: true },
    { id: "earlier", at: 20, summary: "Moved earlier sample", actionId: "move-old", undoable: true },
  ],
  pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null, running: false, stopped: false, statusText: "Ready",
  hands: { backend: "node", available: true }, writer: { enabled: false, keyHint: null },
};
const message = "Lalime withdrew 2 waiting approvals because Undo changed this task.";
const notice: WithdrawalNotice = { actionId: "pending-step", summary: "Move another sample", reason: "user_undo", message, withdrawnCount: 2 };
function withNotice(id = "affected", value = notice) { return initial.activity.map((entry) => entry.id === id ? { ...entry, approvalWithdrawal: value } : entry); }
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
const results: string[] = [];
let failures = 0;
async function fixture(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2000);
  await page.addInitScript((state: Snapshot) => {
    let current = state;
    const replies: string[] = [];
    let delay = false;
    let outcome: ActivityEntry["undoResult"] | "reject" | "silent" = { status: "restored" };
    let sequence: UndoOutcome[] = [];
    let failVerification = false, readFailed = false;
    let finishUndo: (() => void) | undefined;
    const listeners = new Set<(snapshot: Snapshot) => void>();
    function publish(patch: Partial<Snapshot>) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    Object.defineProperty(window, "withdrawalFixture", { value: { publish, replies() { return replies; }, delayUndo() { delay = true; }, finishUndo() { finishUndo?.(); }, outcome(value: typeof outcome) { outcome = value; }, outcomes(values: UndoOutcome[]) { sequence = values; }, failVerification() { failVerification = true; } } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { if (readFailed) throw new Error("Synthetic snapshot failure"); return current; }, subscribe(listener: (snapshot: Snapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async sendMessage() {}, async stop() {}, async copyText() {}, async writerStatus() { return current.writer; },
      async respondApproval(choice: string, id?: string) { replies.push(`${choice}:${id ?? "missing"}`); return true; },
      async undo(id: string) {
        if (delay) await new Promise<void>((resolve) => { finishUndo = resolve; });
        const result = sequence.length ? sequence.shift() : outcome;
        if (result === "reject") throw new Error("Synthetic failure");
        if (result === "silent") return;
        publish({ activity: current.activity.map((entry) => entry.id === id ? { ...entry, undone: result?.status === "restored", undoResult: result } : entry) });
        if (failVerification) readFailed = true;
      },
    } });
  }, initial);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  return page;
}
async function publish(page: Page, patch: Partial<Snapshot>) { await page.evaluate((value) => (window as unknown as { withdrawalFixture: Harness }).withdrawalFixture.publish(value), patch); }
function receipt(page: Page, text = message) { return page.getByTestId("change-summary").getByRole("status").filter({ hasText: text }); }
async function assertContext(status: Locator, summary: string) {
  const context = await status.evaluate((element) => [
    element.textContent, element.closest('[data-testid="change-entry"]')?.textContent,
    ...(element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent),
  ].join(" "));
  assert(context.includes(summary), "The notice must identify the affected change");
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  if (process.env.WITHDRAWAL_CASE && !name.includes(process.env.WITHDRAWAL_CASE)) return;
  const page = await fixture();
  try { await run(page); results.push(`PASS ${name}`); }
  catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("batch9 host failed status with partial counts shows progress", async page => {
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.outcome({status:"failed",restored:2,total:3,reason:"One file was left alone."}));
    const row=page.getByTestId("change-entry").filter({hasText:"Moved sample A"});
    await row.getByTestId("undo-button").click();
    await row.getByRole("alert").waitFor();
    assert.equal(await row.getByRole("alert").textContent(),"Partly undone: 2 of 3 items are back. One file was left alone.");
  });
  await check("batch9 Undo all moves focus to a later failed result", async page => {
    await page.evaluate(() => { const f=(window as unknown as {withdrawalFixture:Harness}).withdrawalFixture; f.outcomes([{status:"restored"},{status:"failed",reason:"The second change could not be restored."}]); f.delayUndo(); });
    await page.getByRole("button",{name:"Undo all available",exact:true}).focus();await page.keyboard.press("Enter");
    await page.getByRole("button",{name:"Restoring...",exact:true}).waitFor();
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.finishUndo());
    const second=page.getByTestId("change-entry").filter({hasText:"Moved sample B"});
    await second.getByRole("button",{name:"Restoring...",exact:true}).waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.finishUndo());
    const alert=second.getByRole("alert"); await alert.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role")==="alert",undefined,{timeout:2000});
  });
  await check("batch9 authoritative partial result survives a verification read failure", async page => {
    await page.evaluate(() => { const f=(window as unknown as {withdrawalFixture:Harness}).withdrawalFixture; f.outcome({status:"partly_restored",restored:2,total:3,reason:"One file was left alone."} as unknown as ActivityEntry["undoResult"]);f.failVerification(); });
    const row=page.getByTestId("change-entry").filter({hasText:"Moved sample A"}); await row.getByTestId("undo-button").click();
    await row.getByRole("button",{name:"Try Undo again",exact:true}).waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await row.getByRole("alert").textContent(),"Partly undone: 2 of 3 items are back. One file was left alone.");
  });
  await check("batch9 Undo all explains why it stopped", async page => {
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.outcome({status:"failed",reason:"A newer file has that name, so it was left alone."}));
    await page.getByRole("button",{name:"Undo all available",exact:true}).click();
    const row=page.getByTestId("change-entry").filter({hasText:"Moved sample A"});
    await row.getByText("Undo all stopped here. Review this result before continuing.",{exact:true}).waitFor();
    await page.getByTestId("change-entry").filter({hasText:"Moved sample B"}).getByRole("button",{name:"Undo",exact:true}).waitFor();
  });
  for (const [name, outcome, expected] of [
    ["counted", { status: "partly_restored", restored: 2, total: 3, reason: "A newer file has that name, so it was left alone." }, "Partly undone: 2 of 3 items are back. A newer file has that name, so it was left alone."],
    ["without counts", { status: "partly_restored", reason: "Review the remaining items." }, "Partly undone. Some items are back, but this change is not finished. Review the remaining items."],
  ] as const) {
    await check("batch9 partial Undo " + name + " is clear and focused", async page => {
      await page.evaluate(value => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.outcome(value as unknown as ActivityEntry["undoResult"]), outcome);
      const row=page.getByTestId("change-entry").filter({hasText:"Moved sample A"});
      await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
      const result=row.getByRole("alert"); await result.waitFor(); assert.equal(await result.textContent(),expected);
      await page.waitForFunction(() => document.activeElement?.getAttribute("role")==="alert",undefined,{timeout:2000});
      assert.equal(await row.getByText("Restore verified",{exact:true}).count(),0);
      await row.getByRole("button",{name:"Try Undo again",exact:true}).waitFor();
      if(name==="counted") {await page.setViewportSize({width:390,height:700});await result.scrollIntoViewIfNeeded();await page.screenshot({path:"artifacts/screenshots/batch9-partial-undo-mobile.png"});}
    });
  }
  for (const [kind, outcome, expected] of [
    ["failed", { status: "failed", reason: "The file could not be restored. Try Undo again." }, "The file could not be restored. Try Undo again."],
    ["rejected", "reject", "Could not restore this change."],
    ["unverified", "silent", "The restore was not verified. Please try again."],
  ] as const) {
    await check("batch9 keyboard focus explains " + kind + " Undo", async (page) => {
      await page.evaluate(value => (window as unknown as { withdrawalFixture: Harness }).withdrawalFixture.outcome(value), outcome);
      const row = page.getByTestId("change-entry").filter({ hasText: "Moved sample A" });
      await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
      const result = row.getByRole("alert"); await result.waitFor();
      assert.equal(await result.textContent(), expected);
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert", undefined, { timeout: 2000 });
      assert.equal(await result.getAttribute("tabindex"), "-1");
      assert.equal(await result.evaluate(el => document.getElementById(el.getAttribute("aria-describedby")!)?.textContent), "Moved sample A");
      await page.keyboard.press("Shift+Tab");
      assert(await row.getByRole("button", { name: "Try Undo again", exact: true }).evaluate(el => el === document.activeElement));
    });
  }
  await check("batch9 failed Undo keeps focus in a new draft", async (page) => {
    await page.evaluate(() => { const f=(window as unknown as { withdrawalFixture: Harness }).withdrawalFixture; f.outcome({status:"failed",reason:"Restore could not finish."}); f.delayUndo(); });
    const row=page.getByTestId("change-entry").filter({hasText:"Moved sample A"});
    await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
    await page.getByRole("button",{name:"Restoring...",exact:true}).waitFor();
    await page.getByTestId("chat-input").fill("Keep this draft");
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.finishUndo());
    await row.getByRole("alert").waitFor();
    assert(await page.getByTestId("chat-input").evaluate(el=>el===document.activeElement));
  });
  await check("batch9 Undo all focuses its first failed result", async (page) => {
    await page.evaluate(() => (window as unknown as {withdrawalFixture:Harness}).withdrawalFixture.outcome({status:"failed",reason:"Restore could not finish."}));
    await page.getByRole("button",{name:"Undo all available",exact:true}).focus(); await page.keyboard.press("Enter");
    await page.getByRole("alert").waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert", undefined, {timeout:2000});
    assert.equal(await page.getByText("Restore verified",{exact:true}).count(),0);
  });
  await check("completed restores do not show an unrelated Undo waiting instruction", async (page) => {
    await publish(page, { running: true, activity: withNotice().map(entry => ({ ...entry, undone: true, undoResult: { status: "restored" } })) });
    await receipt(page).waitFor();
    assert.equal(await page.getByText("Finish or stop the current task before undoing changes.", { exact: true }).count(), 0);
    await receipt(page).getByText("Lalime is still working. It will ask before the next important step.", { exact: true }).waitFor();
  });
  if (process.env.LALIME_HOST_WITHDRAWAL_EVIDENCE) {
    const evidence = JSON.parse(await readFile(process.env.LALIME_HOST_WITHDRAWAL_EVIDENCE, "utf8")) as { snapshots: AppSnapshot[] };
    const snapshot = evidence.snapshots.at(-1)!;
    const entry = snapshot.activity.find(item => item.approvalWithdrawal)!;
    assert(entry, "Host evidence must contain a withdrawal notice");
    await check("real host snapshot shows the cancelled request beside its verified restore", async (page) => {
      await page.setViewportSize({ width: 390, height: 700 });
      await publish(page, snapshot);
      const status = receipt(page, entry.approvalWithdrawal!.message); await status.waitFor();
      await assertContext(status, entry.summary);
      assert.equal(await status.getAttribute("aria-live"), "polite");
      assert(entry.undone && entry.undoResult?.status === "restored", "Host fixture must verify the restore");
      const row = page.getByTestId("change-entry").filter({ hasText: entry.summary });
      await row.getByText("Restore verified", { exact: true }).waitFor();
      assert.equal(await page.getByTestId("approval-card").count(), 0);
      await status.scrollIntoViewIfNeeded();
      await page.screenshot({ path: "artifacts/screenshots/batch8-host-withdrawal-mobile.png" });
    });
  }
  await check("keyboard Undo focuses the verified result and explains what remains", async (page) => {
    await page.setViewportSize({ width: 390, height: 700 });
    const row = page.getByTestId("change-entry").filter({ hasText: "Moved sample A" });
    await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
    const result = row.getByRole("status").filter({ hasText: "Restore verified" }); await result.waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "status" && document.activeElement?.textContent?.includes("Restore verified"), undefined, { timeout: 2000 });
    assert.equal(await result.getAttribute("tabindex"), "-1");
    assert.equal(await result.evaluate(el => document.getElementById(el.getAttribute("aria-describedby")!)?.textContent), "Moved sample A");
    await row.getByTestId("undo-next-step").getByText("No approvals are waiting.", { exact: true }).waitFor();
    assert.equal(await row.getByTestId("approval-withdrawal").count(), 0);
    await page.screenshot({ path: "artifacts/screenshots/batch8-undo-result-mobile.png" });
  });
  await check("completed Undo does not steal focus from a new draft", async (page) => {
    await page.evaluate(() => (window as unknown as { withdrawalFixture: Harness }).withdrawalFixture.delayUndo());
    const row = page.getByTestId("change-entry").filter({ hasText: "Moved sample A" });
    await row.getByTestId("undo-button").focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Restoring...", exact: true }).waitFor();
    await page.getByTestId("chat-input").fill("Keep this draft");
    await page.evaluate(() => (window as unknown as { withdrawalFixture: Harness }).withdrawalFixture.finishUndo());
    await row.getByRole("status").filter({ hasText: "Restore verified" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-testid="change-summary"] button:disabled'));
    assert(await page.getByTestId("chat-input").evaluate(el => el === document.activeElement));
    assert.equal(await page.getByTestId("chat-input").inputValue(), "Keep this draft");
  });
  await check("unknown and queued counts do not claim the task is clear", async (page) => {
    await publish(page, { activity: withNotice(), pendingApprovalCount: undefined });
    await receipt(page).getByText("You can continue when you are ready.", { exact: true }).waitFor();
    assert.equal(await receipt(page).getByText("No approvals are waiting.", { exact: true }).count(), 0);
    await publish(page, { pendingApprovalCount: 2 });
    await receipt(page).getByText("Lalime is preparing the next step for review.", { exact: true }).waitFor();
  });
  await check("live withdrawal is escaped, polite, tied to its change, and sends no approval", async (page) => {
    await publish(page, { pendingApproval: pending, pendingApprovalCount: 1 });
    await page.getByTestId("approval-card").waitFor();
    const raw = "Withdrew\n\u202e2\u202c\u200b\u{e0061} <button id=\"spoof\">Approve</button> \\n";
    const escaped = "Withdrew\\n\\u202e2\\u202c\\u200b\\u{e0061} <button id=\"spoof\">Approve</button> \\n";
    await publish(page, { pendingApproval: null, pendingApprovalCount: 0, activity: withNotice("affected", { ...notice, message: raw }) });
    await page.getByTestId("approval-card").waitFor({ state: "hidden" });
    const status = receipt(page, escaped);
    await status.waitFor();
    assert.equal(await status.getAttribute("aria-live"), "polite");
    await assertContext(status, "Moved sample A");
    assert.equal(await status.locator("#spoof").count(), 0);
    assert.equal(await status.getByRole("alert").count(), 0);
    const unrelated = page.getByTestId("change-entry").filter({ hasText: "Moved sample B" });
    assert(!(await unrelated.innerText()).includes(escaped));
    assert.deepEqual(await page.evaluate(() => (window as unknown as { withdrawalFixture: Harness }).withdrawalFixture.replies()), []);
  });
  await check("removed affected entry never transfers its notice to another change", async (page) => {
    await publish(page, { activity: withNotice() });
    await receipt(page).waitFor();
    await publish(page, { activity: initial.activity.filter((entry) => entry.id !== "affected") });
    await receipt(page).waitFor({ state: "hidden" });
    assert.equal(await receipt(page).count(), 0);
    assert.equal(await page.getByTestId("change-entry").filter({ hasText: message }).count(), 0);
  });
  await check("cleared notice disappears without changing the recorded activity", async (page) => {
    await publish(page, { activity: withNotice() });
    await receipt(page).waitFor();
    await publish(page, { activity: initial.activity });
    await receipt(page).waitFor({ state: "hidden" });
    await page.getByTestId("change-entry").filter({ hasText: "Moved sample A" }).getByTestId("undo-button").waitFor();
  });
  await check("notice about historical change is visible without opening history", async (page) => {
    await publish(page, { activity: withNotice("earlier") });
    const status = receipt(page);
    await status.waitFor();
    await assertContext(status, "Moved earlier sample");
    assert.equal(await status.getAttribute("aria-live"), "polite");
  });
  await check("withdrawal stays separate from restore failure and describes the next state", async (page) => {
    await publish(page, { activity: withNotice().map((entry) => entry.id === "affected" ? { ...entry, undoResult: { status: "failed", reason: "Sample restore failed." } } : entry) });
    await receipt(page).waitFor();
    await page.getByTestId("change-summary").getByRole("alert").filter({ hasText: "Sample restore failed." }).waitFor();
    assert.equal(await page.getByTestId("change-summary").getByText("Restore verified", { exact: true }).count(), 0);
    for (const [patch, next] of [
      [{ pendingApproval: pending, pendingApprovalCount: 1, running: false }, "Another step is waiting for your approval."],
      [{ pendingApproval: null, pendingApprovalCount: 0, running: true }, "Lalime is still working. It will ask before the next important step."],
      [{ pendingApproval: null, pendingApprovalCount: 0, running: false }, "No approvals are waiting."],
    ] as const) {
      await publish(page, patch);
      await page.getByTestId("change-summary").getByText(next, { exact: true }).waitFor();
    }
  });
  await check("absent withdrawal metadata preserves existing Undo controls without a receipt", async (page) => {
    assert.equal(await page.getByTestId("change-summary-current").getByTestId("undo-button").count(), 2);
    assert.equal(await receipt(page).count(), 0);
    assert.equal(await page.getByTestId("change-summary").getByText("No approvals are waiting.", { exact: true }).count(), 0);
    assert.equal(await page.getByTestId("change-summary").getByRole("alert").count(), 0);
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch8-undo-${process.env.LALIME_EVIDENCE ?? "result"}.txt`, `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=${process.env.LALIME_BROWSER_CHANNEL ?? "chromium"} node src/tests/ui-undo-withdrawal.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact source:\n${await readFile("src/tests/ui-undo-withdrawal.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
