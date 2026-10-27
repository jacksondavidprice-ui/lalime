/** Browser checks for readable quotes and visible presentation controls. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import type { AppSnapshot } from "../../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const initial: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "u1", role: "user", content: "Review sample", createdAt: 100 }, { id: "a1", role: "assistant", content: "Review the next step.", createdAt: 110 }],
  plan: [], activity: [], pendingApproval: null, pendingApprovalCount: 0, blockedNotice: null,
  running: false, stopped: false, statusText: "Ready", hands: { backend: "node", available: true }, writer: { enabled: false, providerId: null, model: null },
};
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
const results: string[] = [];
let failures = 0;
async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2000);
  await page.addInitScript((state: AppSnapshot) => {
    let current = state;
    const listeners = new Set<(snapshot: AppSnapshot) => void>();
    function publish(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const listener of listeners) listener(current); }
    Object.defineProperty(window, "readableFixture", { value: { publish } });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; }, subscribe(listener: (snapshot: AppSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      async sendMessage() {}, async stop() {}, async copyText() {}, async writerStatus() { return current.writer; },
      async respondApproval() { throw new Error("A readable-text check must not approve anything"); },
    } });
  }, initial);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  return page;
}
async function publish(page: Page, patch: Partial<AppSnapshot>) { await page.evaluate((value) => (window as unknown as { readableFixture: { publish(patch: Partial<AppSnapshot>): void } }).readableFixture.publish(value), patch); }
async function approval(page: Page, summary: string, payload = summary, summaryTruncated = false) {
  await publish(page, { pendingApprovalCount: 1, pendingApproval: {
    action: { id: "readable-step", kind: "shell", payload, summary, userRequest: "Review sample" }, summaryTruncated,
    decision: { actionId: "readable-step", kind: "ask", tier: 2, plainEnglish: "Review sample", details: "Sample", matchedRules: [], undoable: true },
  } });
  await page.getByTestId("approval-summary").waitFor();
}
async function withdrawal(page: Page, message: string) {
  await publish(page, { activity: [{ id: "change", at: 109, summary: "Sample change", actionId: "change-action", undoable: true,
    approvalWithdrawal: { actionId: "readable-step", summary: "Sample step", reason: "user_undo", message, withdrawnCount: 1 } }] });
  await page.getByTestId("approval-withdrawal").waitFor();
}
async function check(name: string, run: (page: Page) => Promise<void>) {
  const page = await fixture();
  try { await run(page); results.push(`PASS ${name}`); }
  catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
const quotes = "Keep \u2018\u2019\u201a\u201b\u201c\u201d\u201e\u201f readable";
try {
  await check("approval summary preserves every curly quote", async (page) => {
    await approval(page, quotes);
    assert.equal(await page.getByTestId("approval-summary").textContent(), quotes);
  });
  await check("approval command preserves every curly quote", async (page) => {
    await approval(page, "Review command", quotes);
    assert.equal(await page.getByTestId("approval-payload").textContent(), quotes);
  });
  await check("withdrawal notice preserves every curly quote", async (page) => {
    await withdrawal(page, quotes);
    assert.equal(await page.getByTestId("approval-withdrawal").locator("p").nth(1).textContent(), quotes);
  });
  await check("bidi zero-width and TAG controls remain visibly escaped on every surface", async (page) => {
    const raw = "Review \u202etarget\u202c\u200b\u2060\u{e0061}\u{e007f}";
    const expected = "Review \\u202etarget\\u202c\\u200b\\u2060\\u{e0061}\\u{e007f}";
    await approval(page, raw);
    assert.equal(await page.getByTestId("approval-summary").textContent(), expected);
    assert.equal(await page.getByTestId("approval-payload").textContent(), expected);
    await withdrawal(page, raw);
    assert.equal(await page.getByTestId("approval-withdrawal").locator("p").nth(1).textContent(), expected);
  });
  await check("literal host escape sequences remain literal text", async (page) => {
    const literal = String.raw`Don't decode \u2019 or \u202e or \n <button>Allow</button>`;
    await approval(page, literal);
    assert.equal(await page.getByTestId("approval-summary").textContent(), literal);
    assert.equal(await page.getByTestId("approval-payload").textContent(), literal);
    await withdrawal(page, literal);
    assert.equal(await page.getByTestId("approval-withdrawal").locator("p").nth(1).textContent(), literal);
    assert.equal(await page.getByTestId("approval-withdrawal").locator("button").count(), 0);
  });
  await check("command tabs and newlines survive collapsed and expanded preview", async (page) => {
    const command = "echo\tone\necho\ttwo\necho\tthree\necho\tfour";
    await approval(page, "Review multiline command", command);
    const payload = page.getByTestId("approval-payload");
    assert.equal(await payload.textContent(), command);
    assert.equal(await payload.evaluate((element) => getComputedStyle(element).whiteSpace), "pre-wrap");
    await page.getByRole("button", { name: "Show full action", exact: true }).click();
    assert.equal(await payload.textContent(), command);
    await page.getByRole("button", { name: "Show less", exact: true }).click();
    assert.equal(await payload.textContent(), command);
  });
  await check("capped summary full command disclosure preserves tabs and newlines", async (page) => {
    const command = "echo\tone\necho\ttwo\necho\tthree";
    await approval(page, "Review capped command...(+20 more)", command, true);
    await page.getByRole("button", { name: "Show full command", exact: true }).click();
    assert.equal(await page.getByTestId("approval-payload").textContent(), command);
    assert.equal(await page.getByTestId("approval-payload").evaluate((element) => getComputedStyle(element).whiteSpace), "pre-wrap");
  });
  await check("summary and notice still escape tabs and newlines", async (page) => {
    await approval(page, "Review\tcommand\nnext line");
    assert.equal(await page.getByTestId("approval-summary").textContent(), "Review\\tcommand\\nnext line");
    await withdrawal(page, "Withdrew\tone\nstep");
    assert.equal(await page.getByTestId("approval-withdrawal").locator("p").nth(1).textContent(), "Withdrew\\tone\\nstep");
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-batch9-readable-${process.env.LALIME_EVIDENCE ?? "result"}.txt`, `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=${process.env.LALIME_BROWSER_CHANNEL ?? "chromium"} node src/tests/ui-readable-text.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact source:\n${await readFile("src/tests/ui-readable-text.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
