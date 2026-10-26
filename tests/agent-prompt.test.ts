import { describe, expect, it } from "vitest";
import {
  DEVELOPER_INSTRUCTIONS,
  LALIME_DYNAMIC_TOOLS,
  RepeatGuard,
  capListing,
  narrationStatus,
  sanitizePlan,
  settlePlan,
  toolStatus,
} from "../electron/main/agent-prompt";
import { parseBlocks, parseInline } from "../src/components/chat/rich-text";

describe("agent prompt", () => {
  it("tells the model to plan, verify, and stay honest", () => {
    expect(DEVELOPER_INSTRUCTIONS).toContain("lalime_update_plan");
    expect(DEVELOPER_INSTRUCTIONS).toMatch(/check that it worked/i);
    expect(DEVELOPER_INSTRUCTIONS).toMatch(/Never type passwords/);
  });

  it("exposes a plan tool and describes every parameter of action tools", () => {
    const names = LALIME_DYNAMIC_TOOLS.map((t) => t.name);
    expect(names[0]).toBe("lalime_update_plan");
    expect(names).toContain("lalime_click");
    const click = LALIME_DYNAMIC_TOOLS.find((t) => t.name === "lalime_click")!;
    const props = (click.inputSchema as { properties: Record<string, { description?: string }> }).properties;
    expect(props.name?.description).toBeTruthy();
    expect(props.windowTitle?.description).toBeTruthy();
  });
});

describe("plan handling", () => {
  it("sanitizes model steps", () => {
    const steps = sanitizePlan({
      steps: [
        { label: "  Open   Display settings ", status: "running" },
        { label: "", status: "pending" },
        { label: "Turn on Night light", status: "bogus" },
      ],
    });
    expect(steps).toEqual([
      { id: "step_1", label: "Open Display settings", status: "running" },
      { id: "step_2", label: "Turn on Night light", status: "pending" },
    ]);
    expect(sanitizePlan({ steps: "nope" })).toBeNull();
    expect(sanitizePlan({ steps: Array.from({ length: 20 }, (_, i) => ({ label: `s${i}`, status: "pending" })) })).toHaveLength(8);
  });

  it("never leaves a spinner on a finished, stopped, or failed turn", () => {
    const plan = sanitizePlan({
      steps: [
        { label: "a", status: "done" },
        { label: "b", status: "running" },
        { label: "c", status: "pending" },
      ],
    })!;
    expect(settlePlan(plan, "done").map((s) => s.status)).toEqual(["done", "done", "pending"]);
    expect(settlePlan(plan, "stopped").map((s) => s.status)).toEqual(["done", "skipped", "skipped"]);
    expect(settlePlan(plan, "failed").map((s) => s.status)).toEqual(["done", "failed", "skipped"]);
  });
});

describe("guards and status", () => {
  it("advises on the third consecutive identical call", () => {
    const g = new RepeatGuard();
    const args = { name: "OK", windowTitle: "Settings" };
    expect(g.check("lalime_click", args)).toBeNull();
    expect(g.check("lalime_click", args)).toBeNull();
    expect(g.check("lalime_click", args)).toMatch(/already tried/);
    expect(g.check("lalime_screenshot", {})).toBeNull();
    g.reset();
    expect(g.check("lalime_click", args)).toBeNull();
  });

  it("uses friendly status lines", () => {
    expect(toolStatus("lalime_click", { name: "Night light" })).toBe("Clicking “Night light”…");
    expect(toolStatus("lalime_screenshot", {})).toBe("Looking at your screen…");
    expect(toolStatus("whatever", {})).toBe("Working…");
  });

  it("caps listings and trims narration", () => {
    expect(capListing("x".repeat(30), 10)).toMatch(/cut short/);
    expect(narrationStatus("Opening Display settings to find Night light. Then I will check.")).toBe(
      "Opening Display settings to find Night light.",
    );
    expect(narrationStatus("ok")).toBeNull();
  });
});

describe("assistant rich text", () => {
  it("parses inline marks without producing HTML", () => {
    expect(parseInline("Click **Save**, then `Enter` or see [docs](https://example.com).")).toEqual([
      { t: "text", v: "Click " },
      { t: "strong", v: "Save" },
      { t: "text", v: ", then " },
      { t: "code", v: "Enter" },
      { t: "text", v: " or see " },
      { t: "link", v: "docs", href: "https://example.com" },
      { t: "text", v: "." },
    ]);
    expect(parseInline("[x](javascript:alert(1))").some((p) => p.t === "link")).toBe(false);
  });

  it("parses lists, headings, and code blocks", () => {
    const blocks = parseBlocks("## Done\nI did two things:\n\n- Sorted files\n- Emptied nothing\n\n1. First\n2. Second\n\n```\ncode\n```");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "code"]);
  });
});
