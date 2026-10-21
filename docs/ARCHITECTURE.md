# Architecture

## Goals

1. A calm consumer UI for people who are not comfortable with computers.
2. An agent that can operate Windows — without silent dangerous actions.
3. Buildable on Linux CI via gated mocks (`LALIME_DEMO=1`); product path is always live Codex.

## Processes

### Renderer

React + TypeScript + Tailwind. No Node integration. Talks to the main process through a typed preload bridge (`window.lalime`). Browser preview shows the sign-in path; scripted `DemoEngine` only with an explicit dev flag (`?demo=1` / `VITE_LALIME_DEMO`).

### Main process

- `SessionController` — chat turns, plan checklist, approvals, activity/undo; after each live turn, optional Deliberate Lite rewrite via `WriterService`.
- `CodexAppServerClient` — optional JSON-RPC client for `codex app-server` (ChatGPT sign-in or API key).
- `writer/` — Deliberate Lite (Opus 5.5 Messages API, BYO Anthropic key in safeStorage). Falls back to Codex text when no key / error / timeout.
- Guardian — every `ProposedAction` is evaluated before Hands runs it.
- Hands client — mock / Node on Linux; Hands.exe by default on Windows.

### Guardian layers

| Layer | Mechanism |
|---|---|
| L1 | Deterministic never-list, ask-rules, default tiers |
| L2 | Optional model reviewer — **can only raise** severity or block on intent mismatch |
| L3 | Plain-English approval cards in the UI |
| L4 | Journal / Recycle Bin undo via Hands |
| L5 | `fromUntrustedContent` flag blocks actions justified only by screen/web text |

### Codex live path

Verified against OpenAI app-server docs (Oct 2026):

```
codex app-server --listen stdio://
  initialize (experimentalApi: true)
  account/login/start { type: "chatgpt" | "apiKey" }
  thread/start { sandboxPolicy: workspaceWrite, dynamicTools: lalime_* }
  turn/start → stream item/agentMessage/delta
  server requests:
    item/commandExecution/requestApproval  → Guardian → { decision }
    item/fileChange/requestApproval        → Guardian → { decision }
    item/tool/call                         → Guardian → Hands → { contentItems, success }
```

`LiveAgentHost` never lets Codex execute Hands tools without Guardian. Built-in shell still requires client approval responses, which we decline when Guardian blocks.

If Codex is missing or OAuth fails, the app shows a clear sign-in / error state — it never falls back to scripted replies. Packaged builds cannot enable `LALIME_DEMO`.

Fake Codex (`electron/main/fake-codex-server.ts`) drives the live path in unit tests.

## Security posture (Electron)

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- Strict CSP in `index.html`
- External links open via `shell.openExternal` only

## Contest originality

Fresh repo created for CAC 2026. Ideas from prior Lalime / ToMyWhim research informed Guardian’s tiers, but code is new. Jackson’s personal modules are listed in `docs/JACKSON_TODO.md`.
