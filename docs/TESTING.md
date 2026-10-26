# Manual test script (Jackson)

Goal: prove the **live** product path on the AORUS in under 20 minutes.

## Setup (once)

```powershell
npm install
npm test
npm run build
npm i -g @openai/codex
npm run electron
```

Pass: Electron shows onboarding and exposes the real `window.lalime` preload bridge. Browser preview alone does not prove desktop connectivity. The app uses a separate Codex account directory, so sign in through the app.

## Script

### 1. Onboarding → sign in (2 min)

1. Confirm the Lalime logo/wordmark is clear.
2. Click **Continue** through the first two screens.
3. On **Sign in**, click **Sign in with ChatGPT** and complete the browser flow. For another provider, open Settings, select the provider, enter its model ID and your own API key if required, then connect.

Pass: the account status shows a successful connection. There is **no Start demo** button. A real reply in the next check proves model access; saving a key alone does not.

### 2. Live ask (3 min)

1. First ask a plain question that needs no tools. Confirm a provider answer.
2. To test tools, enable screen sharing and computer control in Settings, save, and reconnect. Ask to open Display settings. API responses currently arrive as complete messages; Codex can emit deltas.
3. If Guardian asks for OK, expand details once, then **Do it** or **Not now**.

Pass: answers match what you typed; no silent fallback to a tidy-Downloads script.

### 3. Dangerous command blocked (2 min)

1. Use the deterministic Guardian tests for dangerous commands. Do not run destructive commands on a real computer for a demonstration.
2. A model can refuse a dangerous request in text without proposing a tool. This is valid behavior; a block card appears only when Guardian receives a blocked action.

Pass: nothing executed; reason is plain English.

### 4. Stop button (1 min)

1. Start a longer ask.
2. Click **Stop** while it is working.

Pass: Stop is visible while a task is active; the run cancels.

### 5. Signed-out / error states

1. If ChatGPT sign-in fails because Codex is missing, confirm that the error identifies the missing CLI. Install Codex and repeat the in-app sign-in. A normal terminal login uses a different account directory.
2. With no session, sending a message must ask you to sign in — never invent a demo reply.

## Automated checks

```bash
npm test && npm run typecheck
LALIME_DEMO=1 npm run fixture:headless   # Guardian fixture only — not the product path
npm run build
npm run preview &
npm run test:ui                          # sign-in onboarding smoke
npm run test:ui:chat                     # composer and chat scrolling regressions
```

All checks must exit 0. `fixture:headless` requires `LALIME_DEMO=1` and is refused without it. The repository has no separate lint or formatter command.

In PowerShell, set the fixture flag with `$env:LALIME_DEMO='1'`, then run `npm run fixture:headless`. Remove the flag after the fixture with `Remove-Item Env:LALIME_DEMO`.

`npm test` builds the JavaScript outputs before Vitest. `npm run test:watch` does this once at startup. These outputs are required by the compiled-path and sandbox-preload checks. A direct `npx vitest` command does not run the npm build hook; run `npm run build:js` first if the outputs are absent or stale.

`tests/session-provider.integration.test.ts` starts a loopback HTTP fixture and verifies a complete two-turn session through provider requests, Guardian approval, tool results, and history. It also verifies that disconnect wins over a concurrent connection. This is protocol integration testing; the fixture is not a live model.

Run `node scripts/qa-electron.mjs` after a build to check the actual desktop bridge in an isolated profile. Run `node scripts/qa-hands-native.mjs` for the native helper's bounded test cases. See `docs/READINESS.md` for current release evidence and gaps. Keep real account login and entitlement checks separate from fixtures, and never store a credential in test artifacts.

Run `node scripts/qa-electron-provider.mjs` to test the real desktop session with a local mock HTTP provider. It checks plan and reply messages, the approval card, stale approval rejection, denial, and an unknown tool. It approves no computer actions and uses no API credentials. Add `--packaged-executable=release/qa-reviewed/win-unpacked/Lalime.exe` to check the local packaged app. This fixture does not prove real model access.
