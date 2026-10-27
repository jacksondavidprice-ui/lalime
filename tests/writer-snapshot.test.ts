import { describe, expect, it } from "vitest";
import type { AppSnapshot } from "../shared/types.js";

describe("AppSnapshot writer field", () => {
  it("never carries raw provider credentials", () => {
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
      writer: { enabled: true, providerId: "openai", model: "gpt-test" },
    };
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/sk-/);
    expect(snap.writer.model).toBe("gpt-test");
    expect(Object.keys(snap.writer).sort()).toEqual(
      ["enabled", "model", "providerId"].sort(),
    );
  });
});
