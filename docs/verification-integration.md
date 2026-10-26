# Integration verification, 25 October 2026

## Baseline

`npm test` passed 106 tests in 19 files before changes. The working tree already contained `.github/`; that work was preserved. Other active tasks own visual design and native release checks. This document records the backend integration work, not all concurrent edits.

## Red-green evidence

Each listed regression ran before its production fix. Accepted assertions stayed fixed during that fix. New test files contain the exact behavior assertions. Initial IPC/settings diffs were also saved under ignored `scratch/red-ipc.patch` and `scratch/red-settings.patch` at red time.

| Command | Relevant red result (exit 1) | Green result (exit 0) |
|---|---|---|
| `npm test -- tests/session-settings.test.ts tests/ipc-security.test.ts` | Five failures: foreign sender accepted, invalid input accepted, no settings state or update operation | Six tests passed |
| `npm test -- tests/session-lifecycle.test.ts tests/writer-key-security.test.ts` | Three failures: premature signed-in state, late result after Stop, ciphertext interpreted as plaintext | Three tests passed |
| `npm test -- tests/session-settings.test.ts` | Temperature default was 0.7 rather than omitted | Four tests passed after nullable provider default |
| `npm test -- tests/session-lifecycle.test.ts` | Disconnected login changed state to error; submitted key appeared in raw login error | Four tests passed |
| `npm test -- tests/session-lifecycle.test.ts` | An unrelated blocked action erased the visible pending approval; a later turn's writer facts included earlier actions | Six tests passed after the two separate red-green fixes |
| `npm test -- tests/session-provider.integration.test.ts` | A connection restored signed-in state after disconnect | Two tests passed |
| `npm test -- tests/codex-client.test.ts tests/session-provider.integration.test.ts` | Empty model field sent as an invalid model instead of using provider default | Nineteen tests passed |
| `npm test -- tests/window-security.test.ts` | Thirteen initial window-boundary failures, then one embedded-frame navigation failure | Sixteen tests passed |
| `npm test -- tests/preload-build.test.ts` | Four failures; actual emitted ESM preload could not execute in the restricted runtime | Four tests passed using bundled CommonJS preload |
| `npx vitest run writer/anthropic-client.test.ts writer/index.test.ts` | Four failures: pre-aborted request started, repair ran after cancellation, approval requests ignored cancellation | Sixteen tests passed |
| `npm test -- tests/ipc-security.test.ts` | No scoped clipboard-copy operation existed while browser clipboard permission was denied | Four tests passed after a write-only IPC action with sender and size checks |

Provider, Guardian, and Codex transport red evidence is in `verification-providers.md`, `verification-security.md`, and `verification-codex.md`.

## Integration checks

The dependency audit initially reported six advisories (two critical, two high, two moderate).
Targeted updates installed Electron 45.0.0, Vitest 5.0.5, and fast-uri 3.1.9. A new
`npm audit --json` returned zero findings. Type checks passed. Vitest 5 defaults to clearing
mocks; `clearMocks: false` explicitly preserves the suite's previous lifecycle semantics.
No accepted test was removed or weakened for the upgrade. The new Node minimum is 22.12.

The source secret scan includes new, untracked source files. Placeholder exceptions apply
only to the matched value, not to the whole file. Failure output identifies the file and
credential category without printing token characters.

`tests/session-provider.integration.test.ts` uses a real loopback HTTP connection. It verifies two messages, a tool proposal, no execution before consent, stale action-ID rejection, one successful tool execution, the result returned to the provider, and retained conversation context. Hands is mocked. This check does not prove live model access or native UI operation.

`npm run typecheck` passed after integration. `git diff --check` passed. The first full suite after documentation updates found one README expectation for `codex login`; documentation now explains why that terminal login is separate from the app-owned login. The affected test then passed unchanged.

`npm run build:js` passed after the preload fix. The compiled bridge test runs the real output with access only to a mocked Electron module. Watch startup and shutdown also passed. Real desktop and native release checks belong in `READINESS.md`.

The integrated `npm test` run at 00:34 passed all 257 tests in 38 files, including the
scoped clipboard operation and native recycle regressions. All three TypeScript projects
passed. The expanded secret scan also passed. `git diff --check` passed using the repository's
normal Windows line-ending settings.

No `ship-check` skill was installed in the available skill catalog or local skills search. Repository-native tests, TypeScript checks, build commands, UI checks, and diff review are used instead. The repository has no separate lint or formatter command.

A final independent, read-only review found no release-blocking defect in session lifecycle,
settings validation and persistence, the provider UI, API integration, IPC trust checks,
clipboard writes, or the Codex default model. Its check,
`npx vitest run tests/session-lifecycle.test.ts tests/session-settings.test.ts tests/ipc-security.test.ts tests/api-agent-client.test.ts tests/providers.test.ts tests/codex-client.test.ts`,
passed all 63 tests in six files.

The final `npm audit --json` also returned zero findings after the lockfile metadata
update. The restricted network attempt could not reach the advisory service; the
approved network retry exited 0.

The build owner reported a passing full `npm run build` and real Electron 45 checks
for a fresh profile, corrupted settings, an invalid encrypted writer key, and the
write-only clipboard IPC path. The UI owner reported 18 passing browser scenarios
against the final production bundle. Exact release commands and packaging limits
are recorded in `READINESS.md`.

The release owner built `release/qa-final-dist/Lalime-Setup-0.1.0.exe` with
`npx electron-builder --win nsis --x64 --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=release/qa-final-dist`.
The supported local Electron distribution option avoided an environment-specific
EPERM error in archive staging. No dependency was patched for that error. The packaged
app passed `node scripts/qa-electron.mjs --corrupt-settings --packaged-executable=release/qa-final-dist/win-unpacked/Lalime.exe`.
This check launched the packaged app on the current computer. It did not install the
NSIS executable, prove clean-machine behavior, or sign into a provider.

The packaged native helper also passed all seven checks with
`node scripts/qa-hands-native.mjs --hands-exe=release/qa-final-dist/win-unpacked/resources/hands/Hands.exe`.
The installer is unsigned. Its SHA256 is
`E8E6C99838BF26DF23D86149256997AD141E6399C5A4B1BA5B0CEB979D078BC7`.

## Scope limits

No real paid-provider inference was performed by this task. No provider credentials were copied from another project. Catalog support means a documented compatible protocol; it does not prove every model, account, or paid subscription works. Use a user-authorized account and the actual desktop app for that final check.
