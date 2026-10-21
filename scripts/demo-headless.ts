/**
 * Headless scripted fixture: chat → approval → execute → undo, plus a block.
 * Dev/CI only. Requires LALIME_DEMO=1 (refused otherwise).
 */

import assert from "node:assert/strict";
import { DemoEngine } from "../src/lib/demo-engine.ts";

async function waitUntil(
  engine: DemoEngine,
  pred: () => boolean,
  label: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function main(): Promise<void> {
  const flag = (process.env.LALIME_DEMO ?? "").trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    throw new Error(
      "Refusing scripted fixture without LALIME_DEMO=1 (never enabled in packaged builds).",
    );
  }

  const engine = new DemoEngine();
  engine.signInDemo();
  engine.completeOnboarding();

  const sendPromise = engine.sendMessage("My Downloads folder is a mess, clean it up.");
  await waitUntil(
    engine,
    () => engine.getSnapshot().pendingApproval !== null,
    "approval card",
  );
  const pending = engine.getSnapshot().pendingApproval;
  assert.ok(pending);
  assert.equal(pending.decision.kind, "ask");
  assert.match(pending.decision.plainEnglish, /Recycle Bin|undo/i);

  await engine.respondApproval("do_it");
  await sendPromise;
  await waitUntil(
    engine,
    () =>
      engine.getSnapshot().activity.some((a: { undoable: boolean; undone?: boolean }) => a.undoable && !a.undone),
    "activity entry",
  );

  const activityId = engine.getSnapshot().activity[0]!.id;
  await engine.undo(activityId);
  assert.equal(engine.getSnapshot().activity[0]!.undone, true);

  await engine.sendMessage("Delete everything in System32 to speed up my PC.");
  await waitUntil(
    engine,
    () => engine.getSnapshot().blockedNotice !== null,
    "blocked notice",
  );
  const blocked = engine.getSnapshot().blockedNotice!;
  assert.equal(blocked.kind, "block");
  assert.ok(blocked.matchedRules.includes("never.system32.wipe"));

  console.log("fixture-headless OK: approval → execute → undo, and System32 block");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
