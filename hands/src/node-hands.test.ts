import { describe, expect, it } from "vitest";
import { NodeHands } from "./node-hands.js";

describe("NodeHands", () => {
  it("prechecks block encoded PowerShell", async () => {
    const h = new NodeHands();
    const r = await h.precheckPowerShell("powershell -EncodedCommand SQBFAFgA");
    expect(r.blocked).toBe(true);
  });

  it("journals a recycle move", async () => {
    const h = new NodeHands();
    const r = await h.moveToRecycleBin(["/tmp/does-not-exist-lalime"], "test");
    expect(r.ok).toBe(true);
    expect(r.journalId).toBeTruthy();
    const undo = await h.undo(r.journalId!);
    expect(undo.ok).toBe(true);
  });
});
