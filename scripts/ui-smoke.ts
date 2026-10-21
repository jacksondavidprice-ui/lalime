/**
 * Playwright UI smoke against the running renderer (product sign-in path).
 * Expects http://127.0.0.1:43123 (vite preview or dev).
 */

import { chromium } from "playwright";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43123";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "networkidle" });

  await page.getByTestId("onboarding").waitFor({ timeout: 15000 });
  await page.getByTestId("onboarding-next").click();
  await page.waitForTimeout(200);
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("sign-in-panel").waitFor({ timeout: 10000 });
  await page.getByTestId("sign-in-chatgpt").waitFor();
  await page.getByTestId("toggle-api-key").click();
  await page.getByTestId("api-key-input").waitFor();

  // Product path must not expose a Start demo button.
  const demoCount = await page.getByTestId("start-demo").count();
  if (demoCount !== 0) {
    throw new Error("Product UI still exposes start-demo");
  }

  await browser.close();
  console.log("ui-smoke OK (sign-in onboarding)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
