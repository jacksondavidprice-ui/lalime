/**
 * Main-process session: live Codex agent (Guardian-gated).
 * Scripted scenarios exist only when isScriptedMockAllowed() (never in packaged builds).
 */

import { EventEmitter } from "node:events";
import { app, shell } from "electron";
import {
  demoReviewer,
  evaluateAction,
  evaluateActionSync,
} from "../../guardian/src/index.js";
import { createHandsClient } from "../../hands/src/create-hands.js";
import { handsMissingMessage } from "../../hands/src/hands-exe.js";
import type { HandsClient } from "../../hands/src/types.js";
import type { DemoScenarioId } from "../../shared/ipc.js";
import type {
  ActivityEntry,
  AppSnapshot,
  ApprovalChoice,
  AuthStatus,
  ChatMessage,
  HandsStatus,
  PendingApproval,
  PlanStep,
  ProposedAction,
} from "../../shared/types.js";
import {
  AnthropicClient,
  looksLikeAnthropicKey,
} from "../../writer/anthropic-client.js";
import { WriterService, buildFactsPacket } from "../../writer/index.js";
import type { FactsOutcome } from "../../writer/facts.js";
import { CodexAppServerClient } from "./codex-client.js";
import { codexMissingMessage, resolveCodexCommand } from "./codex-resolve.js";
import { isScriptedMockAllowed } from "./dev-flags.js";
import { LiveAgentHost } from "./live-agent.js";
import {
  clearWriterKey,
  getWriterKeyStatus,
  loadWriterKey,
  saveWriterKey,
  setWriterLastError,
} from "./writer-key.js";

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SessionController extends EventEmitter {
  private hands: HandsClient;
  private abort = false;
  private approvalWaiters: Array<(choice: ApprovalChoice) => void> = [];
  private codex: CodexAppServerClient | null = null;
  private live: LiveAgentHost | null = null;
  private streamingMessageId: string | null = null;
  private agentConclusion = "";
  private turnUserRequest = "";
  private turnBlocked: Array<{ plainEnglish: string; tier: number }> = [];
  private writerFetch: typeof fetch | undefined;

  private state: AppSnapshot = {
    mode: "live",
    auth: { state: "signed_out" },
    onboardingComplete: false,
    messages: [],
    plan: [],
    activity: [],
    pendingApproval: null,
    blockedNotice: null,
    running: false,
    stopped: false,
    statusText: "Sign in to get started",
    hands: { backend: "node", available: true },
    writer: { enabled: false, keyHint: null },
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

  /** Test helper: inject Anthropic fetch transport. */
  setWriterFetch(fetchImpl: typeof fetch): void {
    this.writerFetch = fetchImpl;
  }

  private describeWriter() {
    try {
      return getWriterKeyStatus();
    } catch {
      return { enabled: false, keyHint: null as string | null };
    }
  }

  writerStatus() {
    const status = this.describeWriter();
    this.patch({ writer: status });
    return status;
  }

  writerSetKey(key: string) {
    const result = saveWriterKey(key);
    this.patch({ writer: result.status });
    return { ok: result.ok, message: result.message };
  }

  writerClearKey(): void {
    const status = clearWriterKey();
    this.patch({ writer: status });
  }

  async writerCheckKey(): Promise<{ ok: boolean; message?: string }> {
    const key = loadWriterKey();
    if (!key || !looksLikeAnthropicKey(key)) {
      return { ok: false, message: "Add an Anthropic key that starts with sk-ant- first." };
    }
    const client = new AnthropicClient({
      apiKey: key,
      fetchImpl: this.writerFetch,
    });
    const result = await client.validateKey();
    if (!result.ok) setWriterLastError(result.message);
    else setWriterLastError(undefined);
    this.patch({ writer: this.describeWriter() });
    return result;
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
    try {
      this.codex?.stop();
      const fromEnv = process.env.LALIME_CODEX_BIN?.trim();
      this.codex = new CodexAppServerClient(fromEnv ? { command: fromEnv } : {});
      await this.codex.start();
      const { authUrl } = await this.codex.loginWithChatgpt();
      if (authUrl) {
        await shell.openExternal(authUrl);
      }
      this.live = new LiveAgentHost(this.codex, this.hands);
      this.wireLive(this.live);
      const auth: AuthStatus = { state: "signed_in", method: "chatgpt" };
      this.patch({
        mode: "live",
        auth,
        statusText: authUrl
          ? "Finish signing in with ChatGPT in your browser, then ask Lalime anything"
          : "Signed in with ChatGPT",
      });
      return { ok: true, message: authUrl };
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Codex app-server unavailable";
      const message = /not found|ENOENT|spawn/i.test(raw)
        ? codexMissingMessage(resolveCodexCommand())
        : `${raw} Sign in with your own OpenAI API key, or run "codex login" once in a terminal.`;
      this.patch({
        mode: "live",
        auth: { state: "error", message },
        statusText: "Sign-in needed",
      });
      return { ok: false, message };
    }
  }

  async signInApiKey(apiKey: string): Promise<{ ok: boolean; message?: string }> {
    if (!apiKey.trim().startsWith("sk-")) {
      return { ok: false, message: "That does not look like an OpenAI API key." };
    }
    try {
      this.codex?.stop();
      const fromEnv = process.env.LALIME_CODEX_BIN?.trim();
      this.codex = new CodexAppServerClient(fromEnv ? { command: fromEnv } : {});
      await this.codex.start();
      await this.codex.loginWithApiKey(apiKey.trim());
      this.live = new LiveAgentHost(this.codex, this.hands);
      this.wireLive(this.live);
      this.patch({
        mode: "live",
        auth: { state: "signed_in", method: "api_key", email: "api-key" },
        statusText: "Signed in with your API key",
      });
      return { ok: true };
    } catch (err) {
      const raw = err instanceof Error ? err.message : "API key sign-in failed";
      const message = /not found|ENOENT|spawn/i.test(raw)
        ? codexMissingMessage(resolveCodexCommand())
        : raw;
      this.patch({
        mode: "live",
        auth: { state: "error", message },
        statusText: "Sign-in needed",
      });
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
    live.on("status", (text: string) => this.patch({ statusText: text }));
    // Buffer Codex deltas — Deliberate writes the visible reply at turn end.
    live.on("delta", () => {
      this.patch({ statusText: "Working…" });
    });
    live.on("messageDone", (text: string) => {
      this.agentConclusion = text;
      this.patch({ statusText: "Preparing a clear reply…" });
    });
    live.on("plan", (steps: PlanStep[]) => this.patch({ plan: steps }));
    live.on("approvalNeeded", (pending: PendingApproval) => {
      this.patch({ pendingApproval: pending, statusText: "Waiting for your OK" });
      void this.glossApproval(pending);
    });
    live.on("blocked", (decision) => {
      this.turnBlocked.push({
        plainEnglish: decision.plainEnglish,
        tier: decision.tier,
      });
      this.patch({
        blockedNotice: decision,
        pendingApproval: null,
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
    });
    live.on("activity", (entry) => {
      const activity: ActivityEntry = {
        id: id("a"),
        at: Date.now(),
        summary: entry.summary,
        details: entry.details,
        undoable: entry.undoable,
        actionId: entry.actionId,
      };
      this.patch({ activity: [activity, ...this.state.activity] });
    });
    live.on("turnDone", () => {
      void this.finishTurnWithWriter();
    });
    live.on("error", (message: string) => {
      this.patch({
        running: false,
        statusText: "Something went wrong",
        messages: [
          ...this.state.messages,
          { id: id("m"), role: "assistant", content: message, createdAt: Date.now() },
        ],
      });
    });
  }

  private async glossApproval(pending: PendingApproval): Promise<void> {
    const key = loadWriterKey();
    if (!key) return;
    try {
      const writer = new WriterService({
        apiKey: key,
        fetchImpl: this.writerFetch,
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
      });
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
    const fallback = this.agentConclusion.trim() || "Done.";
    const outcome = this.inferOutcome();
    const facts = buildFactsPacket({
      userRequest: this.turnUserRequest,
      outcome,
      actions: this.state.activity.slice(0, 6).map((a) => ({
        summary: a.summary,
        status: a.undone ? "skipped" : "done",
        undoable: a.undoable,
      })),
      blocked: this.turnBlocked.length ? this.turnBlocked : undefined,
      agentConclusion: fallback,
    });

    const key = loadWriterKey();
    if (!key) {
      this.publishAssistant(fallback);
      this.patch({ running: false, statusText: "Done", pendingApproval: null });
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
      const writer = new WriterService({
        apiKey: key,
        fetchImpl: this.writerFetch,
      });
      const result = await writer.composeReply(facts, {
        fallbackText: fallback,
        onDelta: (chunk) => {
          if (!this.streamingMessageId) return;
          this.patch({
            messages: this.state.messages.map((m) =>
              m.id === this.streamingMessageId
                ? { ...m, content: m.content + chunk }
                : m,
            ),
          });
        },
      });
      if (result.error) setWriterLastError(result.error);
      else setWriterLastError(undefined);
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
      this.publishAssistant(fallback);
      this.patch({ running: false, statusText: "Done", pendingApproval: null });
    } finally {
      this.streamingMessageId = null;
      this.agentConclusion = "";
      this.turnBlocked = [];
    }
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
    if (this.state.activity.some((a) => a.undoable)) return "done";
    if (this.agentConclusion.trim()) return "done";
    return "partly_done";
  }

  dismissBlocked(): void {
    this.patch({ blockedNotice: null });
  }

  stop(): void {
    this.abort = true;
    this.hands.stop();
    void this.live?.stop();
    for (const w of this.approvalWaiters) w("not_now");
    this.approvalWaiters = [];
    this.patch({
      running: false,
      stopped: true,
      pendingApproval: null,
      statusText: "Stopped",
    });
  }

  async respondApproval(choice: ApprovalChoice): Promise<void> {
    if (this.live && this.state.mode === "live") {
      this.live.respondApproval(choice);
      this.patch({ pendingApproval: null });
      return;
    }
    const waiters = this.approvalWaiters.splice(0);
    for (const w of waiters) w(choice);
  }

  async undo(activityId: string): Promise<void> {
    const entry = this.state.activity.find((a) => a.id === activityId);
    if (!entry?.actionId) return;
    const result = await this.hands.undo(entry.actionId);
    if (!result.ok) return;
    const activity: ActivityEntry[] = this.state.activity.map((a) =>
      a.id === activityId ? { ...a, undone: true, summary: `Undone: ${a.summary}` } : a,
    );
    this.patch({
      activity,
      messages: [
        ...this.state.messages,
        {
          id: id("m"),
          role: "assistant",
          content: "All set — I put things back. Nothing permanent was lost.",
          createdAt: Date.now(),
        },
      ],
      statusText: "Undone",
    });
  }

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state.running) return;

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
    this.hands.resume();
    this.streamingMessageId = null;
    this.agentConclusion = "";
    this.turnUserRequest = userText;
    this.turnBlocked = [];
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
            content:
              err instanceof Error
                ? `I hit a problem talking to Codex: ${err.message}. Open Settings to sign in again, or paste your own API key.`
                : "Codex error",
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
