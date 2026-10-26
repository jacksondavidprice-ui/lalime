/**
 * In-renderer demo engine so the Vite UI can run end-to-end without Electron.
 * Electron main hosts a parallel engine; both use Guardian + MockHands.
 */

import {
  demoReviewer,
  evaluateAction,
  evaluateActionSync,
} from "../../guardian/src/index";
import { createHandsClient } from "../../hands/mock/index";
import type {
  ActivityEntry,
  AppSnapshot,
  ApprovalChoice,
  AuthStatus,
  ChatMessage,
  PendingApproval,
  PlanStep,
  ProposedAction,
} from "../../shared/types";
import type { DemoScenarioId } from "../../shared/ipc";

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Listener = (snap: AppSnapshot) => void;

export class DemoEngine {
  private listeners = new Set<Listener>();
  private hands = createHandsClient();
  private abort = false;
  private approvalWaiters: Array<{ actionId: string; resolve: (choice: ApprovalChoice) => void }> = [];

  private state: AppSnapshot = {
    // Only reachable when LALIME_DEMO / ?demo=1 gates are on (never packaged UI).
    mode: "demo",
    auth: { state: "demo" },
    onboardingComplete: false,
    messages: [],
    plan: [],
    activity: [],
    pendingApproval: null,
    blockedNotice: null,
    running: false,
    stopped: false,
    statusText: "Dev scripted fixture",
    hands: { backend: "mock", available: true },
    writer: { enabled: false, keyHint: null },
  };

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => this.listeners.delete(cb);
  }

  getSnapshot(): AppSnapshot {
    return structuredClone(this.state);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }

  private patch(partial: Partial<AppSnapshot>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  completeOnboarding(): void {
    this.patch({ onboardingComplete: true, statusText: "Ready when you are" });
  }

  setMode(mode: "demo" | "live"): void {
    this.patch({
      mode,
      auth:
        mode === "demo"
          ? { state: "demo" }
          : this.state.auth.state === "signed_in"
            ? this.state.auth
            : { state: "signed_out" },
      statusText: mode === "demo" ? "Demo mode" : "Live mode",
    });
  }

  signInDemo(): void {
    this.patch({
      mode: "demo",
      auth: { state: "demo" },
      statusText: "Demo mode — no ChatGPT sign-in needed",
    });
  }

  signInChatgpt(): { ok: boolean; message?: string } {
    this.patch({
      auth: {
        state: "error",
        message:
          "ChatGPT sign-in runs in the desktop app (Codex app-server). Open Electron after npm run build.",
      },
    });
    return {
      ok: false,
      message: "Use the desktop app for ChatGPT sign-in (codex login), or paste an API key there.",
    };
  }

  signInApiKey(apiKey: string): { ok: boolean; message?: string } {
    if (!apiKey.trim().startsWith("sk-")) {
      return { ok: false, message: "That does not look like an OpenAI API key." };
    }
    const auth: AuthStatus = {
      state: "signed_in",
      method: "api_key",
      email: "api-key",
    };
    this.patch({ mode: "live", auth, statusText: "Signed in with API key (fallback)" });
    return { ok: true };
  }

  dismissBlocked(): void {
    this.patch({ blockedNotice: null });
  }

  stop(): void {
    this.abort = true;
    this.hands.stop();
    for (const w of this.approvalWaiters) w.resolve("not_now");
    this.approvalWaiters = [];
    this.patch({
      running: false,
      stopped: true,
      pendingApproval: null,
      statusText: "Stopped",
    });
  }

  async respondApproval(choice: ApprovalChoice, actionId?: string): Promise<boolean> {
    if (!actionId || this.state.pendingApproval?.action.id !== actionId) return false;
    const index = this.approvalWaiters.findIndex((waiter) => waiter.actionId === actionId);
    if (index < 0) return false;
    const [waiter] = this.approvalWaiters.splice(index, 1);
    waiter.resolve(choice);
    return true;
  }

  async undo(activityId: string): Promise<void> {
    const entry = this.state.activity.find((a: ActivityEntry) => a.id === activityId);
    if (!entry?.actionId) return;
    const result = await this.hands.undo(entry.actionId);
    if (!result.ok) return;
    const activity: ActivityEntry[] = this.state.activity.map((a: ActivityEntry) =>
      a.id === activityId ? { ...a, undone: true, summary: `Undone: ${a.summary}` } : a,
    );
    const messages: ChatMessage[] = [
      ...this.state.messages,
      {
        id: id("m"),
        role: "assistant",
        content: "All set — I put things back. Nothing permanent was lost.",
        createdAt: Date.now(),
      },
    ];
    this.patch({ activity, messages, statusText: "Undone" });
  }

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state.running) return;

    const scenario = inferScenario(trimmed);
    await this.runScenario(scenario, trimmed);
  }

  async runDemoScenario(scenarioId: DemoScenarioId): Promise<void> {
    const prompts: Record<DemoScenarioId, string> = {
      downloads_cleanup: "My Downloads folder is a mess, clean it up.",
      wifi_fix: "My Wi-Fi keeps dropping.",
      night_light: "Turn on night light and make my text bigger.",
      dangerous_block: "Delete everything in System32 to speed up my PC.",
    };
    await this.runScenario(scenarioId, prompts[scenarioId]);
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

    await sleep(450);
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
      case "downloads_cleanup":
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
      plan: this.state.plan.map((s: PlanStep) => (s.id === stepId ? { ...s, status } : s)),
    });
  }

  private async waitForApproval(pending: PendingApproval): Promise<ApprovalChoice> {
    return new Promise((resolve) => {
      this.approvalWaiters.push({ actionId: pending.action.id, resolve });
      this.patch({
        pendingApproval: pending,
        statusText: "Waiting for your OK",
      });
    });
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
      const entry: ActivityEntry = {
        id: id("a"),
        at: Date.now(),
        summary: action.summary ?? decision.plainEnglish,
        details: action.payload,
        undoable: decision.undoable,
        actionId: result.journalId,
      };
      this.patch({ activity: [entry, ...this.state.activity] });
    }
    return true;
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
    await sleep(500);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    await sleep(400);
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
    await sleep(500);
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
    await sleep(400);
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
    // open_settings with night light pattern → allow_with_journal
    const decision = evaluateActionSync(open);
    await this.hands.openSettings(open.payload);
    this.updateStep("p1", "done");
    this.updateStep("p2", "running");
    await sleep(350);
    this.updateStep("p2", "done");
    this.updateStep("p3", "running");
    await sleep(350);
    this.updateStep("p3", "done");
    this.patch({
      activity: [
        {
          id: id("a"),
          at: Date.now(),
          summary: "Turned on Night light and increased text size",
          details: decision.details,
          undoable: true,
          actionId: undefined,
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
    await sleep(400);
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

  private async assistant(content: string): Promise<void> {
    this.patch({
      messages: [
        ...this.state.messages,
        { id: id("m"), role: "assistant", content, createdAt: Date.now() },
      ],
    });
    await sleep(200);
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

let singleton: DemoEngine | null = null;

export function getDemoEngine(): DemoEngine {
  if (!singleton) singleton = new DemoEngine();
  return singleton;
}
