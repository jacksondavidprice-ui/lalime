/**
 * Risk tiers (inspired by ToMyWhim / LAPCR safety models).
 *
 * Tier 0 — read-only / observational
 * Tier 1 — session-scoped, trivially reversible
 * Tier 2 — persistent but undoable (Recycle Bin, snapshots)
 * Tier 3 — system-impacting (services, registry) — hold-to-confirm
 * Tier 4 — boot / platform — never automated; explain only
 *
 * JACKSON: You should be able to explain every tier to a judge in one sentence.
 */

import type { ActionKind, RiskTier } from "../../shared/types.js";
import type { TierRule } from "./types.js";

export const TIER_LABELS: Record<RiskTier, string> = {
  0: "Read-only",
  1: "Gentle change",
  2: "Needs your OK",
  3: "Serious change",
  4: "Not automated",
};

export const DEFAULT_ACTION_TIERS: Record<ActionKind, RiskTier> = {
  screenshot: 0,
  sysinfo: 0,
  file_read: 0,
  ui_click: 1,
  ui_type: 1,
  open_settings: 1,
  file_write: 2,
  file_move: 2,
  file_delete: 2,
  shell: 2,
  powershell: 2,
};

export const TIER_RULES: TierRule[] = [
  {
    id: "tier.readonly.tools",
    tier: 0,
    description: "Screenshots, sysinfo, and file reads stay read-only.",
    kinds: ["screenshot", "sysinfo", "file_read"],
  },
  {
    id: "tier.ui.session",
    tier: 1,
    description: "UI clicks/typing and opening Settings are session-scoped.",
    kinds: ["ui_click", "ui_type", "open_settings"],
  },
  {
    id: "tier.files.persistent",
    tier: 2,
    description: "File writes/moves/deletes need approval and journaling.",
    kinds: ["file_write", "file_move", "file_delete"],
  },
  {
    id: "tier.shell.default",
    tier: 2,
    description: "Shell and PowerShell default to ask-before-run.",
    kinds: ["shell", "powershell"],
  },
];

export function defaultTierForKind(kind: ActionKind): RiskTier {
  return DEFAULT_ACTION_TIERS[kind];
}
