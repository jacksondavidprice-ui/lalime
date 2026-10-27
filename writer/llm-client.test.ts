import { describe, expect, it, vi } from "vitest";
import {
  WriterLlmClient,
  friendlyWriterError,
  redactSecrets,
} from "./llm-client.js";

const FAKE_KEY = "sk-test-fake-for-unit-tests-only-0123456789";

describe("writer llm helpers", () => {
  it("redacts keys from log text", () => {
    const raw = `authorization: Bearer ${FAKE_KEY} failed`;
    const redacted = redactSecrets(raw, FAKE_KEY);
    expect(redacted).not.toContain(FAKE_KEY);
    expect(redacted).toMatch(/\[redacted\]/);
  });

  it("maps provider status codes to friendly text", () => {
    expect(friendlyWriterError(401)).toMatch(/not accepted/i);
    expect(friendlyWriterError(429)).toMatch(/busy|limit/i);
  });
});

describe("WriterLlmClient with mocked transport", () => {
  it("does not start a request when its caller already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Must not run" } }] })));
    const client = new WriterLlmClient({
      providerId: "openai",
      model: "gpt-test",
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    await expect(client.complete({ system: "s", user: "u", signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls OpenAI-compatible chat completions with the selected model", async () => {
    const seen: { url?: string; body?: Record<string, unknown> } = {};
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Done. Files moved." }, finish_reason: "stop" }] }),
        { status: 200 },
      );
    };
    const deltas: string[] = [];
    const client = new WriterLlmClient({
      providerId: "openai",
      model: "gpt-test-model",
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    const result = await client.complete({
      system: "sys",
      user: "facts",
      onDelta: (t) => deltas.push(t),
    });
    expect(result.text).toBe("Done. Files moved.");
    expect(deltas.join("")).toBe("Done. Files moved.");
    expect(seen.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen.body?.model).toBe("gpt-test-model");
    expect(seen.body).toHaveProperty("max_completion_tokens");
  });

  it("calls Anthropic messages when that provider is selected", async () => {
    const seen: { url?: string; body?: Record<string, unknown>; headers?: Headers } = {};
    const fetchImpl = async (url: string, init: RequestInit) => {
      seen.url = url;
      seen.body = JSON.parse(String(init.body)) as Record<string, unknown>;
      seen.headers = new Headers(init.headers);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"whatHappens":"Moves files.","undo":"Undo."}' }],
          stop_reason: "end_turn",
        }),
        { status: 200 },
      );
    };
    const client = new WriterLlmClient({
      providerId: "anthropic",
      model: "claude-test",
      apiKey: "sk-ant-fake-for-unit-tests-only-0123456789",
      fetchImpl,
    });
    const result = await client.complete({ system: "sys", user: "u", json: true });
    expect(result.text).toContain("whatHappens");
    expect(seen.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen.headers?.get("anthropic-version")).toBe("2023-06-01");
    expect(seen.body?.model).toBe("claude-test");
  });

  it("falls back with friendly error on 401", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const client = new WriterLlmClient({
      providerId: "openai",
      model: "gpt-test",
      apiKey: FAKE_KEY,
      fetchImpl,
    });
    await expect(client.complete({ system: "s", user: "u" })).rejects.toThrow(/not accepted/i);
  });

  it("allows local ollama without an API key", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
        { status: 200 },
      );
    const client = new WriterLlmClient({
      providerId: "ollama",
      model: "llama-test",
      fetchImpl,
    });
    expect((await client.complete({ system: "s", user: "u" })).text).toBe("ok");
  });
});
