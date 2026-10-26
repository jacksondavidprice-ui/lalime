/** Source-server checks for the explicitly gated development mock. No real action runs. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.LALIME_URL ?? "http://127.0.0.1:43125";
const browser = await chromium.launch({ headless: true, channel: process.env.LALIME_BROWSER_CHANNEL ?? "msedge" });
const results: string[] = [];
let failures = 0;
try {
  for (const test of ["wrong", "missing", "matching", "stale", "one waiter"] as const) {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/?demo=1`, { waitUntil: "networkidle" });
      const result = await page.evaluate(async (testName) => {
        // These imports require Vite source serving; a production renderer disables this mock.
        const bridgePath = "/src/lib/bridge.ts";
        const { getApi } = await import(bridgePath);
        const api = getApi();
        let snapshot = await api.getSnapshot();
        api.subscribe((next: typeof snapshot) => { snapshot = next; });
        const engine = { ...api, getSnapshot: () => snapshot };
        const waitFor = async (predicate: () => boolean) => {
          const deadline = performance.now() + 6000;
          while (!predicate()) {
            if (performance.now() > deadline) throw new Error("Development approval did not arrive");
            await new Promise(resolve => setTimeout(resolve, 20));
          }
        };
        let firstDone = false;
        void engine.runDemoScenario("wifi_fix").then(() => { firstDone = true; });
        await waitFor(() => !!api.getSnapshot && !!engine.getSnapshot().pendingApproval);
        const firstId = engine.getSnapshot().pendingApproval.action.id;
        let reply;
        if (testName === "wrong" || testName === "missing" || testName === "matching") {
          reply = await api.respondApproval("not_now", testName === "wrong" ? "wrong-id" : testName === "missing" ? undefined : firstId);
          await new Promise(resolve => setTimeout(resolve, 30));
          return { reply, firstDone, pendingId: engine.getSnapshot().pendingApproval?.action.id, firstId };
        }
        if (testName === "stale") {
          engine.stop();
          await waitFor(() => firstDone);
          void engine.runDemoScenario("wifi_fix");
          await waitFor(() => !!engine.getSnapshot().pendingApproval);
          const nextId = engine.getSnapshot().pendingApproval.action.id;
          reply = await api.respondApproval("not_now", firstId);
          await new Promise(resolve => setTimeout(resolve, 30));
          return { reply, nextId, pendingId: engine.getSnapshot().pendingApproval?.action.id };
        }
        let secondDone = false;
        void engine.runDemoScenario("wifi_fix").then(() => { secondDone = true; });
        await waitFor(() => !!engine.getSnapshot().pendingApproval && engine.getSnapshot().pendingApproval.action.id !== firstId);
        const secondId = engine.getSnapshot().pendingApproval.action.id;
        reply = await api.respondApproval("not_now", secondId);
        await waitFor(() => secondDone);
        return { reply, firstDone, secondDone };
      }, test);
      if (test === "matching") { assert.equal(result.reply, true); assert.equal(result.firstDone, true); assert.equal(result.pendingId, undefined); }
      else if (test === "one waiter") { assert.equal(result.firstDone, false, "Reply must not resolve another action waiter"); assert.equal(result.secondDone, true); assert.equal(result.reply, true); }
      else { assert.equal(result.pendingId, test === "stale" ? result.nextId : result.firstId, "Invalid ID must keep the displayed action pending"); if (test !== "stale") assert.equal(result.firstDone, false); assert.equal(result.reply, false); }
      results.push(`PASS ${test}`);
    } catch (error) { failures++; results.push(`FAIL ${test}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { await page.close(); }
    console.log(results.at(-1));
  }
} finally { await browser.close(); }
await mkdir("artifacts", { recursive: true });
await writeFile(`artifacts/ui-demo-approval-${process.env.LALIME_EVIDENCE ?? "result"}.txt`,
  `Source-only command: LALIME_URL=${base} LALIME_BROWSER_CHANNEL=msedge node scripts/ui-demo-approval-regressions.ts\nExit: ${failures ? 1 : 0}\n${results.join("\n")}\n\nExact test source:\n${await readFile("scripts/ui-demo-approval-regressions.ts", "utf8")}`);
assert.equal(failures, 0, results.join("\n"));
