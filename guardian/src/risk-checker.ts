/**
 * Command / action risk checker.
 *
 * Pipeline (fail closed):
 *  1. Never-list → block
 *  2. Untrusted-content-only justification → block
 *  3. Default tier for action kind
 *  4. Ask-rules may raise tier
 *  5. Optional AI reviewer may raise tier / flip intent (never lower)
 *
 * JACKSON: Own the deterministic parts (steps 1–4). The reviewer adapter is
 * allowed to be AI-assisted scaffolding.
 */

import type {
  GuardianDecision,
  GuardianDecisionKind,
  ProposedAction,
  RiskTier,
} from "../../shared/types.js";
import { ASK_RULES } from "./ask-rules.js";
import { NEVER_RULES } from "./never-list.js";
import {
  collapsePolicyTokens,
  deobfuscateLite,
  normalizeActionText,
} from "./normalize.js";
import { defaultTierForKind } from "./tiers.js";
import {
  riskLevelToTier,
  tierToDecisionKind,
  type ReviewerInput,
  type ReviewerResult,
} from "./types.js";

export type ReviewerFn = (input: ReviewerInput) => Promise<ReviewerResult | null>;

export interface EvaluateOptions {
  /** Optional L2 reviewer. May only make the decision stricter. */
  reviewer?: ReviewerFn;
  /** Session allow-list of rule ids the user approved "for this task". */
  sessionAllowRuleIds?: Set<string>;
}

const NOT_UNDOABLE_RULE_IDS = new Set([
  "ask.permanent.delete",
  "ask.permanent.delete.file",
  "ask.print.spool.clear",
  "ask.recycle.bin.empty",
  "ask.ui.consequential",
  "ask.ui.type.into.shell",
  "ask.ui.security.window",
  "ask.defender.change",
]);

function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return (a > b ? a : b) as RiskTier;
}

function kindApplies(
  kinds: ProposedAction["kind"][] | "*" | undefined,
  kind: ProposedAction["kind"],
): boolean {
  if (!kinds || kinds === "*") return true;
  return kinds.includes(kind);
}

function fillTemplate(template: string, action: ProposedAction): string {
  return template
    .replace("{summary}", action.summary ?? "make a change")
    .replace("{payload}", action.payload.slice(0, 120));
}

/**
 * Pure synchronous evaluation (no reviewer). Prefer this in unit tests.
 */
export function evaluateActionSync(
  action: ProposedAction,
  options: Omit<EvaluateOptions, "reviewer"> = {},
): GuardianDecision {
  const text = normalizeActionText(action);
  const textDeob = deobfuscateLite(text);
  const textDeobBody = deobfuscateLite(text, { prefix: false });
  const textUnquoted = text.replace(/[`'""'']/g, "");
  const textCollapsed = collapsePolicyTokens(`${text}\n${textDeob}`);
  const matchedRules: string[] = [];

  for (const rule of NEVER_RULES) {
    if (!kindApplies(rule.kinds, action.kind)) continue;
    const hit = rule.patterns.some(
      (p) =>
        p.test(text) ||
        p.test(textDeob) ||
        p.test(textUnquoted) ||
        // Obfuscation-proof: collapsed token contains the pattern's letters
        (typeof p.source === "string" &&
          collapsePolicyTokens(p.source.replace(/\\[bswd]|[^a-z0-9]+/gi, "")).length >= 6 &&
          textCollapsed.includes(
            collapsePolicyTokens(p.source.replace(/\\[bswd]|[^a-z0-9]+/gi, "")),
          )),
    );
    if (hit) {
      matchedRules.push(rule.id);
      return {
        actionId: action.id,
        kind: "block",
        tier: 4,
        plainEnglish: rule.plainEnglish,
        details: action.payload,
        matchedRules,
        undoable: false,
      };
    }
  }

  if (action.fromUntrustedContent) {
    matchedRules.push("policy.untrusted_content");
    return {
      actionId: action.id,
      kind: "block",
      tier: 4,
      plainEnglish:
        "Lalime will not follow instructions that came from a web page, file, or screen text. Only what you type counts.",
      details: action.payload,
      matchedRules,
      undoable: false,
    };
  }

  let tier = defaultTierForKind(action.kind);
  let plainEnglish =
    action.summary ??
    `Lalime wants to run a ${action.kind.replaceAll("_", " ")} step.`;
  // Jackson, Oct 26: a delete is undoable only when it goes to the Recycle
  // Bin. Permanent deletes and emptying the bin are never undoable.
  let undoable = tier >= 2 && action.kind !== "file_delete";
  let decisionHint: GuardianDecisionKind | null = null;

  for (const rule of ASK_RULES) {
    if (!kindApplies(rule.kinds, action.kind)) continue;
    const deob = rule.commandTextOnly ? textDeobBody : textDeob;
    const hit = rule.patterns.some((p) => p.test(text) || p.test(deob));
    if (!hit) continue;
    matchedRules.push(rule.id);
    if (options.sessionAllowRuleIds?.has(rule.id) && rule.tier <= 2) {
      continue;
    }
    tier = maxTier(tier, rule.tier);
    plainEnglish = fillTemplate(rule.plainEnglishTemplate, action);
    if (rule.undoable !== undefined) undoable = rule.undoable;
  }
  if (matchedRules.some((id) => NOT_UNDOABLE_RULE_IDS.has(id))) undoable = false;

  // Tier 4 defaults (boot/platform) — explain only
  if (
    /\bbcdedit\b/i.test(text) ||
    /\bfirmware\b/i.test(text) ||
    /\bbios\b/i.test(text)
  ) {
    matchedRules.push("tier.platform.explain");
    tier = 4;
    decisionHint = "explain_only";
    plainEnglish =
      "This touches startup or firmware settings. Lalime will explain how you can do it yourself instead of doing it automatically.";
  }

  const kind = decisionHint ?? tierToDecisionKind(tier);

  return {
    actionId: action.id,
    kind,
    tier,
    plainEnglish,
    details: action.payload,
    matchedRules,
    undoable: undoable && kind !== "block" && kind !== "explain_only",
  };
}

/**
 * Full evaluation including optional AI reviewer (L2).
 * Reviewer can only raise severity or flip intent → block.
 */
export async function evaluateAction(
  action: ProposedAction,
  options: EvaluateOptions = {},
): Promise<GuardianDecision> {
  const base = evaluateActionSync(action, options);
  if (base.kind === "block" || base.kind === "explain_only") {
    return base;
  }

  if (!options.reviewer) {
    return base;
  }

  const review = await options.reviewer({
    userRequest: action.userRequest,
    proposedPayload: action.payload,
    summary: action.summary,
    deterministicTier: base.tier,
    fromUntrustedContent: action.fromUntrustedContent,
  });

  if (!review) {
    return base;
  }

  if (!review.matchesUserIntent) {
    return {
      ...base,
      kind: "block",
      tier: maxTier(base.tier, 3),
      plainEnglish:
        review.plainEnglish ||
        "This step does not match what you asked for, so Lalime stopped.",
      matchedRules: [...base.matchedRules, "reviewer.intent_mismatch"],
      reviewerNote: review.plainEnglish,
      undoable: false,
    };
  }

  const raised = riskLevelToTier(review.risk);
  if (raised <= base.tier) {
    return {
      ...base,
      reviewerNote: review.plainEnglish,
    };
  }

  const tier = raised as RiskTier;
  const kind = tierToDecisionKind(tier);
  return {
    ...base,
    tier,
    kind,
    plainEnglish: review.plainEnglish || base.plainEnglish,
    matchedRules: [...base.matchedRules, "reviewer.raised_risk"],
    reviewerNote: review.plainEnglish,
    undoable: base.undoable && kind !== "block" && kind !== "explain_only",
  };
}

/**
 * Deterministic stand-in for the AI reviewer used in demo mode and tests.
 * It never softens a decision; it only flags obvious intent mismatches.
 */
export function demoReviewer(input: ReviewerInput): Promise<ReviewerResult | null> {
  const request = input.userRequest.toLowerCase();
  const payload = input.proposedPayload.toLowerCase();

  const dangerousDespiteBenignRequest =
    (request.includes("wifi") ||
      request.includes("wi-fi") ||
      request.includes("downloads") ||
      request.includes("night light") ||
      request.includes("text bigger")) &&
    (payload.includes("system32") ||
      payload.includes("format ") ||
      payload.includes("mimikatz") ||
      payload.includes("-encodedcommand"));

  if (dangerousDespiteBenignRequest || input.fromUntrustedContent) {
    return Promise.resolve({
      risk: "high",
      matchesUserIntent: false,
      plainEnglish:
        "This step does not match what you asked for, so Lalime stopped.",
    });
  }

  if (input.deterministicTier >= 3) {
    return Promise.resolve({
      risk: "high",
      matchesUserIntent: true,
      plainEnglish: input.summary ?? "This is a serious change and needs your OK.",
    });
  }

  if (input.deterministicTier >= 2) {
    return Promise.resolve({
      risk: "med",
      matchesUserIntent: true,
      plainEnglish: input.summary ?? "Please confirm this change.",
    });
  }

  return Promise.resolve({
    risk: "low",
    matchesUserIntent: true,
    plainEnglish: "Looks consistent with your request.",
  });
}
