/** Shared types between renderer, main process, Guardian, and Hands. */

export type RiskTier = 0 | 1 | 2 | 3 | 4;

export type GuardianDecisionKind =
  | "allow"
  | "allow_with_journal"
  | "ask"
  | "ask_hold"
  | "block"
  | "explain_only";

export type ActionKind =
  | "shell"
  | "powershell"
  | "file_read"
  | "file_write"
  | "file_move"
  | "file_delete"
  | "ui_click"
  | "ui_type"
  | "open_settings"
  | "screenshot"
  | "sysinfo";

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  /** Exact command or tool payload the agent wants to run. */
  payload: string;
  /** Paths touched, when known. Absolute when possible. */
  paths?: string[];
  /** Working directory for shell/powershell. */
  cwd?: string;
  /** User's original request for this turn (for intent checks). */
  userRequest: string;
  /** Optional extra context (plan step label, etc.). */
  summary?: string;
  /** Untrusted provenance. Without a source, policy treats it as instruction-only justification. */
  fromUntrustedContent?: boolean;
  /** Set by the host after a screen read; observation requires fresh consent. */
  untrustedContentSource?: "screen_observation";
}

export interface GuardianDecision {
  actionId: string;
  kind: GuardianDecisionKind;
  tier: RiskTier;
  /** Plain-English one-liner for the approval card or block notice. */
  plainEnglish: string;
  /** Technical detail (command, paths) for the Details expander. */
  details: string;
  /** Deterministic rule ids that fired. */
  matchedRules: string[];
  /** Whether undo will be available after execution. */
  undoable: boolean;
  /** Optional AI reviewer notes (can only raise severity). */
  reviewerNote?: string;
}

export type ApprovalChoice = "do_it" | "not_now" | "allow_for_task" | "hold_confirmed";

export interface TaskGrant {
  id: string;
  kind: ActionKind;
  /** Exact approved operation and target, never a whole action category. */
  target: string;
}

export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}

export interface ActivityEntry {
  id: string;
  at: number;
  summary: string;
  details?: string;
  undoable: boolean;
  undone?: boolean;
  actionId?: string;
  /** Optional counts describe complete journal items restored, including earlier retry attempts. */
  undoResult?: ({ status: "restored" } | { status: "failed"; reason: string }) & { restored?: number; total?: number };
  /** Display-only record of consent withdrawn when Undo started. Text is escaped and capped at 4096 characters. */
  approvalWithdrawal?: {
    actionId: string;
    summary: string;
    reason: "user_undo";
    message: string;
    withdrawnCount: number;
  };
}

export interface PendingApproval {
  decision: GuardianDecision;
  action: ProposedAction;
  /** Optional Deliberate gloss — never changes the Guardian decision. */
  whatHappens?: string;
  undoNote?: string;
  /** Model-supplied claim. Display as "Assistant's explanation", not a headline. */
  assistantExplanation?: string;
  canAllowForTask?: boolean;
  /** Host reason that this action needs individual approval. */
  grantUnavailableReason?: string;
  /** True when the escaped display summary was capped at enqueue. */
  summaryTruncated?: boolean;
  /** UTF-16 length of the escaped display summary before the cap. */
  summaryFullLength?: number;
}

/** Display-only consent queue entry. It does not authorize an action. */
export interface ApprovalQueueEntry {
  readonly actionId: string;
  readonly kind: ActionKind;
  readonly summary: string;
  readonly tier: RiskTier;
  readonly canAllowForTask: boolean;
  /** Host reason that this action needs individual approval. */
  readonly grantUnavailableReason?: string;
  /** True when the escaped display summary was capped at enqueue. */
  readonly summaryTruncated?: boolean;
  /** UTF-16 length of the escaped display summary before the cap. */
  readonly summaryFullLength?: number;
}

export interface WriterStatus {
  enabled: boolean;
  keyHint: string | null;
  encryptedAtRest?: boolean;
  lastError?: string;
  model?: string;
}

export type AppMode = "demo" | "live";

export type AuthStatus =
  | { state: "signed_out" }
  | { state: "signing_in" }
  | { state: "demo" }
  | { state: "signed_in"; email?: string; method: "chatgpt" | "api_key" | "local"; providerId?: string }
  | { state: "error"; message: string };

export interface HandsStatus {
  backend: "mock" | "node" | "windows";
  available: boolean;
  /** Absolute path when known (windows backend). */
  exePath?: string;
  /** Friendly message when Hands is missing or limited. */
  message?: string;
}

export interface AppSnapshot {
  taskGrants?: TaskGrant[];
  /** Exact pending count; it can exceed the number of preview entries. */
  pendingApprovalCount?: number;
  /** First 50 pending entries in FIFO order, including the current card first. */
  approvalQueue?: readonly ApprovalQueueEntry[];
  settings?: import("./settings.js").AppSettings;
  mode: AppMode;
  auth: AuthStatus;
  onboardingComplete: boolean;
  messages: ChatMessage[];
  plan: PlanStep[];
  activity: ActivityEntry[];
  pendingApproval: PendingApproval | null;
  blockedNotice: GuardianDecision | null;
  running: boolean;
  stopped: boolean;
  statusText: string;
  hands: HandsStatus;
  writer: WriterStatus;
}
