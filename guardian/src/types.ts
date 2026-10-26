/**
 * Guardian types — keep this module free of Electron/UI imports.
 * Jackson owns the policy logic; see docs/JACKSON_TODO.md.
 */

import type {
  ActionKind,
  GuardianDecisionKind,
  RiskTier,
} from "../../shared/types.js";

export type {
  ActionKind,
  GuardianDecision,
  GuardianDecisionKind,
  ProposedAction,
  RiskTier,
} from "../../shared/types.js";

export interface TierRule {
  id: string;
  tier: RiskTier;
  description: string;
  /** Which action kinds this rule can apply to. */
  kinds: ActionKind[] | "*";
}

export interface NeverRule {
  id: string;
  description: string;
  /** Plain English shown when this rule blocks. */
  plainEnglish: string;
  /**
   * Match against the normalized payload (and joined paths).
   * Prefer specific patterns; obfuscation variants are listed separately.
   */
  patterns: RegExp[];
  kinds?: ActionKind[] | "*";
}

export interface AskRule {
  id: string;
  tier: RiskTier;
  description: string;
  plainEnglishTemplate: string;
  patterns: RegExp[];
  kinds?: ActionKind[] | "*";
  undoable?: boolean;
  /** Skip the canonical words Guardian prepends while de-obfuscating, so a
   * delete named only in a comment or string does not count as a command. */
  commandTextOnly?: boolean;
}

export interface ReviewerInput {
  userRequest: string;
  proposedPayload: string;
  summary?: string;
  deterministicTier: RiskTier;
  fromUntrustedContent?: boolean;
}

export interface ReviewerResult {
  /** Reviewer-assessed risk; Guardian will take max(deterministic, this). */
  risk: "low" | "med" | "high";
  matchesUserIntent: boolean;
  plainEnglish: string;
}

export type RiskLevel = "low" | "med" | "high";

export function riskLevelToTier(level: RiskLevel): RiskTier {
  switch (level) {
    case "low":
      return 1;
    case "med":
      return 2;
    case "high":
      return 3;
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

export function tierToDecisionKind(tier: RiskTier): GuardianDecisionKind {
  switch (tier) {
    case 0:
      return "allow";
    case 1:
      return "allow_with_journal";
    case 2:
      return "ask";
    case 3:
      return "ask_hold";
    case 4:
      return "explain_only";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
