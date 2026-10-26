import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ApiAgentClient } from "../electron/main/api-agent-client.js";

const TOOL = { name: "lalime_run_powershell", description: "Approved command", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } };
const outcome = "I checked the service. It is running, but the symptom has not been verified fixed.";
const jargon = /HTTP|token limit|Check your model|provider returned|tool_call|tool_use/i;

describe.each(["openai", "anthropic"])("%s provider recovery", (providerId) => {
  const reply = (text = outcome, stop = "end_turn") => providerId === "anthropic"
    ? { content: text ? [{ type: "text", text }] : [], stop_reason: stop }
    : { choices: [{ message: { role: "assistant", content: text }, finish_reason: stop === "max_tokens" ? "length" : "stop" }] };
  const calls = (entries: { id?: string; name?: string; args?: unknown }[] = [{}]) => providerId === "anthropic"
    ? { content: entries.map((call) => ({ type: "tool_use", id: call.id ?? "call_1", name: call.name ?? TOOL.name, input: call.args ?? { command: "Get-Service" } })), stop_reason: "tool_use" }
    : { choices: [{ message: { role: "assistant", content: null, tool_calls: entries.map((call) => ({ id: call.id ?? "call_1", type: "function", function: { name: call.name ?? TOOL.name, arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args ?? { command: "Get-Service" }) } })) }, finish_reason: "tool_calls" }] };
  async function setup(bodies: unknown[]) {
    const fetcher = vi.fn(async () => { const body = bodies.shift(); return body instanceof Response ? body : new Response(JSON.stringify(body ?? reply())); });
    const client = new ApiAgentClient({ providerId, model: "test-model", apiKey: "test-placeholder" }, fetcher as typeof fetch);
    await client.start(); const thread = await client.startThread({ dynamicTools: [TOOL] });
    const visible: string[] = [];
    client.on("item/completed", (event) => visible.push(event.item.text));
    const dispatch = vi.fn((event) => client.respondToolCall(event.id, { success: true, contentItems: [{ type: "inputText", text: "SERVICE_EVIDENCE: Spooler running" }] }));
    client.on("serverRequest", dispatch);
    const run = async () => { const done = once(client, "turn/completed"); await client.startTurn(thread, "Fix the symptom"); return (await done)[0]; };
    const requests = () => fetcher.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    return { client, fetcher, dispatch, visible, run, requests };
  }
  it.each(["unknown", "bad arguments", "malformed arguments", "duplicate"])("recovers %s through paired error results without executing invalid calls", async (fault) => {
    const entries = fault === "duplicate" ? [{}, {}] : [{ name: fault === "unknown" ? "unknown_tool" : TOOL.name, args: fault === "bad arguments" ? { cmd: 42 } : fault === "malformed arguments" ? "not json" : undefined }];
    const s = await setup([calls(entries), reply()]);
    expect((await s.run()).turn.status).toBe("completed");
    expect(s.dispatch).toHaveBeenCalledTimes(fault === "duplicate" ? 1 : 0);
    const messages = s.requests()[1].messages;
    const results = providerId === "anthropic" ? messages.at(-1).content : messages.filter((m: any) => m.role === "tool");
    expect(results).toHaveLength(entries.length);
    expect(JSON.stringify(results)).toMatch(/invalid|unknown|duplicate/i);
    if (providerId === "anthropic") expect(results.at(-1).is_error).toBe(true);
    const ids = results.map((r: any) => r.tool_use_id ?? r.tool_call_id);
    expect(new Set(ids).size).toBe(entries.length);
    expect(s.visible.at(-1)).toBe(outcome); expect(s.visible.join()).not.toMatch(jargon); s.client.stop();
  });
  it("keeps partial text and continues an output length stop", async () => {
    const s = await setup([reply("The first check found", "max_tokens"), reply()]);
    expect((await s.run()).turn.status).toBe("completed");
    expect(s.fetcher).toHaveBeenCalledTimes(2); expect(JSON.stringify(s.requests()[1].messages)).toContain("The first check found");
    expect(s.visible.at(-1)).toBe(outcome); s.client.stop();
  });
  it("ends identical repeated length stops with a plain nonempty summary", async () => {
    const s = await setup(Array.from({ length: 8 }, () => reply("Let me check...", "max_tokens")));
    await s.run(); expect(s.fetcher.mock.calls.length).toBeLessThan(8); expect(s.visible.at(-1)).toMatch(/verified|stopped|confirmed/i); expect(s.visible.join()).not.toMatch(jargon); s.client.stop();
  });
  it.each(["same ids", "fresh ids", "duplicate ids"])("does not execute the same tool again when an identical truncated reply repeats (%s)", async (mode) => {
    const partial: any = calls(mode === "duplicate ids" ? [{}, {}] : undefined);
    if (providerId === "anthropic") partial.stop_reason = "max_tokens";
    else partial.choices[0].finish_reason = "length";
    const repeated = Array.from({ length: 3 }, (_, index) => {
      const copy = structuredClone(partial);
      if (mode === "fresh ids") {
        if (providerId === "anthropic") copy.content[0].id = `call_${index}`;
        else copy.choices[0].message.tool_calls[0].id = `call_${index}`;
      }
      return copy;
    });
    const s = await setup([...repeated, reply()]);
    expect((await s.run()).turn.status).toBe("completed");
    expect(s.dispatch).toHaveBeenCalledTimes(1);
    const requests = s.requests();
    const messages = requests[2].messages;
    const results = providerId === "anthropic" ? messages.filter((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result")).flatMap((m: any) => m.content) : messages.filter((m: any) => m.role === "tool");
    expect(results).toHaveLength(mode === "duplicate ids" ? 4 : 2);
    expect(JSON.stringify(results.at(-1))).toMatch(/repeat|already/i);
    if (providerId === "anthropic") expect(results.at(-1).is_error).toBe(true);
    expect(requests.at(-1).tool_choice).toEqual(providerId === "anthropic" ? { type: "none" } : "none");
    expect(s.visible.at(-1)?.trim()).toBeTruthy(); s.client.stop();
  });
  it.each([true, false])("retries HTTP 400 once, retry succeeds=%s", async (succeeds) => {
    const s = await setup([new Response("private detail", { status: 400 }), succeeds ? reply() : new Response("private detail", { status: 400 })]);
    const result = await s.run(); expect(s.fetcher).toHaveBeenCalledTimes(2); expect(result.turn.status).toBe(succeeds ? "completed" : "failed");
    expect(s.visible.at(-1)?.trim()).toBeTruthy(); expect(JSON.stringify(result) + s.visible.join()).not.toMatch(/HTTP|private detail|Check your model/i); s.client.stop();
  });
  it("retries a malformed reply once", async () => {
    const s = await setup([{ malformed: true }, reply()]); await s.run(); expect(s.fetcher).toHaveBeenCalledTimes(2); expect(s.visible.at(-1)).toBe(outcome); s.client.stop();
  });
  it.each(["", "I'll start it.", "Let me check...", "Now I will run the check.", "Plan updated.", "Calling lalime_list_ui now."])("nudges an empty or narration-only final once: %s", async (text) => {
    const s = await setup([reply(text), reply()]); await s.run(); expect(s.fetcher).toHaveBeenCalledTimes(2);
    expect(s.requests()[1].tool_choice).toEqual(providerId === "anthropic" ? { type: "none" } : "none");
    expect(s.visible).toEqual([outcome]); s.client.stop();
  });
  it("falls back honestly when the summary is still empty", async () => {
    const s = await setup([calls(), reply(""), reply("")]); await s.run(); expect(s.visible.at(-1)).toMatch(/verified|confirmed/i); expect(s.visible.at(-1)?.trim()).toBeTruthy(); s.client.stop();
  });
  it("keeps the fallback outcome in the next turn's history", async () => {
    const s = await setup([reply(""), reply(""), reply()]); await s.run(); const summary = s.visible.at(-1);
    await s.run(); expect(JSON.stringify(s.requests()[2].messages)).toContain(summary); s.client.stop();
  });
  it("does not count a plan update as a completed check or change", async () => {
    const s = await setup([calls([{ name: "lalime_update_plan" }]), reply(""), reply("")]);
    const thread = await s.client.startThread({ dynamicTools: [{ ...TOOL, name: "lalime_update_plan" }] });
    const done = once(s.client, "turn/completed"); await s.client.startTurn(thread, "Repair this"); await done;
    expect(s.visible.at(-1)).not.toContain("completed 1"); expect(s.visible.at(-1)).toContain("could not confirm"); s.client.stop();
  });
  it("backs off a transient failure and Stop cancels the retry", async () => {
    vi.useFakeTimers();
    const s = await setup([new Response("busy", { status: 429 }), reply()]);
    try {
      const done = s.run(); await vi.advanceTimersByTimeAsync(0);
      expect(s.fetcher).toHaveBeenCalledTimes(1);
      s.client.stop(); expect((await done).turn.status).toBe("interrupted");
      await vi.advanceTimersByTimeAsync(1000); expect(s.fetcher).toHaveBeenCalledTimes(1);
    } finally { s.client.stop(); vi.useRealTimers(); }
  });
  it("retains completed paired tool results after a later request fails", async () => {
    const s = await setup([calls(), new Response("bad", { status: 400 }), new Response("bad", { status: 400 }), reply()]);
    expect((await s.run()).turn.status).toBe("failed"); await s.run();
    expect(JSON.stringify(s.requests().at(-1).messages)).toContain("SERVICE_EVIDENCE: Spooler running");
    expect(s.visible.join()).not.toMatch(jargon); s.client.stop();
  });
  it("retains completed results and valid pairings when Stop interrupts the next call", async () => {
    const s = await setup([calls([{ id: "first" }, { id: "second" }]), reply()]);
    s.client.removeAllListeners("serverRequest");
    let count = 0;
    s.client.on("serverRequest", (event) => {
      count++;
      if (count === 1) s.client.respondToolCall(event.id, { success: true, contentItems: [{ type: "inputText", text: "COMPLETED_FIRST_ACTION" }] });
      else void s.client.interruptTurn(event.params.threadId, event.params.turnId);
    });
    expect((await s.run()).turn.status).toBe("interrupted"); await s.run();
    const messages = s.requests()[1].messages;
    expect(JSON.stringify(messages)).toContain("COMPLETED_FIRST_ACTION");
    expect(JSON.stringify(messages)).toContain("before this result was received");
    const results = providerId === "anthropic" ? messages.find((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result")).content : messages.filter((m: any) => m.role === "tool");
    expect(results).toHaveLength(2); s.client.stop();
  });
  if (providerId === "anthropic") it("withholds the latest tool output for one refusal retry", async () => {
    const s = await setup([calls(), reply("", "refusal"), reply()]); await s.run();
    expect(s.fetcher).toHaveBeenCalledTimes(3); expect(JSON.stringify(s.requests()[2].messages)).not.toContain("SERVICE_EVIDENCE");
    expect(JSON.stringify(s.requests()[2].messages)).toContain("withheld"); expect(s.visible.at(-1)).toBe(outcome); s.client.stop();
  });
  if (providerId === "anthropic") it("does not treat a refusal as a ready connection", async () => {
    const s = await setup([reply("I cannot answer this request.", "refusal")]);
    await expect(s.client.checkConnection()).rejects.toThrow(); s.client.stop();
  });
  if (providerId === "anthropic") it("does not withhold a new tool result after refusal recovery", async () => {
    const s = await setup([calls(), reply("", "refusal"), calls([{ id: "new_call" }]), reply()]); await s.run();
    expect(JSON.stringify(s.requests()[3].messages)).toContain("SERVICE_EVIDENCE");
    expect(JSON.stringify(s.requests()[3].messages.at(-1))).not.toContain("withheld"); s.client.stop();
  });
  if (providerId === "openai") it("returns an error for malformed function metadata while keeping its valid sibling", async () => {
    const batch: any = calls([{ id: "valid" }, { id: "invalid" }]); batch.choices[0].message.tool_calls[1].function = null;
    const s = await setup([batch, reply()]); await s.run(); expect(s.dispatch).toHaveBeenCalledTimes(1);
    expect(s.requests()[1].messages.filter((m: any) => m.role === "tool")).toHaveLength(2); s.client.stop();
  });
  if (providerId === "anthropic") it("repairs only an invalid trailing content block on the 400 retry", async () => {
    const batch: any = calls(); batch.content.push({ type: "bogus" });
    const s = await setup([batch, new Response("bad", { status: 400 }), reply()]); await s.run();
    expect(s.dispatch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.requests()[1].messages)).toContain("bogus");
    expect(JSON.stringify(s.requests()[2].messages)).not.toContain("bogus");
    expect(JSON.stringify(s.requests()[2].messages)).toContain("SERVICE_EVIDENCE"); s.client.stop();
  });
});
