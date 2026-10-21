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
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private stdin: NodeJS.WritableStream | null = null;
  private started = false;

  constructor(private readonly options: CodexClientOptions = {}) {
    super();
  }

  get isRunning(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (this.options.transport) {
      this.stdin = this.options.transport.stdin;
      this.transportKill = this.options.transport.kill ?? null;
      const rl = readline.createInterface({ input: this.options.transport.stdout });
      rl.on("line", (line) => this.onLine(line));
    } else {
      const command = this.options.command ?? resolveCodexCommand();
      if (!isCodexAvailable() && !this.options.command) {
        throw new Error(
          `Codex CLI not found. Install with "npm i -g @openai/codex", run "codex login", or set LALIME_CODEX_BIN.`,
        );
      }
      const args = this.options.args ?? ["app-server", "--listen", "stdio://"];
      this.proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        // Windows npm shims are often .cmd — shell helps spawn them reliably.
        shell: process.platform === "win32",
      });
      this.stdin = this.proc.stdin;
      const rl = readline.createInterface({ input: this.proc.stdout });
      rl.on("line", (line) => this.onLine(line));
      this.proc.stderr.on("data", (buf: Buffer) => {
        this.emit("stderr", buf.toString("utf8"));
      });
      this.proc.on("exit", (code) => {
        this.emit("exit", code);
        this.started = false;
        this.proc = null;
      });
      this.proc.on("error", (err) => {
        this.emit("error", err);
      });
    }

    this.started = true;

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
    this.transportKill?.();
    this.proc?.kill();
    this.proc = null;
    this.stdin = null;
    this.started = false;
    for (const [, p] of this.pending) {
      p.reject(new Error("Codex client stopped"));
    }
    this.pending.clear();
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

  async startThread(options: {
    model?: string;
    cwd?: string;
    dynamicTools?: DynamicToolSpec[];
    developerInstructions?: string;
  } = {}): Promise<string> {
    const params: Record<string, unknown> = {
      model: options.model ?? process.env.LALIME_MODEL ?? "gpt-5.4",
      sandboxPolicy: {
        type: "workspaceWrite",
        networkAccess: false,
      },
      approvalPolicy: "on-request",
    };
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
        type: "workspaceWrite",
        networkAccess: false,
      },
      approvalPolicy: "on-request",
    })) as { turn?: { id: string } };
    return { turnId: result.turn?.id };
  }

  async interruptTurn(threadId: string, turnId?: string): Promise<void> {
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
    this.send({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
