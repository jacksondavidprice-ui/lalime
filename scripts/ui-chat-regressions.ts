/** Browser regressions for draft resizing and streamed conversation scrolling. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type { LalimeApi } from "../shared/ipc";
import type { AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43123";
const SAMPLE = "This is a synthetic streaming test sentence with enough words to wrap across multiple lines. ";
const state: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-${i}`,
    role: i % 2 ? "assistant" : "user", content: `Sample ${i}. ${SAMPLE.repeat(2)}`, createdAt: i })),
  plan: [], activity: [], pendingApproval: null, blockedNotice: null, running: false,
  stopped: false, statusText: "Synthetic browser test", hands: { backend: "node", available: true },
  writer: { enabled: false, providerId: null, model: null },
};

async function fixture(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  page.setDefaultTimeout(5000);
  await page.addInitScript((initial: AppSnapshot) => {
    let current = initial;
    let copiedText = "";
    let rejectCopy = false;
    const subscribers = new Set<(snapshot: AppSnapshot) => void>();
    const api: LalimeApi = {
      async getSnapshot() { return current; },
      subscribe(callback) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
      async completeOnboarding() {}, async setMode() {}, async signInDemo() {},
      async signInChatgpt() { return { ok: true }; }, async signInApiKey() { return { ok: true }; },
      async sendMessage() {}, async respondApproval() {}, async undo() {}, async stop() {},
      async dismissBlocked() {}, async runDemoScenario() {},
      async writerStatus() { return current.writer; }, async updateSettings() { return { ok: true }; }, async connectProvider() { return { ok: true }; }, async disconnect() {},
      async copyText(text) { if (rejectCopy) throw new Error("Synthetic copy failure"); copiedText = text; },
    };
    Object.defineProperty(window, "lalime", { value: api });
    Object.defineProperty(window, "chatRegression", { value: {
      copied() { return copiedText; },
      failCopy() { rejectCopy = true; },
      append(chunk: string) {
        const messages = current.messages.slice();
        messages[messages.length - 1] = { ...messages[messages.length - 1], content: messages[messages.length - 1].content + chunk };
        current = { ...current, messages };
        for (const callback of subscribers) callback(current);
      },
    } });
  }, state);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  await page.locator('[aria-label="Conversation"]').waitFor({ state: "attached" });
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label="Conversation"]');
    return !!el && el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
  });
  return page;
}

async function append(page: Page, chunk: string): Promise<void> {
  const before = await page.locator('[aria-label="Conversation"]').evaluate((el) => el.scrollHeight);
  await page.evaluate((text) => {
    (window as unknown as { chatRegression: { append(text: string): void } }).chatRegression.append(text);
  }, chunk);
  await page.waitForFunction((height) => document.querySelector('[aria-label="Conversation"]')!.scrollHeight > height, before);
}

async function metrics(page: Page) {
  return page.locator('[aria-label="Conversation"]').evaluate((el) => ({
    top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight,
    gap: el.scrollHeight - el.scrollTop - el.clientHeight,
  }));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
  const results: string[] = [];
  let failures = 0;
  async function check(name: string, run: (page: Page) => Promise<void>) {
    const page = await fixture(browser);
    try { await run(page); results.push(`PASS ${name}`); }
    catch (error) {
      failures++;
      results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\nConversation geometry: ${JSON.stringify(await metrics(page))}`);
    } finally { await page.close(); }
    console.log(results[results.length - 1]);
  }
  try {
    await check("copy reply uses the app bridge", async (page) => {
      await page.getByTestId("copy-reply").last().click();
      await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
      const copied = await page.evaluate(() => (window as unknown as { chatRegression: { copied(): string } }).chatRegression.copied());
      assert.equal(copied, state.messages[state.messages.length - 1].content);
    });
    await check("copy failure offers a visible retry", async (page) => {
      await page.evaluate(() => (window as unknown as { chatRegression: { failCopy(): void } }).chatRegression.failCopy());
      await page.getByTestId("copy-reply").last().click();
      await page.getByRole("button", { name: "Copy failed, try again", exact: true }).waitFor();
    });
    await check("growing the composer keeps the latest reply in view", async (page) => {
      const before = await metrics(page);
      await page.getByTestId("chat-input").fill(SAMPLE.repeat(12));
      await page.waitForFunction((height) => document.querySelector('[aria-label="Conversation"]')!.clientHeight < height, before.client);
      await page.waitForFunction(() => {
        const el = document.querySelector('[aria-label="Conversation"]')!;
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
      }, undefined, { timeout: 3000 });
    });
    await check("existing draft reflows after narrowing the viewport", async (page) => {
      const draft = page.getByTestId("chat-input");
      await draft.fill(SAMPLE.repeat(6));
      await page.setViewportSize({ width: 390, height: 700 });
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-testid="chat-input"]') as HTMLTextAreaElement;
          return el.scrollHeight <= el.clientHeight + 1 || getComputedStyle(el).overflowY === "auto";
        }, undefined, { timeout: 3000 });
      } catch {
        const dimensions = await draft.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight,
          overflow: getComputedStyle(el).overflowY, height: getComputedStyle(el).height }));
        assert.fail(`Resizing must expand or scroll the existing draft; got ${JSON.stringify(dimensions)}`);
      }
    });
    await check("streamed replies stay pinned while smooth following", async (page) => {
      const initial = await metrics(page);
      await append(page, SAMPLE.repeat(12));
      // Start the next updates only once browser geometry proves smooth scrolling began.
      await page.waitForFunction((top) => document.querySelector('[aria-label="Conversation"]')!.scrollTop > top, initial.top);
      for (let i = 0; i < 8; i++) await append(page, SAMPLE.repeat(3));
      await page.waitForFunction(() => {
        const el = document.querySelector('[aria-label="Conversation"]')!;
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
      }, undefined, { timeout: 4000 });
    });
    await check("reader scroll position is preserved and jump returns to latest", async (page) => {
      const conversation = page.locator('[aria-label="Conversation"]');
      await conversation.hover();
      await page.mouse.wheel(0, -600);
      await page.getByTestId("jump-to-latest").waitFor();
      // Wait for wheel scrolling to settle using consecutive animation-frame measurements.
      await page.evaluate(async () => {
        const el = document.querySelector('[aria-label="Conversation"]')!;
        let last = el.scrollTop;
        let stable = 0;
        for (let frame = 0; frame < 120 && stable < 8; frame++) {
          await new Promise(requestAnimationFrame);
          stable = Math.abs(el.scrollTop - last) < 1 ? stable + 1 : 0;
          last = el.scrollTop;
        }
      });
      const reading = await metrics(page);
      assert(reading.gap > 80, "The simulated reader must be away from the bottom");
      await append(page, SAMPLE.repeat(6));
      await page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame); });
      assert(Math.abs((await metrics(page)).top - reading.top) <= 2, "New text must not drag a reader away from their position");
      await page.getByTestId("jump-to-latest").click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[aria-label="Conversation"]')!;
        return el.scrollHeight - el.scrollTop - el.clientHeight <= 2;
      }, undefined, { timeout: 4000 });
    });
  } finally { await browser.close(); }
  await mkdir("artifacts", { recursive: true });
  const source = await readFile("scripts/ui-chat-regressions.ts", "utf8");
  await writeFile("artifacts/chat-regression-result.txt", `Command: ${process.argv.join(" ")}\nURL: ${BASE}\nBrowser: ${process.env.LALIME_BROWSER_CHANNEL || "chromium"}\nExit status: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact test source:\n${source}`);
  assert.equal(failures, 0, results.join("\n\n"));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
