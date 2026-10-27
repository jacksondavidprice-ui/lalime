/**
 * Lightweight text-completion client for Deliberate Lite.
 * Uses the same OpenAI-compatible / Anthropic protocols as the live agent.
 * Main process only. Never logs API keys.
 */

import { getProvider, validateProviderBaseUrl } from "../shared/providers.js";

export type WriterTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface WriterLlmOptions {
  providerId: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: WriterTransport;
  timeoutMs?: number;
}

export interface CompleteInput {
  system: string;
  user: string;
  /** When true, ask for JSON-only output (prompt-level; no provider-specific schema APIs). */
  json?: boolean;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
}

const ERROR_GUIDANCE: Record<number, string> = {
  400: "The writing service could not understand the request. Lalime will use the regular reply instead.",
  401: "That API key was not accepted. Check it in Settings, or Lalime will keep using the regular reply.",
  402: "This account needs billing attention. Lalime will use the regular reply for now.",
  403: "This key cannot use that model. Check access in Settings.",
  429: "The writing service is busy or at a spend limit. Lalime will use the regular reply for now.",
  500: "The writing service had a temporary problem. Lalime will use the regular reply.",
  529: "The writing service is overloaded. Lalime will use the regular reply.",
};

export function redactSecrets(value: string, apiKey?: string): string {
  let out = value;
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  out = out.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
  out = out.replace(/sk-[A-Za-z0-9_-]{20,}/g, "[redacted]");
  out = out.replace(/(x-api-key|authorization)\s*[:=]\s*["']?[^"'\s]+/gi, "$1:[redacted]");
  return out;
}

export function friendlyWriterError(status: number): string {
  return (
    ERROR_GUIDANCE[status] ??
    "The writing service could not finish. Lalime will use the regular reply."
  );
}

export class WriterLlmClient {
  private readonly providerId: string;
  private readonly protocol: "openai" | "anthropic";
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: WriterTransport;
  private readonly timeoutMs: number;

  constructor(options: WriterLlmOptions) {
    const provider = getProvider(options.providerId);
    if (!options.model?.trim() || options.model.length > 256 || /[\r\n\0]/.test(options.model)) {
      throw new Error("Choose a valid model ID from your provider.");
    }
    if (provider.requiresKey && !options.apiKey?.trim()) {
      throw new Error("This provider requires your API key.");
    }
    if (options.apiKey && (options.apiKey.length > 8192 || /[\r\n\0]/.test(options.apiKey))) {
      throw new Error("Invalid API key.");
    }
    this.providerId = provider.id;
    this.protocol = provider.protocol;
    this.model = options.model.trim();
    this.apiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = validateProviderBaseUrl(options.baseUrl || provider.baseUrl);
    if (!["custom", "ollama"].includes(provider.id) && this.baseUrl !== provider.baseUrl) {
      throw new Error("This provider's API endpoint cannot be changed. Select a custom provider instead.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async complete(input: CompleteInput): Promise<CompleteResult> {
    if (input.signal?.aborted) throw new Error("Writing was stopped.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const text =
        this.protocol === "anthropic"
          ? await this.completeAnthropic(input, controller.signal)
          : await this.completeOpenAi(input, controller.signal);
      if (input.signal?.aborted) throw new Error("Writing was stopped.");
      if (!text.trim()) {
        throw new Error("The writing service returned an empty reply.");
      }
      input.onDelta?.(text);
      return { text };
    } catch (err) {
      if (input.signal?.aborted) throw new Error("Writing was stopped.");
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

  private async completeAnthropic(input: CompleteInput, signal: AbortSignal): Promise<string> {
    const user = input.json
      ? `${input.user}\n\nReturn JSON only. No markdown fence.`
      : input.user;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    const res = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        system: input.system,
        messages: [{ role: "user", content: user }],
        stream: false,
      }),
      redirect: "error",
      signal,
    });
    if (!res.ok) throw new Error(friendlyWriterError(res.status));
    const payload = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    };
    if (payload.stop_reason === "refusal") {
      throw new Error("The writing model declined this reply. Lalime will use the regular text.");
    }
    return (payload.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("");
  }

  private async completeOpenAi(input: CompleteInput, signal: AbortSignal): Promise<string> {
    const user = input.json
      ? `${input.user}\n\nReturn JSON only. No markdown fence.`
      : input.user;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (this.providerId === "gemini") headers["x-goog-api-client"] = "lalime/0.1.0";
    const maxTokenField = this.providerId === "openai" ? "max_completion_tokens" : "max_tokens";
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: user },
      ],
      stream: false,
      [maxTokenField]: 1200,
    };
    if (input.json) {
      body.response_format = { type: "json_object" };
    }
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    if (!res.ok) {
      // Some OpenAI-compatible hosts reject response_format; retry once without it.
      if (input.json && (res.status === 400 || res.status === 422)) {
        await res.body?.cancel();
        delete body.response_format;
        const retry = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        });
        if (!retry.ok) throw new Error(friendlyWriterError(retry.status));
        return extractOpenAiText(await retry.json());
      }
      throw new Error(friendlyWriterError(res.status));
    }
    return extractOpenAiText(await res.json());
  }
}

function extractOpenAiText(payload: unknown): string {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : {};
  const message = first.message && typeof first.message === "object"
    ? (first.message as Record<string, unknown>)
    : {};
  if (typeof message.refusal === "string" && message.refusal) {
    throw new Error("The writing model declined this reply. Lalime will use the regular text.");
  }
  if (first.finish_reason === "content_filter") {
    throw new Error("The writing model declined this reply. Lalime will use the regular text.");
  }
  return typeof message.content === "string" ? message.content : "";
}
