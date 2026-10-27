import { describe, expect, it, vi } from "vitest";
import { WriterService } from "./index.js";
import type { FactsPacket } from "./facts.js";

const FAKE_KEY = "sk-test-fake-for-unit-tests-only-0123456789";

const facts: FactsPacket = {
  userRequest: "Sort Downloads",
  outcome: "done",
  actions: [{ summary: "Moved old installers to Recycle Bin", status: "done", undoable: true }],
  agentConclusion: "Moved 12 installers to the Recycle Bin.",
};

function mockOpenAiTransport(text: string) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { stream?: boolean };
    expect(body.stream).toBe(false);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: text }, finish_reason: "stop" }],
      }),
      { status: 200 },
    );
  };
}

function writer(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof WriterService>[0]> = {}) {
  return new WriterService({
    providerId: "openai",
    model: "gpt-test",
    apiKey: FAKE_KEY,
    fetchImpl,
    ...extra,
  });
}

describe("WriterService", () => {
  it("does not start a request after cancellation before compose", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(mockOpenAiTransport("Should not run"));
    const result = await writer(fetchImpl).composeReply(facts, {
      fallbackText: "Original reply.",
      signal: controller.signal,
    });
    expect(result.source).toBe("fallback");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not start an approval explanation after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(mockOpenAiTransport("{}"));
    const result = await writer(fetchImpl).explainApproval(
      { plainEnglish: "Change?", details: "action", undoable: false },
      controller.signal,
    );
    expect(result.used).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels an approval explanation when the caller stops", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const service = writer(
      async (_url, init) => {
        requestSignal = init.signal;
        controller.abort();
        return new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(new Error("aborted"));
          else init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
      { approvalTimeoutMs: 100 },
    );
    const pending = service.explainApproval(
      { plainEnglish: "Change?", details: "action", undoable: false },
      controller.signal,
    );
    expect(requestSignal?.aborted).toBe(true);
    expect((await pending).used).toBe(false);
  });

  it("composes a deliberate reply from facts in one pass", async () => {
    const fetchImpl = vi.fn(mockOpenAiTransport("I moved the old installers to the Recycle Bin."));
    const deltas: string[] = [];
    const result = await writer(fetchImpl).composeReply(facts, {
      fallbackText: "Moved 12 installers to the Recycle Bin.",
      onDelta: (c) => deltas.push(c),
    });
    expect(result.source).toBe("deliberate");
    expect(result.text).toMatch(/Recycle Bin/);
    expect(deltas.join("").length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original text when the provider errors", async () => {
    const result = await writer(async () => new Response("fail", { status: 500 })).composeReply(facts, {
      fallbackText: "Moved 12 installers to the Recycle Bin.",
    });
    expect(result.source).toBe("fallback");
    expect(result.text).toBe("Moved 12 installers to the Recycle Bin.");
  });

  it("falls back on timeout", async () => {
    const result = await writer(
      async (_url, init) => {
        await new Promise<void>((_, reject) => {
          const signal = init.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
        return new Response("late", { status: 200 });
      },
      { replyTimeoutMs: 30 },
    ).composeReply(facts, { fallbackText: "Provider said this." });
    expect(result.source).toBe("fallback");
    expect(result.text).toBe("Provider said this.");
  });

  it("approval gloss never invents undo when undoable is false", async () => {
    const gloss = await writer(async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                whatHappens: "Resets the Wi-Fi adapter briefly.",
                undo: "You can undo this afterward.",
              }),
            },
            finish_reason: "stop",
          }],
        }),
        { status: 200 },
      ),
    { approvalTimeoutMs: 2_500 }).explainApproval({
      plainEnglish: "Reset the Wi-Fi adapter?",
      details: "Restart-NetAdapter",
      undoable: false,
      targetHint: "Wi-Fi",
    });
    expect(gloss.used).toBe(false);
    expect(gloss.undo).toMatch(/cannot be undone/i);
  });

  it("returns unused gloss when approval times out", async () => {
    const gloss = await writer(
      async (_url, init) => {
        await new Promise<void>((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
        return new Response("{}", { status: 200 });
      },
      { approvalTimeoutMs: 20 },
    ).explainApproval({
      plainEnglish: "Move files?",
      details: "Move-Item",
      undoable: true,
      targetHint: "Downloads",
    });
    expect(gloss.used).toBe(false);
  });
});
