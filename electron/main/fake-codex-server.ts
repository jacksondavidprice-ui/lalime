/**
 * Scripted fake Codex app-server for tests (stdio JSON-RPC).
 * Speaks enough of the protocol for LiveAgentHost end-to-end tests.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

export interface FakeScenarioStep {
  /** After turn/start, emit these server messages in order. */
  afterTurn: Array<Record<string, unknown>>;
}

export class FakeCodexServer extends EventEmitter {
  readonly clientToServer = new PassThrough();
  readonly serverToClient = new PassThrough();
  private buf = "";
  private scenario: FakeScenarioStep | null = null;
  private threadId = "thr_fake_1";
  private turnId = "turn_fake_1";

  constructor() {
    super();
    this.clientToServer.setEncoding("utf8");
    this.serverToClient.setEncoding("utf8");
    this.clientToServer.on("data", (chunk: string) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (line.trim()) this.onClientLine(line);
      }
    });
  }

  setScenario(scenario: FakeScenarioStep): void {
    this.scenario = scenario;
  }

  transport() {
    return {
      // Client writes to clientToServer; server reads it.
      // Client reads from serverToClient; server writes it.
      stdin: this.clientToServer,
      stdout: this.serverToClient,
      kill: () => {
        this.clientToServer.end();
        this.serverToClient.end();
      },
    };
  }

  private send(msg: Record<string, unknown>): void {
    // Defer so the client's readline is not racing a sync write in the same tick.
    setImmediate(() => {
      this.serverToClient.write(`${JSON.stringify(msg)}\n`);
    });
  }

  private onClientLine(line: string): void {
    const msg = JSON.parse(line) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
    };

    // Client answering a server request
    if (msg.id != null && msg.method == null && ("result" in msg || "error" in msg)) {
      this.emit("clientResponse", msg);
      return;
    }

    if (!msg.method || msg.id == null) return;

    switch (msg.method) {
      case "initialize":
        this.send({ id: msg.id, result: { userAgent: "fake-codex" } });
        break;
      case "account/login/start":
        this.send({
          id: msg.id,
          result:
            msg.params?.type === "apiKey"
              ? { type: "apiKey" }
              : { type: "chatgpt", authUrl: "https://chatgpt.com/login#fake" },
        });
        this.send({
          method: "account/login/completed",
          params: { success: true, error: null },
        });
        break;
      case "thread/start":
        this.send({
          id: msg.id,
          result: { thread: { id: this.threadId } },
        });
        this.send({
          method: "thread/started",
          params: { thread: { id: this.threadId } },
        });
        break;
      case "turn/start":
        this.send({
          id: msg.id,
          result: { turn: { id: this.turnId, status: "inProgress", items: [] } },
        });
        this.send({
          method: "turn/started",
          params: { turn: { id: this.turnId, status: "inProgress", items: [] } },
        });
        void this.runScenario();
        break;
      case "turn/interrupt":
        this.send({ id: msg.id, result: {} });
        break;
      default:
        this.send({
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        });
    }
  }

  private async runScenario(): Promise<void> {
    const steps = this.scenario?.afterTurn ?? defaultBenignScenario(this.threadId, this.turnId);
    for (const step of steps) {
      await delay(5);
      this.send(step);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function defaultBenignScenario(
  threadId: string,
  turnId: string,
): Array<Record<string, unknown>> {
  return [
    {
      method: "item/started",
      params: {
        item: {
          id: "msg1",
          type: "agentMessage",
          text: "",
        },
      },
    },
    {
      method: "item/agentMessage/delta",
      params: { delta: "I can help with that. " },
    },
    {
      method: "item/agentMessage/delta",
      params: { delta: "Checking the screen first." },
    },
    {
      method: "item/completed",
      params: {
        item: {
          id: "msg1",
          type: "agentMessage",
          text: "I can help with that. Checking the screen first.",
        },
      },
    },
    {
      method: "item/started",
      params: {
        item: {
          id: "tool1",
          type: "dynamicToolCall",
          tool: "lalime_screenshot",
          arguments: {},
          status: "inProgress",
        },
      },
    },
    {
      id: 9001,
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId: "tool1",
        tool: "lalime_screenshot",
        arguments: {},
      },
    },
  ];
}

export function dangerousCommandScenario(
  threadId: string,
  turnId: string,
): Array<Record<string, unknown>> {
  return [
    {
      method: "item/agentMessage/delta",
      params: { delta: "I should not do that — asking Guardian." },
    },
    {
      method: "item/started",
      params: {
        item: {
          id: "cmd1",
          type: "commandExecution",
          command: "Remove-Item -Recurse -Force C:\\Windows\\System32\\*",
          cwd: "C:\\",
          status: "pending",
        },
      },
    },
    {
      id: 9002,
      method: "item/commandExecution/requestApproval",
      params: {
        itemId: "cmd1",
        threadId,
        turnId,
        command: "Remove-Item -Recurse -Force C:\\Windows\\System32\\*",
        cwd: "C:\\",
        reason: "Delete System32",
      },
    },
  ];
}

export function recycleAskScenario(
  threadId: string,
  turnId: string,
): Array<Record<string, unknown>> {
  return [
    {
      method: "item/agentMessage/delta",
      params: { delta: "I will tidy Downloads — with your OK." },
    },
    {
      id: 9003,
      method: "item/tool/call",
      params: {
        threadId,
        turnId,
        callId: "rec1",
        tool: "lalime_recycle",
        arguments: {
          paths: ["C:\\Users\\Demo\\Downloads\\old_setup.exe"],
          summary: "Move old installers to the Recycle Bin",
        },
      },
    },
  ];
}
