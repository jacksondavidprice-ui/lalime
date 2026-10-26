export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string;
  protocol: "openai" | "anthropic";
  requiresKey: boolean;
  docsUrl: string;
  supportsTools?: boolean;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  { id: "openai", name: "OpenAI API", baseUrl: "https://api.openai.com/v1", protocol: "openai", requiresKey: true, docsUrl: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic", requiresKey: true, docsUrl: "https://platform.claude.com/docs/en/api/messages" },
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai", requiresKey: true, docsUrl: "https://ai.google.dev/gemini-api/docs/openai" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai", requiresKey: true, docsUrl: "https://console.groq.com/docs/openai" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", protocol: "openai", requiresKey: true, docsUrl: "https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai", requiresKey: true, docsUrl: "https://api-docs.deepseek.com/quick_start/agent_integrations/" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", protocol: "openai", requiresKey: true, docsUrl: "https://openrouter.ai/docs/api_reference/overview" },
  { id: "xai", name: "xAI", baseUrl: "https://api.x.ai/v1", protocol: "openai", requiresKey: true, docsUrl: "https://docs.x.ai/developers/model-capabilities/legacy/chat-completions" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.ai/v1", protocol: "openai", requiresKey: true, docsUrl: "https://docs.together.ai/docs/inference/openai-compatibility" },
  { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", protocol: "openai", requiresKey: true, docsUrl: "https://docs.fireworks.ai/tools-sdks/openai-compatibility" },
  { id: "cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", protocol: "openai", requiresKey: true, docsUrl: "https://inference-docs.cerebras.ai/resources/openai" },
  { id: "ollama", name: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", protocol: "openai", requiresKey: false, docsUrl: "https://docs.ollama.com/api/openai-compatibility" },
  { id: "custom", name: "Custom OpenAI-compatible API", baseUrl: "", protocol: "openai", requiresKey: false, docsUrl: "https://docs.ollama.com/api/openai-compatibility" },
];

export function getProvider(id: string): ProviderDefinition {
  const provider = PROVIDERS.find((entry) => entry.id === id);
  if (!provider) throw new Error("Unknown AI provider.");
  return provider;
}

export function validateProviderBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a valid API endpoint URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTPS API endpoint, or HTTP on this computer only. Do not put credentials in the URL.");
  }
  return url.href.replace(/\/+$/, "");
}
