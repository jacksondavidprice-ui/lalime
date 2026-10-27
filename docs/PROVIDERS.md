# AI providers

Lalime runs requests with the credentials that the user supplies. It does not include a shared API key or pay for inference. ChatGPT sign-in uses the existing Codex integration. The API choices use a separate, local agent loop. All desktop tool calls go through the same Guardian host.

## API connections

Select a provider, enter a model ID from that provider, and supply your own API key. The app does not guess model IDs. Provider model access, tool support, image support, quotas, and charges depend on your account and selected model. A chat subscription does not automatically provide API access. Check your provider's billing terms before using a key.

The following endpoints were checked against official documentation on 2026-10-25. These are protocol presets, not a claim that every model from each provider was tested live.

| Provider | API base URL | Source |
| --- | --- | --- |
| OpenAI API | `https://api.openai.com/v1` | [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| Anthropic | `https://api.anthropic.com/v1` | [Messages API](https://platform.claude.com/docs/en/api/messages) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| Groq | `https://api.groq.com/openai/v1` | [OpenAI compatibility](https://console.groq.com/docs/openai) |
| Mistral | `https://api.mistral.ai/v1` | [First API request](https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request) |
| DeepSeek | `https://api.deepseek.com` | [API integration](https://api-docs.deepseek.com/quick_start/agent_integrations/) |
| OpenRouter | `https://openrouter.ai/api/v1` | [API reference](https://openrouter.ai/docs/api_reference/overview) |
| xAI | `https://api.x.ai/v1` | [Legacy Chat Completions](https://docs.x.ai/developers/model-capabilities/legacy/chat-completions) |
| Together AI | `https://api.together.ai/v1` | [OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility) |
| Fireworks AI | `https://api.fireworks.ai/inference/v1` | [OpenAI compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility) |
| Cerebras | `https://api.cerebras.ai/v1` | [OpenAI compatibility](https://inference-docs.cerebras.ai/resources/openai) |
| Ollama | `http://127.0.0.1:11434/v1` | [Local OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) |

Ollama runs on this computer. Install a suitable model separately. Local models do not require an API key. Hardware and model capability limit their performance. A custom connection can use another server that implements OpenAI Chat Completions. Enter its base URL and model ID. A key is optional for a custom connection because local servers may not require one.

Official provider URLs cannot be changed. To use a proxy, select the custom connection explicitly. URLs must use HTTPS, except HTTP on `localhost`, `127.0.0.1`, or `::1`. URLs cannot contain credentials, query parameters, or fragments. HTTP redirects are rejected. Do not enter a provider key into an endpoint that you do not trust.

## Clearer replies (Deliberate Lite)

After a live turn finishes, Lalime can run one lightweight rewrite of the reply the person reads. That rewrite uses the same connected provider, model, and in-memory API key as the live agent. There is no separate writing key. ChatGPT / Codex sign-in alone does not enable the rewrite (there is no standalone completion route on that path), so those sessions keep the agent’s own text. If the rewrite fails, times out, or is aborted, the original reply is shown unchanged.

## Agent limits and behavior

- Requests run in the Electron main process. Credentials are not added to prompts, logs, or provider error messages.
- The adapter supports OpenAI Chat Completions and native Anthropic Messages. It sends each response as one completed message; token streaming is not implemented in this adapter.
- A turn can request only the tools that the host registered. Tool names and arguments are checked before dispatch. The adapter has no native shell or file execution route.
- The tool call budget applies to the whole turn. Settings allow 1 to 50 tool calls per turn. The adapter stops before executing a batch that exceeds the remaining budget. Screen capture and computer control have separate permission switches.
- Request timeouts cancel network requests. Stop also cancels pending tool responses. There are no automatic paid retries.
- Response bodies are limited to 4 MiB. Conversation requests are limited to 8 MiB. Tool arguments are limited to 64 KiB. An individual screenshot is limited to 6 MiB. Tool approval waits end after five minutes.
- Model and output token limit are explicit. Temperature is optional. Leave it unset for models that do not support it. OpenAI receives `max_completion_tokens`; other compatible providers receive `max_tokens`.
- Conversations are kept in memory. If a turn fails after a tool request, the next turn receives a notice to check the activity log and current state before repeating an action.

A model must support function calls to operate the computer. A model must support images to interpret screenshots. Provider-specific reasoning controls, hosted tools, native file uploads, and Responses-only models are outside this adapter. Perplexity is not a preset because its current documented Sonar and Agent routes need a distinct adapter. See its [migration documentation](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview).

xAI still documents Chat Completions as a legacy route. It recommends Responses for current Grok reasoning models because Chat Completions does not preserve encrypted reasoning between turns. This preset has that limitation. See [xAI best practices](https://docs.x.ai/developers/model-capabilities/text/best-practices).

## Subscription integrations

Lalime does not collect Claude, Google, or GitHub session tokens. API keys in this release are separate from the existing ChatGPT sign-in path.

Possible future subscription adapters must preserve provider-owned authentication and Guardian approval checks:

- Anthropic permits users to sign into the unmodified Claude Code binary with their own plan. Its terms distinguish that flow from a third-party app collecting or routing Claude credentials. The current SDK overview also retains a restriction on offering Claude.ai login. A native CLI adapter needs a separate review and tests. See [credential use](https://code.claude.com/docs/en/legal-and-compliance) and [the plan usage update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).
- Gemini CLI supports Google sign-in, including AI Pro and Ultra accounts. Its [ACP mode](https://geminicli.com/docs/cli/acp-mode/) provides a programmatic integration route. See [authentication](https://geminicli.com/docs/get-started/authentication/).
- The GitHub Copilot SDK supports end-user subscription credentials through its native CLI and supports OAuth apps. See [authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate).

## Extend a provider

Add an official endpoint and documentation URL to `shared/providers.ts`. Add a fixture test for the provider's request and response format. Use the existing adapter only if its protocol matches. For another protocol, implement the `AgentClient` contract and route every tool request through `LiveAgentHost`. Do not add an alternate action executor. Test errors, cancellation, tool limits, and hostile tool arguments before adding a UI choice.

The earlier Llime project informed the design of explicit token and execution limits. Its key metadata design also informed the separation between credentials and UI status. No credentials or code were copied from that project.
