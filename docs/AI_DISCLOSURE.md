# AI disclosure (Congressional App Challenge 2026)

Required by the 2026 CAC rules: AI use must be fully disclosed, and AI must not constitute the entirety of technical development.

## Tools used

| Tool | Used for |
|---|---|
| Cursor (cloud agent, Grok 4.5) | Scaffolding, UI polish, live agent host, Hands bridge, installer/CI wiring, docs, tests |
| Playwright | UI screenshots and smoke tests |
| OpenAI Codex app-server (runtime) | Live agent turns when the user signs in with their ChatGPT account or their own API key |
| OpenAI developer docs (app-server, auth, dynamic tools) | Verified protocol for approvals + `item/tool/call` |
| User-selected provider/model (OpenAI-compatible or Anthropic Messages) | Optional Deliberate Lite writing layer that rewrites the reply the person reads after a live turn finishes |

## Writing layer (Deliberate)

Lalime’s message-writing layer uses Jackson’s own **Deliberate** rules from his `aibutgood` / Deliberate project (2026). It runs a single lightweight rewrite (plus local safe fixes) on the same provider and model the user already connected in Settings. The live agent still performs all actions; Deliberate only writes what the person sees from a factual summary. Without a connected API provider, or on error/timeout/abort, the app shows the agent’s own text unchanged. Author-voice preset files from Deliberate were not ported (they contain copyrighted excerpts).

## What AI did **not** solely invent as the “student contribution”

Jackson Price is responsible for personally writing or rewriting:

1. Guardian never-list wording and rule selection (`guardian/src/never-list.ts`)
2. Risk tier definitions and defaults (`guardian/src/tiers.ts`)
3. Deterministic evaluation order and new test cases (`guardian/src/risk-checker.ts`, `guardian/tests/cases.jsonl`)
4. Hands PowerShell AST guard design (C# sketch under `hands/`)

See `docs/JACKSON_TODO.md` for the concrete checklist.

## Open-source libraries (not AI)

Documented in `package.json`: Electron, React, Vite, TypeScript, Tailwind CSS, Framer Motion, Lucide, Vitest, Zustand, clsx.

## How to describe this in the video (one sentence)

“I used Cursor to move faster on the interface and plumbing, and I personally designed Guardian’s block rules and risk tiers so the AI never gets to decide what’s dangerous.”
