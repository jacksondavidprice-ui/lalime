# Codex transport verification

Date: 2026-10-25. Scope: electron/main/codex-client.ts and tests/codex-client.test.ts.
Tests use local fake streams. No account credentials, login, or inference were used.

## Protocol evidence

The [official app-server reference](https://learn.chatgpt.com/docs/app-server) documents account/read, account/logout, and sandbox policies.
The installed codex-cli 0.155.0-alpha.9.2 schema was checked with:

```powershell
codex app-server generate-json-schema --experimental --out (Join-Path $env:TEMP 'lalime-codex-schema')
```

Exit status: 0. ThreadStartParams has sandbox values read-only, workspace-write, and danger-full-access. AskForApproval includes untrusted. TurnStartParams accepts sandboxPolicy.type readOnly; networkAccess defaults to false.
The current web example uses a different spelling for the thread sandbox. The code uses the installed schema.
The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents shell, app, browser, and search controls. Thread-local overrides disable these built-in paths.

## Red evidence

Command: `npm test -- tests/codex-client.test.ts`.

Before the production edit, exit status was 1: 11 failures and 1 pass.
Synchronous replies, deadlines, process exit, and output closure reached the 300 ms test limit.
Child and input errors threw without a listener. A write failure threw instead of rejecting.
A null JSON message threw a TypeError. Two stop calls invoked kill twice.
The thread request used workspaceWrite and on-request instead of the required read-only and untrusted values.
readAccount was absent. Two failed error assertions also produced unhandled rejections during cleanup.
These failures demonstrate the transport defects; the green run has no unhandled errors.
Initial test SHA256: 4B7A710D88F36E6EE194860101A1E23ABAEA262E631FD1A4414600AF0006F612.
The 12 accepted tests stayed fixed during implementation.

Exact initial test addition:

```diff
*** Add File: tests/codex-client.test.ts
+import { EventEmitter } from "node:events";
+import { PassThrough } from "node:stream";
+import { afterEach, describe, expect, it, vi } from "vitest";
+import { CodexAppServerClient, type CodexClientOptions } from "../electron/main/codex-client.js";
+
+const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
+vi.mock("node:child_process", async (original) => ({
+  ...await original<typeof import("node:child_process")>(),
+  spawn: spawnMock,
+}));
+
+const clients: CodexAppServerClient[] = [];
+afterEach(() => {
+  clients.forEach((client) => client.stop());
+  clients.length = 0;
+  vi.useRealTimers();
+});
+
+function setup(sync = false, requestTimeoutMs = 1000, processTransport = false) {
+  const stdin = new PassThrough();
+  const stdout = new PassThrough();
+  const messages: Array<{ id?: number; method: string; params?: Record<string, unknown> }> = [];
+  const kill = vi.fn();
+  const proc = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough(), kill });
+  spawnMock.mockReturnValue(proc);
+  stdin.on("data", (chunk) => {
+    const message = JSON.parse(String(chunk));
+    messages.push(message);
+    if (message.id == null || message.method === "hang") return;
+    const result = message.method === "thread/start" ? { thread: { id: "thread-test" } }
+      : message.method === "account/read" ? { account: { type: "chatgpt", email: "test@example.com" } }
+      : {};
+    const reply = () => stdout.write(JSON.stringify({ id: message.id, result }) + "\n");
+    if (sync) reply(); else queueMicrotask(reply);
+  });
+  const options = {
+    requestTimeoutMs,
+    ...(processTransport ? { command: "test-codex" } : { transport: { stdin, stdout, kill } }),
+  } as CodexClientOptions;
+  const client = new CodexAppServerClient(options);
+  clients.push(client);
+  return { client, stdin, stdout, messages, kill, proc };
+}
+
+describe("Codex transport lifecycle", () => {
+  it("captures responses delivered during write", async () => {
+    const { client } = setup(true);
+    await client.start();
+    await expect(client.request("echo")).resolves.toEqual({});
+  }, 300);
+
+  it("rejects requests within the configured finite deadline", async () => {
+    vi.useFakeTimers();
+    const { client } = setup(false, 25);
+    await client.start();
+    const result = expect(client.request("hang")).rejects.toThrow(/timed out/i);
+    await vi.advanceTimersByTimeAsync(25);
+    await result;
+  }, 300);
+
+  it("rejects pending requests when the child exits", async () => {
+    const { client, proc } = setup(false, 1000, true);
+    await client.start();
+    const result = expect(client.request("hang")).rejects.toThrow(/exit|closed/i);
+    proc.emit("exit", 1);
+    await result;
+    expect(client.isRunning).toBe(false);
+  }, 300);
+
+  it("handles child errors without an error listener", async () => {
+    const { client, proc } = setup(false, 1000, true);
+    await client.start();
+    const result = expect(client.request("hang")).rejects.toThrow("transport failed");
+    expect(() => proc.emit("error", new Error("transport failed"))).not.toThrow();
+    await result;
+    expect(client.isRunning).toBe(false);
+  });
+
+  it("rejects requests when stdout closes", async () => {
+    const { client, stdout } = setup();
+    await client.start();
+    const result = expect(client.request("hang")).rejects.toThrow(/closed/i);
+    stdout.emit("close");
+    await result;
+  }, 300);
+
+  it("handles stdin errors and stops the transport", async () => {
+    const { client, stdin } = setup();
+    await client.start();
+    const result = expect(client.request("hang")).rejects.toThrow("broken pipe");
+    expect(() => stdin.emit("error", new Error("broken pipe"))).not.toThrow();
+    await result;
+    expect(client.isRunning).toBe(false);
+  });
+
+  it("returns a rejected promise when a write throws", async () => {
+    const { client, stdin } = setup();
+    await client.start();
+    vi.spyOn(stdin, "write").mockImplementation(() => { throw new Error("write failed"); });
+    let result: Promise<unknown> | undefined;
+    expect(() => { result = client.request("echo"); }).not.toThrow();
+    await expect(result).rejects.toThrow("write failed");
+  });
+
+  it("ignores malformed message shapes without crashing", async () => {
+    const { client, stdout } = setup();
+    await client.start();
+    expect(() => stdout.write("null\n42\n[]\n")).not.toThrow();
+    await expect(client.request("echo")).resolves.toEqual({});
+  });
+
+  it("stops only once and removes the readline listener", async () => {
+    const { client, stdout, kill } = setup();
+    await client.start();
+    client.stop();
+    client.stop();
+    expect(kill).toHaveBeenCalledTimes(1);
+    expect(stdout.listenerCount("data")).toBe(0);
+  });
+
+  it("shares initialization across concurrent starts", async () => {
+    const { client, messages } = setup();
+    const first = client.start();
+    const second = client.start();
+    await Promise.all([first, second]);
+    expect(messages.filter((message) => message.method === "initialize")).toHaveLength(1);
+    expect(messages.filter((message) => message.method === "initialized")).toHaveLength(1);
+  });
+});
+
+describe("Codex safety and account requests", () => {
+  it("requests read-only thread and turn sandboxes with approval checks", async () => {
+    const { client, messages } = setup();
+    await client.start();
+    const dynamicTools = [{ type: "function" as const, name: "safe_tool", description: "Test", inputSchema: {} }];
+    const threadId = await client.startThread({ model: "test-model", cwd: "/test", dynamicTools, developerInstructions: "Test only" });
+    await client.startTurn(threadId, "hello");
+    expect(messages.find((message) => message.method === "thread/start")?.params).toMatchObject({
+      sandbox: "read-only", approvalPolicy: "untrusted", model: "test-model", cwd: "/test", dynamicTools, developerInstructions: "Test only",
+    });
+    expect(messages.find((message) => message.method === "turn/start")?.params).toMatchObject({
+      sandboxPolicy: { type: "readOnly" }, approvalPolicy: "untrusted",
+    });
+  });
+
+  it("reads account state and signs out through the server", async () => {
+    const { client, messages } = setup();
+    await client.start();
+    await expect(client.readAccount()).resolves.toMatchObject({ account: { type: "chatgpt" } });
+    await client.logout();
+    expect(messages.find((message) => message.method === "account/read")?.params).toEqual({ refreshToken: false });
+    expect(messages.some((message) => message.method === "account/logout")).toBe(true);
+  });
+});
```

A second cycle added the following test before adding the configuration overrides.
The same command exited 1: 12 passed, 1 failed. The expected config object was undefined.
That test stayed fixed during its implementation.

```diff
+  it("disables built-in shell and app tools outside the Lalime tool gate", async () => {
+    const { client, messages } = setup();
+    await client.start();
+    await client.startThread();
+    expect(messages.find((message) => message.method === "thread/start")?.params?.config).toMatchObject({
+      "features.shell_tool": false,
+      "features.apps": false,
+      "features.browser_use": false,
+      "features.browser_use_external": false,
+      "web_search": "disabled",
+    });
+  });
```

## Green evidence and checks

- `npm test -- tests/codex-client.test.ts tests/live-agent.test.ts`: exit 0, 16 tests passed.
- `npm test -- tests/codex-client.test.ts`: exit 0, 13 tests passed.
- `npm run typecheck`: exit 1 during concurrent integration, at ChatHome.tsx state typing.
- `npx tsc -p tsconfig.electron.json --noEmit`: exit 1 during concurrent integration, at IPC calls to SessionController methods under development.

The main integration owner must rerun type checks, the full suite, and the build after all writers finish.
No formatter or lint command is defined in package.json. The ship-check skill is not in the available skill catalog.

## Limits

A response timeout rejects the caller but cannot prove that the server cancelled the request.
Do not retry an action with effects automatically after a timeout.
The read-only sandbox protects filesystem writes by built-in tools. It does not prevent reads of all user files.
The optional codexHome setting selects an app-owned configuration and account directory.
When set, the child does not inherit OPENAI_API_KEY or CODEX_API_KEY. No account files are copied.
Without this option, the client retains the caller's Codex configuration and account store.
The parent session supplies this option for the Lime app. Administrator configuration and project-local configuration can still apply.
Real login, real provider inference, and packaged Windows sandbox behavior were not tested here.

## Isolated account directory follow-up

Two more red-green cycles used `npm test -- tests/codex-client.test.ts`.
The first red run exited 1 with 1 failure and 14 passes: child CODEX_HOME used the parent path instead of the supplied app path.
The first green run exited 0 with 15 passes.
The second red run exited 1 with 1 failure and 15 passes: child OPENAI_API_KEY retained the test placeholder.
The final green run exited 0 with 16 passes. No real environment values were printed.
The test helper gained an optional extra options argument, spread into client options, and afterEach restores stubbed environment variables.
These new tests stayed fixed during their respective production changes:

```diff
+  it("uses the app-owned Codex home without changing the parent environment", async () => {
+    vi.stubEnv("CODEX_HOME", "/other-app-codex");
+    const { client } = setup(false, 1000, true, { codexHome: "/lime-user-data/codex" });
+    await client.start();
+    expect(spawnMock.mock.lastCall?.[2].env.CODEX_HOME).toBe("/lime-user-data/codex");
+    expect(process.env.CODEX_HOME).toBe("/other-app-codex");
+  });
+
+  it("preserves the caller environment when no Codex home is supplied", async () => {
+    vi.stubEnv("CODEX_HOME", "/caller-codex");
+    const { client } = setup(false, 1000, true);
+    await client.start();
+    expect(spawnMock.mock.lastCall?.[2].env.CODEX_HOME).toBe("/caller-codex");
+  });
+
+  it("does not inherit provider keys into the isolated account store", async () => {
+    vi.stubEnv("OPENAI_API_KEY", "test-openai-placeholder");
+    vi.stubEnv("CODEX_API_KEY", "test-codex-placeholder");
+    vi.stubEnv("LALIME_MODEL", "test-model");
+    const { client } = setup(false, 1000, true, { codexHome: "/lime-user-data/codex" });
+    await client.start();
+    const childEnv = spawnMock.mock.lastCall?.[2].env;
+    expect(childEnv.OPENAI_API_KEY).toBeUndefined();
+    expect(childEnv.CODEX_API_KEY).toBeUndefined();
+    expect(childEnv.LALIME_MODEL).toBe("test-model");
+    expect(process.env.OPENAI_API_KEY).toBe("test-openai-placeholder");
+    expect(process.env.CODEX_API_KEY).toBe("test-codex-placeholder");
+  });
```
