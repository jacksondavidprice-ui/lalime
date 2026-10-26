import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ApiAgentClient } from "../electron/main/api-agent-client.js";

const TOOL = {
  type: "function" as const,
  name: "lalime_list_windows",
  description: "List windows",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};
const KEY = "unit-test-placeholder";
const completion = (text: string) => ({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] });
const toolReply = (name = TOOL.name, args = "{}") => ({ choices: [{ message: {
  role: "assistant", content: null,
  tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }],
}, finish_reason: "tool_calls" }] });
function mockFetch(...bodies: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 200 })) as unknown as typeof fetch;
}
async function ready(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  const client = new ApiAgentClient({ providerId: "openai", model: "user-selected-model", apiKey: KEY, ...extra }, fetchImpl);
  await client.start();
  const threadId = await client.startThread({ dynamicTools: [TOOL], developerInstructions: "Use only approved tools." });
  return { client, threadId };
}
async function run(client: ApiAgentClient, threadId: string, text = "Hello") {
  const done = once(client, "turn/completed");
  await client.startTurn(threadId, text);
  return (await done)[0] as { turn: { status: string; error?: { message: string } } };
}

describe("API agent provider transport", () => {
  it("completes a real protocol turn and preserves conversation history", async () => {
    const fetchImpl = mockFetch(completion("Hello back"), completion("Remembered"));
    const { client, threadId } = await ready(fetchImpl);
    const messages: string[] = [];
    client.on("item/completed", (event) => messages.push(event.item.text));
    expect((await run(client, threadId)).turn.status).toBe("completed");
    await run(client, threadId, "What did I say?");
    const calls = vi.mocked(fetchImpl).mock.calls;
    expect(String(calls[0][0])).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0][1]?.redirect).toBe("error");
    const request = JSON.parse(calls[1][1]?.body as string);
    expect(request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "Hello" }),
      expect.objectContaining({ role: "assistant", content: "Hello back" }),
    ]));
    expect(messages).toEqual(["Hello back", "Remembered"]);
    client.stop();
  });

  it("waits for the Guardian host response before continuing a tool loop", async () => {
    const fetchImpl = mockFetch(toolReply(), completion("Found a window"));
    const { client, threadId } = await ready(fetchImpl);
    const requested = once(client, "serverRequest");
    const done = once(client, "turn/completed");
    await client.startTurn(threadId, "List my windows");
    const [request] = await requested;
    expect(request.method).toBe("item/tool/call");
    expect(request.params.tool).toBe(TOOL.name);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    client.respondToolCall(request.id, { success: true, contentItems: [{ type: "inputText", text: "Editor" }] });
    await done;
    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[1][1]?.body as string);
    expect(body.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "call_1", content: "Editor" }));
    client.stop();
  });

  it("uses native Anthropic messages and tool_result blocks", async () => {
    const fetchImpl = mockFetch(
      { content: [{ type: "tool_use", id: "tool_1", name: TOOL.name, input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Done" }], stop_reason: "end_turn" },
    );
    const { client, threadId } = await ready(fetchImpl, { providerId: "anthropic", maxTokens: 1024 });
    client.on("serverRequest", (request) => client.respondToolCall(request.id, {
      success: false, contentItems: [{ type: "inputText", text: "Denied" }],
    }));
    expect((await run(client, threadId)).turn.status).toBe("completed");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init?.headers).get("x-api-key")).toBe(KEY);
    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[1][1]?.body as string);
    expect(body.max_tokens).toBe(1024);
    expect(body.messages.at(-1).content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tool_1", is_error: true });
    client.stop();
  });

  it.each([["unknown_tool", "{}"], [TOOL.name, "not-json"], [TOOL.name, "[]"], [TOOL.name, '{"unexpected":true}']])(
    "rejects unknown or malformed tool calls before dispatch (%s, %s)", async (name, args) => {
      const { client, threadId } = await ready(mockFetch(toolReply(name, args)));
      const requests = vi.fn();
      client.on("serverRequest", requests);
      expect((await run(client, threadId)).turn.status).toBe("failed");
      expect(requests).not.toHaveBeenCalled();
      client.stop();
    },
  );

  it("bounds tool calls and does not execute a call beyond the limit", async () => {
    const fetchImpl = mockFetch(toolReply(), toolReply());
    const { client, threadId } = await ready(fetchImpl, { maxToolCalls: 1 });
    const requests = vi.fn((request) => client.respondToolCall(request.id, { success: true, contentItems: [] }));
    client.on("serverRequest", requests);
    const result = await run(client, threadId);
    expect(result.turn.status).toBe("failed");
    expect(result.turn.error?.message).toMatch(/limit/i);
    expect(requests).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("aborts an in-flight request on stop without reporting success", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl);
    const done = once(client, "turn/completed");
    const { turnId } = await client.startTurn(threadId, "Hello");
    await client.interruptTurn(threadId, turnId);
    expect(signal?.aborted).toBe(true);
    expect((await done)[0].turn.status).toBe("interrupted");
    client.stop();
  });

  it("cancels pending tool approvals without making another API request", async () => {
    const fetchImpl = mockFetch(toolReply(), completion("Must not run"));
    const { client, threadId } = await ready(fetchImpl);
    const request = once(client, "serverRequest");
    const done = once(client, "turn/completed");
    const { turnId } = await client.startTurn(threadId, "Hello");
    const [event] = await request;
    await client.interruptTurn(threadId, turnId);
    client.respondToolCall(event.id, { success: true, contentItems: [] });
    expect((await done)[0].turn.status).toBe("interrupted");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("keeps provider error bodies and credentials out of events", async () => {
    const fetchImpl = vi.fn(async () => new Response(`private server error ${KEY}`, { status: 401 })) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl);
    const result = await run(client, threadId);
    expect(result.turn.status).toBe("failed");
    expect(result.turn.error?.message).toMatch(/401/);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("private server error");
    client.stop();
  });

  it("does not send keys to an overridden official endpoint", () => {
    expect(() => new ApiAgentClient({ providerId: "openai", model: "x", apiKey: KEY, baseUrl: "https://evil.example/v1" })).toThrow(/endpoint/i);
  });

  it("requires a model and API key before making a paid-provider request", () => {
    expect(() => new ApiAgentClient({ providerId: "openai", model: "" })).toThrow(/model/i);
    expect(() => new ApiAgentClient({ providerId: "openai", model: "x" })).toThrow(/key/i);
  });

  it("can use a local endpoint without an API key", async () => {
    const fetchImpl = mockFetch(completion("Local response"));
    const { client, threadId } = await ready(fetchImpl, { providerId: "ollama", apiKey: undefined });
    expect((await run(client, threadId)).turn.status).toBe("completed");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    client.stop();
  });

  it("keeps all tool replies adjacent before sending screenshot context", async () => {
    const batch = toolReply();
    batch.choices[0].message.tool_calls.push({ id: "call_2", type: "function", function: { name: TOOL.name, arguments: "{}" } });
    const fetchImpl = mockFetch(batch, completion("Both tools finished"));
    const { client, threadId } = await ready(fetchImpl);
    client.on("serverRequest", (request) => client.respondToolCall(request.id, { success: true, contentItems: [
      { type: "inputText", text: "Screenshot" }, { type: "inputImage", imageUrl: "data:image/png;base64,aGVsbG8=" },
    ] }));
    expect((await run(client, threadId)).turn.status).toBe("completed");
    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[1][1]?.body as string);
    const roles = body.messages.map((message: { role: string }) => message.role);
    expect(roles).toEqual(["system", "user", "assistant", "tool", "tool", "user"]);
    client.stop();
  });

  it("rejects duplicate tool call identifiers before any action runs", async () => {
    const batch = toolReply();
    batch.choices[0].message.tool_calls.push(batch.choices[0].message.tool_calls[0]);
    const { client, threadId } = await ready(mockFetch(batch, completion("Must not run")));
    const requests = vi.fn((request) => client.respondToolCall(request.id, { success: true, contentItems: [] }));
    client.on("serverRequest", requests);
    expect((await run(client, threadId)).turn.status).toBe("failed");
    expect(requests).not.toHaveBeenCalled();
    client.stop();
  });

  it("aborts provider requests at the configured timeout", async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("untrusted timeout detail")));
    })) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl, { requestTimeoutMs: 10 });
    const result = await run(client, threadId);
    expect(result.turn.status).toBe("failed");
    expect(result.turn.error?.message).toMatch(/timed out/);
    client.stop();
  });

  it("rejects oversized provider responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(4 * 1024 * 1024 + 1))) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl);
    expect((await run(client, threadId)).turn.error?.message).toMatch(/size limit/);
    client.stop();
  });
});
