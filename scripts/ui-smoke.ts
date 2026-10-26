/** Browser regression checks against the renderer at LALIME_URL. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import type { LalimeApi } from "../shared/ipc";
import type { AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43123";
const SHOTS = "artifacts/screenshots";
const MOBILE = { width: 390, height: 700 };
const DESKTOP = { width: 1280, height: 800 };

function snapshot(populated = false): AppSnapshot {
  return {
    mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
    messages: populated ? Array.from({ length: 30 }, (_, i) => ({
      id: `message-${i}`, role: i % 2 === 0 ? "user" : "assistant",
      content: i === 28 ? `A long filename: ${"report".repeat(80)}.txt` :
        `Message ${i + 1}: Please organize these documents. Keep the original files available so each change can be reviewed.`,
      createdAt: 1_800_000_000_000 + i,
    })) : [],
    plan: populated ? [{ id: "review", label: "Review the documents", status: "done" },
      { id: "organize", label: "Organize by project", status: "pending" }] : [],
    activity: populated ? [{ id: "reviewed", at: 1_800_000_000_000, summary: "Reviewed the document list",
      undoable: true, actionId: "review" }] : [],
    pendingApproval: null, blockedNotice: null, running: false, stopped: false,
    statusText: "Ready when you are.", hands: { backend: "node", available: true },
    writer: { enabled: false, keyHint: null },
  };
}

async function fixturePage(browser: Browser, mobile = false, populated = false, overrides: Partial<AppSnapshot> = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: mobile ? MOBILE : DESKTOP, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => console.error(`Browser error: ${error.message}`));
  await page.addInitScript((state: AppSnapshot) => {
    const api: LalimeApi = {
      async getSnapshot() { return state; }, subscribe() { return () => {}; }, async completeOnboarding() {},
      async setMode() {}, async signInDemo() {}, async signInChatgpt() { return { ok: true }; },
      async signInApiKey() { return { ok: true }; }, async sendMessage() {}, async respondApproval() {},
      async undo() {}, async stop() {}, async dismissBlocked() {}, async runDemoScenario() {},
      async writerSetKey() { return { ok: true }; }, async writerClearKey() {},
      async writerStatus() { return state.writer; }, async writerCheckKey() { return { ok: true }; },
      async updateSettings() { return { ok: true }; }, async connectProvider() { return { ok: true }; }, async disconnect() {},
      async copyText() {},
    };
    Object.defineProperty(window, "lalime", { value: api });
  }, { ...snapshot(populated), ...overrides });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  return page;
}

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });
}

async function waitForOnboardingSlide(page: Page, title: string): Promise<void> {
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.waitForFunction((expected) => {
    const heading = document.querySelector('[data-testid="onboarding"] h1');
    return heading?.textContent === expected && heading.parentElement &&
      getComputedStyle(heading.parentElement).opacity === "1";
  }, title);
}

async function checkReachable(page: Page, control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  await control.click({ trial: true });
  const bounds = await control.boundingBox();
  const viewport = page.viewportSize()!;
  // Fractional CSS pixels can round a scrolled edge by less than one device pixel.
  assert(bounds && bounds.x >= -1 && bounds.y >= -1 &&
    bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
  `Control must fit the viewport after scrolling: ${JSON.stringify(bounds)}`);
}

async function checkDialog(page: Page, trigger: Locator, name: RegExp): Promise<void> {
  await trigger.click();
  const dialog = page.getByRole("dialog", { name });
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("aria-modal"), "true", "Dialog must be modal");
  assert(await dialog.evaluate((el) => el.contains(document.activeElement)), "Opening a dialog must move focus inside");
  const controls = dialog.locator('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
  assert(await controls.count() > 0, "Dialog needs a focusable control");
  await controls.last().focus();
  await page.keyboard.press("Tab");
  assert(await controls.first().evaluate((el) => el === document.activeElement), "Tab from the final control must return to the first");
  await controls.first().focus();
  await page.keyboard.press("Shift+Tab");
  assert(await controls.last().evaluate((el) => el === document.activeElement), "Shift+Tab from the first control must return to the last");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(await trigger.evaluate((el) => el === document.activeElement), "Escape must return focus to the dialog trigger");
}

async function checkViewport(page: Page): Promise<void> {
  // Read geometry without scrolling the composer, which could hide a layout failure.
  const bounds = await page.getByTestId("chat-input").boundingBox();
  const viewport = page.viewportSize()!;
  assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
    `Composer must remain in the viewport: ${JSON.stringify(bounds)}`);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "The document must not overflow horizontally");
  assert(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
    "The conversation must scroll inside the app, without moving the page");
  const header = await page.getByTestId("settings-button").boundingBox();
  assert(header && header.y >= 0 && header.y + header.height <= viewport.height,
    "The app header must remain visible during a long conversation");
  assert(await page.getByTestId("user-message").evaluateAll((messages) => messages.every((message) => message.scrollWidth <= message.clientWidth)),
    "Long filenames must wrap inside message bubbles");
}

async function main(): Promise<void> {
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
  const failures: string[] = [];
  async function check(name: string, run: () => Promise<void>): Promise<void> {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) {
      const message = `${name}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(message); console.error(`FAIL ${message}`);
    }
  }
  try {
    await check("product sign-in onboarding", async () => {
      const page = await browser.newPage({ viewport: DESKTOP, reducedMotion: "reduce" });
      page.setDefaultTimeout(5000);
      try {
        await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
        await page.getByTestId("onboarding").waitFor();
        await waitForOnboardingSlide(page, "Help with your computer");
        await capture(page, "onboarding");
        await page.getByTestId("onboarding-next").click();
        await page.getByTestId("onboarding-next").click();
        await page.getByTestId("sign-in-panel").waitFor();
        await page.getByTestId("sign-in-chatgpt").waitFor();
        await page.getByTestId("toggle-api-key").click();
        await page.getByTestId("api-key-input").waitFor();
        await page.getByRole("heading", { name: "Use your own ChatGPT or API key" }).waitFor();
        await page.waitForFunction(() => {
          const heading = document.querySelector('[data-testid="onboarding"] h1');
          return heading?.parentElement && getComputedStyle(heading.parentElement).opacity === "1";
        });
        assert.equal(await page.getByTestId("start-demo").count(), 0, "Product UI must not expose start-demo");
        await capture(page, "onboarding-sign-in");
        await page.getByRole("button", { name: "Choose another provider or local model" }).click();
        await page.getByRole("dialog", { name: "Settings" }).waitFor();
      } finally { await page.close(); }
    });
    for (const [size, viewport] of [["mobile", MOBILE], ["short-laptop", { width: 900, height: 520 }]] as const) {
      await check(`${size} onboarding presentation`, async () => {
        const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
        page.setDefaultTimeout(5000);
        try {
          await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
          const titles = ["Help with your computer", "You review risky steps", "Use your own ChatGPT or API key"];
          for (const [index, title] of titles.entries()) {
            await waitForOnboardingSlide(page, title);
            await page.getByRole("heading", { name: title, exact: true }).scrollIntoViewIfNeeded();
            await capture(page, `onboarding-${size}-${index + 1}`);
            assert(await page.getByTestId("onboarding").evaluate((el) => el.scrollWidth <= el.clientWidth),
              "Onboarding must not clip content horizontally");
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
              "Onboarding must fit the document width");
            if (index < 2) {
              await checkReachable(page, page.getByTestId("onboarding-next"));
              await page.getByTestId("onboarding-next").click();
            }
          }
          await checkReachable(page, page.getByTestId("sign-in-chatgpt"));
          await page.getByTestId("toggle-api-key").click();
          await checkReachable(page, page.getByTestId("api-key-input"));
          await checkReachable(page, page.getByTestId("continue-api-key"));
          await checkReachable(page, page.getByRole("button", { name: "Choose another provider or local model" }));
          await waitForOnboardingSlide(page, titles[2]);
          await capture(page, `onboarding-${size}-sign-in-controls`);
        } finally { await page.close(); }
      });
    }
    for (const mobile of [false, true]) {
      for (const kind of ["approval", "blocked"] as const) {
        await check(`${mobile ? "mobile" : "desktop"} ${kind} card presentation`, async () => {
          // Synthetic presentation fixtures. No command is executed by the injected API.
          const decision = {
            actionId: "synthetic-review", kind: kind === "approval" ? "ask" as const : "block" as const,
            tier: 2 as const, plainEnglish: kind === "approval" ? "Move the sample files into a project folder?" : "This sample request cannot run safely.",
            details: "Synthetic test action: review sample documents.\nNo real files or commands are used.",
            matchedRules: ["synthetic-presentation"], undoable: kind === "approval",
          };
          const overrides: Partial<AppSnapshot> = kind === "approval" ? {
            pendingApproval: { decision, action: { id: "synthetic-review", kind: "file_move", payload: "synthetic-test-only", userRequest: "Organize the sample documents." },
              whatHappens: "The sample documents will move into one project folder.", undoNote: "You can undo this sample change." },
          } : { blockedNotice: decision };
          const page = await fixturePage(browser, mobile, true, overrides);
          try {
            const card = page.getByTestId(`${kind}-card`);
            await card.waitFor();
            await card.getByRole("heading").scrollIntoViewIfNeeded();
            await capture(page, `${kind}-${mobile ? "mobile" : "desktop"}`);
            assert(await card.evaluate((el) => el.scrollWidth <= el.clientWidth), "Safety card must not clip content horizontally");
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Safety card must fit the document width");
            const controls = kind === "approval" ? [page.getByTestId("approval-do-it"), page.getByTestId("approval-not-now")] : [card.getByRole("button", { name: "Got it" })];
            for (const control of controls) await checkReachable(page, control);
            if (kind === "approval") {
              await card.getByRole("button", { name: "Show details" }).click();
              await card.locator("pre").waitFor();
              for (const control of controls) await checkReachable(page, control);
            }
            await capture(page, `${kind}-${mobile ? "mobile" : "desktop"}-controls`);
          } finally { await page.close(); }
        });
      }
    }
    await check("settings keyboard and focus", async () => {
      const page = await fixturePage(browser);
      try {
        await page.getByTestId("empty-state").waitFor();
        await capture(page, "chat-empty");
        const welcome = await page.getByTestId("empty-state").boundingBox();
        const header = await page.locator("header").boundingBox();
        assert(welcome && header && welcome.y >= header.y + header.height,
          "The complete empty-chat welcome must start below the header");
        await checkDialog(page, page.getByTestId("settings-button"), /sign in|settings/i);
        await page.getByTestId("settings-button").click();
        await capture(page, "settings-desktop");
      } finally { await page.close(); }
    });
    await check("mobile plan drawer keyboard and focus", async () => {
      const page = await fixturePage(browser, true, true);
      try {
        await checkDialog(page, page.getByRole("button", { name: "Open plan and activity" }), /plan and activity/i);
        await page.getByRole("button", { name: "Open plan and activity" }).click();
        await capture(page, "plan-mobile");
      } finally { await page.close(); }
    });
    for (const mobile of [false, true]) {
      await check(`${mobile ? "mobile" : "desktop"} long conversation viewport`, async () => {
        const page = await fixturePage(browser, mobile, true);
        try {
          assert.equal(await page.getByTestId("user-message").count(), 15);
          assert.equal(await page.getByTestId("assistant-reply").count(), 15);
          await capture(page, `chat-long-${mobile ? "mobile" : "desktop"}`);
          await checkViewport(page);
        } finally { await page.close(); }
      });
    }
    await check("mobile settings field layout and keyboard", async () => {
      const page = await fixturePage(browser, true);
      try {
        await capture(page, "chat-empty-mobile");
        const welcome = await page.getByTestId("empty-state").boundingBox();
        const header = await page.locator("header").boundingBox();
        assert(welcome && header && welcome.y >= header.y + header.height,
          "The complete mobile welcome must start below the header");
        await page.getByTestId("settings-button").click();
        await page.getByTestId("provider-select").selectOption("openai");
        const field = page.getByTestId("settings-api-key");
        await field.waitFor();
        await capture(page, "settings-mobile");
        const bounds = await field.boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= MOBILE.width,
          `API key field must fit the mobile viewport: ${JSON.stringify(bounds)}`);
        await page.getByTestId("provider-select").selectOption("custom");
        await field.waitFor();
        await checkReachable(page, field);
        const customBounds = await field.boundingBox();
        assert(customBounds && customBounds.x >= 0 && customBounds.x + customBounds.width <= MOBILE.width,
          `Custom provider API key field must fit the mobile viewport: ${JSON.stringify(customBounds)}`);
        await capture(page, "settings-mobile-custom-provider");
        const modal = page.getByTestId("settings-modal");
        assert(await modal.evaluate((el) => el.scrollWidth <= el.clientWidth), "Settings must not overflow horizontally");
        await page.getByRole("button", { name: "Close settings" }).click();
        await modal.waitFor({ state: "hidden" });
        await checkDialog(page, page.getByTestId("settings-button"), /sign in|settings/i);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
  assert.equal(failures.length, 0, failures.join("\n\n"));
  console.log("ui-smoke OK (onboarding, safety cards, dialogs, mobile layout, long conversations)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
