/**
 * Anthropic Messages API client for Deliberate Lite (Opus 5.5 rules).
 * Main process only. Never logs the API key.
 */

export const ANTHROPIC_VERSION = "2023-06-01";
export const DEFAULT_WRITER_MODEL = "claude-opus-5-5";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type AnthropicTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export interface AnthropicClientOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: AnthropicTransport;
  timeoutMs?: number;
}

export interface MessageCreateInput {
  system: string;
  user: string;
  effort?: EffortLevel;
  /** When set, requests structured JSON via output_config.format. */
  jsonSchema?: Record<string, unknown>;
  stream?: boolean;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export interface MessageCreateResult {
  text: string;
  stopReason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const ERROR_GUIDANCE: Record<number, string> = {
  400: "The writing service could not understand the request. Lalime will use the regular reply instead.",
  401: "That Anthropic key was not accepted. Check it in Settings, or Lalime will keep using the regular reply.",
  402: "This Anthropic account needs billing attention. Lalime will use the regular reply for now.",
  403: "This Anthropic key cannot use that model. Check access in Settings.",
  429: "The writing service is busy or at a spend limit. Lalime will use the regular reply for now.",
  500: "The writing service had a temporary problem. Lalime will use the regular reply.",
  529: "The writing service is overloaded. Lalime will use the regular reply.",
};

export function redactSecrets(value: string, apiKey?: string): string {
  let out = value;
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
  out = out.replace(/(x-api-key|authorization)\s*[:=]\s*["']?[^"'\s]+/gi, "$1:[redacted]");
  return out;
}

export function friendlyAnthropicError(status: number): string {
  return (
    ERROR_GUIDANCE[status] ??
    "The writing service could not finish. Lalime will use the regular reply."
  );
}

export class AnthropicClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: AnthropicTransport;
  private readonly timeoutMs: number;

  constructor(options: AnthropicClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_WRITER_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async validateKey(): Promise<{ ok: boolean; message?: string }> {
    try {
      const res = await this.fetchImpl("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { ok: false, message: friendlyAnthropicError(res.status) };
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message:
          err instanceof Error && err.name === "TimeoutError"
            ? "Could not reach Anthropic in time. Check your internet connection."
            : "Could not reach Anthropic. Check your internet connection.",
      };
    }
  }

  async createMessage(input: MessageCreateInput): Promise<MessageCreateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: input.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: input.user }],
      output_config: {
        effort: input.effort ?? "low",
        ...(input.jsonSchema
          ? {
              format: {
                type: "json_schema",
                schema: input.jsonSchema,
              },
            }
          : {}),
      },
      stream: Boolean(input.stream),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort);

    try {
      const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(friendlyAnthropicError(res.status));
      }

      if (input.stream && res.body) {
        return await this.readStream(res, input.onDelta);
      }

      const payload = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (payload.stop_reason === "refusal") {
        throw new Error("The writing model declined this reply. Lalime will use the regular text.");
      }
      const text = (payload.content ?? [])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("");
      if (!text.trim()) {
        throw new Error("The writing service returned an empty reply.");
      }
      return { text, stopReason: payload.stop_reason, usage: payload.usage };
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new Error("The writing service took too long. Lalime will use the regular reply.");
      }
      const msg = err instanceof Error ? err.message : "Writing service error";
      throw new Error(redactSecrets(msg, this.apiKey));
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async readStream(
    res: Response,
    onDelta?: (text: string) => void,
  ): Promise<MessageCreateResult> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let stopReason: string | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const evt = JSON.parse(data) as {
            type?: string;
            delta?: { type?: string; text?: string; stop_reason?: string };
            message?: { stop_reason?: string };
          };
          if (evt.type === "content_block_delta" && evt.delta?.text) {
            text += evt.delta.text;
            onDelta?.(evt.delta.text);
          }
          if (evt.type === "message_delta" && evt.delta?.stop_reason) {
            stopReason = evt.delta.stop_reason;
          }
          if (evt.message?.stop_reason) stopReason = evt.message.stop_reason;
        } catch {
          // ignore partial JSON lines
        }
      }
    }
    if (stopReason === "refusal") {
      throw new Error("The writing model declined this reply. Lalime will use the regular text.");
    }
    if (!text.trim()) {
      throw new Error("The writing service returned an empty reply.");
    }
    return { text, stopReason };
  }
}

export function looksLikeAnthropicKey(key: string): boolean {
  return key.trim().startsWith("sk-ant-") && key.trim().length > 20;
}

export function keyHint(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 4) return "…";
  return `…${trimmed.slice(-4)}`;
}
