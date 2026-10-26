/**
 * JSON-RPC client for `codex app-server` (stdio).
 *
 * Protocol (verified against learn.chatgpt.com/docs/app-server, Oct 2026):
 * - Client requests: { id, method, params } → { id, result | error }
 * - Notifications: { method, params } (no id)
 * - Server requests: { id, method, params } — reply with { id, result }
 *   e.g. item/commandExecution/requestApproval, item/tool/call
 *
 * Auth: account/login/start { type: "chatgpt" | "apiKey" | "chatgptDeviceCode" }
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import { isCodexAvailable, resolveCodexCommand } from "./codex-resolve.js";

export interface CodexClientOptions {
  command?: string;
  args?: string[];
  /** App-owned configuration and account directory. No user config is copied. */
  codexHome?: string;
  /** Maximum time for control RPC replies. Model turn starts have no deadline. */
  requestTimeoutMs?: number;
  /** Injected stdio for tests (fake server). */
  transport?: {
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
    kill?: () => void;
  };
}

export type ApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export interface DynamicToolSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DynamicToolCallResponse {
  contentItems: Array<
    | { type: "inputText"; text: string }
    | { type: "inputImage"; imageUrl: string }
  >;
  success: boolean;
}

export interface CodexAccountState {
  account: { type: string; email?: string | null; planType?: string | null } | null;
  requiresOpenaiAuth?: boolean;
}

type JsonRpc =
  | { jsonrpc?: string; id: number | string; method: string; params?: unknown }
  | { jsonrpc?: string; id: number | string; result?: unknown; error?: { code: number; message: string } }
  | { jsonrpc?: string; method: string; params?: unknown };

export class CodexAppServerClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private transportKill: (() => void) | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout>; turnThreadId?: string }
  >();
  private stdin: NodeJS.WritableStream | null = null;
  private started = false;
  private starting: Promise<void> | null = null;
  private reader: readline.Interface | null = null;

  constructor(private readonly options: CodexClientOptions = {}) {
    super();
    if (options.requestTimeoutMs !== undefined &&
        (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0 || options.requestTimeoutMs > 2_147_483_647)) {
      throw new Error("requestTimeoutMs must be a positive finite timer interval");
    }
  }

  get isRunning(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.started) return;
    this.starting = this.startTransport();
    try {
      await this.starting;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      this.starting = null;
    }
  }

  private async startTransport(): Promise<void> {
    let stdout: NodeJS.ReadableStream;

    if (this.options.transport) {
      this.stdin = this.options.transport.stdin;
      this.transportKill = this.options.transport.kill ?? null;
      stdout = this.options.transport.stdout;
    } else {
      const command = this.options.command ?? resolveCodexCommand();
      if (!isCodexAvailable() && !this.options.command) {
        throw new Error(
          `Codex CLI not found. Install with "npm i -g @openai/codex" or set LALIME_CODEX_BIN to your installed Codex CLI. Then return to Lalime and select "Sign in with ChatGPT".`,
        );
      }
      const args = this.options.args ?? ["app-server", "--listen", "stdio://"];
      const env = { ...process.env };
      if (this.options.codexHome !== undefined) {
        env.CODEX_HOME = this.options.codexHome;
        delete env.OPENAI_API_KEY;
        delete env.CODEX_API_KEY;
      }
      this.proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
        // Windows npm shims are often .cmd — shell helps spawn them reliably.
        shell: process.platform === "win32",
      });
      this.stdin = this.proc.stdin;
      stdout = this.proc.stdout;
      const proc = this.proc;
      this.proc.stderr.on("data", (buf: Buffer) => {
        this.emit("stderr", buf.toString("utf8"));
      });
      this.proc.on("exit", (code) => {
        if (this.proc !== proc) return;
        this.closeTransport(new Error(`Codex app-server exited (${code ?? "signal"})`));
        this.emit("exit", code);
      });
      this.proc.on("error", (err) => {
        if (this.proc === proc) this.failTransport(err);
      });
    }

    this.started = true;
    const input = this.stdin;
    const onError = (error: Error) => {
      if (this.stdin === input) this.failTransport(error);
    };
    input.on("error", onError);
    stdout.on("error", onError);
    const reader = readline.createInterface({ input: stdout });
    this.reader = reader;
    reader.on("line", (line) => this.onLine(line));
    const onClose = () => {
      if (this.reader === reader) this.failTransport(new Error("Codex transport closed"));
    };
    reader.on("close", onClose);
    stdout.once("close", onClose);
    input.once("close", onClose);

    await this.request("initialize", {
      clientInfo: {
        name: "lalime",
        title: "Lalime",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.notify("initialized", {});
  }

  stop(): void {
    this.closeTransport(new Error("Codex client stopped"));
  }

  private failTransport(error: Error): void {
    this.closeTransport(error);
    this.emit("transportError", error);
    // EventEmitter throws when an error event has no listener.
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  private closeTransport(error: Error): void {
    const proc = this.proc;
    const kill = this.transportKill;
    const reader = this.reader;
    this.reader = null;
    this.transportKill = null;
    this.proc = null;
    this.stdin = null;
    this.started = false;
    reader?.close();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    kill?.();
    proc?.kill();
  }

  async loginWithChatgpt(): Promise<{ authUrl?: string; loginId?: string }> {
    const result = (await this.request("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    })) as { authUrl?: string; auth_url?: string; loginId?: string };
    return {
      authUrl: result.authUrl ?? result.auth_url,
      loginId: result.loginId,
    };
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    await this.request("account/login/start", { type: "apiKey", apiKey });
  }

  async readAccount(): Promise<CodexAccountState> {
    return await this.request("account/read", { refreshToken: false }) as CodexAccountState;
  }

  async logout(): Promise<void> {
    await this.request("account/logout", {});
  }

  async startThread(options: {
    model?: string;
    cwd?: string;
    dynamicTools?: DynamicToolSpec[];
    developerInstructions?: string;
  } = {}): Promise<string> {
    const params: Record<string, unknown> = {
      sandbox: "read-only",
      approvalPolicy: "untrusted",
      // Computer actions must use the tools checked by Lalime's Guardian.
      config: {
        "features.shell_tool": false,
        "features.apps": false,
        "features.browser_use": false,
        "features.browser_use_external": false,
        "web_search": "disabled",
      },
    };
    const model = options.model?.trim() || process.env.LALIME_MODEL?.trim();
    if (model) params.model = model;
    if (options.cwd) params.cwd = options.cwd;
    if (options.dynamicTools?.length) params.dynamicTools = options.dynamicTools;
    if (options.developerInstructions) {
      params.developerInstructions = options.developerInstructions;
    }
    const result = (await this.request("thread/start", params)) as {
      thread: { id: string };
    };
    return result.thread.id;
  }

  async startTurn(threadId: string, text: string): Promise<{ turnId?: string }> {
    const result = (await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
      sandboxPolicy: {
        type: "readOnly",
      },
      approvalPolicy: "untrusted",
    })) as { turn?: { id: string } };
    return { turnId: result.turn?.id };
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (pending.turnThreadId !== threadId) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex turn stopped"));
    }
    try {
      await this.request("turn/interrupt", { threadId, turnId });
    } catch {
      // Older builds may use different interrupt shapes; ignore soft failures.
    }
  }

  /** Reply to a server-initiated approval request. */
  respondApproval(requestId: number | string, decision: ApprovalDecision): void {
    this.send({ id: requestId, result: { decision } });
  }

  /** Reply to item/tool/call. */
  respondToolCall(requestId: number | string, response: DynamicToolCallResponse): void {
    this.send({ id: requestId, result: response });
  }

  /** Reply to item/fileChange/requestApproval. */
  respondFileChangeApproval(
    requestId: number | string,
    decision: ApprovalDecision,
  ): void {
    this.send({ id: requestId, result: { decision } });
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = method === "turn/start" ? undefined : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.options.requestTimeoutMs ?? 30_000);
      const turnThreadId = method === "turn/start" && params && typeof params === "object" && "threadId" in params
        ? String(params.threadId) : undefined;
      this.pending.set(id, { resolve, reject, timer, turnThreadId });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Codex transport write failed"));
      }
    });
  }

  private send(message: JsonRpc): void {
    if (!this.stdin) {
      throw new Error("Codex app-server is not running");
    }
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: JsonRpc;
    try {
      msg = JSON.parse(line) as JsonRpc;
      if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
        throw new Error("Invalid JSON-RPC message");
      }
    } catch {
      this.emit("parse_error", line);
      return;
    }

    const hasId = "id" in msg && (msg as { id?: unknown }).id != null;
    const hasMethod = "method" in msg && typeof (msg as { method?: unknown }).method === "string";
    const hasResult = "result" in msg || "error" in msg;

    // Server-initiated request: { id, method, params }
    if (hasId && hasMethod && !hasResult) {
      const req = msg as { id: number | string; method: string; params?: unknown };
      this.emit("serverRequest", { id: req.id, method: req.method, params: req.params });
      this.emit(req.method, { id: req.id, params: req.params });
      return;
    }

    // Response to our request
    if (hasId && hasResult) {
      const resp = msg as {
        id: number | string;
        result?: unknown;
        error?: { code: number; message: string };
      };
      const pending = this.pending.get(resp.id);
      if (pending) {
        this.pending.delete(resp.id);
        clearTimeout(pending.timer);
        if (resp.error) {
          pending.reject(new Error(resp.error.message));
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Notification
    if (hasMethod) {
      const note = msg as { method: string; params?: unknown };
      this.emit("notification", note);
      this.emit(note.method, note.params);
    }
  }
}

export function isCodexOnPath(): boolean {
  return isCodexAvailable();
}
