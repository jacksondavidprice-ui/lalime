import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppServerClient, type CodexClientOptions } from "../electron/main/codex-client.js";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawn: spawnMock,
}));

const clients: CodexAppServerClient[] = [];
afterEach(() => {
  clients.forEach((client) => client.stop());
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function setup(sync = false, requestTimeoutMs = 1000, processTransport = false, extra: Partial<CodexClientOptions> = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const messages: Array<{ id?: number; method: string; params?: Record<string, unknown> }> = [];
  const kill = vi.fn();
  const proc = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough(), kill });
  spawnMock.mockReturnValue(proc);
  stdin.on("data", (chunk) => {
    const message = JSON.parse(String(chunk));
    messages.push(message);
    if (message.id == null || message.method === "hang") return;
    const result = message.method === "thread/start" ? { thread: { id: "thread-test" } }
      : message.method === "account/read" ? { account: { type: "chatgpt", email: "test@example.com" } }
      : {};
    const reply = () => stdout.write(JSON.stringify({ id: message.id, result }) + "\n");
    if (sync) reply(); else queueMicrotask(reply);
  });
  const options = {
    requestTimeoutMs,
    ...(processTransport ? { command: "test-codex" } : { transport: { stdin, stdout, kill } }),
    ...extra,
  } as CodexClientOptions;
  const client = new CodexAppServerClient(options);
  clients.push(client);
  return { client, stdin, stdout, messages, kill, proc };
}

describe("Codex transport lifecycle", () => {
  it("uses the provider model default when settings leave the model empty", async () => {
    vi.stubEnv("LALIME_MODEL", "");
    const { client, messages } = setup();
    await client.start();
    await client.startThread({ model: "" });
    expect(messages.find((message) => message.method === "thread/start")?.params).not.toHaveProperty("model");
  });
  it("captures responses delivered during write", async () => {
    const { client } = setup(true);
    await client.start();
    await expect(client.request("echo")).resolves.toEqual({});
  }, 300);

  it("rejects requests within the configured finite deadline", async () => {
    vi.useFakeTimers();
    const { client } = setup(false, 25);
    await client.start();
    const result = expect(client.request("hang")).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(25);
    await result;
  }, 300);

  it("rejects pending requests when the child exits", async () => {
    const { client, proc } = setup(false, 1000, true);
    await client.start();
    const result = expect(client.request("hang")).rejects.toThrow(/exit|closed/i);
    proc.emit("exit", 1);
    await result;
    expect(client.isRunning).toBe(false);
  }, 300);

  it("handles child errors without an error listener", async () => {
    const { client, proc } = setup(false, 1000, true);
    await client.start();
    const result = expect(client.request("hang")).rejects.toThrow("transport failed");
    expect(() => proc.emit("error", new Error("transport failed"))).not.toThrow();
    await result;
    expect(client.isRunning).toBe(false);
  });

  it("rejects requests when stdout closes", async () => {
    const { client, stdout } = setup();
    await client.start();
    const result = expect(client.request("hang")).rejects.toThrow(/closed/i);
    stdout.emit("close");
    await result;
  }, 300);

  it("handles stdin errors and stops the transport", async () => {
    const { client, stdin } = setup();
    await client.start();
    const result = expect(client.request("hang")).rejects.toThrow("broken pipe");
    expect(() => stdin.emit("error", new Error("broken pipe"))).not.toThrow();
    await result;
    expect(client.isRunning).toBe(false);
  });

  it("returns a rejected promise when a write throws", async () => {
    const { client, stdin } = setup();
    await client.start();
    vi.spyOn(stdin, "write").mockImplementation(() => { throw new Error("write failed"); });
    let result: Promise<unknown> | undefined;
    expect(() => { result = client.request("echo"); }).not.toThrow();
    await expect(result).rejects.toThrow("write failed");
  });

  it("ignores malformed message shapes without crashing", async () => {
    const { client, stdout } = setup();
    await client.start();
    expect(() => stdout.write("null\n42\n[]\n")).not.toThrow();
    await expect(client.request("echo")).resolves.toEqual({});
  });

  it("stops only once and removes the readline listener", async () => {
    const { client, stdout, kill } = setup();
    await client.start();
    client.stop();
    client.stop();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(stdout.listenerCount("data")).toBe(0);
  });

  it("shares initialization across concurrent starts", async () => {
    const { client, messages } = setup();
    const first = client.start();
    const second = client.start();
    await Promise.all([first, second]);
    expect(messages.filter((message) => message.method === "initialize")).toHaveLength(1);
    expect(messages.filter((message) => message.method === "initialized")).toHaveLength(1);
  });
});

describe("Codex safety and account requests", () => {
  it("uses the app-owned Codex home without changing the parent environment", async () => {
    vi.stubEnv("CODEX_HOME", "/other-app-codex");
    const { client } = setup(false, 1000, true, { codexHome: "/lime-user-data/codex" });
    await client.start();
    expect(spawnMock.mock.lastCall?.[2].env.CODEX_HOME).toBe("/lime-user-data/codex");
    expect(process.env.CODEX_HOME).toBe("/other-app-codex");
  });

  it("preserves the caller environment when no Codex home is supplied", async () => {
    vi.stubEnv("CODEX_HOME", "/caller-codex");
    const { client } = setup(false, 1000, true);
    await client.start();
    expect(spawnMock.mock.lastCall?.[2].env.CODEX_HOME).toBe("/caller-codex");
  });

  it("does not inherit provider keys into the isolated account store", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-placeholder");
    vi.stubEnv("CODEX_API_KEY", "test-codex-placeholder");
    vi.stubEnv("LALIME_MODEL", "test-model");
    const { client } = setup(false, 1000, true, { codexHome: "/lime-user-data/codex" });
    await client.start();
    const childEnv = spawnMock.mock.lastCall?.[2].env;
    expect(childEnv.OPENAI_API_KEY).toBeUndefined();
    expect(childEnv.CODEX_API_KEY).toBeUndefined();
    expect(childEnv.LALIME_MODEL).toBe("test-model");
    expect(process.env.OPENAI_API_KEY).toBe("test-openai-placeholder");
    expect(process.env.CODEX_API_KEY).toBe("test-codex-placeholder");
  });

  it("disables built-in shell and app tools outside the Lalime tool gate", async () => {
    const { client, messages } = setup();
    await client.start();
    await client.startThread();
    expect(messages.find((message) => message.method === "thread/start")?.params?.config).toMatchObject({
      "features.shell_tool": false,
      "features.apps": false,
      "features.browser_use": false,
      "features.browser_use_external": false,
      "web_search": "disabled",
    });
  });

  it("requests read-only thread and turn sandboxes with approval checks", async () => {
    const { client, messages } = setup();
    await client.start();
    const dynamicTools = [{ type: "function" as const, name: "safe_tool", description: "Test", inputSchema: {} }];
    const threadId = await client.startThread({ model: "test-model", cwd: "/test", dynamicTools, developerInstructions: "Test only" });
    await client.startTurn(threadId, "hello");
    expect(messages.find((message) => message.method === "thread/start")?.params).toMatchObject({
      sandbox: "read-only", approvalPolicy: "untrusted", model: "test-model", cwd: "/test", dynamicTools, developerInstructions: "Test only",
    });
    expect(messages.find((message) => message.method === "turn/start")?.params).toMatchObject({
      sandboxPolicy: { type: "readOnly" }, approvalPolicy: "untrusted",
    });
  });

  it("reads account state and signs out through the server", async () => {
    const { client, messages } = setup();
    await client.start();
    await expect(client.readAccount()).resolves.toMatchObject({ account: { type: "chatgpt" } });
    await client.logout();
    expect(messages.find((message) => message.method === "account/read")?.params).toEqual({ refreshToken: false });
    expect(messages.some((message) => message.method === "account/logout")).toBe(true);
  });
});
