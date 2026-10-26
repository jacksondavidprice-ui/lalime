# Security verification

Date: 2026-10-25. Scope: the live agent host, Guardian consent tiers, and Windows Settings URI checks. Windows text entry was changed from SendKeys to UI Automation ValuePattern.

## Red evidence

Each test file was added before its corresponding production fix. The test assertions stayed unchanged during that fix. The exact added test files are preserved in `verification-security-red.patch`.

| Command | Exit | Evidence |
| --- | --- | --- |
| `npm test -- --run tests/live-agent-security.test.ts` | 1 | 13 failures. Two pending requests displayed two cards. Stop sent a second response. A delayed precheck created a card after Stop. Click, type, and Settings requests ran without consent. Invalid Settings URIs reached the backend. Permissions, the selected model, and the tool limit were ignored. |
| `npm test -- --run tests/live-agent-lifecycle-security.test.ts` | 1 | 3 failures. Consent remained valid after turn completion. Late text was emitted after Stop. A click without a window target created a consent card. |
| `npm test -- --run tests/live-agent-disconnect.test.ts` | 1 | 1 failure and 1 unhandled rejection when the provider response transport was closed. |
| `npm test -- --run tests/live-agent-turn-scope.test.ts` | 1 | 1 failure. A request from the old turn reached Hands while the next turn was starting. |

The initial NodeHands URI case timed out because the old code attempted to open the invalid URI through the shell. The other 12 failures in that first command were direct assertion failures. The final case now returns an error before process launch.

## Green evidence

`npm test -- --run tests/live-agent-turn-scope.test.ts tests/live-agent-disconnect.test.ts tests/live-agent-lifecycle-security.test.ts tests/live-agent-security.test.ts tests/live-agent.test.ts guardian hands/src/node-hands.test.ts`

Exit 0: 8 files and 60 tests passed.

`dotnet build hands/windows/Hands/Hands.csproj --no-restore -c Release`

The sandbox run could not read the installed Windows SDK directory. The approved retry outside the sandbox exited 0, with no warnings or errors. This verifies compilation of the URI, window target, and literal text changes. It does not verify native UI interaction.

Two existing Guardian cases were updated from silent allow to ask. This is an intentional consent contract change: opening Settings and clicking UI now require approval. The new accepted regression assertions were not changed.

## Boundaries

- The host checks the selected screen capture and computer control permissions. It uses a per-turn tool limit and rejects retired turn IDs.
- Consent applies to one queued action. The main process can supply the displayed action ID. A stale ID does not approve a different action.
- Stop and terminal provider events invalidate pending consent. A disconnected transport cannot cause an unhandled request rejection.
- Settings navigation accepts only `ms-settings:` followed by a page identifier made of letters, digits, and hyphens. Query strings and other URI schemes are rejected.
- Native text entry sets the focused editable field value. It requires the named foreground window and rejects password fields. Native controls without ValuePattern support fail with a message. No native text-entry automation test was run; the local compile and source review are the available checks for that part.
- This work does not establish that every Codex built-in command emits an approval request. Provider sandbox configuration must enforce that boundary separately.
- The full `npm run typecheck` command encountered an integration error in `src/pages/ChatHome.tsx` for the newly added `signing_in` auth state during this work. The main task owns that file and the final integrated checks.
- `$ship-check` was not available in the installed skill catalog. The main task owns final repository tests, type checks, and build verification.

## Undo and failed-action follow-up

`npm test -- --run tests/live-agent-undo.test.ts` first exited 1 with 9 failures and 1 passing case. Approval cards and activity entries claimed undo without a backend restore token. The successful recycle case with a token already passed. The host now sets approval `undoable` to false, reports no undo for Settings or commands, and enables recycle undo only when the result is successful and has a journal ID. The unchanged test file then passed.

Review found a stronger required contract: failed backend actions must not create a completed activity entry. With explicit review approval, the failed-result test expectation was changed from `undoable: false` to no activity event. Successful-result assertions stayed unchanged. This is an intentional correction of the test contract, not a change made to obtain a passing result.

The same command then exited 1 with 1 failure and 9 passes. A failed recycle operation still emitted an activity entry. After this red result, the host was changed to emit activity only when `result.response.success` is true.

Final follow-up command:

`npm test -- --run tests/live-agent-undo.test.ts tests/live-agent-security.test.ts tests/live-agent-lifecycle-security.test.ts tests/live-agent-disconnect.test.ts tests/live-agent-turn-scope.test.ts tests/live-agent.test.ts guardian`

Exit 0: 8 files and 68 tests passed. The exact initial Undo test addition and the later expectation correction are appended to `verification-security-red.patch`.

Final review found that native command approval was also recorded as completed activity before execution. The command test was deliberately strengthened: the host must send `accept`, but must not emit completed activity from approval alone. The narrow Undo command exited 1 with this one expected failure and 9 passes before the production change. The premature activity emission was then removed. Native command completion is not currently recorded in Activity; approval is not evidence of successful execution.

## Provider transport closure

`npm test -- --run tests/live-agent-transport-close.test.ts` exited 1 with 5 failures before the fix. The host did not end an active turn on transport exit or transport error. External interruption marked a running plan step done. A failed turn threw an unhandled EventEmitter error when no error listener was installed.

The unchanged tests now pass. Transport exit and transport error invalidate pending approval, retire the active turn, clear its ID, and report a generic connection error without raw transport details. Repeated terminal signals do not report a second failure. External interruption marks unfinished plan steps skipped and reports interruption. A host without an error listener uses its status event. Only successful completion emits `turnDone`.

`npm test -- --run tests/live-agent-transport-close.test.ts tests/live-agent-lifecycle-security.test.ts tests/live-agent-security.test.ts tests/live-agent-disconnect.test.ts tests/live-agent-turn-scope.test.ts tests/live-agent-undo.test.ts tests/live-agent.test.ts tests/agent-prompt.test.ts`

Exit 0: 8 files and 45 tests passed. The external agent prompt integration was preserved.
