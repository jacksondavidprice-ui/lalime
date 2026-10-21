# AI disclosure (Congressional App Challenge 2026)

Required by the 2026 CAC rules: AI use must be fully disclosed, and AI must not constitute the entirety of technical development.

## Tools used

| Tool | Used for |
|---|---|
| Cursor (cloud agent, Grok 4.5) | Scaffolding, UI polish, live agent host, Hands bridge, installer/CI wiring, docs, tests |
| Playwright | UI screenshots and smoke tests |
| OpenAI Codex app-server (runtime) | Live agent turns when the user signs in with their ChatGPT account or their own API key |
| OpenAI developer docs (app-server, auth, dynamic tools) | Verified protocol for approvals + `item/tool/call` |
| Claude Opus 5.5 (`claude-opus-5-5`) via Anthropic Messages API | Optional Deliberate Lite writing layer (user’s own Anthropic key) that rewrites the reply the person reads after Codex finishes a turn |

## Writing layer (Deliberate)

Lalime’s message-writing layer uses Jackson’s own **Deliberate** rules from his `aibutgood` / Deliberate project (2026), running on Claude Opus 5.5 with the user’s bring-your-own Anthropic key. Codex still performs all actions; Deliberate only writes what the person sees from a factual summary. Without a key, or on error/timeout, the app shows Codex’s own text unchanged. Author-voice preset files from Deliberate were not ported (they contain copyrighted excerpts).

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
