# Security boundaries

Lalime is a local desktop app. It does not provide an account, API credits, or a hosted credential service. Model requests go from the main process to the selected provider. A custom endpoint receives the same permitted conversation and tool data as a named provider.

## Renderer

Electron enables context isolation and the renderer sandbox, and disables Node integration and webviews. The preload bundle exposes a limited API. Main-process handlers check the sender, its frame, and input values. The window blocks navigation away from the application and denies browser permission requests. External links must use HTTPS without embedded credentials or a nondefault port.

Copy reply uses a separate write-only IPC action. It accepts at most 64,000 text characters
from the application frame. The bridge exposes no clipboard read operation.

## Accounts and keys

Primary API keys stay in memory until disconnect or exit. Settings never include a key. The optional Anthropic writer uses Electron `safeStorage` when encryption is available, and otherwise keeps a new key in memory. If encryption becomes unavailable, existing encrypted bytes are not interpreted as plaintext.

Codex runs with an app-owned `CODEX_HOME`. Lalime does not copy another Codex account store or configuration, and it excludes inherited OpenAI API credential environment variables from that child process. Codex manages its own authentication persistence. Disconnect ends the active client; it does not revoke the provider account or erase Codex's saved login. Use the provider's account controls to revoke access.

## Tools and consent

Screen and window disclosure and computer actions each require an enabled setting. State-changing dynamic tools require an approval tied to the displayed action ID. Requests wait in order. Stop, provider completion, and provider failure invalidate pending approvals. A stale response cannot authorize the next action.

Codex threads request a read-only sandbox and untrusted approvals, with built-in shell, apps, browser, and web search disabled. Direct API providers receive only Lalime's dynamic tool list. The host validates settings URI syntax and applies Guardian before actions. Windows text input uses literal UI Automation values, not SendKeys syntax.

Undo requires a successful backend operation with a real restore journal. Native Recycle Bin operations can require manual recovery. Approval alone is not evidence that a command completed. Failed tools do not produce completed activity entries.

## Limits

Guardian's deterministic checks are not a proof that arbitrary commands are safe. The native PowerShell precheck uses pattern checks; do not call it a complete AST sandbox. Prompt instructions alone are not an authorization boundary. Human approval can still authorize a harmful action, and a third-party provider sees data that the user permits the app to send.

API tools, response sizes, conversation sizes, and request times are bounded. Stop cancels API work and optional writer work. An external service may already have processed a request before cancellation, and stopping does not reverse a completed computer action.

Deterministic tests use fake responses or local HTTP fixtures. Live provider entitlement, native UI compatibility, and release packaging require separate checks on the target computer. Do not claim that every provider and model has been tested with a paid account.

## Report a problem

Report the affected version, operating system, minimal steps, and a description of the boundary crossed. Do not attach keys, tokens, account files, or screenshots with private data. For an issue that could expose users, contact the repository maintainer privately before posting exploit details in a public issue.
