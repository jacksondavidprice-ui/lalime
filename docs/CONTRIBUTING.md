# Modify Lalime

The project uses the MIT license in `LICENSE`. Keep the license and attribution with copied source. No shared model account is required to develop the app.

## Find the right file

| Change | Files |
|---|---|
| Add a compatible provider | `shared/providers.ts`; add official endpoint and documentation URL |
| Add a different API protocol | `electron/main/api-agent-client.ts`; add transport tests before changing it |
| Change model behavior or tool descriptions | `electron/main/agent-prompt.ts` |
| Change permission enforcement | `electron/main/live-agent.ts`, `guardian/src/` |
| Add a setting | `shared/settings.ts`, `electron/main/settings-store.ts`, `src/components/ProviderSettings.tsx` |
| Change session state or account lifecycle | `electron/main/session.ts` |
| Change the renderer/main contract | `shared/ipc.ts`, `electron/preload/index.ts`, `electron/main/ipc.ts` |
| Change Windows actions | `hands/windows/Hands/Program.cs`, `hands/src/windows-bridge.ts` |

Use the existing interfaces. A provider returns proposed tools to `LiveAgentHost`; it must not call Hands or execute a command itself. Keep credentials in the main process. A provider catalog entry must cite an official protocol document. Do not infer that a web subscription permits API use.

## Small verified changes

1. Read the relevant source and tests. Preserve other working changes.
2. Write a test for the required behavior. Confirm its relevant failure before production edits.
3. Make the smallest change that passes the test. Keep the accepted test fixed.
4. Run the nearby tests, `npm test`, and `npm run typecheck`.
5. Run `npm run build`. On Windows this includes the native helper. Run the browser and desktop checks described in `docs/TESTING.md`.
6. Review the diff and state which behavior still needs live testing.

The repository has no separate lint or formatter command. TypeScript strict checks and tests are the current static checks. Do not treat a successful build as proof of live provider access.

## Give an AI assistant a bounded task

Use a request such as: “Change the request timeout validation. Own only `shared/settings.ts` and its tests. Prove values outside the supported range fail. Preserve unrelated edits. Report exact tests and remaining limits.”

Assign one writer per file when multiple assistants share this directory. Use local fixtures or a loopback HTTP server for deterministic tests. Use only placeholder credentials. Never include a real key, token, account store, or private conversation in a fixture, screenshot, log, or commit.

Primary API connections are session-only. Codex uses an app-owned directory under Electron user data. Do not copy credentials from another project to make a test pass.
