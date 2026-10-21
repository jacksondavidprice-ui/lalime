/**
 * Guardian — Lalime's safety layer.
 *
 * Public API for the main process and tests. Keep UI out of this package.
 *
 * Layers:
 *  L1  Deterministic never-list + ask rules + tiers   (this package)
 *  L2  Model risk reviewer (optional; can only raise) (risk-checker)
 *  L3  Human approval cards                           (UI + IPC)
 *  L4  Undo journal                                   (Hands / main)
 *  L5  Untrusted-content tagging                      (evaluate flags)
 *
 * Contest note: Jackson should personally write or rewrite never-list.ts,
 * tiers.ts, and the sync path in risk-checker.ts. See docs/JACKSON_TODO.md.
 */

export { ASK_RULES } from "./ask-rules.js";
export {
  ALLOWED_MUTATION_ROOTS,
  NEVER_RULES,
} from "./never-list.js";
export {
  collapsePolicyTokens,
  deobfuscateLite,
  normalizeActionText,
} from "./normalize.js";
export {
  demoReviewer,
  evaluateAction,
  evaluateActionSync,
  type EvaluateOptions,
  type ReviewerFn,
} from "./risk-checker.js";
export {
  DEFAULT_ACTION_TIERS,
  TIER_LABELS,
  TIER_RULES,
  defaultTierForKind,
} from "./tiers.js";
export {
  riskLevelToTier,
  tierToDecisionKind,
  type AskRule,
  type NeverRule,
  type ReviewerInput,
  type ReviewerResult,
  type RiskLevel,
  type TierRule,
} from "./types.js";
