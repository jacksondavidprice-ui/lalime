# Submission readiness

Batch 11 integration gate, October 25: local code and integration gates are GREEN; desktop release remains BLOCKED by SDK access and Electron sandbox ACL errors. Results: 732 unit tests passed (3 POSIX skips), 249 production browser checks plus 5 development checks, 4 live renderer cases, 7 compiled startup cases, 1 original withdrawal regression, 18 compiled wiring checks, 6 delete checks, 3 host-snapshot browser checks, and 7 existing-helper native checks. The fresh isolated build and typecheck pass. Live checks verify bounded named failure lists, the long-command hint, factual first-use/recap text, and prior partial/historical Undo contracts. Startup checks verify stale-ID rejection without losing valid early events. No batch 11 installer was created. See the Codex C batch 11 gate in docs/LANES.md for exact evidence, normal-terminal commands, and Jackson's remaining decisions. Earlier records below are historical.

Batch 10 integration gate, October 25: local code and integration checks are GREEN; desktop release remains BLOCKED by the SDK access and Electron sandbox ACL errors. The historical failed-Undo writer defect is fixed and verified through live SessionController/IPC/preload/renderer delivery. Real NodeHands partial Undo restores 2 of 3 files, preserves both conflicting copies, and reports matching counts and a plain-language reason. Results: 718 unit tests passed (3 POSIX skips), 241 production browser checks plus 5 development checks, 4 live cases, 1 original withdrawal regression, 18 compiled checks, 6 delete checks, 3 host-snapshot browser checks, and 7 existing-helper native checks. Typecheck and isolated build pass. No batch 10 installer was built. Exact commands, evidence, and pending normal-terminal packaging steps are in the Codex C batch 10 gate section of docs/LANES.md. Earlier records below are historical.

Batch 9 integration gate, October 25 at 09:27 CDT: NOT GREEN. Live SessionController/IPC/preload/renderer checks confirm withdrawal notices now work. Same-turn success and partial-failure Undo pass. Historical failed Undo remains a host defect: renderer and provider retain failure, but current writer facts say done and omit UNDO_FAILED. Existing gates pass: 702 unit tests (3 POSIX skips), 222 production browser checks, 5 development checks, the original withdrawal repro, 18 compiled checks, 6 delete checks, and 3 static host-snapshot browser checks. Fresh native compilation and actual Electron startup remain blocked. Seven native checks pass against the existing helper. No batch 9 installer was built. See Codex C batch 9 gate in docs/LANES.md. Earlier records below are historical.

Batch 8 integration gate, October 25 at 08:29 CDT: NOT GREEN. Existing suites pass (697 unit tests, 3 POSIX skips; 211 production browser checks plus 5 development checks), and 18 compiled checks, 6 delete-grant checks, 3 host-snapshot browser checks, typecheck, and isolated build pass. A new targeted repro fails: Undo safely withdraws pending consent and tells the provider, but no renderer-visible explanation says the approval was withdrawn. A/B must complete that requirement. Seven native checks pass against the existing helper; fresh native compilation and Electron startup remain blocked by SDK access and runtime sandbox ACL errors. No batch 8 installer was created. See `Codex C batch 8 gate` in docs/LANES.md for evidence and normal-terminal commands. Earlier gate and installer records below are historical.

Batch 7 integration gate, October 25 at 06:56 CDT: local code gates pass; desktop release gate remains BLOCKED. The shared approval metadata is now typed. Results: 598 unit tests pass (3 POSIX skips), 195 production browser checks pass, 5 development demo checks pass, 13 compiled-host/preload VM checks pass, and all 6 checks for the batch 6 chained-delete defect now pass. Typecheck and the isolated build pass. Seven native checks pass against the existing helper. Fresh native compilation still fails on SDK access; Electron startup still fails on the runtime sandbox ACL before any desktop contract assertion. No batch 7 installer was created. See `Codex C batch 7 gate` in docs/LANES.md for evidence and normal-terminal commands. The batch 6 defect and older installer evidence below are historical.

Batch 6 integration gate, October 25 at 05:58 CDT: NOT GREEN. The current tree passes typecheck, 529 unit tests (3 POSIX skips), 169 production browser checks, 5 development demo checks, and 8 isolated compiled-preload checks. A confirmed host defect offers and accepts reusable task grants for chained `.PSObject.BaseObject.Delete()` calls. The red repro is `node scripts/qa-batch6-wiring.mjs --delete-repro` (2 passed, 4 failed). Native rebuild and actual Electron startup remain blocked by environment permissions. Seven native checks pass against the existing helper only. No batch 6 installer was built. See `Codex C batch 6 gate` in docs/LANES.md for evidence and normal-terminal commands. All older installer evidence below is historical.

Batch 2 integration gate, October 25 at 02:58 CDT: NOT GREEN. The working tree is newer than qa-reviewed. Type checks, 407 unit tests (3 POSIX skips), and all 94 browser checks pass. Native rebuild and Electron startup are blocked by environment permissions. The native QA cleanup was repaired; all seven assertions now exit 0 against the existing helper, but a fresh helper build remains unverified. No batch 2 package was created. See the Codex C batch 2 gate section in docs/LANES.md; earlier evidence below applies only to the earlier artifact.

Updated: October 25, 2026. The local release package passes the checks below. Live provider use and a clean-machine install remain unverified.

The current installer is `qa-reviewed`. It includes the newer approval and Stop controls, corrected sign-in guidance, and the screen-reading permission fix. Earlier installers do not include all of these changes.

## Deadline

The [2026 official CAC rules, section 5](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf) state October 26, 2026 at noon EDT (11 a.m. CDT). Target submission on October 25. The former 8 p.m. Central deadline in the submission notes was incorrect.

## Work ownership

- Improve Lime AI app: providers, session settings, IPC, Guardian, and agent security.
- Polish Lalime app visual design: interface, onboarding, and browser regression checks.
- Polish and rigorously test app: integration checks, native release checks, and this record.

The final source build was coordinated across these tasks. Do not publish, deploy, or submit without explicit approval.

## Verified results

| Check | Command | Result |
| --- | --- | --- |
| Unit and regression suite, including secret scan | `npm test` | Exit 0; 265 tests in 39 files from the fresh export |
| Type checks | `npm run typecheck` | Exit 0; all three TypeScript projects |
| Full Windows build | `npm run build` | Exit 0; renderer, main process, sandbox preload, and self-contained native helper; no native warnings or errors |
| Dependency audit | `npm audit --json` | Exit 0; zero known advisories |
| Built browser interface | Node 24 and installed Edge; exact fallback commands below | 12 layout, 6 chat, and 20 trust checks pass; final renderer bytes match the tested build |
| Build failure handling and recycle boundary | `npx vitest run tests/windows-build.test.ts tests/windows-recycle.test.ts` | Exit 0; 19 tests |
| Native process regressions | `node scripts/qa-hands-native.mjs` | Exit 0; 7/7 |
| Actual Electron 45 app | `node scripts/qa-electron.mjs --corrupt-settings` | Exit 0; real sandbox bridge, isolated profile, onboarding, missing-provider error, safe defaults after corrupt files, and Copy reply IPC |
| Packaged Electron app | `node scripts/qa-electron.mjs --corrupt-settings --packaged-executable=release/qa-reviewed/win-unpacked/Lalime.exe` | Exit 0; same desktop checks with app.isPackaged true |
| Packaged native helper | `node scripts/qa-hands-native.mjs --hands-exe=release/qa-reviewed/win-unpacked/resources/hands/Hands.exe` | Exit 0; same 7/7 native checks |
| Packaged desktop provider and approval flow | `node scripts/qa-electron-provider.mjs --packaged-executable=release/qa-reviewed/win-unpacked/Lalime.exe` | Exit 0; five local mock HTTP exchanges, plan and reply, stale approval rejection, UI denial, and unknown-tool rejection |
| Whitespace and patch review | `git -c core.safecrlf=false diff --check` | Exit 0; independent native, packaging, backend, and UI reviews completed |

The clipboard test captures the application's attempted write in its own process. It does not read or change the host clipboard. Browser clipboard permission stays denied.

The desktop provider fixture also passed against the earlier unpackaged build with `node scripts/qa-electron-provider.mjs`. It uses the real preload and session with a local deterministic mock provider. It approves no host actions, uses no credentials, and does not prove real model access or native execution. The current packaged report is `scratch/qa-electron-provider/profile-T4NAcX/result.json`. Native execution is tested separately by the seven helper checks. HTTP provider tools do not include a generic PowerShell tool.

The final copy correction removed the welcome screen's automatic Undo claim and made manual Recycle Bin restore explicit. After that copy-only change, `npm run build:js` passed, all 18 built-browser scenarios passed again, screenshots were refreshed, and the installer and packaged desktop checks were repeated. The native helper was unchanged.

## Current UI and privacy integration

The overnight UI owner released its source at 01:27 CDT. Approval cards show concrete targets and risk, reject duplicate choices, and reset confirmation when the action changes. Higher-risk approvals require a sustained hold and release, or a separate two-step confirmation. Blocked actions offer a new request for a safer approach. Stop remains accessible inside Settings and the mobile activity panel. Continue prepares a draft for review; it does not resume automatically. The sign-in copy now directs ChatGPT users through Lalime's own account flow after CLI installation.

The owner ran all 38 browser cases against `http://127.0.0.1:43126`. It set `LALIME_URL` to that URL and `LALIME_BROWSER_CHANNEL=msedge`, then ran `node artifacts/layout-smoke-edge.ts`, `node scripts/ui-chat-regressions.ts`, and `node scripts/ui-trust-regressions.ts`. The layout copy changes only the browser channel, not assertions. The normal npm UI commands failed before execution with a `tsx` user-info error, and the required bundled Chromium was absent in that worker's environment. Node 24 and installed Edge provided the verified fallback. Earlier timing failures and unchanged successful reruns are recorded in `docs/LANES.md`; their cause is unproven. Independent review found no material defect in the confirmation logic. Physical touch and assistive-technology use remain unverified.

The privacy review found that disabling screen disclosure blocked screenshots but not window titles or UI control text. Four mocked cases reproduced the calls without permission; two enabled cases established the allowed behavior. The same permission guard now covers all three reading tools. The six accepted tests were unchanged during the fix. The targeted suite passes 19/19 and nearby checks pass 34/34. Exact red evidence is in `scratch/qa-evidence/screen-read-red.txt` and `screen-read-tests-red.patch`. No actual host windows were enumerated.

A fresh export of 199 source files, `scratch/clean-source-trust-20261025`, passes `npm ci`, `npm test` (265/265), `npm run typecheck`, and `npm run build` on Windows. The dependency audit reports zero known vulnerabilities. The native build has zero warnings or errors; Node emits a shell-option deprecation warning. The export's `scratch/qa-evidence/source-manifest.json` records source hashes. Command logs are beside it. All 77 renderer files match the isolated build covered by the 38 browser cases. The package inspection also verified the compiled privacy fix and writer assets against this export.

The main workspace was then rebuilt successfully so local launches use the same current source. Its log is `scratch/qa-evidence/current-workspace-build.log`.

The same 199-file export passes clean Linux checks with Node 22.23.4/npm 10.9.9: `npm ci`, type checks, `npm test` (255 passed, 10 existing Windows-only skips), the explicit mock fixture, and the full build. The lockfile remains byte-identical. Prompt assets match source after the pretest and full builds. Final evidence is in `scratch/linux-ci-trust-20261025/logs-retry`, with the runner retained as `scripts/verification-linux-ci-trust-20261025.sh`.

The first Linux run passed install, types, tests, and the fixture, but its full build exited 133 with a V8 Turboshaft native compiler crash after Vite succeeded. The unchanged clean retry passed without flags or code changes. The initial crash log remains in `scratch/linux-ci-trust-20261025/logs/build.log`. Its cause is unproven, and consistent build reliability is not established by one successful retry. Linux browser UI was not tested.

## Earlier clean-source verification

A separate export of 191 tracked and nonignored source files was tested without existing dependencies or generated files. The Windows copy is `scratch/clean-source-20261025-055108`. Linux used isolated Ubuntu WSL temporary directories and an official Node 24.13.0 archive, verified against its published SHA-256. Both used npm 11.6.2. This is source reproducibility testing, not a clean Windows installation test.

Four failures were found and corrected:

1. `npm ci` initially exited 1 because the lockfile omitted `@emnapi/wasi-threads@1.2.3`. Testing the actual CI runtime, Node 22 with npm 10, then exposed two more missing bundled records. The final repair adds three records in total and preserves all existing dependency versions and metadata. The exact final lockfile passes clean installation with Windows/npm 11 and Linux/npm 10. Audits reported no vulnerabilities.
2. `npm test` initially failed the compiled-path and preload checks because their generated files did not exist. The tests were unchanged. The npm `pretest` and `pretest:watch` hooks now build the JavaScript outputs. With both output directories absent before the green run, Windows `npm test` passed all 257 tests. The bounded watch command `npm run test:watch -- --run tests/app-paths.test.ts tests/preload-build.test.ts` also passed all 13 affected checks.

3. Fresh JavaScript-only and development builds omitted the writer prompt assets. Two regressions first failed when the actual compiled writer loaded its prompts. A shared copy step now runs for the full build, JavaScript-only build, and development startup. The tests remain unchanged and pass. A separate fresh `npm run build:js` check loaded the actual compiled writer and compared its full prompt with the four unchanged source files.
4. The headless fixture scripts used a POSIX environment assignment that Windows rejected. They now invoke `tsx` directly and retain the existing explicit `LALIME_DEMO` guard. The flagged mock fixture passes, and an unflagged run still fails with the expected refusal. This does not change production behavior or add automatic Undo.

Windows `npm run typecheck` and `npm run build` passed from the clean source. The native build reported zero warnings and errors. The final Windows suite has 259 passing tests in 39 files. The initial Linux Node 24 run passed 247 tests before the two asset regressions were added. The final Linux Node 22.23.4/npm 10.9.9 run passed 249 tests across 38 files, with only the 10 existing Windows-only checks skipped. Clean install, type checks, the mock fixture, and full build also passed. Writer prompt copies matched source after both the pretest build and the full build.

The final lockfile SHA-256 is `80AA8C86443D9079D519B651D7EDD2CD61D2A0A3430955514861FC3E7E7CEEE2`. This exact file was tested on both npm versions without regeneration. A broader npm 10 generated candidate changed peer flags and removed an entry needed by npm 11; it was rejected in favor of the minimal compatible patch.

Red evidence is in `scratch/qa-evidence/clean-install-red.txt` and `clean-tests-red.txt`. Linux red and green command logs are in `scratch/linux-ci-20261025/logs` and `logs-green`. The exact Linux audit runner is retained as `scripts/verification-linux-ci-20261025.sh`; it uses the saved source archive and workspace paths from this run. The Windows scratch Git ownership mismatch was handled with process-scoped trust for only that exact directory. No global Git trust was changed.

Canonical Node 22 evidence is in `scratch/linux-ci-node22-20261025/logs-final`. Its exact runner is retained as `scripts/verification-linux-ci-node22-final-20261025.sh`; the earlier generated-candidate runner is retained separately for the audit history. These scripts require the saved workspace artifacts. The actual Node 22 CI runtime is now verified for install, type checks, tests, the fixture, and build; Linux browser UI was not tested.

## Local installer

These commands completed with exit 0 from `scratch/clean-source-trust-20261025`, after the clean install, tests, type checks, and full build. Electron 45 downloads its runtime on first use; the first command prepares that distribution for packaging.

```powershell
node node_modules/electron/install.js
npx electron-builder --win nsis --x64 --publish never --config.electronDist=node_modules/electron/dist '--config.directories.output=A:/codingProjects/Lalime Congressional App/release/qa-reviewed'
```

- File: `release/qa-reviewed/Lalime-Setup-0.1.0.exe`
- Size: 234,520,276 bytes.
- SHA-256: `B02161ED9CC84D57550F9EE0691E809C982CD56791C4089D7125D378083C71C2`
- Authenticode status: `NotSigned`.
- The native runtime configuration includes .NET and Windows Desktop 8.0.29. The package includes the runtime files and the native executable passes the real-process checks.
- The installer was not installed or published. Launching the packaged executable proves its launch path on this host, not installation on a clean Windows machine.

This artifact supersedes the packages in `qa-final-dist`, `qa-submission`, `qa-clean-source`, and `qa-verified`. Packaged writer prompts match the source files. The archive inspection found no `.env`, `.git`, account, settings, or key files.

The default packaging command failed twice with EPERM while renaming the extracted Electron staging directory. A direct rename of the second staging directory also failed. The exact Windows cause is unknown. The successful command uses the supported electronDist option with the installed Electron 45.0.0 distribution. No dependency code, permission policy, or certificate check was changed. Failed staging folders remain for diagnosis.

## Defects found and corrected

1. The old sandbox preload did not expose window.lalime in the real app. The bundled CommonJS preload now passes both built-app and packaged-app checks.
2. Build scripts could continue after failed commands or accept a missing .NET SDK. They now fail immediately. A self-contained rebuild prevents a mixed native runtime layout.
3. Native errors could lose the request ID. Native output could deadlock, and timed-out or completed commands could leave child processes. Seven real-process regressions now pass, including a launcher that exits before its child.
4. Native actions returned false Undo success. Unsupported Undo now fails. File recycling uses Electron's recycle-only operation and returns no invented restore token. The old native recycling implementation was removed.
5. Backend tests cover approval identity, stale results after Stop or disconnect, provider errors, IPC trust, key storage, and conversation state. The loopback provider integration uses a real HTTP connection with mocked computer actions; it does not use a real model.

Red test copies and logs for this task are in the ignored scratch/qa-evidence directory. Backend evidence is in the docs/verification-*.md files. Desktop screenshots and isolated profiles are in scratch/qa-electron; the packaged-app check used profile-tjFpsf. UI screenshots are in artifacts/screenshots.

## Remaining evidence and limits

1. Use the intended provider account to test sign-in, one real conversation, and a harmless approved action. No real paid inference was performed. No credentials were copied from another project.
2. Install the unsigned installer in a disposable Windows guest. Verify launch, helper operation, uninstall, and a real recycle/restore round trip. Standard Sandbox, VirtualBox, VMware, and Hyper-V command discovery found no usable guest on this machine. No destructive host test was run.
3. Automatic Undo is not available. Restore recycled items manually in Windows. Stop prevents later recycle operations but cannot cancel an OS recycle operation already in progress. Process cleanup does not undo changes already made.
4. The PowerShell pre-check uses text patterns, not an AST parser. Process jobs enforce the tested lifetime cases; they are not an adversarial security sandbox.
   The live host does not assign `fromUntrustedContent`; prompt warnings do not provide automatic detection of instructions from untrusted content. State-changing tools still require permission and action-specific approval.
5. The student must confirm actual personal contributions, review the AI disclosure, record the required public video, and complete the submission. Draft authorship statements are not verification of who wrote the code.

The ship-check skill was unavailable. Repository checks were run directly. No separate lint or formatting command is defined. Restricted SDK, process cleanup, packaging, and registry checks required approved escalation; the successful results above came from those retries.

Use disposable test files and isolated profiles. Do not access personal files, change host settings, or execute destructive commands to test a block rule. The improvement objective remains incomplete. Further live-provider and Windows-guest verification requires the user's provider choice, account connection, and test environment. Submission materials also require the student's participation.
