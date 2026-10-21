/**
 * Live agent host: Codex app-server turns with every tool/command gated by Guardian.
 */

import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import {
  demoReviewer,
  evaluateAction,
} from "../../guardian/src/index.js";
import type { HandsClient } from "../../hands/src/types.js";
import type {
  ApprovalChoice,
  GuardianDecision,
  PendingApproval,
  PlanStep,
  ProposedAction,
} from "../../shared/types.js";
import {
  CodexAppServerClient,
  type ApprovalDecision,
  type DynamicToolSpec,
} from "./codex-client.js";

const DEVELOPER_INSTRUCTIONS = `You are Lalime, a calm computer helper for people who are not comfortable with PCs.
Speak in short plain English. Prefer safe, reversible steps.
Never suggest deleting System32, disabling Defender, or downloading and running scripts.
When you need the screen or UI, use the lalime_* tools. Shell/PowerShell will be checked by Guardian before running.`;

export const LALIME_DYNAMIC_TOOLS: DynamicToolSpec[] = [
  {
    type: "function",
    name: "lalime_screenshot",
    description: "Capture the current screen so you can see what the user sees.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "lalime_list_windows",
    description: "List open window titles.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "lalime_list_ui",
    description: "List UI Automation elements in a window by title.",
    inputSchema: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lalime_click",
    description: "Click a UI element by accessible name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        windowTitle: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lalime_type",
    description: "Type text into the focused field or named window.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        windowTitle: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lalime_open_settings",
    description: "Open a Windows Settings page via ms-settings: URI.",
    inputSchema: {
      type: "object",
      properties: {
        uri: { type: "string", description: "e.g. ms-settings:display" },
      },
      required: ["uri"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "lalime_recycle",
    description: "Move files to the Recycle Bin (undoable).",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["paths"],
      additionalProperties: false,
    },
  },
];

function actionId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface LiveAgentEvents {
  status: (text: string) => void;
  delta: (text: string) => void;
  messageDone: (text: string) => void;
  plan: (steps: PlanStep[]) => void;
  approvalNeeded: (pending: PendingApproval) => void;
  blocked: (decision: GuardianDecision) => void;
  activity: (entry: {
    summary: string;
    details?: string;
    undoable: boolean;
    actionId?: string;
  }) => void;
  turnDone: () => void;
  error: (message: string) => void;
}

export class LiveAgentHost extends EventEmitter {
  private threadId: string | null = null;
  private turnId: string | null = null;
  private userRequest = "";
  private streamBuffer = "";
  private approvalWaiters = new Map<
    string | number,
    {
      resolve: (choice: ApprovalChoice) => void;
      kind: "command" | "file" | "tool";
    }
  >();
  private sessionAllow = new Set<string>();
  private wired = false;

  constructor(
    private readonly codex: CodexAppServerClient,
    private readonly hands: HandsClient,
  ) {
    super();
  }

  private emitStatus(text: string): void {
    this.emit("status", text);
  }

  async ensureThread(): Promise<string> {
    this.wireOnce();
    if (this.threadId) return this.threadId;
    const cwd = path.join(os.homedir(), "Documents");
    this.threadId = await this.codex.startThread({
      cwd,
      dynamicTools: LALIME_DYNAMIC_TOOLS,
      developerInstructions: DEVELOPER_INSTRUCTIONS,
    });
    return this.threadId;
  }

  private wireOnce(): void {
    if (this.wired) return;
    this.wired = true;

    this.codex.on("serverRequest", (req: { id: number | string; method: string; params?: unknown }) => {
      void this.handleServerRequest(req);
    });

    this.codex.on("item/agentMessage/delta", (params: unknown) => {
      const p = params as { delta?: string; text?: string };
      const chunk = p.delta ?? p.text ?? "";
      if (!chunk) return;
      this.streamBuffer += chunk;
      this.emit("delta", chunk);
    });

    this.codex.on("item/completed", (params: unknown) => {
      const p = params as { item?: { type?: string; text?: string; content?: string } };
      if (p.item?.type === "agentMessage") {
        const text = p.item.text ?? p.item.content ?? this.streamBuffer;
        if (text) this.emit("messageDone", text);
        this.streamBuffer = "";
      }
    });

    this.codex.on("turn/completed", () => {
      this.emit("turnDone");
    });

    this.codex.on("item/started", (params: unknown) => {
      const p = params as { item?: { type?: string; command?: string; tool?: string } };
      if (p.item?.type === "commandExecution" && p.item.command) {
        this.emit("plan", [
          {
            id: "cmd",
            label: `Run: ${p.item.command.slice(0, 60)}`,
            status: "running" as const,
          },
        ]);
      }
      if (p.item?.type === "dynamicToolCall" && p.item.tool) {
        this.emitStatus(`Using ${p.item.tool}…`);
      }
    });
  }

  async runTurn(userText: string): Promise<void> {
    this.userRequest = userText;
    this.streamBuffer = "";
    this.emitStatus("Thinking…");
    const threadId = await this.ensureThread();
    const { turnId } = await this.codex.startTurn(threadId, userText);
    this.turnId = turnId ?? null;
  }

  async stop(): Promise<void> {
    for (const [reqId, waiter] of this.approvalWaiters) {
      waiter.resolve("not_now");
      if (waiter.kind === "command" || waiter.kind === "file") {
        this.codex.respondApproval(reqId, "cancel");
      } else {
        this.codex.respondToolCall(reqId, {
          contentItems: [{ type: "inputText", text: "Stopped by user." }],
          success: false,
        });
      }
    }
    this.approvalWaiters.clear();
    if (this.threadId) {
      await this.codex.interruptTurn(this.threadId, this.turnId ?? undefined);
    }
  }

  respondApproval(choice: ApprovalChoice): void {
    // Resolve the oldest waiter (UI has one pending card).
    const first = this.approvalWaiters.entries().next();
    if (first.done) return;
    const [reqId, waiter] = first.value;
    this.approvalWaiters.delete(reqId);
    waiter.resolve(choice);
  }

  private async handleServerRequest(req: {
    id: number | string;
    method: string;
    params?: unknown;
  }): Promise<void> {
    switch (req.method) {
      case "item/commandExecution/requestApproval":
        await this.onCommandApproval(req.id, req.params);
        break;
      case "item/fileChange/requestApproval":
        await this.onFileApproval(req.id, req.params);
        break;
      case "item/tool/call":
        await this.onToolCall(req.id, req.params);
        break;
      default:
        // Unknown server request — decline safely when it looks like an approval.
        if (req.method.includes("requestApproval")) {
          this.codex.respondApproval(req.id, "decline");
        }
        break;
    }
  }

  private waitUiApproval(
    reqId: number | string,
    kind: "command" | "file" | "tool",
    pending: PendingApproval,
  ): Promise<ApprovalChoice> {
    this.emit("approvalNeeded", pending);
    return new Promise((resolve) => {
      this.approvalWaiters.set(reqId, { resolve, kind });
    });
  }

  private async guardianGate(
    action: ProposedAction,
  ): Promise<{ allow: boolean; decision: GuardianDecision; choice?: ApprovalChoice }> {
    const decision = await evaluateAction(action, {
      reviewer: demoReviewer,
      sessionAllowRuleIds: this.sessionAllow,
    });

    if (decision.kind === "block" || decision.kind === "explain_only") {
      this.emit("blocked", decision);
      return { allow: false, decision };
    }

    if (decision.kind === "ask" || decision.kind === "ask_hold") {
      return { allow: false, decision, choice: undefined };
    }

    return { allow: true, decision };
  }

  private async onCommandApproval(reqId: number | string, params: unknown): Promise<void> {
    const p = params as { command?: string; cwd?: string; reason?: string };
    const command = p.command ?? "";
    const action: ProposedAction = {
      id: actionId(),
      kind: "powershell",
      payload: command,
      cwd: p.cwd,
      userRequest: this.userRequest,
      summary: p.reason ?? `Run: ${command.slice(0, 80)}`,
    };

    const pre = await this.hands.precheckPowerShell(command);
    if (pre.blocked) {
      const decision: GuardianDecision = {
        actionId: action.id,
        kind: "block",
        tier: 4,
        plainEnglish: pre.reason ?? "Hands blocked this PowerShell command.",
        details: command,
        matchedRules: ["hands.precheck"],
        undoable: false,
      };
      this.emit("blocked", decision);
      this.codex.respondApproval(reqId, "decline");
      return;
    }

    const gate = await this.guardianGate(action);
    if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
      this.codex.respondApproval(reqId, "decline");
      return;
    }

    if (gate.decision.kind === "ask" || gate.decision.kind === "ask_hold") {
      const choice = await this.waitUiApproval(reqId, "command", {
        decision: gate.decision,
        action,
      });
      if (choice === "not_now") {
        this.codex.respondApproval(reqId, "decline");
        return;
      }
      const decision: ApprovalDecision =
        choice === "allow_for_task" ? "acceptForSession" : "accept";
      if (choice === "allow_for_task") {
        for (const r of gate.decision.matchedRules) this.sessionAllow.add(r);
      }
      this.codex.respondApproval(reqId, decision);
      this.emit("activity", {
        summary: action.summary ?? "Ran a command",
        details: command,
        undoable: gate.decision.undoable,
      });
      return;
    }

    this.codex.respondApproval(reqId, "accept");
  }

  private async onFileApproval(reqId: number | string, params: unknown): Promise<void> {
    const p = params as { reason?: string; grantRoot?: string };
    const action: ProposedAction = {
      id: actionId(),
      kind: "file_write",
      payload: p.reason ?? p.grantRoot ?? "file change",
      userRequest: this.userRequest,
      summary: p.reason ?? "Change files",
    };
    const gate = await this.guardianGate(action);
    if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
      this.codex.respondFileChangeApproval(reqId, "decline");
      return;
    }
    if (gate.decision.kind === "ask" || gate.decision.kind === "ask_hold") {
      const choice = await this.waitUiApproval(reqId, "file", {
        decision: gate.decision,
        action,
      });
      this.codex.respondFileChangeApproval(
        reqId,
        choice === "not_now" ? "decline" : "accept",
      );
      return;
    }
    this.codex.respondFileChangeApproval(reqId, "accept");
  }

  private async onToolCall(reqId: number | string, params: unknown): Promise<void> {
    const p = params as {
      tool?: string;
      arguments?: Record<string, unknown>;
      callId?: string;
    };
    const tool = p.tool ?? "";
    const args = p.arguments ?? {};

    try {
      const result = await this.executeDynamicTool(tool, args, reqId);
      this.codex.respondToolCall(reqId, result.response);
      if (result.activity) this.emit("activity", result.activity);
    } catch (err) {
      this.codex.respondToolCall(reqId, {
        contentItems: [
          {
            type: "inputText",
            text: err instanceof Error ? err.message : "Tool failed",
          },
        ],
        success: false,
      });
    }
  }

  private async executeDynamicTool(
    tool: string,
    args: Record<string, unknown>,
    reqId: number | string,
  ): Promise<{
    response: {
      contentItems: Array<
        { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
      >;
      success: boolean;
    };
    activity?: {
      summary: string;
      details?: string;
      undoable: boolean;
      actionId?: string;
    };
  }> {
    const text = (v: unknown) => (typeof v === "string" ? v : "");

    switch (tool) {
      case "lalime_screenshot": {
        const shot = await this.hands.screenshot();
        const items: Array<
          { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
        > = [{ type: "inputText", text: shot.output }];
        if (shot.imageDataUrl) {
          items.push({ type: "inputImage", imageUrl: shot.imageDataUrl });
        }
        return { response: { contentItems: items, success: shot.ok } };
      }
      case "lalime_list_windows": {
        const w = await this.hands.listWindows();
        return {
          response: {
            contentItems: [{ type: "inputText", text: JSON.stringify(w.windows) }],
            success: w.ok,
          },
        };
      }
      case "lalime_list_ui": {
        const els = await this.hands.listUiElements(text(args.windowTitle) || undefined);
        return {
          response: {
            contentItems: [{ type: "inputText", text: JSON.stringify(els.elements) }],
            success: els.ok,
          },
        };
      }
      case "lalime_click": {
        const action: ProposedAction = {
          id: actionId(),
          kind: "ui_click",
          payload: `click:${text(args.name)}`,
          userRequest: this.userRequest,
          summary: `Click “${text(args.name)}”`,
        };
        const gate = await this.guardianGate(action);
        if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
          return {
            response: {
              contentItems: [{ type: "inputText", text: gate.decision.plainEnglish }],
              success: false,
            },
          };
        }
        if (gate.decision.kind === "ask" || gate.decision.kind === "ask_hold") {
          const choice = await this.waitUiApproval(reqId, "tool", {
            decision: gate.decision,
            action,
          });
          if (choice === "not_now") {
            return {
              response: {
                contentItems: [{ type: "inputText", text: "User declined." }],
                success: false,
              },
            };
          }
        }
        const r = await this.hands.clickElement(
          text(args.name),
          text(args.windowTitle) || undefined,
        );
        return {
          response: {
            contentItems: [{ type: "inputText", text: r.output }],
            success: r.ok,
          },
          activity: { summary: action.summary!, details: action.payload, undoable: false },
        };
      }
      case "lalime_type": {
        const action: ProposedAction = {
          id: actionId(),
          kind: "ui_type",
          payload: `type:${text(args.text)}`,
          userRequest: this.userRequest,
          summary: "Type text",
        };
        const gate = await this.guardianGate(action);
        if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
          return {
            response: {
              contentItems: [{ type: "inputText", text: gate.decision.plainEnglish }],
              success: false,
            },
          };
        }
        if (gate.decision.kind === "ask" || gate.decision.kind === "ask_hold") {
          const choice = await this.waitUiApproval(reqId, "tool", {
            decision: gate.decision,
            action,
          });
          if (choice === "not_now") {
            return {
              response: {
                contentItems: [{ type: "inputText", text: "User declined." }],
                success: false,
              },
            };
          }
        }
        const r = await this.hands.typeText(
          text(args.text),
          text(args.windowTitle) || undefined,
        );
        return {
          response: {
            contentItems: [{ type: "inputText", text: r.output }],
            success: r.ok,
          },
        };
      }
      case "lalime_open_settings": {
        const uri = text(args.uri) || "ms-settings:";
        const action: ProposedAction = {
          id: actionId(),
          kind: "open_settings",
          payload: uri,
          userRequest: this.userRequest,
          summary: `Open ${uri}`,
        };
        const gate = await this.guardianGate(action);
        if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
          return {
            response: {
              contentItems: [{ type: "inputText", text: gate.decision.plainEnglish }],
              success: false,
            },
          };
        }
        const r = await this.hands.openSettings(uri);
        return {
          response: {
            contentItems: [{ type: "inputText", text: r.output }],
            success: r.ok,
          },
          activity: { summary: action.summary!, details: uri, undoable: true },
        };
      }
      case "lalime_recycle": {
        const paths = Array.isArray(args.paths)
          ? args.paths.filter((x): x is string => typeof x === "string")
          : [];
        const summary =
          text(args.summary) || `Move ${paths.length} item(s) to the Recycle Bin`;
        const action: ProposedAction = {
          id: actionId(),
          kind: "file_move",
          payload: `recycle:${paths.join(";")}`,
          paths,
          userRequest: this.userRequest,
          summary,
        };
        const gate = await this.guardianGate(action);
        if (gate.decision.kind === "block" || gate.decision.kind === "explain_only") {
          return {
            response: {
              contentItems: [{ type: "inputText", text: gate.decision.plainEnglish }],
              success: false,
            },
          };
        }
        if (gate.decision.kind === "ask" || gate.decision.kind === "ask_hold") {
          const choice = await this.waitUiApproval(reqId, "tool", {
            decision: gate.decision,
            action,
          });
          if (choice === "not_now") {
            return {
              response: {
                contentItems: [{ type: "inputText", text: "User declined." }],
                success: false,
              },
            };
          }
        }
        const r = await this.hands.moveToRecycleBin(paths, summary);
        return {
          response: {
            contentItems: [{ type: "inputText", text: r.output }],
            success: r.ok,
          },
          activity: {
            summary,
            details: paths.join("\n"),
            undoable: true,
            actionId: r.journalId,
          },
        };
      }
      default:
        return {
          response: {
            contentItems: [{ type: "inputText", text: `Unknown tool: ${tool}` }],
            success: false,
          },
        };
    }
  }
}
