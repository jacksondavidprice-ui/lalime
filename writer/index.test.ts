import { describe, expect, it } from "vitest";
import { WriterService } from "./index.js";
import type { FactsPacket } from "./facts.js";

const FAKE_KEY = "sk-ant-fake-for-unit-tests-only-0123456789";

const facts: FactsPacket = {
  userRequest: "Sort Downloads",
  outcome: "done",
  actions: [{ summary: "Moved old installers to Recycle Bin", status: "done", undoable: true }],
  agentConclusion: "Moved 12 installers to the Recycle Bin.",
};

function mockReplyTransport(text: string) {
  return async (url: string, init: RequestInit) => {
    if (url.includes("/v1/models")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    const body = JSON.parse(String(init.body)) as { stream?: boolean };
    if (body.stream) {
      const chunk = `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":${JSON.stringify(text)}}}\n\n`;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
      }),
      { status: 200 },
    );
  };
}

describe("WriterService", () => {
  it("composes a deliberate reply from facts", async () => {
    const writer = new WriterService({
      apiKey: FAKE_KEY,
      fetchImpl: mockReplyTransport("I moved the old installers to the Recycle Bin."),
    });
    const deltas: string[] = [];
    const result = await writer.composeReply(facts, {
      fallbackText: "Moved 12 installers to the Recycle Bin.",
      onDelta: (c) => deltas.push(c),
    });
    expect(result.source).toBe("deliberate");
    expect(result.text).toMatch(/Recycle Bin/);
    expect(deltas.join("").length).toBeGreaterThan(0);
  });

  it("falls back to Codex text when Anthropic errors", async () => {
    const writer = new WriterService({
      apiKey: FAKE_KEY,
      fetchImpl: async () => new Response("fail", { status: 500 }),
    });
    const result = await writer.composeReply(facts, {
      fallbackText: "Moved 12 installers to the Recycle Bin.",
    });
    expect(result.source).toBe("fallback");
    expect(result.text).toBe("Moved 12 installers to the Recycle Bin.");
  });

  it("falls back on timeout", async () => {
    const writer = new WriterService({
      apiKey: FAKE_KEY,
      replyTimeoutMs: 30,
      fetchImpl: async (_url, init) => {
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
    });
    const result = await writer.composeReply(facts, {
      fallbackText: "Codex said this.",
    });
    expect(result.source).toBe("fallback");
    expect(result.text).toBe("Codex said this.");
  });

  it("approval gloss never invents undo when undoable is false", async () => {
    const writer = new WriterService({
      apiKey: FAKE_KEY,
      approvalTimeoutMs: 2_500,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  whatHappens: "Resets the Wi-Fi adapter briefly.",
                  undo: "You can undo this afterward.",
                }),
              },
            ],
            stop_reason: "end_turn",
          }),
          { status: 200 },
        ),
    });
    const gloss = await writer.explainApproval({
      plainEnglish: "Reset the Wi-Fi adapter?",
      details: "Restart-NetAdapter",
      undoable: false,
      targetHint: "Wi-Fi",
    });
    expect(gloss.used).toBe(false);
    expect(gloss.undo).toMatch(/cannot be undone/i);
  });

  it("returns unused gloss when approval times out", async () => {
    const writer = new WriterService({
      apiKey: FAKE_KEY,
      approvalTimeoutMs: 20,
      fetchImpl: async (_url, init) => {
        await new Promise<void>((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
        return new Response("{}", { status: 200 });
      },
    });
    const gloss = await writer.explainApproval({
      plainEnglish: "Move files?",
      details: "Move-Item",
      undoable: true,
      targetHint: "Downloads",
    });
    expect(gloss.used).toBe(false);
  });
});
