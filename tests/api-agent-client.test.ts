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

  it("continues beyond former tool limits without an artificial wrap-up", async () => {
    const fetchImpl = mockFetch(...Array.from({ length: 75 }, () => toolReply()), completion("Finished work"));
    const { client, threadId } = await ready(fetchImpl, { maxToolCalls: 1 });
    const requests = vi.fn((request) => client.respondToolCall(request.id, { success: true, contentItems: [] }));
    client.on("serverRequest", requests);
    expect((await run(client, threadId)).turn.status).toBe("completed");
    expect(requests).toHaveBeenCalledTimes(75);
    for (const [, init] of vi.mocked(fetchImpl).mock.calls) {
      const body = JSON.parse(init?.body as string);
      expect(body.tool_choice).toBeUndefined();
      expect(body.tools).toHaveLength(1);
      expect(JSON.stringify(body.messages)).not.toContain("Do not call tools");
    }
    client.stop();
  });

  it("keeps approval pending beyond five minutes until the user responds", async () => {
    vi.useFakeTimers();
    const { client, threadId } = await ready(mockFetch(toolReply(), completion("Done")));
    try {
      const request = once(client, "serverRequest");
      const done = once(client, "turn/completed");
      const completed = vi.fn(); client.on("turn/completed", completed);
      await client.startTurn(threadId, "List windows");
      const [event] = await request;
      await vi.advanceTimersByTimeAsync(600000);
      expect(completed).not.toHaveBeenCalled();
      client.respondToolCall(event.id, { success: true, contentItems: [] });
      expect((await done)[0].turn.status).toBe("completed");
    } finally { client.stop(); vi.useRealTimers(); }
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
    expect(result.turn.error?.message).toMatch(/problem talking to the AI service/);
    expect(result.turn.error?.message).not.toMatch(/HTTP|401|Check your model/);
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

  it("executes the first valid call and rejects the duplicate while continuing", async () => {
    const batch = toolReply();
    batch.choices[0].message.tool_calls.push(batch.choices[0].message.tool_calls[0]);
    const { client, threadId } = await ready(mockFetch(batch, completion("Must not run")));
    const requests = vi.fn((request) => client.respondToolCall(request.id, { success: true, contentItems: [] }));
    client.on("serverRequest", requests);
    expect((await run(client, threadId)).turn.status).toBe("completed");
    expect(requests).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("does not attach an elapsed request timer and still aborts long work on Stop", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let signal!: AbortSignal;
    const fetchImpl = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener("abort", () => reject(new Error("untrusted abort detail")));
    })) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl, { requestTimeoutMs: 10 });
    try {
      const done = once(client, "turn/completed");
      await client.startTurn(threadId, "Long work");
      expect(timeout).not.toHaveBeenCalled();
      expect(signal.aborted).toBe(false);
      client.stop();
      expect((await done)[0].turn.status).toBe("interrupted");
      expect(signal.aborted).toBe(true);
    } finally { client.stop(); timeout.mockRestore(); }
  });

  it.each(["openai", "anthropic"])("checks configured %s without tools, history or chat events", async (providerId) => {
    const reply = (text: string) => providerId === "anthropic" ? { content: [{ type: "text", text }], stop_reason: "end_turn" } : completion(text);
    const fetchImpl = mockFetch(reply("First answer"), reply("OK"), reply("Second answer"));
    const { client, threadId } = await ready(fetchImpl, { providerId });
    await run(client, threadId, "First question");
    const events = vi.fn(); client.on("item/completed", events); client.on("serverRequest", events);
    await client.checkConnection();
    expect(events).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[1];
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe("user-selected-model");
    expect(body.messages).toEqual([{ role: "user", content: "Reply with OK." }]);
    expect(body.tools).toBeUndefined(); expect(body.system).toBeUndefined();
    expect(body.max_tokens ?? body.max_completion_tokens).toBeLessThanOrEqual(128);
    if (providerId === "anthropic") {
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      expect(new Headers(init?.headers).get("anthropic-version")).toBe("2023-06-01");
      expect(new Headers(init?.headers).get("x-api-key")).toBe(KEY);
    }
    await run(client, threadId, "Second question");
    const conversation = JSON.parse(vi.mocked(fetchImpl).mock.calls[2][1]?.body as string);
    expect(JSON.stringify(conversation.messages)).toContain("First question");
    expect(JSON.stringify(conversation.messages)).not.toContain("Reply with OK.");
    client.stop();
  });

  it("checks before a thread starts and sanitizes provider failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("private body " + KEY, { status: 401 })) as unknown as typeof fetch;
    const client = new ApiAgentClient({ providerId: "openai", model: "configured-model", apiKey: KEY }, fetchImpl);
    await client.start();
    await expect(client.checkConnection()).rejects.toThrow(/HTTP 401/);
    await expect(client.checkConnection()).rejects.not.toThrow(KEY);
    client.stop();
  });

  it("never dispatches unsolicited tools from a connection check", async () => {
    const { client } = await ready(mockFetch(toolReply()));
    const dispatch = vi.fn(); client.on("serverRequest", dispatch);
    await expect(client.checkConnection()).rejects.toThrow(/connection|tools|text/i);
    expect(dispatch).not.toHaveBeenCalled(); client.stop();
  });

  it("rejects a late connection response after Stop even when fetch ignores abort", async () => {
    let release!: (response: Response) => void;
    let signal!: AbortSignal;
    const fetchImpl = vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>((resolve) => { release = resolve; }); }) as unknown as typeof fetch;
    const { client } = await ready(fetchImpl);
    const check = client.checkConnection();
    const rejected = expect(check).rejects.toThrow(/stopped|aborted/i);
    client.stop(); expect(signal.aborted).toBe(true);
    release(new Response(JSON.stringify(completion("OK"))));
    await rejected;
  });

  it.each(["openai", "anthropic"])("accepts nonempty truncated %s probe text and recovers a normal truncated turn", async (providerId) => {
    const partial = providerId === "anthropic"
      ? { content: [{ type: "text", text: "OK" }], stop_reason: "max_tokens" }
      : { choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "length" }] };
    const { client, threadId } = await ready(mockFetch(partial, partial, providerId === "anthropic" ? { content: [{ type: "text", text: "The check completed." }], stop_reason: "end_turn" } : completion("The check completed.")), { providerId });
    await expect(client.checkConnection()).resolves.toBeUndefined();
    const turn = await run(client, threadId);
    expect(turn.turn.status).toBe("completed");
    expect(turn.turn.error).toBeUndefined();
    client.stop();
  });

  it("requires usable text rather than a whitespace-only successful probe", async () => {
    const { client } = await ready(mockFetch(completion("   ")));
    await expect(client.checkConnection()).rejects.toThrow(/text/i);
    client.stop();
  });

  it("cancels only an external connection check while preserving the active conversation", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(completion("Remember this answer"))))
      .mockImplementationOnce((_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })).mockResolvedValueOnce(new Response(JSON.stringify(completion("Still connected")))) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl);
    await run(client, threadId, "Remember this question");
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const check = client.checkConnection(controller.signal);
    const rejected = expect(check).rejects.toThrow(/stopped|aborted/i);
    controller.abort();
    await rejected;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(client.isRunning).toBe(true);
    expect((await run(client, threadId, "Continue")).turn.status).toBe("completed");
    const body = JSON.parse(vi.mocked(fetchImpl).mock.calls[2][1]?.body as string);
    expect(JSON.stringify(body.messages)).toContain("Remember this answer");
    expect(JSON.stringify(body.messages)).not.toContain("Reply with OK.");
    client.stop();
  });

  it("does not start a model probe when its external signal is already aborted", async () => {
    const fetchImpl = mockFetch(completion("Should not run"));
    const { client } = await ready(fetchImpl);
    const controller = new AbortController(); controller.abort();
    await expect(client.checkConnection(controller.signal)).rejects.toThrow(/stopped|aborted/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    client.stop();
  });

  it.each([42, "Display option"])("accepts the registered string-or-number value schema (%s)", async (value) => {
    const name = "lalime_set_value";
    const { client } = await ready(mockFetch(toolReply(name, JSON.stringify({ value })), completion("Set value")));
    const threadId = await client.startThread({ dynamicTools: [{ ...TOOL, name, inputSchema: {
      type: "object", properties: { value: { type: ["string", "number"] } }, required: ["value"], additionalProperties: false,
    } }] });
    const requests = vi.fn((request) => client.respondToolCall(request.id, { success: true, contentItems: [] }));
    client.on("serverRequest", requests);
    expect((await run(client, threadId)).turn.status).toBe("completed");
    expect(requests).toHaveBeenCalledTimes(1);
    expect(requests.mock.calls[0][0].params.arguments).toEqual({ value });
    client.stop();
  });

  it.each([{ types: ["string", "number"], value: true }, { types: ["string", "unknown"], value: "text" }])("rejects invalid or unknown union schema inputs (%j)", async ({ types, value }) => {
    const name = "lalime_set_value";
    const { client } = await ready(mockFetch(toolReply(name, JSON.stringify({ value }))));
    const threadId = await client.startThread({ dynamicTools: [{ ...TOOL, name, inputSchema: {
      type: "object", properties: { value: { type: types } }, required: ["value"], additionalProperties: false,
    } }] });
    const requests = vi.fn(); client.on("serverRequest", requests);
    expect((await run(client, threadId)).turn.status).toBe("failed");
    expect(requests).not.toHaveBeenCalled();
    client.stop();
  });

  it("rejects oversized provider responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(4 * 1024 * 1024 + 1))) as unknown as typeof fetch;
    const { client, threadId } = await ready(fetchImpl);
    const diagnostics = vi.fn(); client.on("diagnostic", diagnostics);
    expect((await run(client, threadId)).turn.error?.message).toMatch(/problem talking to the AI service/);
    expect(JSON.stringify(diagnostics.mock.calls)).toMatch(/size limit/);
    client.stop();
  });
});
