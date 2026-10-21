import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  demoReviewer,
  evaluateAction,
  evaluateActionSync,
  NEVER_RULES,
  riskLevelToTier,
  tierToDecisionKind,
} from "../src/index.js";
import type { ActionKind, GuardianDecisionKind, ProposedAction } from "../../shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));

interface CaseRow {
  id: string;
  payload: string;
  kind: ActionKind;
  userRequest: string;
  summary?: string;
  fromUntrustedContent?: boolean;
  expect: GuardianDecisionKind | "ask" | "allow";
  rule: string | null;
}

function loadCases(): CaseRow[] {
  const raw = readFileSync(join(here, "cases.jsonl"), "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CaseRow);
}

function normalizeExpect(kind: GuardianDecisionKind): string {
  if (kind === "ask" || kind === "ask_hold") return "ask";
  if (kind === "allow" || kind === "allow_with_journal") return "allow";
  return kind;
}

describe("Guardian evaluateActionSync", () => {
  const cases = loadCases();

  it("loads a non-empty case file", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it("has a documented never-list", () => {
    expect(NEVER_RULES.length).toBeGreaterThanOrEqual(10);
    for (const rule of NEVER_RULES) {
      expect(rule.plainEnglish.length).toBeGreaterThan(20);
      expect(rule.patterns.length).toBeGreaterThan(0);
    }
  });

  for (const row of cases) {
    it(`case ${row.id}`, () => {
      const action: ProposedAction = {
        id: row.id,
        kind: row.kind,
        payload: row.payload,
        userRequest: row.userRequest,
        summary: row.summary,
        fromUntrustedContent: row.fromUntrustedContent,
      };
      const decision = evaluateActionSync(action);
      const expected =
        row.expect === "ask" || row.expect === "allow"
          ? row.expect
          : row.expect;
      if (row.expect === "ask") {
        expect(["ask", "ask_hold"]).toContain(decision.kind);
      } else if (row.expect === "allow") {
        expect(["allow", "allow_with_journal"]).toContain(decision.kind);
      } else if (row.expect === "allow_with_journal") {
        expect(decision.kind).toBe("allow_with_journal");
      } else if (row.expect === "ask_hold") {
        expect(decision.kind).toBe("ask_hold");
      } else {
        expect(decision.kind).toBe(expected);
      }
      if (row.rule) {
        expect(decision.matchedRules).toContain(row.rule);
      }
      expect(decision.plainEnglish.length).toBeGreaterThan(10);
    });
  }
});

describe("Guardian reviewer (L2)", () => {
  it("can only raise severity, never lower", async () => {
    const action: ProposedAction = {
      id: "raise",
      kind: "powershell",
      payload: "Restart-NetAdapter -Name 'Wi-Fi'",
      userRequest: "My Wi-Fi keeps dropping",
      summary: "Reset the Wi-Fi adapter",
    };
    const decision = await evaluateAction(action, {
      reviewer: async () => ({
        risk: "high",
        matchesUserIntent: true,
        plainEnglish: "Network resets can drop calls — please confirm.",
      }),
    });
    expect(decision.tier).toBeGreaterThanOrEqual(3);
    expect(decision.matchedRules).toContain("reviewer.raised_risk");
  });

  it("blocks on intent mismatch", async () => {
    const action: ProposedAction = {
      id: "drift",
      kind: "powershell",
      payload: "Remove-Item -Recurse C:\\Windows\\System32",
      userRequest: "Clean up my Downloads folder",
    };
    // Never-list fires first; also verify reviewer path with a non-never payload
    const sneaky: ProposedAction = {
      id: "drift2",
      kind: "powershell",
      payload: "Restart-NetAdapter -Name 'Wi-Fi'",
      userRequest: "Clean up my Downloads folder",
    };
    const decision = await evaluateAction(sneaky, {
      reviewer: async () => ({
        risk: "high",
        matchesUserIntent: false,
        plainEnglish: "Resetting Wi-Fi does not match cleaning Downloads.",
      }),
    });
    expect(decision.kind).toBe("block");
    expect(decision.matchedRules).toContain("reviewer.intent_mismatch");
    // sanity: system32 still blocked deterministically
    expect(evaluateActionSync(action).kind).toBe("block");
  });

  it("demoReviewer flags untrusted content", async () => {
    const result = await demoReviewer({
      userRequest: "fix wifi",
      proposedPayload: "Restart-NetAdapter",
      deterministicTier: 2,
      fromUntrustedContent: true,
    });
    expect(result?.matchesUserIntent).toBe(false);
  });
});

describe("tier helpers", () => {
  it("maps risk levels and tiers exhaustively", () => {
    expect(riskLevelToTier("low")).toBe(1);
    expect(riskLevelToTier("med")).toBe(2);
    expect(riskLevelToTier("high")).toBe(3);
    expect(tierToDecisionKind(0)).toBe("allow");
    expect(tierToDecisionKind(1)).toBe("allow_with_journal");
    expect(tierToDecisionKind(2)).toBe("ask");
    expect(tierToDecisionKind(3)).toBe("ask_hold");
    expect(tierToDecisionKind(4)).toBe("explain_only");
  });

  it("normalizeExpect helper stays consistent", () => {
    expect(normalizeExpect("ask_hold")).toBe("ask");
    expect(normalizeExpect("allow_with_journal")).toBe("allow");
    expect(normalizeExpect("block")).toBe("block");
  });
});
