/** Boot UI checks use a deferred host snapshot and execute no native actions. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";

const base = process.env.LALIME_URL ?? "http://127.0.0.1:43125";

async function fixture(browser: Browser, reducedMotion: "reduce" | "no-preference"): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion });
  page.setDefaultTimeout(5000);
  await page.addInitScript(() => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    Object.defineProperty(window, "lalime", { value: {
      getSnapshot: () => pending,
      subscribe: () => () => {},
    } });
    Object.defineProperty(window, "releaseBoot", { value: () => release({
      mode: "live", auth: { state: "signed_out" }, onboardingComplete: false,
      messages: [], plan: [], activity: [], pendingApproval: null, blockedNotice: null,
      running: false, stopped: false, statusText: "Ready", hands: { backend: "node", available: true },
      writer: { enabled: false, keyHint: null },
    }) });
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.getByRole("status").waitFor();
  return page;
}

const results: string[] = [];
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL || undefined });
let failures = 0;
async function check(name: string, reducedMotion: "reduce" | "no-preference", run: (page: Page) => Promise<void>) {
  const page = await fixture(browser, reducedMotion);
  try { await run(page); results.push(`PASS ${name}`); }
  catch (error) { failures++; results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { await page.close(); }
  console.log(results.at(-1));
}
try {
  await check("loader announces progress and assembles logo from grid cells", "no-preference", async (page) => {
    assert.match(await page.getByRole("status").innerText(), /Getting things ready/i);
    const cells = page.getByTestId("boot-logo-cell");
    assert.equal(await cells.count(), 16, "Logo must assemble from a four-by-four grid");
    assert.equal(await cells.first().getAttribute("aria-hidden"), "true");
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="boot-logo-cell"]')].every((cell) => getComputedStyle(cell).opacity === "1"));
    await page.screenshot({ path: "artifacts/boot-ready.png" });
  });
  await check("reduced motion shows a complete static logo", "reduce", async (page) => {
    const cells = page.getByTestId("boot-logo-cell");
    assert.equal(await cells.count(), 16);
    const initial = await cells.evaluateAll((elements) => elements.map((element) => ({ opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform })));
    assert.ok(initial.every((style) => style.opacity === "1" && style.transform === "none"), JSON.stringify(initial));
    await page.screenshot({ path: "artifacts/boot-reduced-motion.png" });
  });
  await check("hydration replaces loader without waiting for its animation", "no-preference", async (page) => {
    const elapsed = await page.evaluate(async () => {
      const started = performance.now();
      (window as unknown as { releaseBoot(): void }).releaseBoot();
      for (let frame = 0; frame < 6; frame++) {
        await new Promise(requestAnimationFrame);
        if (!document.querySelector('[role="status"]')) return performance.now() - started;
      }
      throw new Error("Loader remained after six animation frames following hydration");
    });
    assert.ok(elapsed < 300, `Loader exit took ${elapsed}ms`);
    await page.getByRole("heading").first().waitFor();
  });
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/boot-result.txt", `${results.join("\n")}\n\nCommand: LALIME_URL=${base} LALIME_BROWSER_CHANNEL=msedge node scripts/ui-boot-regressions.ts\n\n${await readFile(new URL(import.meta.url), "utf8")}`);
process.exitCode = failures ? 1 : 0;
