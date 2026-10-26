import { describe, expect, it, vi } from "vitest";
import {
  AnthropicClient,
  friendlyAnthropicError,
  keyHint,
  looksLikeAnthropicKey,
  redactSecrets,
} from "./anthropic-client.js";

const FAKE_KEY = "sk-ant-fake-for-unit-tests-only-0123456789";

describe("anthropic client helpers", () => {
  it("recognizes and hints Anthropic keys", () => {
    expect(looksLikeAnthropicKey(FAKE_KEY)).toBe(true);
    expect(looksLikeAnthropicKey("sk-proj-not-anthropic")).toBe(false);
    expect(keyHint(FAKE_KEY)).toBe("…6789");
  });

  it("redacts keys from log text", () => {
    const raw = `x-api-key: ${FAKE_KEY} failed`;
    const redacted = redactSecrets(raw, FAKE_KEY);
    expect(redacted).not.toContain(FAKE_KEY);
    expect(redacted).toMatch(/\[redacted\]/);
  });

  it("maps provider status codes to grandparent-friendly text", () => {
    expect(friendlyAnthropicError(401)).toMatch(/not accepted/i);
    expect(friendlyAnthropicError(429)).toMatch(/busy|limit/i);
  });
});

describe("AnthropicClient with mocked transport", () => {
  it("does not start a request when its caller already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "Must not run" }] })));
    const client = new AnthropicClient({ apiKey: FAKE_KEY, fetchImpl });
    await expect(client.createMessage({ system: "s", user: "u", signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("streams text deltas and omits temperature/prefill", async () => {
    const chunks = [
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Done. "}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Files moved."}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    ];
    const body = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const seen: { body?: Record<string, unknown> } = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const deltas: string[] = [];
    const client = new AnthropicClient({ apiKey: FAKE_KEY, fetchImpl });
    const result = await client.createMessage({
      system: "sys",
      user: "facts",
      effort: "low",
      stream: true,
      onDelta: (t) => deltas.push(t),
    });
    expect(result.text).toBe("Done. Files moved.");
    expect(deltas.join("")).toBe("Done. Files moved.");
    expect(seen.body?.model).toBe("claude-opus-5-5");
    expect(seen.body).not.toHaveProperty("temperature");
    expect(seen.body).not.toHaveProperty("thinking");
    const messages = seen.body?.messages as Array<{ role: string }>;
    expect(messages.every((m) => m.role === "user")).toBe(true);
    const outputConfig = seen.body?.output_config as { effort: string };
    expect(outputConfig.effort).toBe("low");
  });

  it("uses output_config.format for JSON schemas", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const fetchImpl = async (_url: string, init: RequestInit) => {
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"whatHappens":"Moves files.","undo":"Undo."}' }],
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const client = new AnthropicClient({ apiKey: FAKE_KEY, fetchImpl });
    await client.createMessage({
      system: "sys",
      user: "u",
      effort: "low",
      jsonSchema: {
        type: "object",
        properties: { whatHappens: { type: "string" }, undo: { type: "string" } },
        required: ["whatHappens", "undo"],
        additionalProperties: false,
      },
    });
    const outputConfig = seen.body?.output_config as {
      format: { type: string; schema: unknown };
    };
    expect(outputConfig.format.type).toBe("json_schema");
  });

  it("falls back with friendly error on 401", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const client = new AnthropicClient({ apiKey: FAKE_KEY, fetchImpl });
    await expect(
      client.createMessage({ system: "s", user: "u" }),
    ).rejects.toThrow(/not accepted/i);
  });

  it("validates keys via /v1/models", async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toContain("/v1/models");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const client = new AnthropicClient({ apiKey: FAKE_KEY, fetchImpl });
    expect(await client.validateKey()).toEqual({ ok: true });
  });
});
