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
  /** True when justification came only from screen/web/file content. */
  fromUntrustedContent?: boolean;
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

export type ApprovalChoice = "do_it" | "not_now" | "allow_for_task";

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
}

export interface PendingApproval {
  decision: GuardianDecision;
  action: ProposedAction;
  /** Optional Deliberate gloss — never changes the Guardian decision. */
  whatHappens?: string;
  undoNote?: string;
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
  | { state: "demo" }
  | { state: "signed_in"; email?: string; method: "chatgpt" | "api_key" }
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
