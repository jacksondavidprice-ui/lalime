import { describe, expect, it } from "vitest";
import {
  applySafeLocalFixes,
  detectAiisms,
  detectEmDashes,
  detectEmptySetup,
  detectLaterTopicDump,
  lintReply,
  wordCount,
} from "./lint.js";

describe("lint", () => {
  it("flags process narration and throat-clearing", () => {
    const findings = detectAiisms("Let me explain how Wi-Fi works. Here's the thing: it resets.");
    expect(findings.some((f) => f.ruleId === "ai-process-narration")).toBe(true);
    expect(findings.some((f) => f.ruleId === "ai-throat-clearing")).toBe(true);
  });

  it("flags em dashes", () => {
    expect(detectEmDashes("Done — files moved.").length).toBe(1);
  });

  it("flags empty setup and later topic dumps", () => {
    expect(detectEmptySetup("Here's a quick overview of what happened.").length).toBe(1);
    expect(detectLaterTopicDump("All set. Additionally, we could tidy photos.").length).toBe(1);
  });

  it("combines findings and counts words", () => {
    const text = "In conclusion, the Downloads folder is tidy.";
    expect(lintReply(text).some((f) => f.ruleId === "ai-signposted-recap")).toBe(true);
    expect(wordCount(text)).toBe(7);
  });

  it("applies safe local em-dash fixes", () => {
    expect(applySafeLocalFixes("Moved three files — nothing else.")).toBe(
      "Moved three files, nothing else.",
    );
  });
});
