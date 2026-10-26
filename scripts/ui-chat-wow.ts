/** Synthetic renderer checks for in-conversation progress and reply tools. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import type { AppSnapshot } from "../shared/types";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const snapshot: AppSnapshot = {
  mode: "live", auth: { state: "signed_in", method: "chatgpt" }, onboardingComplete: true,
  messages: [{ id: "user", role: "user", content: "Explain the sample", createdAt: 1 },
    { id: "answer", role: "assistant", content: "Here is a synthetic answer about a sample folder.", createdAt: 2 }],
  plan: [{ id: "look", label: "Look at the sample folder", status: "done" },
    { id: "explain", label: "Explain the result", status: "running" }],
  activity: [{ id: "act", at: 2, summary: "Read the sample folder", undoable: false }],
  pendingApproval: null, blockedNotice: null, running: false, stopped: false,
  statusText: "Looking at the sample folder", hands: { backend: "node", available: true },
  writer: { enabled: false, keyHint: null },
};

async function fixture(browser: Browser, speech = true): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(2500);
  await page.addInitScript(({ initial, speech }) => {
    let current = initial;
    let sendFailure = false;
    let sendPending = false;
    let finishSend: (() => void) | undefined;
    const sent: string[] = [];
    const spoken: { text: string; voice?: string }[] = [];
    let canceled = 0;
    let local = true;
    let failSpeech = false;
    const subscribers = new Set<(state: AppSnapshot) => void>();
    const synth = {
      cancel() { canceled++; },
      speak(utterance: SpeechSynthesisUtterance) { if (failSpeech) throw new Error("Synthetic speech failure"); spoken.push({ text: utterance.text, voice: utterance.voice?.name }); },
      getVoices() { return [{ name: "Remote sample", localService: false, lang: "en-US" }, ...(local ? [{ name: "Local sample", localService: true, lang: "en-US" }] : [])]; },
    };
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { text: string; constructor(text: string) { this.text = text; } }, configurable: true });
    Object.defineProperty(window, "speechSynthesis", { value: speech ? synth : undefined, configurable: true });
    Object.defineProperty(window, "lalime", { value: {
      async getSnapshot() { return current; },
      subscribe(callback: (state: AppSnapshot) => void) { subscribers.add(callback); return () => subscribers.delete(callback); },
      async sendMessage(text: string) {
        sent.push(text);
        if (sendFailure) throw new Error("Synthetic failure");
        if (sendPending) await new Promise<void>((resolve) => { finishSend = resolve; });
      },
      async stop() {}, async copyText() {}, async undo() {}, async respondApproval() {},
      async writerStatus() { return current.writer; },
    } });
    Object.defineProperty(window, "wowFixture", { value: {
      update(patch: Partial<AppSnapshot>) { current = { ...current, ...patch }; for (const fn of subscribers) fn(current); },
      result() { return { sent, spoken, canceled }; },
      rejectSend() { sendFailure = true; },
      delaySend() { sendPending = true; },
      resolveSend() { finishSend?.(); },
      remoteOnly() { local = false; },
      rejectSpeech() { failSpeech = true; },
    } });
  }, { initial: snapshot, speech });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
  await page.getByTestId("chat-home").waitFor();
  return page;
}

type Harness = { update(patch: Partial<AppSnapshot>): void; result(): { sent: string[]; spoken: { text: string; voice?: string }[]; canceled: number }; rejectSend(): void; delaySend(): void; resolveSend(): void; remoteOnly(): void; rejectSpeech(): void };
async function update(page: Page, patch: Partial<AppSnapshot>) {
  await page.evaluate((patch) => (window as unknown as { wowFixture: Harness }).wowFixture.update(patch), patch);
}
async function result(page: Page) {
  return page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.result());
}

const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
const results: string[] = [];
let failures = 0;
async function check(name: string, run: (page: Page) => Promise<void>, speech = true) {
  if (process.env.WOW_CASE && !name.includes(process.env.WOW_CASE)) return;
  const page = await fixture(browser, speech);
  try { await run(page); results.push(`PASS ${name}`); }
  catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("batch6 Up recalls only the latest user request without sending", async (page) => {
    const latest = "Keep this exact request\nwith two lines";
    await update(page, { messages: [...snapshot.messages, { id: "latest-user", role: "user", content: latest, createdAt: 3 }, { id: "latest-answer", role: "assistant", content: "An answer must not become the draft", createdAt: 4 }] });
    const hintCount = await page.getByText("Up arrow to edit your last request", { exact: true }).count();
    const input = page.getByTestId("chat-input"); await input.focus(); await page.keyboard.press("ArrowUp");
    assert.equal(await input.inputValue(), latest);
    assert.equal(hintCount, 1);
    assert.deepEqual((await result(page)).sent, []);
    assert.equal(await page.getByText("Up arrow to edit your last request", { exact: true }).count(), 0);
  });
  for (const draft of ["My own draft", " ", "First line\nSecond line"]) {
    await check(`batch6 Up preserves existing draft ${JSON.stringify(draft)}`, async (page) => {
      const input = page.getByTestId("chat-input"); await input.fill(draft); await input.press("ArrowUp");
      assert.equal(await input.inputValue(), draft); assert.deepEqual((await result(page)).sent, []);
    });
  }
  await check("batch6 Up does not intercept modifiers composition or repeats", async (page) => {
    const input = page.getByTestId("chat-input");
    for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
      const prevented = await input.evaluate((element, options) => {
        const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true, ...options });
        element.dispatchEvent(event); return event.defaultPrevented;
      }, options);
      assert.equal(prevented, false); assert.equal(await input.inputValue(), "");
    }
    assert.deepEqual((await result(page)).sent, []);
  });
  for (const state of ["running", "approval", "sending", "signed out", "no user"] as const) {
    await check(`batch6 Up stays inactive while ${state}`, async (page) => {
      if (state === "running") await update(page, { running: true });
      if (state === "approval") await update(page, { pendingApproval: { action: { id: "recall-pending", kind: "ui_click", payload: "sample", userRequest: "sample" }, decision: { actionId: "recall-pending", kind: "ask", tier: 2, plainEnglish: "Review", details: "Sample", matchedRules: [], undoable: false } } });
      if (state === "sending") { await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.delaySend()); await page.getByTestId("chat-input").fill("Pending send"); await page.getByTestId("chat-send").click(); }
      if (state === "signed out") await update(page, { auth: { state: "signed_out" } });
      if (state === "no user") await update(page, { messages: [snapshot.messages[1]] });
      const input = page.getByTestId("chat-input"); await input.focus(); await page.keyboard.press("ArrowUp");
      assert.equal(await input.inputValue(), "");
      assert.equal(await page.getByText("Up arrow to edit your last request", { exact: true }).count(), 0);
      assert.equal((await result(page)).sent.length, state === "sending" ? 1 : 0);
    });
  }
  await check("timeline belongs to the latest answer and reports actual status", async (page) => {
    const answer = page.getByTestId("assistant-reply").last();
    await answer.getByRole("region", { name: "Steps for this turn" }).waitFor();
    assert.match(await answer.innerText(), /Look at the sample folder[\s\S]*Done/);
    await update(page, { plan: [{ id: "look", label: "Look at the sample folder", status: "failed" }] });
    await answer.getByText("Could not finish", { exact: true }).waitFor();
  });
  await check("plan appears while waiting for the first assistant answer", async (page) => {
    await update(page, { messages: [snapshot.messages[0]], running: true });
    await page.locator('[aria-label="Conversation"]').getByRole("region", { name: "Steps for this turn" }).waitFor();
  });
  await check("elapsed time appears after ten seconds outside the live announcement", async (page) => {
    await page.clock.install();
    await update(page, { running: true });
    await page.getByTestId("follow-up-chip").first().waitFor({ state: "hidden" });
    await page.clock.fastForward(11000);
    const elapsed = page.getByTestId("working-elapsed");
    await elapsed.waitFor();
    assert.match(await elapsed.innerText(), /Still working.*11\s*s/);
    assert.equal(await elapsed.evaluate((el) => el.closest('[role="status"], [aria-live="polite"]') !== null), false);
    await update(page, { running: false });
    await elapsed.waitFor({ state: "hidden" });
  });
  await check("read aloud uses the selected answer and a local voice then stops", async (page) => {
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    assert.deepEqual((await result(page)).spoken, [{ text: snapshot.messages[1].content, voice: "Local sample" }]);
    await page.getByRole("button", { name: "Stop reading", exact: true }).click();
    assert((await result(page)).canceled >= 2);
    await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
  });
  await check("Stop snapshot cancels reading", async (page) => {
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    const before = (await result(page)).canceled;
    await update(page, { stopped: true });
    await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    assert((await result(page)).canceled > before);
  });
  await check("missing speech support explains why reading is unavailable", async (page) => {
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    await page.getByText("Read aloud is unavailable on this device.", { exact: true }).waitFor();
    assert.equal((await result(page)).spoken.length, 0);
  }, false);
  await check("simpler sends selected answer exactly once while pending", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.delaySend());
    await page.getByRole("button", { name: "Say it simpler", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Say it simpler", exact: true }).isDisabled(), true);
    assert.equal((await result(page)).sent.length, 1);
    assert((await result(page)).sent[0].includes(snapshot.messages[1].content));
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.resolveSend());
  });
  await check("follow-up errors are visible and allow retry", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.rejectSend());
    await page.getByRole("button", { name: "Say it simpler", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Could not send that message" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Say it simpler", exact: true }).isDisabled(), false);
  });
  await check("simpler is disabled while running or signed out", async (page) => {
    await update(page, { running: true });
    assert.equal(await page.getByRole("button", { name: "Say it simpler", exact: true }).isDisabled(), true);
    await update(page, { running: false, auth: { state: "signed_out" } });
    assert.equal(await page.getByRole("button", { name: "Say it simpler", exact: true }).isDisabled(), true);
    assert.equal((await result(page)).sent.length, 0);
  });
  await check("context follow-ups fill the composer without sending", async (page) => {
    const chips = page.getByTestId("follow-up-chip");
    assert((await chips.count()) >= 2 && (await chips.count()) <= 3);
    await page.getByRole("button", { name: "Explain the latest activity", exact: true }).click();
    assert((await page.getByTestId("chat-input").inputValue()).includes(snapshot.activity[0].summary));
    assert.equal((await result(page)).sent.length, 0);
    await update(page, { running: true });
    assert.equal(await chips.count(), 0);
  });
  await check("latest activity uses host newest-first ordering", async (page) => {
    await update(page, { activity: [{ id: "latest", at: 3, summary: "Latest sample change", undoable: false }, ...snapshot.activity] });
    await page.getByRole("button", { name: "Explain the latest activity", exact: true }).click();
    assert((await page.getByTestId("chat-input").inputValue()).includes("Latest sample change"));
  });
  await check("Stop click cancels speech before the host responds", async (page) => {
    await update(page, { running: true });
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    const before = (await result(page)).canceled;
    await page.getByTestId("stop-button").click();
    await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
    assert((await result(page)).canceled > before);
  });
  await check("unmounting the answer stops speech", async (page) => {
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    const before = (await result(page)).canceled;
    await update(page, { messages: [] });
    await page.getByTestId("assistant-reply").waitFor({ state: "hidden" });
    assert((await result(page)).canceled > before);
  });
  await check("a new reading replaces the old one", async (page) => {
    await update(page, { messages: [...snapshot.messages, { id: "answer2", role: "assistant", content: "Second sample reply", createdAt: 3 }] });
    await page.getByRole("button", { name: "Read aloud", exact: true }).first().click();
    await page.getByRole("button", { name: "Read aloud", exact: true }).last().click();
    assert.equal(await page.getByRole("button", { name: "Stop reading", exact: true }).count(), 1);
    assert.equal((await result(page)).spoken.at(-1)?.text, "Second sample reply");
  });
  await check("remote-only voices never receive answer text", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.remoteOnly());
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    await page.getByText("Read aloud is unavailable on this device.", { exact: true }).waitFor();
    assert.equal((await result(page)).spoken.length, 0);
  });
  await check("speech errors are visible and retryable", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.rejectSpeech());
    await page.getByRole("button", { name: "Read aloud", exact: true }).click();
    await page.getByText("Could not read this aloud. Try again.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Read aloud", exact: true }).waitFor();
  });
  await check("sending clears the composer before a long host turn ends", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.delaySend());
    await page.getByTestId("chat-input").fill("Synthetic pending message");
    await page.getByTestId("chat-send").click();
    assert.equal(await page.getByTestId("chat-input").inputValue(), "");
    await page.getByTestId("chat-input").fill("My next draft");
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.resolveSend());
    assert.equal(await page.getByTestId("chat-input").inputValue(), "My next draft");
  });
  await check("failed message restores the unsent draft", async (page) => {
    await page.evaluate(() => (window as unknown as { wowFixture: Harness }).wowFixture.rejectSend());
    await page.getByTestId("chat-input").fill("Synthetic rejected message");
    await page.getByTestId("chat-send").click();
    await page.getByRole("alert").filter({ hasText: "Could not send that message" }).waitFor();
    assert.equal(await page.getByTestId("chat-input").inputValue(), "Synthetic rejected message");
  });
  await check("mobile progress and reply controls fit the viewport", async (page) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, "Reply tools and timeline must not widen the viewport");
    await mkdir("artifacts/screenshots", { recursive: true });
    await page.screenshot({ path: "artifacts/screenshots/chat-wow-mobile.png" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: "artifacts/screenshots/chat-wow-desktop.png" });
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/chat-wow-${process.env.LALIME_EVIDENCE ?? "result"}.txt`,
  `Command: LALIME_URL=${BASE} LALIME_BROWSER_CHANNEL=msedge node scripts/ui-chat-wow.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n\n")}\n\nExact source:\n${await readFile("scripts/ui-chat-wow.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n\n"));
