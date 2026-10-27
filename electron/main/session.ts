/**
 * Main-process session: live Codex agent (Guardian-gated).
 * Scripted scenarios exist only when isScriptedMockAllowed() (never in packaged builds).
 */

import { EventEmitter } from "node:events";
import { isNarrationOnly, plainServiceFailure } from "./provider-output.js";
import { app, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  demoReviewer,
  evaluateAction,
  evaluateActionSync,
} from "../../guardian/src/index.js";
import { createHandsClient } from "../../hands/src/create-hands.js";
import { handsMissingMessage } from "../../hands/src/hands-exe.js";
import type { HandsClient, HandsResult } from "../../hands/src/types.js";
import type { DemoScenarioId } from "../../shared/ipc.js";
import type {
  ActivityEntry,
  AppSnapshot,
  ApprovalChoice,
  ApprovalQueueEntry,
  ChatMessage,
  HandsStatus,
  PendingApproval,
  PlanStep,
  ProposedAction,
  UndoItemIssue,
} from "../../shared/types.js";
import { WriterService, buildFactsPacket, type WriterLlmOptions } from "../../writer/index.js";
import type { FactsOutcome } from "../../writer/facts.js";
import { CodexAppServerClient } from "./codex-client.js";
import { isScriptedMockAllowed } from "./dev-flags.js";
import { boundedDisplayText, LiveAgentHost } from "./live-agent.js";
import { validateSettings } from "../../shared/settings.js";
import { loadSettings, saveSettings } from "./settings-store.js";
import { ApiAgentClient } from "./api-agent-client.js";
import { checkCodexConnection } from "./connection-check.js";
import type { RepairPlan } from "../../shared/repair-plan.js";
import { getProvider, validateProviderBaseUrl } from "../../shared/providers.js";
import type { WriterStatus } from "../../shared/types.js";

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function undoIssueHint(items: UndoItemIssue[]): string {
  const first = items[0];
  const name = boundedDisplayText(first.name);
  const reason = boundedDisplayText(first.reason);
  const kept = first.recoveryPath ? " Kept in Lalime's recovery folder." : "";
  const more = items.length > 1 ? `; and ${items.length - 1} more.` : "";
  const label = name.fullLength <= 60 ? name.text : "An item";
  const hint = `${label}: ${reason.text}${kept}${more}`;
  if (hint.length <= 240 && reason.fullLength <= 4096) return hint;
  const short = `An item: ${reason.text}${kept}${more}`;
  if (short.length <= 240 && reason.fullLength <= 4096) return short;
  return `An item was not put back. Its specific reason is in the change details.${kept}${more}`;
}

export class SessionController extends EventEmitter {
  private hands: HandsClient;
  private abort = false;
  private approvalWaiters: Array<(choice: ApprovalChoice) => void> = [];
  private codex: CodexAppServerClient | null = null;
  private apiClient: ApiAgentClient | null = null;
  private generation = 0;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionAbort: AbortController | null = null;
  private connectionPending: Promise<{ ok: boolean; message?: string }> | null = null;
  private writerAbort: AbortController | null = null;
  private live: LiveAgentHost | null = null;
  private streamingMessageId: string | null = null;
  private agentConclusion = "";
  private turnUserRequest = "";
  private turnBlocked: Array<{ plainEnglish: string; tier: number }> = [];
  private turnActivity: ActivityEntry[] = [];
  private writerFetch: typeof fetch | undefined;
  private writerConfigOverride: WriterLlmOptions | null = null;
  private writerLastError: string | undefined;
  private pendingUndos = new Set<string>();

  private state: AppSnapshot = {
    settings: loadSettings(),
    mode: "live",
    auth: { state: "signed_out" },
    onboardingComplete: false,
    messages: [],
    plan: [],
    activity: [],
    taskGrants: [],
    pendingApprovalCount: 0,
    approvalQueue: [],
    pendingApproval: null,
    blockedNotice: null,
    running: false,
    stopped: false,
    statusText: "Sign in to get started",
    hands: { backend: "node", available: true },
    writer: { enabled: false, providerId: null, model: null },
  };

  constructor(hands?: HandsClient) {
    super();
    const mockAllowed = isScriptedMockAllowed({ isPackaged: appIsPackaged() });
    this.hands =
      hands ??
      createHandsClient(
        process.env.LALIME_HANDS === "mock" || mockAllowed ? "mock" : "auto",
      );
    this.state = {
      ...this.state,
      hands: this.describeHands(),
      writer: this.describeWriter(),
    };
  }

  /** Test helper: inject writer fetch transport. */
  setWriterFetch(fetchImpl: typeof fetch): void {
    this.writerFetch = fetchImpl;
  }

  /** Test helper: force a writer config without a live ApiAgentClient. */
  setWriterConfig(config: WriterLlmOptions | null): void {
    this.writerConfigOverride = config;
    this.patch({ writer: this.describeWriter() });
  }

  private resolveWriterConfig(): WriterLlmOptions | null {
    if (this.writerConfigOverride) {
      return {
        ...this.writerConfigOverride,
        fetchImpl: this.writerConfigOverride.fetchImpl ?? this.writerFetch,
      };
    }
    if (!this.apiClient) return null;
    try {
      const cfg = this.apiClient.getInferenceConfig();
      if (!cfg.model?.trim()) return null;
      const provider = getProvider(cfg.providerId);
      if (provider.requiresKey && !cfg.apiKey?.trim()) return null;
      return {
        providerId: cfg.providerId,
        model: cfg.model,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        fetchImpl: this.writerFetch,
      };
    } catch {
      return null;
    }
  }

  private describeWriter(): WriterStatus {
    const cfg = this.resolveWriterConfig();
    return {
      enabled: Boolean(cfg),
      providerId: cfg?.providerId ?? null,
      model: cfg?.model ?? null,
      ...(this.writerLastError ? { lastError: this.writerLastError } : {}),
    };
  }

  writerStatus() {
    const status = this.describeWriter();
    this.patch({ writer: status });
    return status;
  }

  private setWriterLastError(message?: string): void {
    this.writerLastError = message;
  }

  private describeHands(): HandsStatus {
    const available = this.hands.isAvailable();
    const exePath = this.hands.exePath?.();
    if (this.hands.backend === "windows" && !available) {
      return {
        backend: "windows",
        available: false,
        exePath,
        message: handsMissingMessage(exePath),
      };
    }
    return {
      backend: this.hands.backend,
      available,
      exePath,
      message:
        this.hands.backend === "windows"
          ? "Computer control is on (Hands.exe)."
          : undefined,
    };
  }

  private scriptedAllowed(): boolean {
    return isScriptedMockAllowed({ isPackaged: appIsPackaged() });
  }

  getSnapshot(): AppSnapshot {
    return structuredClone(this.state);
  }

  updateSettings(input: unknown): { ok: boolean; message?: string } {
    if (this.state.running) return { ok: false, message: "Stop the current task before changing settings." };
    try {
      const settings = validateSettings(input, this.state.settings);
      if (settings.providerId !== "chatgpt") {
        const provider = getProvider(settings.providerId);
        if (settings.baseUrl) validateProviderBaseUrl(settings.baseUrl);
        if (settings.providerId !== "custom" && settings.providerId !== "ollama" && settings.baseUrl && settings.baseUrl !== provider.baseUrl) throw new Error("Use Custom for a different provider endpoint.");
      }
      saveSettings(settings);
      this.disposeClient();
      this.patch({ settings, auth: { state: "signed_out" }, statusText: "Settings saved. Connect to start a new conversation.", messages: [], activity: [], plan: [], pendingApproval: null });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Could not save settings." };
    }
  }

  private disposeClient(): void {
    this.connectionAbort?.abort();
    this.connectionAbort = null;
    this.connectionPending = null;
    this.writerAbort?.abort();
    this.writerAbort = null;
    this.generation++;
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = null;
    this.live?.removeAllListeners();
    this.live = null;
    this.codex?.stop();
    this.codex = null;
    this.apiClient?.stop();
    this.apiClient = null;
    this.state.connection = undefined;
    this.state.repairPlan = undefined;
    this.state.writer = this.describeWriter();
  }

  disconnect(): void {
    this.stop();
    this.disposeClient();
    this.patch({ auth: { state: "signed_out" }, statusText: "Disconnected", messages: [], activity: [], plan: [], pendingApproval: null, blockedNotice: null });
  }

  async connectProvider(apiKey?: string): Promise<{ ok: boolean; message?: string }> {
    if (this.state.running) return { ok: false, message: "Stop the current task before changing providers." };
    const settings = this.state.settings!;
    if (settings.providerId === "chatgpt") return this.signInChatgpt();
    try {
      const client = new ApiAgentClient({ ...settings, instructions: undefined, temperature: settings.temperature ?? undefined, baseUrl: settings.baseUrl || undefined, apiKey });
      this.disposeClient();
      this.apiClient = client;
      const generation = this.generation;
      await client.start();
      if (generation !== this.generation) return { ok: false, message: "Connection cancelled." };
      const provider = getProvider(settings.providerId);
      this.patch({
        mode: "live",
        auth: { state: "signed_in", method: provider.id === "ollama" ? "local" : "api_key", providerId: provider.id },
        messages: [],
        activity: [],
        plan: [],
        stopped: false,
        statusText: "Checking model access",
        writer: this.describeWriter(),
      });
      return await this.retryConnectionCheck();
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Could not connect provider." };
    }
  }

  retryConnectionCheck(): Promise<{ ok: boolean; message?: string }> {
    if (this.state.running) return Promise.resolve({ ok: false, message: "Stop the current task before checking the connection." });
    if (this.state.auth.state !== "signed_in" || (!this.codex && !this.apiClient)) return Promise.resolve({ ok: false, message: "Sign in before checking the connection." });
    if (this.connectionPending) {
      this.connectionAbort?.abort();
      this.connectionPending = null;
    }
    const pending = this.checkConnection();
    this.connectionPending = pending;
    void pending.finally(() => { if (this.connectionPending === pending) this.connectionPending = null; });
    return pending;
  }

  private async checkConnection(): Promise<{ ok: boolean; message?: string }> {
    const generation = this.generation;
    const controller = new AbortController(); this.connectionAbort = controller;
    const identity = {
      model: this.state.settings?.model || "Provider default",
      ...(this.state.connection?.account ? { account: this.state.connection.account } : {}),
      ...(this.state.connection?.plan ? { plan: this.state.connection.plan } : {}),
    };
    this.patch({ connection: { state: "checking", ...identity }, statusText: "Checking model access" });
    let temporary: CodexAppServerClient | undefined;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new Error("Connection check cancelled."));
      controller.signal.addEventListener("abort", cancel, { once: true });
    });
    try {
      if (this.apiClient) {
        await Promise.race([this.apiClient.checkConnection(controller.signal), cancelled]);
      } else {
        // A retry must not share tool events with an existing live conversation.
        const client = this.live ? (temporary = this.newCodex()) : this.codex!;
        if (temporary) await Promise.race([temporary.start(), cancelled]);
        await Promise.race([checkCodexConnection(client, this.state.settings?.model || undefined, controller.signal), cancelled]);
      }
      if (controller.signal.aborted || generation !== this.generation) return { ok: false, message: "Connection check cancelled." };
      if (!this.live) {
        this.live = new LiveAgentHost(this.apiClient ?? this.codex!, this.hands, this.state.settings);
        this.wireLive(this.live);
      }
      this.patch({ connection: { state: "ready", ...identity }, statusText: "Model connection ready" });
      return { ok: true, message: "Model connection ready." };
    } catch {
      if (controller.signal.aborted || generation !== this.generation) return { ok: false, message: "Connection check cancelled." };
      const reason = "The model did not answer the connection check. Check the selected model, account access, and network, then retry.";
      this.patch({ connection: { state: "failed", ...identity, reason }, statusText: "Model connection check failed" });
      return { ok: false, message: reason };
    } finally {
      controller.signal.removeEventListener("abort", cancel);
      temporary?.stop();
      if (this.connectionAbort === controller) this.connectionAbort = null;
    }
  }

  private newCodex(): CodexAppServerClient {
    const codexHome = path.join(app.getPath("userData"), "codex");
    mkdirSync(codexHome, { recursive: true });
    const command = process.env.LALIME_CODEX_BIN?.trim();
    return new CodexAppServerClient({ ...(command ? { command } : {}), codexHome });
  }

  dispose(): void {
    this.stop();
    this.disposeClient();
    this.patch({ auth: { state: "signed_out" }, statusText: "Disconnected" });
  }

  private patch(partial: Partial<AppSnapshot>): void {
    this.state = { ...this.state, ...partial };
    this.emit("snapshot", this.getSnapshot());
  }

  completeOnboarding(): void {
    this.patch({ onboardingComplete: true, statusText: "Ready when you are" });
  }

  setMode(mode: "demo" | "live"): void {
    if (mode === "demo" && !this.scriptedAllowed()) {
      this.patch({
        mode: "live",
        statusText: "Sign in with ChatGPT or an API key to continue",
      });
      return;
    }
    this.patch({
      mode,
      auth:
        mode === "demo"
          ? { state: "demo" }
          : this.state.auth.state === "signed_in"
            ? this.state.auth
            : { state: "signed_out" },
      statusText:
        mode === "demo"
          ? "Dev scripted fixture (LALIME_DEMO)"
          : this.state.auth.state === "signed_in"
            ? "Ready when you are"
            : "Sign in to get started",
    });
  }

  /** Dev/CI only — refused in packaged builds. */
  signInDemo(): void {
    if (!this.scriptedAllowed()) {
      this.patch({
        mode: "live",
        auth: {
          state: "error",
          message: "Scripted replies are disabled. Sign in with ChatGPT or your own API key.",
        },
        statusText: "Sign in required",
      });
      return;
    }
    this.live = null;
    this.patch({
      mode: "demo",
      auth: { state: "demo" },
      statusText: "Dev scripted fixture (LALIME_DEMO)",
    });
  }

  async signInChatgpt(): Promise<{ ok: boolean; message?: string }> {
    if (this.state.running) return { ok: false, message: "Stop the current task before signing in." };
    this.disposeClient();
    const generation = this.generation;
    const client = this.newCodex();
    this.codex = client;
    this.patch({ mode: "live", auth: { state: "signing_in" }, statusText: "Starting ChatGPT sign-in" });
    try {
      await client.start();
      const activate = async (): Promise<void> => {
        const result = await client.readAccount();
        if (generation !== this.generation || result.account?.type !== "chatgpt") return;
        if (this.loginTimer) clearTimeout(this.loginTimer);
        this.loginTimer = null;
        this.patch({ auth: { state: "signed_in", method: "chatgpt", providerId: "chatgpt", email: result.account.email ?? undefined },
          connection: { state: "checking", model: this.state.settings?.model || "Provider default",
            ...(result.account.email ? { account: result.account.email } : {}),
            ...(result.account.planType ? { plan: result.account.planType } : {}) }, statusText: "Checking model access" });
        await this.retryConnectionCheck();
      };
      const existing = await client.readAccount();
      if (existing.account?.type === "chatgpt") {
        await activate();
        return { ok: this.state.connection?.state === "ready" };
      }
      const { authUrl, loginId } = await client.loginWithChatgpt();
      if (generation !== this.generation) return { ok: false, message: "Sign-in cancelled." };
      client.on("account/login/completed", (result: { loginId?: string; success?: boolean }) => {
        if (generation !== this.generation || result.loginId !== loginId) return;
        if (result.success) void activate().catch(() => this.loginFailed(generation));
        else this.loginFailed(generation);
      });
      this.loginTimer = setTimeout(() => this.loginFailed(generation), 180000);
      this.loginTimer.unref?.();
      if (authUrl) {
        const url = new URL(authUrl);
        if (url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname) || url.username || url.password || url.port) throw new Error("Unexpected sign-in destination.");
        await shell.openExternal(url.toString());
      } else {
        await activate();
      }
      if (this.state.auth.state !== "signed_in") this.patch({ statusText: "Finish ChatGPT sign-in in your browser" });
      return { ok: true, message: "Finish sign-in in your browser." };
    } catch {
      this.loginFailed(generation);
      return { ok: false, message: "ChatGPT sign-in failed. Check that Codex is installed and try again." };
    }
  }

  private loginFailed(generation: number): void {
    if (generation !== this.generation) return;
    this.disposeClient();
    this.patch({ auth: { state: "error", message: "ChatGPT sign-in did not complete. Please try again." }, statusText: "Sign-in needed" });
  }

  async signInApiKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
    if (this.state.running) return { ok: false, message: "Stop the current task before signing in." };
    if (!apiKey.trim().startsWith("sk-")) return { ok: false, message: "That does not look like an OpenAI API key." };
    this.disposeClient();
    const generation = this.generation;
    const client = this.newCodex();
    this.codex = client;
    try {
      await client.start();
      if (generation !== this.generation) return { ok: false, message: "Sign-in cancelled." };
      await client.loginWithApiKey(apiKey.trim());
      if (generation !== this.generation) return { ok: false, message: "Sign-in cancelled." };
      this.patch({ mode: "live", auth: { state: "signed_in", method: "api_key", providerId: "openai" }, stopped: false, statusText: "Signed in with your API key" });
      return await this.retryConnectionCheck();
    } catch {
      if (generation !== this.generation) return { ok: false, message: "Sign-in cancelled." };
      this.disposeClient();
      const message = "API key sign-in failed. Check your key and Codex installation.";
      this.patch({ mode: "live", auth: { state: "error", message }, statusText: "Sign-in needed" });
      return { ok: false, message };
    }
  }

  /** Test helper: attach a pre-started Codex client (e.g. fake server). */
  attachLiveClient(codex: CodexAppServerClient, hands?: HandsClient): void {
    this.codex = codex;
    if (hands) this.hands = hands;
    this.live = new LiveAgentHost(codex, this.hands);
    this.wireLive(this.live);
    this.patch({
      mode: "live",
      auth: { state: "signed_in", method: "api_key", email: "test" },
      statusText: "Live (test)",
      onboardingComplete: true,
    });
  }

  private wireLive(live: LiveAgentHost): void {
    const active = () => this.live === live && !this.state.stopped;
    live.on("taskGrants", (taskGrants) => { if (this.live === live) this.patch({ taskGrants }); });
    live.on("approvalQueue", (pendingApprovalCount: number, approvalQueue: readonly ApprovalQueueEntry[]) => {
      if (this.live !== live) return;
      const current = this.state.pendingApproval?.action.id;
      this.patch({ pendingApprovalCount, approvalQueue,
        ...(!approvalQueue.some((entry) => entry.actionId === current) ? { pendingApproval: null } : {}) });
    });
    live.on("status", (text: string) => { if (active()) this.patch({ statusText: text }); });
    // Buffer Codex deltas — Deliberate writes the visible reply at turn end.
    live.on("delta", () => {
      if (!active()) return;
      this.patch({ statusText: "Working…" });
    });
    live.on("messageDone", (text: string) => {
      if (!active()) return;
      // Mid-turn narration: live-agent follows with its own status, so keep it.
      this.agentConclusion = text;
    });
    live.on("plan", (steps: PlanStep[]) => { if (active()) this.patch({ plan: steps }); });
    live.on("repairPlan", (repairPlan: RepairPlan) => { if (active()) this.patch({ repairPlan }); });
    live.on("approvalNeeded", (pending: PendingApproval) => {
      if (!active()) return;
      this.patch({ pendingApproval: pending, statusText: "Waiting for your OK" });
      void this.glossApproval(pending);
    });
    live.on("blocked", (decision) => {
      if (!active()) return;
      this.turnBlocked.push({
        plainEnglish: decision.plainEnglish,
        tier: decision.tier,
      });
      // The blocked card shows the reason; the model's reply explains next steps.
      // Posting plainEnglish here too would say it twice.
      this.patch({ blockedNotice: decision, statusText: "Blocked by Guardian" });
    });
    live.on("activity", (entry) => {
      // Keep recovery for a change that finished after Stop. Do not credit it to a later task.
      const activity: ActivityEntry = {
        id: id("a"),
        at: Date.now(),
        summary: entry.summary,
        details: entry.details,
        undoable: entry.undoable,
        actionId: entry.actionId,
      };
      if (active() && !entry.stale) this.turnActivity.unshift(activity);
      this.patch({ activity: [activity, ...this.state.activity] });
    });
    live.on("turnDone", () => {
      if (!active()) return;
      void this.finishTurnWithWriter();
    });
    live.on("error", (message: string) => {
      if (!active()) return;
      this.patch({
        running: false,
        pendingApproval: null,
        statusText: "Something went wrong",
        messages: [
          ...this.state.messages,
          { id: id("m"), role: "assistant", content: this.turnActivity.length ? `${message} ${this.activityOutcomeFallback()}` : message, createdAt: Date.now() },
        ],
      });
    });
  }

  private async glossApproval(pending: PendingApproval): Promise<void> {
    const config = this.resolveWriterConfig();
    if (!config) return;
    try {
      const writer = new WriterService({
        ...config,
        approvalTimeoutMs: 2_500,
      });
      const target =
        pending.action.paths?.[0] ??
        pending.action.payload.slice(0, 80);
      const gloss = await writer.explainApproval({
        plainEnglish: pending.decision.plainEnglish,
        details: pending.decision.details,
        undoable: pending.decision.undoable,
        targetHint: target,
      }, this.writerAbort?.signal);
      if (!gloss.used || !this.state.pendingApproval) return;
      if (this.state.pendingApproval.action.id !== pending.action.id) return;
      this.patch({
        pendingApproval: {
          ...this.state.pendingApproval,
          whatHappens: gloss.whatHappens,
          undoNote: gloss.undo,
        },
      });
    } catch {
      // Guardian text stays; gloss is optional.
    }
  }

  private async finishTurnWithWriter(): Promise<void> {
    if (this.state.stopped || !this.state.running) return;
    const generation = this.generation;
    const writerSignal = this.writerAbort?.signal;
    const conclusion = this.agentConclusion.trim();
    const fallback = (conclusion && !isNarrationOnly(conclusion) ? conclusion : "") || this.turnBlocked.at(-1)?.plainEnglish
      || this.activityOutcomeFallback();
    const outcome = this.inferOutcome();
    const facts = buildFactsPacket({
      userRequest: this.turnUserRequest,
      outcome,
      actions: this.turnActivity.slice(0, 6).map((a) => {
        let summary = a.summary;
        if (a.undoResult) {
          const partial = a.undoResult.restored && a.undoResult.total && a.undoResult.restored < a.undoResult.total;
          const label = a.undoResult.status === "restored" ? "Restored" : partial
            ? `Partly restored (${a.undoResult.restored} of ${a.undoResult.total})` : "Undo failed";
          if (a.undoResult.status === "failed") summary = `${label}${partial ? ":" : " for change:"} ${summary}`;
          const complete = boundedDisplayText(summary);
          summary = complete.fullLength <= 240 ? complete.text : `${label} for the selected change. See the change details for complete paths.`;
        }
        return { summary, status: a.undone ? "skipped" as const : a.undoResult?.status === "failed" ? "failed" as const : "done" as const,
          undoable: a.undoable && !a.undone };
      }),
      errors: this.turnActivity.flatMap((a) => {
        if (a.undoResult?.warning) return [{ code: "UNDO_WARNING", plainHint: a.undoResult.warning }];
        if (a.undoResult?.status !== "failed") return [];
        if (a.undoResult.items?.length) return [{ code: "UNDO_FAILED", plainHint: undoIssueHint(a.undoResult.items) }];
        const reason = boundedDisplayText(a.undoResult.reason);
        return [{ code: "UNDO_FAILED", plainHint: reason.fullLength <= 240 ? reason.text
          : "Undo could not be fully verified. See the change details for the complete file and recovery locations." }];
      }),
      blocked: this.turnBlocked.length ? this.turnBlocked : undefined,
      agentConclusion: fallback,
    });

    const config = this.resolveWriterConfig();
    if (!config) {
      this.publishAssistant(fallback);
      this.patch({ running: false, statusText: "Done", pendingApproval: null, writer: this.describeWriter() });
      return;
    }

    this.streamingMessageId = id("m");
    this.patch({
      messages: [
        ...this.state.messages,
        {
          id: this.streamingMessageId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        },
      ],
      statusText: "Writing…",
    });

    try {
      const writer = new WriterService(config);
      const result = await writer.composeReply(facts, {
        fallbackText: fallback,
        signal: writerSignal,
        onDelta: (chunk) => {
          if (!this.streamingMessageId || generation !== this.generation || writerSignal?.aborted) return;
          this.patch({
            messages: this.state.messages.map((m) =>
              m.id === this.streamingMessageId
                ? { ...m, content: m.content + chunk }
                : m,
            ),
          });
        },
      });
      if (generation !== this.generation || writerSignal?.aborted) return;
      if (result.error) this.setWriterLastError(result.error);
      else this.setWriterLastError(undefined);
      this.patch({
        messages: this.state.messages.map((m) =>
          m.id === this.streamingMessageId ? { ...m, content: result.text } : m,
        ),
        writer: this.describeWriter(),
        running: false,
        statusText: "Done",
        pendingApproval: null,
      });
    } catch {
      if (generation !== this.generation || writerSignal?.aborted) return;
      this.publishAssistant(fallback);
      this.patch({ running: false, statusText: "Done", pendingApproval: null, writer: this.describeWriter() });
    } finally {
      if (generation !== this.generation || writerSignal?.aborted) return;
      this.streamingMessageId = null;
      this.agentConclusion = "";
      this.turnBlocked = [];
    }
  }

  private activityOutcomeFallback(): string {
    return this.turnActivity.length
      ? `Lalime recorded ${this.turnActivity.length} action${this.turnActivity.length === 1 ? "" : "s"}. See What changed for details. I could not confirm that the problem is fixed.`
      : "I could not confirm that the problem is fixed. No changes were recorded. Please try again.";
  }

  private publishAssistant(text: string): void {
    this.patch({
      messages: [
        ...this.state.messages,
        { id: id("m"), role: "assistant", content: text, createdAt: Date.now() },
      ],
    });
  }

  private inferOutcome(): FactsOutcome {
    if (this.turnBlocked.length) return "blocked";
    if (this.state.stopped) return "partly_done";
    if (this.turnActivity.some((a) => a.undoResult?.status === "failed")) return "partly_done";
    if (this.turnActivity.some((a) => a.undoable)) return "done";
    if (this.agentConclusion.trim()) return "done";
    return "partly_done";
  }

  dismissBlocked(): void {
    this.patch({ blockedNotice: null });
  }

  stop(): void {
    this.connectionAbort?.abort();
    if (this.state.connection?.state === "checking") {
      this.state.connection = { ...this.state.connection, state: "failed", reason: "Connection check stopped. Reconnect to try again." };
    }
    this.abort = true;
    this.writerAbort?.abort();
    this.hands.stop();
    this.generation++;
    void this.live?.stop().catch(() => {});
    for (const w of this.approvalWaiters) w("not_now");
    this.approvalWaiters = [];
    this.patch({
      running: false,
      stopped: true,
      taskGrants: [],
      pendingApprovalCount: 0,
      approvalQueue: [],
      pendingApproval: null,
      statusText: "Stopped",
    });
  }

  beginApprovalHold(actionId: string): boolean {
    return this.state.pendingApproval?.action.id === actionId && Boolean(this.live?.beginApprovalHold(actionId));
  }

  cancelApprovalHold(actionId: string): void {
    this.live?.cancelApprovalHold(actionId);
  }

  revokeTaskGrant(grantId: string): boolean {
    return this.live?.revokeTaskGrant(grantId) ?? false;
  }

  async respondApproval(choice: ApprovalChoice, actionId?: string): Promise<boolean> {
    if (actionId && this.state.pendingApproval?.action.id !== actionId) return false;
    if (this.live && this.state.mode === "live") {
      const accepted = this.live.respondApproval(choice, actionId);
      if (accepted) this.patch({ pendingApproval: null });
      return accepted;
    }
    const waiters = this.approvalWaiters.splice(0);
    for (const w of waiters) w(choice);
    return waiters.length > 0;
  }

  async undo(activityId: string): Promise<void> {
    const entry = this.state.activity.find((a) => a.id === activityId);
    if (!entry?.actionId || !entry.undoable || entry.undone || this.pendingUndos.has(activityId)) return;
    const live = this.live;
    const pending = live ? this.state.pendingApproval : null;
    const withdrawnCount = pending ? Math.max(1, this.state.pendingApprovalCount ?? 1) : 0;
    const finishUndo = live?.beginUserUndo();
    if (pending) {
      const summary = boundedDisplayText(pending.action.summary ?? pending.decision.plainEnglish).text;
      const message = boundedDisplayText(`Lalime cancelled ${withdrawnCount === 1 ? "the waiting approval" : `${withdrawnCount} waiting approvals`} because you pressed Undo: ${summary}`
        + (withdrawnCount > 1 ? `, and ${withdrawnCount - 1} more.` : ".")).text;
      const approvalWithdrawal = { actionId: pending.action.id, summary, reason: "user_undo" as const, message, withdrawnCount };
      this.patch({
        activity: this.state.activity.map((item) => item.id === activityId ? { ...item, approvalWithdrawal } : item),
        messages: [...this.state.messages, { id: id("m"), role: "assistant", content: message, createdAt: Date.now() }],
      });
    }
    this.writerAbort?.abort();
    this.writerAbort = new AbortController();
    if (this.streamingMessageId) {
      this.patch({ messages: this.state.messages.filter((message) => message.id !== this.streamingMessageId), running: false });
      this.streamingMessageId = null;
    }
    this.pendingUndos.add(activityId);
    let result: HandsResult;
    try {
      result = await this.hands.undo(entry.actionId);
    } catch {
      result = { ok: false, output: "The restore failed. You can try Undo again." };
    } finally {
      this.pendingUndos.delete(activityId);
    }
    if (!this.state.activity.some((a) => a.id === activityId)) { finishUndo?.(); return; }
    if (result.undoState || (!result.ok && ["Already undone.", "Undo is already in progress."].includes(result.output))) {
      finishUndo?.();
      return;
    }
    try {
      if (live && this.live === live) live.recordUndoResult(entry.actionId, entry.summary, result);
    } finally { finishUndo?.(); }
    if (!result.ok) {
      this.patch({ activity: this.state.activity.map((a) => a.id === activityId
        ? { ...a, undoResult: { status: "failed", reason: result.output || "The restore could not be verified.", ...result.restoreProgress,
          ...(result.undoItems ? { items: result.undoItems } : {}) } } : a), statusText: result.restoreProgress && result.restoreProgress.restored > 0 && result.restoreProgress.restored < result.restoreProgress.total ? "Partly restored" : "Undo failed" });
      const updated = this.state.activity.find((a) => a.id === activityId)!;
      this.turnActivity = [updated, ...this.turnActivity.filter((a) => a.id !== activityId)];
      return;
    }
    const activity: ActivityEntry[] = this.state.activity.map((a) =>
      a.id === activityId ? { ...a, undone: true, undoResult: { status: "restored", ...result.restoreProgress,
        ...(result.restoreWarning ? { warning: result.restoreWarning } : {}) }, summary: `Undone: ${a.summary}` } : a,
    );
    this.turnActivity = [activity.find((a) => a.id === activityId)!, ...this.turnActivity.filter((a) => a.id !== activityId)];
    this.patch({
      activity,
      messages: [
        ...this.state.messages,
        {
          id: id("m"),
          role: "assistant",
          content: `The selected change was restored.${result.restoreWarning ? ` ${result.restoreWarning}` : ""}`,
          createdAt: Date.now(),
        },
      ],
      statusText: result.restoreWarning ? "Restored with a warning" : "Undone",
    });
  }

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state.running) return;
    if (this.state.connection?.state === "checking") {
      this.patch({ statusText: "Checking model access. Wait for the result or stop the check." });
      return;
    }

    if (this.state.mode === "live" && this.live && this.state.auth.state === "signed_in") {
      await this.runLive(trimmed);
      return;
    }

    if (this.scriptedAllowed() && (this.state.mode === "demo" || this.state.auth.state === "demo")) {
      await this.runScenario(inferScenario(trimmed), trimmed);
      return;
    }

    await this.rejectUnsignedSend(trimmed);
  }

  /** Dev/CI only — refused in packaged builds. */
  async runDemoScenario(scenarioId: DemoScenarioId): Promise<void> {
    if (!this.scriptedAllowed()) {
      this.patch({
        statusText: "Scripted fixtures are disabled in this build",
        auth: {
          state: "error",
          message: "Sign in with ChatGPT or your own API key to use Lalime.",
        },
      });
      return;
    }
    const prompts: Record<DemoScenarioId, string> = {
      downloads_cleanup: "My Downloads folder is a mess, clean it up.",
      wifi_fix: "My Wi-Fi keeps dropping.",
      night_light: "Turn on night light and make my text bigger.",
      dangerous_block: "Delete everything in System32 to speed up my PC.",
    };
    this.patch({ mode: "demo", auth: { state: "demo" } });
    await this.runScenario(scenarioId, prompts[scenarioId]);
  }

  private async rejectUnsignedSend(userText: string): Promise<void> {
    const hint =
      this.state.auth.state === "error"
        ? this.state.auth.message
        : "Sign in with ChatGPT (recommended) or paste your own OpenAI API key in Settings. Lalime never uses a shared key — every person brings their own account.";
    this.patch({
      messages: [
        ...this.state.messages,
        { id: id("m"), role: "user", content: userText, createdAt: Date.now() },
        {
          id: id("m"),
          role: "assistant",
          content: `I am ready when you are signed in.\n\n${hint}`,
          createdAt: Date.now(),
        },
      ],
      running: false,
      statusText: "Sign in to continue",
    });
  }

  private async runLive(userText: string): Promise<void> {
    this.abort = false;
    this.writerAbort?.abort();
    this.writerAbort = new AbortController();
    this.hands.resume();
    this.streamingMessageId = null;
    this.agentConclusion = "";
    this.turnUserRequest = userText;
    this.turnBlocked = [];
    this.turnActivity = [];
    this.patch({
      messages: [
        ...this.state.messages,
        { id: id("m"), role: "user", content: userText, createdAt: Date.now() },
      ],
      running: true,
      stopped: false,
      blockedNotice: null,
      pendingApproval: null,
      statusText: "Thinking…",
      plan: [],
      repairPlan: undefined,
    });
    try {
      await this.live!.runTurn(userText);
    } catch (err) {
      this.patch({
        running: false,
        statusText: "Live agent error",
        messages: [
          ...this.state.messages,
          {
            id: id("m"),
            role: "assistant",
            content: plainServiceFailure,
            createdAt: Date.now(),
          },
        ],
      });
    }
  }

  private async runScenario(scenario: DemoScenarioId, userText: string): Promise<void> {
    this.abort = false;
    this.hands.resume();
    const userMsg: ChatMessage = {
      id: id("m"),
      role: "user",
      content: userText,
      createdAt: Date.now(),
    };
    this.patch({
      messages: [...this.state.messages, userMsg],
      running: true,
      stopped: false,
      blockedNotice: null,
      pendingApproval: null,
      statusText: "Thinking…",
      plan: [],
    });
    await sleep(400);
    if (this.abort) return;

    switch (scenario) {
      case "dangerous_block":
        await this.scenarioDangerous(userText);
        break;
      case "wifi_fix":
        await this.scenarioWifi(userText);
        break;
      case "night_light":
        await this.scenarioNightLight(userText);
        break;
      default:
        await this.scenarioDownloads(userText);
        break;
    }
  }

  private setPlan(steps: PlanStep[]): void {
    this.patch({ plan: steps });
  }

  private updateStep(stepId: string, status: PlanStep["status"]): void {
    this.patch({
      plan: this.state.plan.map((s) => (s.id === stepId ? { ...s, status } : s)),
    });
  }

  private waitForApproval(pending: PendingApproval): Promise<ApprovalChoice> {
    this.patch({ pendingApproval: pending, statusText: "Waiting for your OK" });
    return new Promise((resolve) => this.approvalWaiters.push(resolve));
  }

  private async afterApprovalExecute(
    action: ProposedAction,
    execute: () => Promise<{ ok: boolean; output: string; journalId?: string }>,
  ): Promise<boolean> {
    const decision = await evaluateAction(action, { reviewer: demoReviewer });
    if (decision.kind === "block" || decision.kind === "explain_only") {
      this.patch({
        blockedNotice: decision,
        pendingApproval: null,
        running: false,
        statusText: "Blocked by Guardian",
        messages: [
          ...this.state.messages,
          {
            id: id("m"),
            role: "assistant",
            content: decision.plainEnglish,
            createdAt: Date.now(),
          },
        ],
      });
      return false;
    }

    if (decision.kind === "ask" || decision.kind === "ask_hold") {
      const choice = await this.waitForApproval({ decision, action });
      this.patch({ pendingApproval: null });
      if (choice === "not_now" || this.abort) {
        this.patch({
          running: false,
          statusText: "Canceled",
          messages: [
            ...this.state.messages,
            {
              id: id("m"),
              role: "assistant",
              content: "Okay — I did not make that change.",
              createdAt: Date.now(),
            },
          ],
        });
        return false;
      }
    }

    this.patch({ statusText: "Working…" });
    const result = await execute();
    if (!result.ok) {
      this.patch({ running: false, statusText: "Something went wrong" });
      return false;
    }
    if (result.journalId) {
      this.patch({
        activity: [
          {
            id: id("a"),
            at: Date.now(),
            summary: action.summary ?? decision.plainEnglish,
            details: action.payload,
            undoable: decision.undoable,
            actionId: result.journalId,
          },
          ...this.state.activity,
        ],
      });
    }
    return true;
  }

  private async assistant(content: string): Promise<void> {
    this.patch({
      messages: [
        ...this.state.messages,
        { id: id("m"), role: "assistant", content, createdAt: Date.now() },
      ],
    });
    await sleep(180);
  }

  private async scenarioDownloads(userText: string): Promise<void> {
    this.setPlan([
      { id: "p1", label: "Look through Downloads", status: "pending" },
      { id: "p2", label: "Group old installers", status: "pending" },
      { id: "p3", label: "Move them to the Recycle Bin", status: "pending" },
    ]);
    await this.assistant(
      "I can tidy Downloads for you. I will sort obvious old installers and move them to the Recycle Bin — nothing is permanently deleted, and you can undo.",
    );
    this.updateStep("p1", "running");
    await sleep(450);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    await sleep(350);
    this.updateStep("p2", "done");
    this.updateStep("p3", "running");
    const action: ProposedAction = {
      id: id("act"),
      kind: "powershell",
      payload:
        "Move-Item $env:USERPROFILE\\Downloads\\*.exe -Destination 'shell:RecycleBinFolder'",
      userRequest: userText,
      summary: "Move 312 old installers (4.1 GB) from Downloads to the Recycle Bin",
      paths: ["%USERPROFILE%\\Downloads"],
    };
    const ok = await this.afterApprovalExecute(action, async () =>
      this.hands.moveToRecycleBin(
        ["%USERPROFILE%\\Downloads\\setup_old.exe"],
        action.summary ?? "Recycle installers",
      ),
    );
    if (!ok) {
      this.updateStep("p3", "skipped");
      return;
    }
    this.updateStep("p3", "done");
    await this.assistant(
      "Done. I moved the old installers to the Recycle Bin. Use Undo in Activity if you want them back.",
    );
    this.patch({ running: false, statusText: "Done" });
  }

  private async scenarioWifi(userText: string): Promise<void> {
    this.setPlan([
      { id: "p1", label: "Check the Wi-Fi adapter", status: "pending" },
      { id: "p2", label: "Reset the adapter (needs OK)", status: "pending" },
      { id: "p3", label: "Verify connection", status: "pending" },
    ]);
    await this.assistant(
      "I will take a quick look at your Wi-Fi adapter, then ask before resetting it. A reset may drop the connection for a few seconds.",
    );
    this.updateStep("p1", "running");
    await sleep(450);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    const action: ProposedAction = {
      id: id("act"),
      kind: "powershell",
      payload: "Restart-NetAdapter -Name 'Wi-Fi'",
      userRequest: userText,
      summary: "Briefly reset the Wi-Fi adapter",
    };
    const ok = await this.afterApprovalExecute(action, async () =>
      this.hands.runPowerShell(action.payload, action.summary ?? "Reset Wi-Fi"),
    );
    if (!ok) {
      this.updateStep("p2", "skipped");
      return;
    }
    this.updateStep("p2", "done");
    this.updateStep("p3", "running");
    await sleep(350);
    this.updateStep("p3", "done");
    await this.assistant(
      "The adapter reset finished. If the Wi-Fi still drops, tell me what you see and we can dig further.",
    );
    this.patch({ running: false, statusText: "Done" });
  }

  private async scenarioNightLight(userText: string): Promise<void> {
    this.setPlan([
      { id: "p1", label: "Open Display settings", status: "pending" },
      { id: "p2", label: "Turn on Night light", status: "pending" },
      { id: "p3", label: "Increase text size", status: "pending" },
    ]);
    await this.assistant(
      "I will open Display settings and turn on Night light, then nudge text size up a step.",
    );
    this.updateStep("p1", "running");
    const open: ProposedAction = {
      id: id("act"),
      kind: "open_settings",
      payload: "ms-settings:display",
      userRequest: userText,
      summary: "Open Display settings",
    };
    const decision = evaluateActionSync(open);
    await this.hands.openSettings(open.payload);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    await this.hands.clickElement("Night light", "Settings");
    await sleep(300);
    this.updateStep("p2", "done");
    this.updateStep("p3", "running");
    await this.hands.clickElement("Make text bigger", "Settings");
    await sleep(300);
    this.updateStep("p3", "done");
    this.patch({
      activity: [
        {
          id: id("a"),
          at: Date.now(),
          summary: "Turned on Night light and increased text size",
          details: decision.details,
          undoable: true,
        },
        ...this.state.activity,
      ],
    });
    await this.assistant(
      "Night light is on and text should look a bit larger. If it is still hard to read, ask me to go one size bigger.",
    );
    this.patch({ running: false, statusText: "Done" });
  }

  private async scenarioDangerous(userText: string): Promise<void> {
    this.setPlan([
      { id: "p1", label: "Review the request", status: "running" },
      { id: "p2", label: "Guardian safety check", status: "pending" },
    ]);
    await sleep(350);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    const action: ProposedAction = {
      id: id("act"),
      kind: "powershell",
      payload: "Remove-Item -Recurse -Force C:\\Windows\\System32\\*",
      userRequest: userText,
      summary: "Delete System32",
    };
    const decision = evaluateActionSync(action);
    this.updateStep("p2", "done");
    this.patch({
      blockedNotice: decision,
      running: false,
      statusText: "Blocked by Guardian",
      messages: [
        ...this.state.messages,
        {
          id: id("m"),
          role: "assistant",
          content: `${decision.plainEnglish}\n\nI am here to help — but never by breaking Windows.`,
          createdAt: Date.now(),
        },
      ],
    });
  }
}

function inferScenario(text: string): DemoScenarioId {
  const t = text.toLowerCase();
  if (t.includes("system32") || (t.includes("delete") && t.includes("speed"))) {
    return "dangerous_block";
  }
  if (t.includes("wi-fi") || t.includes("wifi") || t.includes("wi fi")) {
    return "wifi_fix";
  }
  if (t.includes("night") || t.includes("text bigger") || t.includes("text size")) {
    return "night_light";
  }
  return "downloads_cleanup";
}

function appIsPackaged(): boolean {
  try {
    return Boolean(app?.isPackaged);
  } catch {
    return false;
  }
}
