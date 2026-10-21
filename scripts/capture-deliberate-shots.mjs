/**
 * Capture chat reply + Settings Anthropic key field screenshots for Deliberate deliverable.
 * Uses VITE_LALIME_DEMO fixtures (dev only).
 */
import { chromium } from "playwright";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43123";
const OUT = path.resolve("artifacts/screenshots");
const ARTIFACTS = "/opt/cursor/artifacts/screenshots";

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
  try {
    await mkdir(ARTIFACTS, { recursive: true });
    await copyFile(file, path.join(ARTIFACTS, `${name}.png`));
  } catch (err) {
    console.warn("artifact copy skipped", err.message);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });

  await page.goto(`${BASE}/?demo=1`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const mod = await import("/src/lib/bridge.ts");
    const api = mod.getApi();
    await api.signInDemo();
    await api.completeOnboarding();
  });
  await page.getByTestId("chat-home").waitFor();

  // Produce a chat reply via the Downloads fixture.
  await page.getByTestId("suggestion-chip").filter({ hasText: "Downloads" }).click();
  await page.getByTestId("chat-send").click();
  await page.getByTestId("approval-card").waitFor({ timeout: 15000 });
  await page.getByTestId("approval-do-it").click();
  await page.getByTestId("assistant-reply").last().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, "deliberate-chat-reply");

  // Settings → Better writing key field
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-writer").waitFor();
  await page.getByTestId("settings-anthropic-key").fill("sk-ant-…paste-your-key-here");
  await page.waitForTimeout(300);
  await shot(page, "deliberate-settings-writer-key");

  await browser.close();
  console.log("deliberate screenshots complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
