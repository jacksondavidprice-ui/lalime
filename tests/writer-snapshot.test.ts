import { describe, expect, it } from "vitest";
import type { AppSnapshot } from "../shared/types.js";

describe("AppSnapshot writer field", () => {
  it("never carries the raw Anthropic key", () => {
    const snap: AppSnapshot = {
      mode: "live",
      auth: { state: "signed_out" },
      onboardingComplete: false,
      messages: [],
      plan: [],
      activity: [],
      pendingApproval: null,
      blockedNotice: null,
      running: false,
      stopped: false,
      statusText: "",
      hands: { backend: "node", available: true },
      writer: { enabled: true, keyHint: "…6789", encryptedAtRest: true },
    };
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/sk-ant-/);
    expect(snap.writer.keyHint).toBe("…6789");
    expect(Object.keys(snap.writer).sort()).toEqual(
      ["enabled", "encryptedAtRest", "keyHint"].sort(),
    );
  });
});
