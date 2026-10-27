/**
 * Browser fallback when Electron preload is missing and scripted mocks are off.
 * Never invents replies — only surfaces a friendly sign-in state.
 */

import type { AppSnapshot } from "@shared/types";
import type { DemoScenarioId } from "@shared/ipc";

type Listener = (snap: AppSnapshot) => void;

export class SignedOutEngine {
  private listeners = new Set<Listener>();
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
    writer: { enabled: false, providerId: null, model: null },
  };

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => this.listeners.delete(cb);
  }

  getSnapshot(): AppSnapshot {
    return structuredClone(this.state);
  }

  private patch(partial: Partial<AppSnapshot>): void {
    this.state = { ...this.state, ...partial };
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }

  completeOnboarding(): void {
    this.patch({ onboardingComplete: true, statusText: "Sign in to continue" });
  }

  setMode(): void {
    this.patch({ mode: "live", statusText: "Sign in to continue" });
  }

  signInDemo(): void {
    this.patch({
      auth: {
        state: "error",
        message: "Scripted replies are off. Open the desktop app and sign in with ChatGPT or your API key.",
      },
      statusText: "Sign in required",
    });
  }

  signInChatgpt(): { ok: boolean; message?: string } {
    const message =
      "ChatGPT sign-in runs in the Lalime desktop app with Codex. Open Electron (npm run electron) after build.";
    this.patch({ auth: { state: "error", message }, statusText: "Desktop app required" });
    return { ok: false, message };
  }

  signInApiKey(): { ok: boolean; message?: string } {
    const message =
      "API key sign-in runs in the Lalime desktop app with Codex. Open Electron after npm run build.";
    this.patch({ auth: { state: "error", message }, statusText: "Desktop app required" });
    return { ok: false, message };
  }

  dismissBlocked(): void {
    this.patch({ blockedNotice: null });
  }

  stop(): void {
    this.patch({ running: false, stopped: true, statusText: "Stopped" });
  }

  async respondApproval(): Promise<void> {}

  async undo(): Promise<void> {}

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.patch({
      messages: [
        ...this.state.messages,
        { id: `m_${Date.now()}`, role: "user", content: trimmed, createdAt: Date.now() },
        {
          id: `m_${Date.now()}_a`,
          role: "assistant",
          content:
            "I need you signed in before I can help. Use the desktop app: Sign in with ChatGPT, or paste your own OpenAI API key.",
          createdAt: Date.now(),
        },
      ],
      statusText: "Sign in to continue",
    });
  }

  async runDemoScenario(_id: DemoScenarioId): Promise<void> {
    this.signInDemo();
  }
}

let singleton: SignedOutEngine | null = null;

export function getSignedOutEngine(): SignedOutEngine {
  if (!singleton) singleton = new SignedOutEngine();
  return singleton;
}
