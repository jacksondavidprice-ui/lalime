import { describe, expect, it } from "vitest";
import { buildFactsPacket, sanitizeField } from "./facts.js";

describe("facts packet", () => {
  it("sanitizes control characters and caps fields", () => {
    expect(sanitizeField("hello\u0000world")).toBe("hello world");
    expect(sanitizeField("x".repeat(600)).length).toBe(500);
  });

  it("builds a capped packet from turn evidence", () => {
    const packet = buildFactsPacket({
      userRequest: "Clean Downloads",
      outcome: "done",
      actions: Array.from({ length: 10 }, (_, i) => ({
        summary: `Action ${i}`,
        status: "done" as const,
        undoable: i === 0,
      })),
      agentConclusion: "All done.",
      blocked: [{ plainEnglish: "Blocked", tier: 4 }],
    });
    expect(packet.actions).toHaveLength(6);
    expect(packet.blocked?.[0]?.plainEnglish).toBe("Blocked");
    expect(packet.outcome).toBe("done");
  });
});
