# Architecture

## Goals

1. A calm consumer UI for people who are not comfortable with computers.
2. An agent that can operate Windows — without silent dangerous actions.
3. Buildable on Linux CI via gated mocks (`LALIME_DEMO=1`); product chat uses a real provider connection.

## Processes

### Renderer

React + TypeScript + Tailwind. No Node integration. Talks to the main process through a typed preload bridge (`window.lalime`). Browser preview shows the sign-in path; scripted `DemoEngine` only with an explicit dev flag (`?demo=1` / `VITE_LALIME_DEMO`).

### Main process

- `SessionController` — chat turns, plan checklist, approvals, activity/undo; after each live turn, optional Deliberate Lite rewrite via `WriterService`.
- `CodexAppServerClient` — optional JSON-RPC client for `codex app-server` (ChatGPT sign-in or API key).
- `ApiAgentClient` — direct OpenAI-compatible and Anthropic Messages requests. Returns tool proposals to the same host. It does not run computer actions itself.
- `shared/providers.ts` — provider catalog with official endpoint and protocol sources.
- `shared/settings.ts` — settings defaults and validation. `settings-store.ts` saves non-secret preferences in Electron user data.
- `writer/` — Deliberate Lite (Opus 5.5 Messages API, BYO Anthropic key in safeStorage). Falls back to Codex text when no key / error / timeout.
- Guardian — every `ProposedAction` is evaluated before Hands runs it.
- Hands client — mock / Node on Linux; Hands.exe by default on Windows.

### Guardian layers

| Layer | Mechanism |
|---|---|
| L1 | Deterministic never-list, ask-rules, default tiers |
| L2 | Optional model reviewer — **can only raise** severity or block on intent mismatch |
| L3 | Plain-English approval cards in the UI |
| L4 | Restore is offered only when the backend returns a valid journal ID; Recycle Bin recovery can be manual |
| L5 | Guardian blocks actions marked `fromUntrustedContent`. The live host does not assign this flag, so this is not automatic detection of instructions from screen or web content. |

The live agent receives warnings about untrusted screen content. These prompt instructions are not an authorization boundary. State-changing tools still require permission and approval for the specific action. Human approval can authorize a harmful action; do not claim complete prompt-injection protection.

### Codex live path

Verified against OpenAI app-server docs (Oct 2026):

```
codex app-server --listen stdio://
  initialize (experimentalApi: true)
  account/login/start { type: "chatgpt" | "apiKey" }
  thread/start { sandbox: "read-only", approvalPolicy: "untrusted", dynamicTools: lalime_* }
  turn/start → stream item/agentMessage/delta
  server requests:
    item/commandExecution/requestApproval  → Guardian → { decision }
    item/fileChange/requestApproval        → Guardian → { decision }
    item/tool/call                         → Guardian → Hands → { contentItems, success }
```

`LiveAgentHost` checks tool permissions, input, and Guardian decisions before computer actions. Mutating tools wait for an approval bound to the visible action ID. Pending requests run in order; completion and Stop invalidate approval waiters. Tool calls per turn are bounded.

Codex uses a separate app-owned `CODEX_HOME`. Built-in shell, apps, browser, and web search features are disabled. The thread uses a read-only sandbox. The transport registers requests before writes, sets finite response deadlines, and rejects pending requests when the process exits. Browser sign-in stays pending until its matching login completion is verified with `account/read`.

The direct API path uses bounded JSON requests and conversation history. API keys remain in main-process memory. Named provider URLs are pinned. Custom endpoints require HTTPS or loopback HTTP. Redirects are refused. Each API tool call returns through `LiveAgentHost`, so direct providers cannot bypass the approval path.

`SessionController` owns the current connection and ignores stale asynchronous results after Stop, disconnect, or a provider change. Optional writer requests receive a cancellation signal. Failed tools do not create successful activity records.

If Codex is missing or OAuth fails, the app shows a clear sign-in / error state — it never falls back to scripted replies. Packaged builds cannot enable `LALIME_DEMO`.

Fake Codex (`electron/main/fake-codex-server.ts`) drives the live path in unit tests.

## Security posture (Electron)

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Single-file CommonJS preload, tested with only Electron module access
- Strict CSP in `index.html`
- IPC sender and frame checks plus input validation
- External links require HTTPS without URL credentials or nondefault ports
- Navigation, embedded frames, webviews, and browser permission requests are restricted

These controls reduce specific risks; they do not prove arbitrary computer actions safe. See [SECURITY.md](SECURITY.md) for the enforced boundaries and remaining limits.

## Contest originality

Fresh repo created for CAC 2026. Ideas from prior Lalime / ToMyWhim research informed Guardian’s tiers, but code is new. Jackson’s personal modules are listed in `docs/JACKSON_TODO.md`.
