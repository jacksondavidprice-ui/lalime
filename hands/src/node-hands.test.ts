import { describe, expect, it } from "vitest";
import { NodeHands } from "./node-hands.js";

describe("NodeHands", () => {
  it("prechecks block encoded PowerShell", async () => {
    const h = new NodeHands();
    const r = await h.precheckPowerShell("powershell -EncodedCommand SQBFAFgA");
    expect(r.blocked).toBe(true);
  });

  it("does not journal a missing recycle target", async () => {
    const h = new NodeHands();
    const r = await h.moveToRecycleBin(["/tmp/does-not-exist-lalime"], "test");
    expect(r.ok).toBe(false);
    expect(r.journalId).toBeUndefined();
    expect(h.listJournal()).toEqual([]);
  });
});
