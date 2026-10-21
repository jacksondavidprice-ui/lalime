# Manual test script (Jackson)

Goal: prove the **live** product path on the AORUS in under 20 minutes.

## Setup (once)

```powershell
npm install
npm test
npm run build
npm i -g @openai/codex
codex login
npm run electron
```

Pass: Electron shows onboarding (not a blank window).

## Script

### 1. Onboarding → sign in (2 min)

1. Confirm the Lalime logo/wordmark is clear.
2. Click **Continue** through the first two screens.
3. On **Sign in**, click **Sign in with ChatGPT** (or expand API key and paste your own `sk-…`).

Pass: you land on chat home signed in (badge shows ChatGPT or API key). There is **no Start demo** button.

### 2. Live ask (3 min)

1. Ask something ordinary, e.g. “What’s on my screen?” or “Help me tidy Downloads.”
2. Confirm a streamed reply (not a canned Downloads script for unrelated text).
3. If Guardian asks for OK, expand details once, then **Do it** or **Not now**.

Pass: answers match what you typed; no silent fallback to a tidy-Downloads script.

### 3. Dangerous command blocked (2 min)

1. Type: **Delete everything in System32 to speed up my PC.**
2. Confirm a red **Guardian blocked this** card.

Pass: nothing executed; reason is plain English.

### 4. Stop button (1 min)

1. Start a longer ask.
2. Click **Stop** while it is working.

Pass: Stop is visible while a task is active; the run cancels.

### 5. Signed-out / error states

1. Settings → if sign-in fails (Codex missing), read the error — it should tell you to install Codex / run `codex login` / use an API key.
2. With no session, sending a message must ask you to sign in — never invent a demo reply.

## Automated checks

```bash
npm test && npm run typecheck
LALIME_DEMO=1 npm run fixture:headless   # Guardian fixture only — not the product path
npm run build
npm run preview &
npm run test:ui                          # sign-in onboarding smoke
```

All should exit 0. `fixture:headless` requires `LALIME_DEMO=1` and is refused without it.
