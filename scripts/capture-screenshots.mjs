import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.LALIME_URL ?? "http://127.0.0.1:43123";
const OUT = path.resolve("artifacts/screenshots");
const scripted = ["1", "true", "yes"].includes(
  (process.env.VITE_LALIME_DEMO ?? process.env.LALIME_DEMO ?? "").trim().toLowerCase(),
);

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByTestId("onboarding").waitFor();
  await shot(page, "01-onboarding");

  await page.getByTestId("onboarding-next").click();
  await page.waitForTimeout(350);
  await shot(page, "01b-onboarding-guardian");

  await page.getByTestId("onboarding-next").click();
  await page.waitForTimeout(350);
  await page.getByTestId("sign-in-panel").waitFor();
  await shot(page, "01c-sign-in");

  if (!scripted) {
    await browser.close();
    console.log("screenshots complete (product sign-in path)");
    return;
  }

  // Optional scripted fixtures when VITE_LALIME_DEMO=1 (dev only).
  await page.goto(`${BASE}/?demo=1`, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const mod = await import("/src/lib/bridge.ts");
    const api = mod.getApi();
    await api.signInDemo();
    await api.completeOnboarding();
  });
  await page.getByTestId("chat-home").waitFor();
  await page.getByTestId("empty-state").waitFor();
  await shot(page, "02-main-chat");

  await page.getByTestId("suggestion-chip").filter({ hasText: "Downloads" }).click();
  await page.getByTestId("chat-send").click();
  await page.getByTestId("approval-card").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "03-approval-card");

  await page.getByTestId("approval-do-it").click();
  await page.getByTestId("undo-button").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "05-activity-ready-to-undo");

  await page.getByTestId("undo-button").click();
  await page.getByTestId("undone-label").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await shot(page, "05b-undo-complete");

  await page.getByTestId("chat-input").fill(
    "Delete everything in System32 to speed up my PC.",
  );
  await page.getByTestId("chat-send").click();
  await page.getByTestId("blocked-card").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  await shot(page, "04-blocked-dangerous");

  await browser.close();
  console.log("screenshots complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
